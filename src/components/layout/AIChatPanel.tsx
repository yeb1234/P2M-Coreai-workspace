import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Send, X, Trash2, Loader2, PlayCircle, Wrench, SlidersHorizontal, Plus, History, Check, HelpCircle, ArrowRight, Undo2, FileText, CalendarDays, ListTodo } from 'lucide-react';
import { useAIStore } from '../../stores';
import type { ChatHitl, ChatAction } from '../../stores/aiStore';
import { authFetch } from '../../lib/authApi';
import { openVideoAt } from '../../lib/videoNavigation';
import {
  fetchAgentActions,
  fetchAssistantRuntimeSettings,
  streamAssistantChat,
  undoAgentAction,
  type AssistantRuntimeSettingsDto,
} from '../../lib/videoApi';
import { useDragResize } from '../../hooks/useDragResize';
import { getAssistantPageContext } from '../../lib/assistantPageContext';
import {
  DEFAULT_PROMPT_TEMPLATES,
  DEFAULT_SYSTEM_PROMPT,
  buildAIRequestSystemPrompt,
  detectIntent,
} from '../../lib/aiPromptDefaults';
import { playInteractionSound } from '../../lib/sounds';
import { renderMarkdown } from '../../lib/markdown';
import { useAssistantPageContext } from '../../hooks/useAssistantPageContext';
import { canShowChatVideoReferences } from '../../config/features';

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ASSISTANT_SETTINGS_CHANGED_EVENT = 'p2m:assistant-settings-changed';

/** 正文里提到的视频：text 是回答原文里的书名号片段，video_id 用于跳转 */
interface MentionedVideo {
  text: string;
  video_id: number;
}

interface ReferenceItem {
  video_id: number;
  video_title: string;
  /** 相对文件夹层级，如「产品经理 / Y亚慧ai产品经理课」。不含系统路径 */
  folder_path?: string;
  start_sec: number;
  /** 块的结束时间。块平均跨 114 秒，只显示起点会让人以为时间戳错了。 */
  end_sec?: number;
  /**
   * 元数据线索：课程 / 章 / 课时 / 第 N 节 / 上一节 / 下一节。
   * 由后端 retrieval_meta 从磁盘路径解析，不含系统路径。
   */
  meta?: {
    course?: string;
    lesson?: string;
    lesson_no?: number | string | null;
    display?: string;
    meta_text?: string;
    chain?: string[];
    position?: number;
    total?: number;
    prev?: string | null;
    next?: string | null;
  } | null;
  text: string;
  score?: number;
}

const TOOL_LABELS: Record<string, string> = {
  search_videos: '检索视频片段',
  search_video_titles: '查找课程',
  get_video_summary: '读取视频摘要',
  get_learning_profile: '读取学习画像',
  get_recent_activity: '查看近期学习',
  get_learning_goal: '读取学习目标',
  recommend_next_videos: '推荐下一步',
  search_notes: '检索笔记',
  save_note: '保存到笔记库',
  summarize_and_save_note: '总结并保存笔记',
  create_calendar_event: '安排日历',
  create_todo: '创建 Todo',
  ask_user: '等待你的选择',
};

const HITL_LABELS: Record<string, string> = {
  clarify: '先确认你的意图',
  supplement: '还差一点信息',
  confirm: '执行前确认',
};

function HitlCard({
  hitl,
  disabled,
  onChoose,
}: {
  hitl: ChatHitl;
  disabled: boolean;
  onChoose: (selected: string, text: string, label: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const pending = hitl.status === 'pending';
  const selectedText = hitl.customText
    ? `其它：${hitl.customText}`
    : hitl.selectedLabel || hitl.selected || '';

  return (
    <div className="mt-2.5 rounded-[var(--r-2)] border border-[var(--accent)]/40 bg-[var(--bg-card)] p-2.5 shadow-sm">
      <p className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-[var(--accent)]">
        <HelpCircle size={11} />
        {HITL_LABELS[hitl.kind] || '需要你确认'}
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-primary)]">{hitl.question}</p>
      {hitl.context && (
        <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{hitl.context}</p>
      )}

      {pending ? (
        <div className="mt-2 space-y-1.5">
          {hitl.options.map((option, index) => (
            <button
              key={`${option.id}-${index}`}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(option.id, '', option.label)}
              className="group flex w-full items-center gap-2 rounded-[var(--r-1)] border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-2 text-left text-xs leading-4 text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-elevated))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[10px] font-semibold text-[var(--accent)]">
                {option.id}
              </span>
              <span className="min-w-0 flex-1">{option.label}</span>
              <ArrowRight size={11} className="shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" />
            </button>
          ))}

          {hitl.allowCustom && !showCustom && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowCustom(true)}
              className="text-[11px] text-[var(--text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent)] disabled:opacity-50"
            >
              其它（自己填写）
            </button>
          )}
          {hitl.allowCustom && showCustom && (
            <div className="flex gap-1.5">
              <input
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && custom.trim() && !disabled) {
                    event.preventDefault();
                    onChoose('custom', custom.trim(), '其它');
                  }
                }}
                autoFocus
                placeholder="写下你的选择或补充…"
                className="min-w-0 flex-1 rounded-[var(--r-1)] border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                disabled={disabled || !custom.trim()}
                onClick={() => onChoose('custom', custom.trim(), '其它')}
                className="shrink-0 rounded-[var(--r-1)] bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
              >
                提交
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--success)]">
          <Check size={11} />
          已选择{selectedText ? `：${selectedText}` : ''}
        </p>
      )}
    </div>
  );
}

function shortProviderModel(provider: 'local' | 'external', modelName: string) {
  const label = provider === 'local' ? '本地' : '外部';
  return `${label} ${modelName.trim() || '未设置'}`;
}

function getRuntimeModelLabel(settings: AssistantRuntimeSettingsDto) {
  const local = shortProviderModel('local', settings.local_model);
  const external = shortProviderModel('external', settings.external_model);
  switch (settings.llm_usage_policy) {
    case 'external_first':
      return `先${external}，后${local}`;
    case 'local_only':
      return `只用${local}`;
    case 'external_only':
      return `只用${external}`;
    case 'local_first':
    default:
      return `先${local}，后${external}`;
  }
}

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // 超过一小时的视频按 h:mm:ss 显示，否则 mm:ss
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 把回答正文里的《视频标题》渲染成可点按钮。
 *
 * 后端在 done 阶段做了反向匹配：从回答里提取书名号 → 去掉尾部时长 →
 * 回视频表模糊匹配 → 返回 { text, video_id } 映射。
 * 工具返回给模型的文本里没有 video_id，模型不可能凭空输出链接，
 * 所以只能在回答生成完之后补这一层。
 *
 * 没命中的书名号原样输出 —— 模型有时会写「《某某理论》」这种不是视频的引用。
 */
/** 助手回答按 Markdown 渲染；有视频映射时把《标题》换成可点链接。 */
function renderAssistantMarkdown(
  text: string,
  links: MentionedVideo[],
  references: ReferenceItem[] = [],
): string {
  const html = renderMarkdown(text);
  if (!links.length) return html;
  const map = new Map(links.map((item) => [item.text, item.video_id]));
  // 同一视频在回答里可能只提到一次；用该视频首条相关片段的起始秒作为跳转定位。
  // 老消息没有 references 时保持原行为，只跳视频不定位。
  const startSecByVideo = new Map<number, number>();
  for (const item of references) {
    if (item.start_sec > 0 && !startSecByVideo.has(item.video_id)) {
      startSecByVideo.set(item.video_id, item.start_sec);
    }
  }
  return html.replace(/《[^》]{2,120}》/g, (raw) => {
    const videoId = map.get(raw);
    if (!videoId) return raw;
    const startSec = startSecByVideo.get(videoId);
    const startAttr = startSec ? ` data-start-sec="${startSec}"` : '';
    return `<a href="#video-${videoId}" data-video-id="${videoId}"${startAttr} class="ai-video-link">${raw}</a>`;
  });
}

/**
 * 一条回答对应的相关片段。
 *
 * 原来整个面板只有一个「相关片段」区块，挂在所有消息之后 ——
 * 结果它永远出现在**最新提问的下方**，看起来像是回答新问题用的，
 * 实际属于上一条回答。用户会误以为「问 Java 却推前端课」。
 *
 * 现在每条 assistant 消息渲染自己的 references，跟着回答走。
 */
function dedupeReferences(items: ReferenceItem[] | undefined): ReferenceItem[] {
  if (!items || !items.length) return [];

  // 两轮去重：
  // ① 同一视频只留最高分那条（避免同一门课刷屏）
  // ② 再按「标题 + 起始秒」去一次 —— 库里存在标题完全相同的重复视频
  //    （早期扫描路径变化留下的），video_id 不同但内容是同一个，
  //    只按 video_id 去重会并排出现两条一模一样的片段。
  const byVideo = new Map<number, ReferenceItem>();
  for (const item of items) {
    const existing = byVideo.get(item.video_id);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) byVideo.set(item.video_id, item);
  }

  const byTitle = new Map<string, ReferenceItem>();
  for (const item of byVideo.values()) {
    const key = `${(item.video_title || '').trim()}|${Math.round(item.start_sec)}`;
    const existing = byTitle.get(key);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) byTitle.set(key, item);
  }

  return [...byTitle.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5);
}

const ReferenceCard: React.FC<{
  item: ReferenceItem;
  onOpenVideo: (videoId: number, startSec?: number) => void;
}> = ({ item, onOpenVideo }) => (
  <button
    type="button"
    onClick={() => onOpenVideo(item.video_id, item.start_sec)}
    aria-label={`打开视频：${item.video_title || `视频 ${item.video_id}`}，从 ${formatTimestamp(item.start_sec)} 开始`}
    className="flex w-full items-start gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-bg)]"
  >
    <PlayCircle size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
    <div className="min-w-0">
      {(() => {
        // 优先用 meta.display（含章，如「前端 / 黑马前端V7.6 / 5-5 jQuery动画」），
        // 退回到 folder_path（只有前 2 层）。两者都没有就不显示这一行。
        const path = item.meta?.display || item.folder_path;
        const pos = item.meta?.position && item.meta?.total
          ? `第 ${item.meta.position}/${item.meta.total} 节`
          : '';
        if (!path && !pos) return null;
        return (
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={item.meta?.meta_text || path || ''}>
            {path}
            {pos && <span className="ml-1 text-[var(--accent)]">{pos}</span>}
          </p>
        );
      })()}
      <p className="truncate text-xs font-medium text-[var(--text-primary)]">
        {item.video_title || `视频 ${item.video_id}`}
      </p>
      <p className="text-xs text-[var(--accent)]">
        {formatTimestamp(item.start_sec)}
        {item.end_sec && item.end_sec > item.start_sec + 5
          ? ` – ${formatTimestamp(item.end_sec)}`
          : ''}
      </p>
      <p className="text-xs text-[var(--text-muted)] line-clamp-2">{item.text}</p>
    </div>
    <span className="ml-auto mt-0.5 shrink-0 text-[10px] font-medium text-[var(--accent)]">
      去视频
    </span>
  </button>
);

const ReferenceBlock: React.FC<{
  items: ReferenceItem[];
  label?: string;
  onOpenVideo: (videoId: number, startSec?: number) => void;
}> = ({ items, label, onOpenVideo }) => {
  if (!items.length) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-[11px] font-medium text-[var(--text-muted)]">
        {label ?? '相关片段（点击跳转）'}
      </p>
      {items.map((item) => (
        <ReferenceCard key={`${item.video_id}-${item.start_sec}`} item={item} onOpenVideo={onOpenVideo} />
      ))}
    </div>
  );
};

const ACTION_META: Record<string, { label: string; icon: React.ReactNode }> = {
  note: { label: '笔记', icon: <FileText size={13} /> },
  calendar: { label: '日历', icon: <CalendarDays size={13} /> },
  todo: { label: 'Todo', icon: <ListTodo size={13} /> },
};

const ActionReceipts: React.FC<{
  actions?: ChatAction[];
  onUndo: (action: ChatAction) => void;
  undoingId: string | null;
}> = ({ actions, onUndo, undoingId }) => {
  if (!actions?.length) return null;
  return (
    <div className="mt-2 space-y-1.5" aria-label="本轮执行记录">
      {actions.map((action) => {
        const meta = ACTION_META[action.action_type] || ACTION_META.note;
        const undone = action.status === 'undone';
        const failed = action.status === 'failed';
        return (
          <div
            key={action.id}
            className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
              failed
                ? 'border-[var(--danger)]/30 bg-[var(--danger-bg)]'
                : undone
                  ? 'border-[var(--border-light)] bg-[var(--bg-secondary)] opacity-70'
                  : 'border-[var(--border-light)] bg-[var(--bg-card)]'
            }`}
          >
            <span className="mt-0.5 text-[var(--accent)]">{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-primary)]">
                  {failed ? '执行失败' : undone ? '已撤回' : `已写入${meta.label}`}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">· {action.title}</span>
              </div>
              {action.summary && (
                <p className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-muted)]">
                  {action.summary}
                </p>
              )}
            </div>
            {action.status === 'applied' && action.can_undo !== false && (
              <button
                type="button"
                onClick={() => onUndo(action)}
                disabled={undoingId === action.id}
                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-light)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                aria-label={`撤回：${action.title}`}
              >
                {undoingId === action.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                撤回
              </button>
            )}
            {undone && <Check size={12} className="mt-1 shrink-0 text-[var(--text-muted)]" />}
          </div>
        );
      })}
    </div>
  );
};

export const AIChatPanel: React.FC<{ mobile?: boolean }> = ({ mobile = false }) => {
  const {
    chatOpen, setChatOpen, model, systemPrompt, setSystemPrompt,
    promptTemplates, activeTemplateId, updateTemplate,
    chatWidth, setChatWidth, messages, addMessage, updateMessage, setMessages, clearMessages, sessionId, setSessionId,
    pendingPrompt, consumePendingPrompt,
  } = useAIStore();
  const { width: liveChatWidth, startResize } = useDragResize({
    initialWidth: chatWidth,
    minWidth: 300,
    maxWidth: 640,
    side: 'left',
    onWidthChange: setChatWidth,
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toolHint, setToolHint] = useState('');
  const [undoingActionId, setUndoingActionId] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  // 本轮没检索到片段时，保留上一轮的引用但标记出来 —— 直接清空的话
  // 用户会以为「推荐的东西没了」，而留着不标记又会让人误当成这轮的依据。
  // 最后一次自动识别到的意图（模板 id）。显示出来让用户知道 AI 拿什么策略在答 ——
  // 原来顶部只有手动选的「学习总结」，用户问课程推荐时也显示这个，很困惑。
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  // 输入框里的实时意图。detectIntent 是几条正则，每次击键跑开销可以忽略。
  // 用户说「突然查了 Java，又想要学习路线，又想查学习状态」——意图一直在变，
  // 只在发送时算一次的话，顶部标签永远滞后一轮，用户不知道现在会用什么策略。
  const [liveIntent, setLiveIntent] = useState<string | null>(null);

  /* ── 会话管理 ──
   * 原来顶部那个「续聊中」只是个状态标签，说明不了「我现在在哪条会话」，
   * 也回不去以前聊过的东西。换成「新建对话」和「历史」两个真按钮。
   */
  interface SessionMeta {
    id: string;
    title: string | null;
    scope?: string;
    video_id?: number | null;
    message_count: number;
    updated_at: string | null;
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const startNewChat = () => {
    clearMessages();
    setReferences([]);
    setLastIntent(null);
    setHistoryOpen(false);
  };

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await authFetch('/api/assistant/sessions?limit=12');
      if (res.ok) setSessions((await res.json()) as SessionMeta[]);
    } catch {
      // 历史拉取失败不影响当前对话
    } finally {
      setLoadingSessions(false);
    }
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) void loadSessions();
  };

  const handleUndoAction = async (messageId: string, action: ChatAction) => {
    if (undoingActionId) return;
    setUndoingActionId(action.id);
    setError('');
    try {
      const result = await undoAgentAction(action.id);
      const updatedAction: ChatAction = result.action
        ? {
            ...action,
            status: result.action.status,
            can_undo: false,
            undone_at: result.action.undone_at ?? action.undone_at,
          }
        : { ...action, status: 'undone', can_undo: false };
      const existing = messages.find((m) => m.id === messageId)?.actions ?? [];
      updateMessage(messageId, {
        actions: existing.map((item) => (item.id === action.id ? updatedAction : item)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤回失败，请稍后重试');
    } finally {
      setUndoingActionId(null);
    }
  };


  const openSession = async (id: string) => {
    const res = await authFetch(`/api/assistant/sessions/${encodeURIComponent(id)}/messages?limit=50`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        references?: ReferenceItem[];
        /** 后端 references_json envelope 里带回来的富内容 */
        mentioned_videos?: MentionedVideo[];
        intent?: string | null;
        actions?: ChatAction[];
        created_at?: string | null;
      }>;
    };
    setSessionId(id);
    const mapped = data.messages.map((m) => ({
        id: m.id || makeId(),
        role: m.role,
        content: m.content,
        references: m.references ?? [],
        // 这两个字段以前后端不存，历史会话加载后正文链接和意图标签全丢。
        // 现在随消息一起还原，历史会话和当前会话显示一致。
        mentioned_videos: m.mentioned_videos ?? [],
        intent: m.intent ?? undefined,
        actions: m.actions ?? [],
      }));
    setMessages(mapped);
    // 消息里的 actions 是写入当时的快照；撤回状态以动作表为准。
    // 重开历史时对一次状态，否则已撤回的记录仍会显示「撤回」按钮。
    void fetchAgentActions(100)
      .then((latest) => {
        const byId = new Map(latest.items.map((item) => [item.id, item]));
        const reconciled = mapped.map((message) =>
          message.actions?.length
            ? {
                ...message,
                actions: message.actions.map((action) => {
                  const current = byId.get(action.id);
                  return current
                    ? {
                        ...action,
                        status: current.status,
                        can_undo: current.can_undo ?? current.status === 'applied',
                        undone_at: current.undone_at ?? action.undone_at,
                      }
                    : action;
                }),
              }
            : message
        );
        setMessages(reconciled);
      })
      .catch(() => undefined);
    setReferences([]);
    // 意图标签取最近一条 assistant 消息的，和历史消息对得上
    const lastWithIntent = [...data.messages].reverse().find((m) => m.intent);
    setLastIntent(lastWithIntent?.intent ?? null);
    setHistoryOpen(false);
  };

  // 提示词编辑器：用户要能直接看到「这次用的是什么提示词」并当场改。
  // 原来得跳到灵境小助手页去改，对话中完全看不到，出了问题没法定位。
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [draftSystem, setDraftSystem] = useState('');
  const [draftTemplate, setDraftTemplate] = useState('');

  // 当前生效的模板：自动识别优先，认不出来用手动选的
  const effectiveTemplateId = liveIntent ?? lastIntent ?? activeTemplateId;
  const editableTemplate =
    promptTemplates.find((t) => t.id === effectiveTemplateId)
    ?? DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === effectiveTemplateId);

  const togglePromptEditor = () => {
    if (!promptExpanded) {
      // 打开时把当前生效值灌进草稿，取消就是丢弃改动
      setDraftSystem(systemPrompt);
      setDraftTemplate(editableTemplate?.content ?? '');
    }
    setPromptExpanded((v) => !v);
  };

  const savePromptEditor = () => {
    setSystemPrompt(draftSystem);
    if (effectiveTemplateId) {
      updateTemplate(effectiveTemplateId, { content: draftTemplate });
    }
    setPromptExpanded(false);
  };

  const resetPromptEditor = () => {
    setDraftSystem(DEFAULT_SYSTEM_PROMPT);
    const def = DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === effectiveTemplateId);
    if (def) setDraftTemplate(def.content);
  };
  const [pageContext, setPageContext] = useAssistantPageContext(chatOpen);
  const [runtimeModelLabel, setRuntimeModelLabel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * 回答里的视频引用：先跳到视频，再收起手机上的整屏 AI。
   * 桌面端侧栏可以一直开着，保持原来的行为。
   */
  const openAssistantVideo = React.useCallback(
    (videoId: number, startSec?: number) => {
      openVideoAt(videoId, startSec);
      if (mobile) setChatOpen(false);
    },
    [mobile, setChatOpen]
  );

  /**
   * 正文链接的点击必须尽早处理。
   * 消息正文是 dangerouslySetInnerHTML，点击序列中 AIChatPanel 发生重渲染，
   * mousedown 到 mouseup 之间原 anchor 会从 DOM 里被替换掉，浏览器不再合成
   * click；所以这里在 pointerdown 就完成跳转。
   * 键盘 Enter/Space 仍走 onClick 兜底。
   */
  const lastVideoActivationRef = useRef<{ videoId: number; at: number } | null>(null);
  const activateVideoLink = React.useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    const target = (event.target as HTMLElement | null)?.closest?.('a[data-video-id]') as HTMLAnchorElement | null;
    const videoId = Number(target?.dataset.videoId);
    if (!videoId) return;
    event.preventDefault();
    const now = Date.now();
    const last = lastVideoActivationRef.current;
    if (last && last.videoId === videoId && now - last.at < 500) return;
    lastVideoActivationRef.current = { videoId, at: now };
    const startSec = Number(target?.dataset.startSec);
    openAssistantVideo(videoId, Number.isFinite(startSec) && startSec > 0 ? startSec : undefined);
  }, [openAssistantVideo]);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // 题目详情等入口通过 pendingPrompt 预填问题；面板已经开着时也要生效。
  useEffect(() => {
    if (!chatOpen || !pendingPrompt) return;
    setInput(pendingPrompt);
    setLiveIntent(detectIntent(pendingPrompt, pageContext?.kind));
    consumePendingPrompt();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [chatOpen, pendingPrompt, consumePendingPrompt, pageContext?.kind]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const activeTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0],
    [activeTemplateId, promptTemplates]
  );

  useEffect(() => {
    if (!chatOpen) return;
    let cancelled = false;
    const refreshRuntimeSettings = async () => {
      try {
        const settings = await fetchAssistantRuntimeSettings();
        if (!cancelled) setRuntimeModelLabel(getRuntimeModelLabel(settings));
      } catch {
        if (!cancelled) setRuntimeModelLabel('');
      }
    };
    void refreshRuntimeSettings();
    window.addEventListener('focus', refreshRuntimeSettings);
    window.addEventListener(ASSISTANT_SETTINGS_CHANGED_EVENT, refreshRuntimeSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshRuntimeSettings);
      window.removeEventListener(ASSISTANT_SETTINGS_CHANGED_EVENT, refreshRuntimeSettings);
    };
  }, [chatOpen]);

  if (!chatOpen) return null;

  /** 按动画帧合并流式 token，避免每个字都触发一次 React 重渲染 */
  const scheduleFlush = (assistantId: string) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const text = bufferRef.current;
      useAIStore.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: text } : message
        ),
      }));
    });
  };

  const patchMessage = (assistantId: string, patch: Record<string, unknown>) => {
    useAIStore.setState((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantId ? { ...message, ...patch } : message
      ),
    }));
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setToolHint('');
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError('');
    setInput('');
    setLiveIntent(null);
    setToolHint('');
    // 必须清空上一轮的检索结果。
    // 「流式过程中的临时片段」区块读的就是这个 state —— 不清的话，
    // 新一轮刚发出、还没检索回来的那几秒，界面上会挂着**上一轮**的片段，
    // 用户会以为「这次问的问题检索到了这些」，而它们和当前问题毫无关系。
    // （按消息归属渲染的那部分不受影响：每条历史消息自己带 references。）
    setReferences([]);

    addMessage({ id: makeId(), role: 'user', content: text });
    setLoading(true);
    playInteractionSound('start');

    const assistantId = makeId();
    bufferRef.current = '';
    addMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const controller = new AbortController();
    abortRef.current = controller;
    const usedTools: string[] = [];
    let streamError = '';
    let interrupted = false;

    /* 静默看门狗：流式请求本身没有超时，模型卡住时前端会永远转「正在思考」。
       用户截图里就卡在这个状态，只能手动关面板。
       规则：90 秒内没有收到任何事件（token / tool_start / tool_end）就主动中止。
       收到事件就重新计时，所以长回答只要在持续输出就不会被误杀。 */
    const watchdog = { timer: null as number | null, fired: false };
    const rearmWatchdog = () => {
      if (watchdog.timer) window.clearTimeout(watchdog.timer);
      watchdog.timer = window.setTimeout(() => {
        watchdog.fired = true;
        controller.abort();
      }, 90_000);
    };
    rearmWatchdog();

    try {
      const context = getAssistantPageContext();
      setPageContext(context);

      // 按用户这次的问题自动选意图模板。认不出来就退回手动选的模板 ——
      // 宁可不认，也不要认错（认错会让 AI 用完全错误的策略回答）。
      const detected = detectIntent(text, context.kind);
      setLastIntent(detected);
      const effectiveTemplate = detected
        ? promptTemplates.find((t) => t.id === detected) ?? activeTemplate
        : activeTemplate;
      const requestSystemPrompt = buildAIRequestSystemPrompt(
        systemPrompt,
        effectiveTemplate?.content ?? ''
      );

      await streamAssistantChat(text, {
        sessionId,
        pageContext: context.promptContext,
        pageNote: context.notePayload,
        systemPrompt: requestSystemPrompt,
        // 把识别出的意图一起存库，历史会话加载后才能还原「当时用的策略」
        intent: detected,
        onEvent: (event) => {
          rearmWatchdog();
          switch (event.type) {
            case 'token':
              bufferRef.current += event.text;
              scheduleFlush(assistantId);
              break;
            case 'tool_start':
              usedTools.push(event.tool);
              setToolHint(TOOL_LABELS[event.tool] ?? event.tool);
              break;
            case 'tool_end':
              setToolHint('');
              break;
            case 'interrupt':
              interrupted = true;
              setToolHint('');
              if (event.session_id && event.session_id !== sessionId) {
                setSessionId(event.session_id);
              }
              updateMessage(assistantId, {
                streaming: false,
                steps: usedTools,
                intent: event.intent ?? detected ?? undefined,
                hitl: {
                  runId: event.run_id,
                  interruptId: event.interrupt_id,
                  kind: event.kind,
                  question: event.question,
                  options: event.options || [],
                  allowCustom: event.allow_custom !== false,
                  context: event.context,
                  intent: event.intent ?? detected ?? null,
                  originalMessage: event.original_message,
                  status: 'pending',
                },
              });
              break;
            case 'done':
              setToolHint('');
              if (event.session_id && event.session_id !== sessionId) {
                setSessionId(event.session_id);
              }
              if (event.mentioned_videos?.length) {
                    // 写回消息本身：刷新/重开页面后链接还在
                updateMessage(assistantId, { mentioned_videos: event.mentioned_videos });
              }
              if (event.references?.length) {
                setReferences(event.references);
                updateMessage(assistantId, { references: event.references });
              }
              if (event.actions?.length) {
                // 执行回执跟着这条回答走：保存了什么、在哪、能不能撤回
                updateMessage(assistantId, { actions: event.actions as ChatAction[] });
              }
              if (event.degraded_from) {
                // 主通道挂了、是备用救回来的。不提示的话用户只会觉得
                // 「这次回答怎么这么慢 / 质量不一样」，不知道发生了什么。
                updateMessage(assistantId, { degraded_from: event.degraded_from });
              }
              if (detected) {
                updateMessage(assistantId, { intent: detected });
              }
              break;
            case 'error':
              streamError = event.message;
              setError(event.message);
              break;
            default:
              break;
          }
        },
        signal: controller.signal,
      });

      const finalText = bufferRef.current.trim();
      if (finalText) playInteractionSound('success');
      patchMessage(assistantId, {
        content: interrupted ? finalText : (finalText || streamError || '（没有返回内容，请重试）'),
        streaming: false,
        steps: usedTools,
      });
      if (finalText) setError('');
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const message = watchdog.fired
        ? '模型 90 秒没有返回任何内容，已自动停止'
        : aborted
          ? '已停止生成'
          : err instanceof Error
            ? err.message
            : '对话请求失败';
      if (watchdog.fired) {
        // 中止是我们主动发的，但这不是「用户停止」，要给可操作的建议
        setError('模型长时间无响应，已自动停止。可以重试，或在设置里换成更快的模型。');
        playInteractionSound('error');
      } else if (!aborted) {
        setError(
          /Failed to fetch|NetworkError/i.test(message)
            ? '连不上后端，请确认服务是否已启动'
            : message
        );
        playInteractionSound('error');
      }
      patchMessage(assistantId, {
        content: bufferRef.current.trim() || (aborted ? '已停止生成。' : '请求失败，请检查后端与模型服务。'),
        streaming: false,
      });
    } finally {
      if (watchdog.timer) window.clearTimeout(watchdog.timer);
      abortRef.current = null;
      setLoading(false);
      setToolHint('');
    }
  };

  /**
   * HITL 续跑：不重新写一条用户问题，只把 A/B/C 选择作为 resume 交给同一个
   * LangGraph thread。后端用 Command(resume=...) 从 checkpoint 继续，
   * 模型看到的是工具返回结果，不会把原问题再问一遍。
   */
  const resumeFromHitl = async (
    assistantId: string,
    hitl: ChatHitl,
    selected: string,
    text: string,
    label: string,
  ) => {
    if (loading || hitl.status !== 'pending') return;
    setError('');
    setToolHint('');

    const choiceText = selected === 'custom' ? `其它：${text}` : `${selected}. ${label}`;
    updateMessage(assistantId, {
      hitl: {
        ...hitl,
        status: 'answered',
        selected,
        selectedLabel: label,
        customText: text || undefined,
      },
      streaming: false,
    });
    addMessage({ id: makeId(), role: 'user', content: choiceText });

    const nextAssistantId = makeId();
    bufferRef.current = '';
    addMessage({ id: nextAssistantId, role: 'assistant', content: '', streaming: true });
    setLoading(true);
    playInteractionSound('start');

    const controller = new AbortController();
    abortRef.current = controller;
    const usedTools: string[] = [];
    let streamError = '';
    let interrupted = false;

    const watchdog = { timer: null as number | null, fired: false };
    const rearmWatchdog = () => {
      if (watchdog.timer) window.clearTimeout(watchdog.timer);
      watchdog.timer = window.setTimeout(() => {
        watchdog.fired = true;
        controller.abort();
      }, 90_000);
    };
    rearmWatchdog();

    try {
      const context = getAssistantPageContext();
      setPageContext(context);
      await streamAssistantChat(text || label || '继续', {
        sessionId,
        pageContext: context.promptContext,
        pageNote: context.notePayload,
        intent: hitl.intent ?? undefined,
        resume: {
          runId: hitl.runId,
          interruptId: hitl.interruptId,
          selected,
          text,
          originalMessage: hitl.originalMessage || hitl.question,
        },
        onEvent: (event) => {
          rearmWatchdog();
          switch (event.type) {
            case 'token':
              bufferRef.current += event.text;
              scheduleFlush(nextAssistantId);
              break;
            case 'tool_start':
              usedTools.push(event.tool);
              setToolHint(TOOL_LABELS[event.tool] ?? event.tool);
              break;
            case 'tool_end':
              setToolHint('');
              break;
            case 'interrupt':
              interrupted = true;
              setToolHint('');
              if (event.session_id && event.session_id !== sessionId) {
                setSessionId(event.session_id);
              }
              updateMessage(nextAssistantId, {
                streaming: false,
                steps: usedTools,
                intent: event.intent ?? hitl.intent ?? undefined,
                hitl: {
                  runId: event.run_id,
                  interruptId: event.interrupt_id,
                  kind: event.kind,
                  question: event.question,
                  options: event.options || [],
                  allowCustom: event.allow_custom !== false,
                  context: event.context,
                  intent: event.intent ?? hitl.intent ?? null,
                  originalMessage: event.original_message,
                  status: 'pending',
                },
              });
              break;
            case 'done':
              setToolHint('');
              if (event.session_id && event.session_id !== sessionId) {
                setSessionId(event.session_id);
              }
              if (event.mentioned_videos?.length) {
                updateMessage(nextAssistantId, { mentioned_videos: event.mentioned_videos });
              }
              if (event.references?.length) {
                setReferences(event.references);
                updateMessage(nextAssistantId, { references: event.references });
              }
              if (event.actions?.length) {
                updateMessage(nextAssistantId, { actions: event.actions as ChatAction[] });
              }
              if (event.degraded_from) {
                updateMessage(nextAssistantId, { degraded_from: event.degraded_from });
              }
              if (hitl.intent) {
                updateMessage(nextAssistantId, { intent: hitl.intent });
              }
              break;
            case 'error':
              streamError = event.message;
              setError(event.message);
              break;
            default:
              break;
          }
        },
        signal: controller.signal,
      });

      const finalText = bufferRef.current.trim();
      if (finalText) playInteractionSound('success');
      patchMessage(nextAssistantId, {
        content: interrupted ? finalText : (finalText || streamError || '（没有返回内容，请重试）'),
        streaming: false,
        steps: usedTools,
      });
      if (finalText) setError('');
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const message = watchdog.fired
        ? '模型 90 秒没有返回任何内容，已自动停止'
        : aborted
          ? '已停止生成'
          : err instanceof Error
            ? err.message
            : '对话请求失败';
      if (!aborted) {
        setError(
          /Failed to fetch|NetworkError/i.test(message)
            ? '连不上后端，请确认服务是否已启动'
            : message
        );
        playInteractionSound('error');
      }
      patchMessage(nextAssistantId, {
        content: bufferRef.current.trim() || (aborted ? '已停止生成。' : '请求失败，请检查后端与模型服务。'),
        streaming: false,
      });
    } finally {
      if (watchdog.timer) window.clearTimeout(watchdog.timer);
      abortRef.current = null;
      setLoading(false);
      setToolHint('');
    }
  };

  return (
    <aside
      className={`ai-panel relative shrink-0 border-l border-[var(--border-light)] bg-[var(--bg-card)] flex flex-col ${
        mobile ? 'ai-panel-mobile' : ''
      }`}
      style={mobile ? undefined : { width: `${liveChatWidth}px` }}
    >
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); startResize(e.clientX); }}
        onTouchStart={(e) => { e.preventDefault(); startResize(e.touches[0].clientX); }}
        className="ai-panel-resize absolute -left-3 top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)]"
        title="拖动调整灵境小助手宽度"
      >
        <span className="h-full w-px bg-[var(--border-light)]" />
        <span className="absolute h-12 w-1 rounded-full bg-[var(--border-medium)] opacity-60" />
      </button>
      <div className="h-14 px-3 border-b border-[var(--border-light)] flex items-center gap-2">
        <Bot size={17} className="text-[var(--accent)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">灵境小助手</p>
          <p className="truncate text-xs text-[var(--text-muted)]" title={runtimeModelLabel || model}>
            {runtimeModelLabel || model}
          </p>
        </div>
        {/* 原来这里是「续聊中」状态标签：只能看不能用。
            换成两个真按钮 —— 回历史、开新对话。 */}
        <button
          type="button"
          onClick={toggleHistory}
          className={`rounded-lg p-1.5 transition-colors ${
            historyOpen
              ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
          }`}
          title="聊天历史"
          aria-label="聊天历史"
        >
          <History size={14} />
        </button>
        <button
          type="button"
          onClick={startNewChat}
          className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
          title="新建对话"
          aria-label="新建对话"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={() => {
            clearMessages();
            setReferences([]);
                    setLastIntent(null);
            playInteractionSound('delete');
          }}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
          title="清空对话（同时开启新会话）"
          aria-label="清空对话"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={() => setChatOpen(false)}
          className="ai-panel-close p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          title="关闭灵境小助手"
          aria-label="关闭灵境小助手"
        >
          <X size={15} />
        </button>
      </div>

      {/* 聊天历史弹层：贴在 header 下方，不挤压消息区 */}
      {historyOpen && (
        <div className="absolute left-2 right-2 top-14 z-40 overflow-hidden rounded-[var(--r-2)] border border-[var(--border-medium)] bg-[var(--bg-card)] shadow-[var(--shadow-2)]">
          <div className="flex items-center justify-between border-b border-[var(--border-light)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">聊天历史</span>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="关闭历史"
            >
              <X size={13} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loadingSessions ? (
              <p className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">加载中…</p>
            ) : sessions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">还没有历史对话</p>
            ) : (
              sessions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openSession(item.id)}
                  className={`w-full border-b border-[var(--border-light)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--bg-elevated)] ${
                    item.id === sessionId ? 'bg-[var(--accent-bg)]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]"
                      title={item.title || '未命名对话'}
                    >
                      {item.title || '未命名对话'}
                    </p>
                    {item.scope === 'video' && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                        视频
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                    <span className="font-mono text-[var(--text-secondary)]">
                      #{item.id.slice(-6)}
                    </span>
                    <span>·</span>
                    <span>{item.message_count} 条</span>
                    {item.updated_at
                      ? ` · ${new Date(item.updated_at).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-1.5">
        {/* 当前生效的意图：正在打字时取实时识别结果，空闲时取上一轮实际用过的。
            两者都为空才退回手动选的模板。 */}
        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
          {liveIntent ? '当前意图' : lastIntent ? '上轮意图' : '模板'}
        </span>
        <span className="truncate text-xs font-medium text-[var(--text-primary)]">
          {(() => {
            const effective = liveIntent ?? lastIntent;
            if (!effective) return activeTemplate?.name ?? '默认模板';
            return (
              promptTemplates.find((t) => t.id === effective)?.name
              ?? DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === effective)?.name
              ?? effective
            );
          })()}
        </span>
        {(liveIntent || lastIntent) && (
          <span
            className="shrink-0 text-[10px] text-[var(--text-muted)]"
            title={liveIntent ? '根据你正在输入的内容实时识别' : '根据你上一句问题自动选择'}
          >
            {liveIntent ? '实时' : '自动'}
          </span>
        )}
        <button
          type="button"
          onClick={togglePromptEditor}
          title="查看 / 修改提示词"
          aria-label="查看或修改提示词"
          className={`ml-auto shrink-0 rounded p-1 transition-colors ${
            promptExpanded
              ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
          }`}
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>

      {/* 提示词编辑器。原来提示词藏在设置页里，对话中出了问题完全看不到，
          用户不知道 AI 是拿什么策略在答。现在直接摊开在对话上方。 */}
      {promptExpanded && (
        <div className="space-y-2.5 border-b border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2.5">
          <div>
            <p className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">
              系统提示词
              <span className="ml-1 font-normal text-[var(--text-muted)]">· 所有对话共用</span>
            </p>
            <textarea
              value={draftSystem}
              onChange={(e) => setDraftSystem(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-[var(--r-1)] border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1.5 text-[11px] leading-4 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">
              模板提示词 · {editableTemplate?.name ?? '默认'}
              <span className="ml-1 font-normal text-[var(--text-muted)]">· 仅此意图使用</span>
            </p>
            <textarea
              value={draftTemplate}
              onChange={(e) => setDraftTemplate(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-[var(--r-1)] border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1.5 text-[11px] leading-4 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={savePromptEditor}
              className="rounded-[var(--r-1)] bg-[var(--accent)] px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              保存
            </button>
            <button
              type="button"
              onClick={resetPromptEditor}
              className="rounded-[var(--r-1)] border border-[var(--border-light)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={() => setPromptExpanded(false)}
              className="ml-auto px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              取消
            </button>
          </div>
          <p className="text-[10px] leading-4 text-[var(--text-muted)]">
            保存后下一次提问生效，不影响已经发出的消息。
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-muted)]">试试这样问：</p>
            {[
              '库里有讲 React Hooks 的视频吗',
              '我最近学得怎么样',
              '下一步该学什么',
            ].map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="w-full rounded-[var(--r-1)] border border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-2 text-left text-xs leading-5 text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
              >
                {q}
              </button>
            ))}
            <p className="pt-1 text-[11px] leading-5 text-[var(--text-muted)]">
              回答会带上视频名与时间点，点一下直接跳到那一秒。
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-6 ${
                message.role === 'user'
                  ? 'bg-[var(--accent)] text-white whitespace-pre-wrap'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-light)] whitespace-normal'
              }`}
            >
              {message.content
                ? (message.role === 'assistant'
                    ? (
                      <div
                        className="ai-md"
                        onPointerDown={(event) => {
                          if (event.pointerType !== 'mouse' || event.button !== 0) return;
                          activateVideoLink(event);
                        }}
                        onClick={activateVideoLink}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          const target = (event.target as HTMLElement | null)?.closest?.('a[data-video-id]');
                          if (!target) return;
                          event.preventDefault();
                          activateVideoLink(event);
                        }}
                        dangerouslySetInnerHTML={{
                          __html: renderAssistantMarkdown(
                            message.content,
                            message.mentioned_videos ?? [],
                            message.references ?? [],
                          ),
                        }}
                      />
                    )
                    : message.content)
                : (message.streaming ? '…' : '')}
              {message.streaming && message.content && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[var(--accent)] align-middle" />
              )}
              {message.role === 'assistant' && message.hitl && (
                <HitlCard
                  hitl={message.hitl}
                  disabled={loading}
                  onChoose={(selected, text, label) => {
                    void resumeFromHitl(message.id, message.hitl!, selected, text, label);
                  }}
                />
              )}
              {message.role === 'assistant' && (
                <ActionReceipts
                  actions={message.actions}
                  onUndo={(action) => void handleUndoAction(message.id, action)}
                  undoingId={undoingActionId}
                />
              )}
              {message.role === 'assistant' && message.steps && message.steps.length > 0 && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <Wrench size={10} />
                  调用了 {message.steps.length} 次工具
                </p>
              )}
              {message.role === 'assistant' && message.degraded_from && (
                <p
                  className="mt-1 flex items-center gap-1 text-[11px] text-[var(--warn)]"
                  title={`主通道 ${message.degraded_from} 调用失败，这条回答由备用模型生成`}
                >
                  <AlertCircle size={10} />
                  已从 {message.degraded_from === 'external' ? '外部' : '本地'} 降级
                </p>
              )}
            </div>
            {/* 相关片段挂在这条回答下面，而不是整个对话的最底部。
                2026-11-17：只对「问题解答」渲染 —— 该意图的正文来自通用知识，
                底部视频卡片作为继续学习的延伸入口；其他意图继续保持清爽。 */}
            {canShowChatVideoReferences(message.intent) &&
              message.role === 'assistant' &&
              !message.streaming && (
              <div className="w-full max-w-[88%]">
                <ReferenceBlock
                  items={dedupeReferences(message.references)}
                  label="想进一步了解？相关视频片段"
                  onOpenVideo={openAssistantVideo}
                />
              </div>
            )}
          </div>
        ))}
        {toolHint && (
          <div className="flex items-center gap-2 text-xs text-[var(--accent)]">
            <Loader2 size={11} className="animate-spin" />
            {toolHint}…
          </div>
        )}
        {loading && !toolHint && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={13} className="animate-spin" />
            灵境小助手正在思考...
          </div>
        )}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div ref={messagesEndRef} />
        {/* 流式过程中的临时引用。
            消息生成完会把 references 写回 message，之后由每条回答自己渲染；
            这里只负责「回答还在流、但检索已经先回来了」这段空窗期。
            同样只对「问题解答」开放，避免其他意图闪出卡片。 */}
        {canShowChatVideoReferences(lastIntent) &&
          loading &&
          dedupeReferences(references).length > 0 && (
          <div className="w-full">
            <ReferenceBlock
              items={dedupeReferences(references)}
              label="想进一步了解？相关视频片段（检索中）"
              onOpenVideo={openAssistantVideo}
            />
          </div>
        )}
      </div>

      <div className="p-3 border-t border-[var(--border-light)]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const next = e.target.value;
              setInput(next);
              setLiveIntent(detectIntent(next, pageContext?.kind));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="发消息…"
            title="Enter 发送，Shift+Enter 换行"
            className="min-h-[40px] max-h-28 flex-1 resize-none rounded-[var(--r-1)] border border-[var(--border-light)] bg-[var(--bg-card)] px-2.5 py-[10px] text-xs leading-5 text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
          />
          {loading ? (
            <button
              onClick={stopStreaming}
              className="self-end rounded-[var(--r-1)] border border-[var(--danger)] p-2.5 text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
              title="停止生成"
            >
              <X size={15} />
            </button>
          ) : (
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim()}
              className="self-end rounded-[var(--r-1)] bg-[var(--accent)] p-2.5 text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              title="发送"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
