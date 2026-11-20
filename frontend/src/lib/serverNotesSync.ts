import { apiFetch, ApiError } from './videoApi';
import { useNotesStore, type ServerNoteLike } from '../stores/notesStore';
import { useMdNotesStore } from '../stores/mdNotesStore';

/**
 * AI 保存笔记后，后端写的是 notes 表；便签墙和 Markdown 笔记页却各自
 * 是 IndexedDB store。没有这一步，用户会看到「已保存」但页面上找不到。
 *
 * 用服务端 id 生成稳定的本地 id（srv-<id>），重复同步不会重复插入。
 * 服务端 surface 决定归属：sticky -> 便签墙，md -> Markdown 笔记；
 * 列表同步按 surface 过滤，单篇回填也以服务端字段为准。
 */

export type ServerNoteTarget = 'sticky' | 'md';

// 撤回动作可能发生在回填请求返回之前；记下已撤回的服务端 id，
// 避免慢请求回来又把刚删掉的本地副本插回去。只压制几秒：
// 如果服务端删除失败，之后手动同步仍应能把这篇笔记重新拉回来。
const removedServerNoteIds = new Map<number, number>();
const REMOVE_SUPPRESS_MS = 5000;

function isRecentlyRemoved(noteId: number): boolean {
  const removedAt = removedServerNoteIds.get(noteId);
  if (!removedAt) return false;
  if (Date.now() - removedAt < REMOVE_SUPPRESS_MS) return true;
  removedServerNoteIds.delete(noteId);
  return false;
}

interface ServerNoteDto {
  id: number;
  title: string;
  content: string;
  source: string;
  surface?: ServerNoteTarget;
  created_at: string;
  updated_at: string;
}

/** 老服务端没有 surface 字段；按旧行为归到 Markdown 笔记。 */
function noteSurface(dto: ServerNoteDto, fallback: ServerNoteTarget): ServerNoteTarget {
  return dto.surface === 'sticky' || dto.surface === 'md' ? dto.surface : fallback;
}

function importIntoStore(note: ServerNoteLike, target: ServerNoteTarget): void {
  if (target === 'sticky') {
    useNotesStore.getState().importServerNote(note);
  } else {
    useMdNotesStore.getState().importServerNote(note);
  }
}

function toServerNote(dto: ServerNoteDto): ServerNoteLike {
  return {
    id: Number(dto.id),
    title: dto.title || '未命名笔记',
    content: dto.content || '',
    source: dto.source || '',
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export async function syncServerNoteIntoLocal(
  noteId: number,
  target: ServerNoteTarget
): Promise<boolean> {
  if (!Number.isFinite(noteId)) return false;
  try {
    const dto = await apiFetch<ServerNoteDto>(`/api/notes/${noteId}`);
    if (isRecentlyRemoved(noteId)) return false;
    const note = toServerNote(dto);
    // 服务端分类是权威：即使发起页已经切走，也不会把长文塞进便签墙。
    importIntoStore(note, noteSurface(dto, target));
    return true;
  } catch {
    // 保存动作已经成功；回填失败不应该把聊天变成报错。
    return false;
  }
}

export function removeServerNoteFromLocal(noteId: number): void {
  if (!Number.isFinite(noteId)) return;
  removedServerNoteIds.set(noteId, Date.now());
  useNotesStore.getState().removeServerNote(noteId);
  useMdNotesStore.getState().removeServerNote(noteId);
}

function localServerIds(target: ServerNoteTarget): number[] {
  const ids = new Set<number>();
  const add = (id: string) => {
    if (!id.startsWith('srv-')) return;
    const n = Number(id.slice(4));
    if (Number.isFinite(n)) ids.add(n);
  };
  if (target === 'sticky') {
    useNotesStore.getState().notes.forEach((note) => add(note.id));
    Object.keys(useNotesStore.getState().trash).forEach(add);
  } else {
    useMdNotesStore.getState().notes.forEach((note) => add(note.id));
  }
  return [...ids];
}

/**
 * 服务端列表最多返回最近 500 篇，不能拿“没出现在列表里”当删除依据。
 * 对每个不在列表里的本地副本单独 GET 一次：只有服务端明确返回 404
 * 才清掉，网络错误、超时、5xx 都保留。
 */
async function removeDeletedServerCopies(
  target: ServerNoteTarget,
  serverIds: Set<number>
): Promise<void> {
  const candidates = localServerIds(target).filter((id) => !serverIds.has(id));
  await Promise.all(
    candidates.map(async (id) => {
      try {
        await apiFetch(`/api/notes/${id}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          removeServerNoteFromLocal(id);
        }
      }
    })
  );
}

/**
 * 页面上的「从服务端同步」：把当前用户已有的私有笔记拉进本地 store。
 * 只做增量导入，已存在的 srv-<id> 或同标题同正文会复用原条目。
 */
export async function syncAllServerNotesIntoLocal(
  target: ServerNoteTarget
): Promise<number> {
  const dto = await apiFetch<ServerNoteDto[]>(
    `/api/notes?scope=private&surface=${target}`
  );
  const list = Array.isArray(dto) ? dto : [];
  const serverIds = new Set<number>();
  let imported = 0;
  for (const item of list) {
    if (!item || !Number.isFinite(Number(item.id))) continue;
    // 服务端若忽略 surface 参数（旧版本），前端再过滤一次，避免互相污染。
    if (noteSurface(item, 'md') !== target) continue;
    const note = toServerNote(item);
    serverIds.add(note.id);
    if (isRecentlyRemoved(note.id)) continue;
    importIntoStore(note, target);
    imported += 1;
  }
  await removeDeletedServerCopies(target, serverIds);
  return imported;
}
