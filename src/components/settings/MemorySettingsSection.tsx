import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Pin, Plus, Save, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/videoApi';
import {
  SettingsFieldLabel, SettingsHint, SettingsSectionTitle, SettingsTextInput,
} from './SettingsPrimitives';

/**
 * 记忆与档案。
 *
 * 为什么要有这一页：自动记忆最大的风险不是记不住，是**记错了没法纠正**。
 * 用户得能看见系统记住了什么、能改、能删、能锁定。
 *
 * 分层是刻意的：
 *   档案 / 助手设定  → 用户手填，LLM 不能改
 *   记忆条目        → 用户和 LLM 都能写，但 pinned 的 LLM 不能碰
 */

interface MemoryItem {
  id: string;
  kind: string;
  content: string;
  source: string;
  importance: number;
  pinned: boolean;
  confidence: number;
  hit_count: number;
  superseded: boolean;
}

interface Profile {
  nickname: string;
  occupation: string;
  goal: string;
  timezone: string;
  weekly_hours: number;
  language: string;
}

interface Persona {
  tone: string;
  proactivity: string;
  cite_sources: boolean;
  freeform: string;
}

const KIND_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  goal: '目标',
  constraint: '约束',
  ability: '能力',
};

const TONES = ['简洁', '详细', '严厉', '温和'];
const PROACTIVITY = ['答问', '反问', '主动推进'];

export const MemorySettingsSection: React.FC = () => {
  const [profile, setProfile] = useState<Profile>({
    nickname: '', occupation: '', goal: '', timezone: 'Asia/Shanghai', weekly_hours: 0, language: '中文',
  });
  const [persona, setPersona] = useState<Persona>({
    tone: '简洁', proactivity: '答问', cite_sources: true, freeform: '',
  });
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newKind, setNewKind] = useState('fact');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, list] = await Promise.all([
        apiFetch<{ profile: Profile; persona: Persona }>('/api/memory/profile'),
        apiFetch<MemoryItem[]>('/api/memory/items'),
      ]);
      if (res.profile) setProfile(res.profile);
      if (res.persona) setPersona(res.persona);
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveAll = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/memory/profile', {
        method: 'PUT',
        body: JSON.stringify({ profile, persona }),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }, [profile, persona]);

  const addItem = useCallback(async () => {
    const content = newContent.trim();
    if (!content) return;
    setBusy(true);
    try {
      const created = await apiFetch<MemoryItem>('/api/memory/items', {
        method: 'POST',
        body: JSON.stringify({ content, kind: newKind, importance: 3 }),
      });
      setItems((prev) => [created, ...prev]);
      setNewContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  }, [newContent, newKind]);

  const patchItem = useCallback(async (id: string, patch: Partial<MemoryItem>) => {
    try {
      const updated = await apiFetch<MemoryItem>(`/api/memory/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setItems((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    }
  }, []);

  const removeItem = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/memory/items/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }, []);

  const pinnedCount = useMemo(() => items.filter((m) => m.pinned).length, [items]);

  if (loading) return <div className="p-4 text-sm text-[#9ca3af]">加载中…</div>;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-[#f0c9c0] bg-[#fdf3f0] px-3 py-2 text-sm text-[#a33a26]">
          {error}
        </div>
      )}

      {/* 档案 */}
      <section>
        <SettingsSectionTitle>关于我</SettingsSectionTitle>
        <SettingsHint>
          这些是结构化信息，会直接影响建议的取舍（比如按每周可投入时间调整计划密度）。
          自动记忆不会修改这里。
        </SettingsHint>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <SettingsFieldLabel>称呼</SettingsFieldLabel>
            <SettingsTextInput
              value={profile.nickname}
              onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
              placeholder="希望我怎么叫你"
            />
          </div>
          <div>
            <SettingsFieldLabel>职业 / 身份</SettingsFieldLabel>
            <SettingsTextInput
              value={profile.occupation}
              onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
              placeholder="如：转行中的后端工程师"
            />
          </div>
          <div className="col-span-2">
            <SettingsFieldLabel>当前目标</SettingsFieldLabel>
            <SettingsTextInput
              value={profile.goal}
              onChange={(e) => setProfile({ ...profile, goal: e.target.value })}
              placeholder="如：三个月内拿到 AI Agent 工程师 offer"
            />
          </div>
          <div>
            <SettingsFieldLabel>每周可投入（小时）</SettingsFieldLabel>
            <SettingsTextInput
              type="number"
              value={String(profile.weekly_hours || '')}
              onChange={(e) => setProfile({ ...profile, weekly_hours: Number(e.target.value) || 0 })}
              placeholder="15"
            />
          </div>
          <div>
            <SettingsFieldLabel>时区</SettingsFieldLabel>
            <SettingsTextInput
              value={profile.timezone}
              onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
            />
          </div>
        </div>
      </section>

      {/* 助手设定 */}
      <section>
        <SettingsSectionTitle>助手设定</SettingsSectionTitle>
        <SettingsHint>控制我怎么说话。这些设定优先级高于默认风格。</SettingsHint>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <SettingsFieldLabel>语气</SettingsFieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button
                  key={t}
                  onClick={() => setPersona({ ...persona, tone: t })}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    persona.tone === t
                      ? 'border-[#2c2a27] bg-[#2c2a27] text-white'
                      : 'border-[#e5e2dd] bg-white text-[#6b7280] hover:bg-[#f5f3f0]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <SettingsFieldLabel>主动程度</SettingsFieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {PROACTIVITY.map((p) => (
                <button
                  key={p}
                  onClick={() => setPersona({ ...persona, proactivity: p })}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    persona.proactivity === p
                      ? 'border-[#2c2a27] bg-[#2c2a27] text-white'
                      : 'border-[#e5e2dd] bg-white text-[#6b7280] hover:bg-[#f5f3f0]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2">
            <SettingsFieldLabel>额外要求</SettingsFieldLabel>
            <textarea
              value={persona.freeform}
              onChange={(e) => setPersona({ ...persona, freeform: e.target.value })}
              rows={3}
              placeholder="比如：不要用「加油」「你可以的」这类空泛鼓励；回答技术问题时给可运行的代码"
              className="w-full rounded-lg border border-[#e5e2dd] bg-white px-3 py-2 text-sm text-[#2c2a27] outline-none focus:border-[#2c2a27]"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => void saveAll()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-[#2c2a27] px-3 py-1.5 text-sm text-white hover:bg-[#3d3a36] disabled:opacity-50"
          >
            <Save size={14} /> {saved ? '已保存' : '保存档案与设定'}
          </button>
        </div>
      </section>

      {/* 记忆条目 */}
      <section>
        <SettingsSectionTitle>长期记忆</SettingsSectionTitle>
        <SettingsHint>
          系统在对话里自动提取的事实和偏好。锁定的条目（{pinnedCount} 条）不会被自动更新覆盖；
          删除只做标记，不物理清除。
        </SettingsHint>

        <div className="mt-3 flex gap-2">
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            className="rounded-lg border border-[#e5e2dd] bg-white px-2 py-1.5 text-sm text-[#2c2a27]"
          >
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <SettingsTextInput
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="手动加一条，比如：不考虑需要长期出差的机会"
          />
          <button
            onClick={() => void addItem()}
            disabled={busy || !newContent.trim()}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-[#e5e2dd] bg-white px-3 py-1.5 text-sm text-[#2c2a27] hover:bg-[#f5f3f0] disabled:opacity-50"
          >
            <Plus size={14} /> 添加
          </button>
        </div>

        <div className="mt-3 space-y-1.5">
          {items.length === 0 && (
            <div className="rounded-lg border border-dashed border-[#e5e2dd] py-6 text-center text-sm text-[#9ca3af]">
              还没有记忆条目。聊几次之后会自动积累。
            </div>
          )}
          {items.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                m.pinned ? 'border-[#c8b88a] bg-[#fdf9ed]' : 'border-[#e5e2dd] bg-white'
              }`}
            >
              <span className="mt-0.5 shrink-0 rounded bg-[#f2efe9] px-1.5 py-0.5 text-[10px] text-[#6b7280]">
                {KIND_LABELS[m.kind] ?? m.kind}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#2c2a27]">{m.content}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#b8b4ad]">
                  <span>{m.source === 'manual' ? '手动' : m.source === 'inferred' ? '自动提取' : '对话'}</span>
                  <span>置信 {(m.confidence * 100).toFixed(0)}%</span>
                  {m.hit_count > 0 && <span>命中 {m.hit_count} 次</span>}
                </div>
              </div>
              <button
                onClick={() => void patchItem(m.id, { pinned: !m.pinned })}
                title={m.pinned ? '取消锁定' : '锁定，防止自动更新覆盖'}
                className="mt-0.5 shrink-0 rounded p-1 text-[#9ca3af] hover:bg-[#f2efe9] hover:text-[#2c2a27]"
              >
                {m.pinned ? <Lock size={13} /> : <Pin size={13} />}
              </button>
              <button
                onClick={() => void removeItem(m.id)}
                title="删除"
                className="mt-0.5 shrink-0 rounded p-1 text-[#9ca3af] hover:bg-[#fdf3f0] hover:text-[#a33a26]"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default MemorySettingsSection;
