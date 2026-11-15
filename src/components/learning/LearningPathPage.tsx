import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Route, Target, Sparkles, RefreshCw, CheckCircle2, Circle, PlayCircle,
  Clock, TrendingUp, AlertCircle, CircleDot, ChevronDown, ChevronRight,
} from 'lucide-react';
import { PageTitle } from '../shared';
import {
  fetchLearningProfile,
  fetchPaths,
  generatePath,
  updateStepStatus,
  updatePathStatus,
  waitForRun,
  type LearningPath,
  type LearningProfileDto,
  type PathStep,
  type StepStatus,
} from '../../lib/learningApi';

const PENDING_VIDEO_KEY = 'p2m_pending_recommended_video_id';

const STATUS_META: Record<StepStatus, { label: string; className: string }> = {
  pending: { label: '未开始', className: 'text-[#9ca3af] bg-[#f3f1ec] border-[#e5e2dd]' },
  in_progress: { label: '进行中', className: 'text-[#c87d2f] bg-[#fdf6ec] border-[#f0dcc0]' },
  done: { label: '已完成', className: 'text-[#16a34a] bg-[#f0f9f1] border-[#c8e6cc]' },
  skipped: { label: '已跳过', className: 'text-[#6b7280] bg-[#f5f5f4] border-[#e5e2dd]' },
};

function formatMinutes(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(minutes || 0));
  if (total < 60) return `${total} 分钟`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function formatClock(totalSec: number): string {
  const minutes = Math.max(0, Math.floor(totalSec || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}:${String(rest).padStart(2, '0')}` : `${rest} 分钟`;
}

/** 跳到视频页并自动播放。复用聊天面板那套 hash + 事件机制，避免两条路径各自实现。 */
function openVideo(videoId: number) {
  try {
    localStorage.setItem(PENDING_VIDEO_KEY, String(videoId));
  } catch {
    /* 隐私模式下写不进去，退化为正常跳转 */
  }
  window.location.hash = '/video';
  window.dispatchEvent(new CustomEvent('p2m:play-video', { detail: { videoId } }));
}

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; hint: string; tone: string }> = ({
  icon, label, value, hint, tone,
}) => (
  <div className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-4">
    <div className={`mb-2 flex items-center gap-2 ${tone}`}>
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-[#1a1a1a]">{value}</p>
    <p className="mt-1 text-[10px] text-[#9ca3af]">{hint}</p>
  </div>
);

const StepRow: React.FC<{
  step: PathStep;
  index: number;
  expanded: boolean;
  onToggle: (stepId: string) => void;
  onAdvance: (step: PathStep) => void;
  onReopen: (step: PathStep) => void;
  busy: boolean;
}> = ({ step, index, expanded, onToggle, onAdvance, onReopen, busy }) => {
  const meta = STATUS_META[step.status] ?? STATUS_META.pending;
  const isDone = step.status === 'done';

  return (
    <li className="relative pl-8">
      {/* 时间线主轴 */}
      <span
        className={`absolute left-[11px] top-6 h-full w-px ${isDone ? 'bg-[#c8e6cc]' : 'bg-[#e5e2dd]'}`}
        aria-hidden
      />
      <span className="absolute left-0 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[#e5e2dd] bg-white">
        {isDone ? (
          <CheckCircle2 size={15} className="text-[#16a34a]" />
        ) : step.status === 'in_progress' ? (
          <CircleDot size={15} className="text-[#c87d2f]" />
        ) : (
          <Circle size={13} className="text-[#c7c2b8]" />
        )}
      </span>

      <div className="mb-3 rounded-xl border border-[#e5e2dd] bg-white">
        <button
          type="button"
          onClick={() => onToggle(step.id)}
          className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-[#9ca3af]">STEP {index + 1}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${meta.className}`}>{meta.label}</span>
              <span className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
                <Clock size={11} /> {formatMinutes(step.est_minutes)}
              </span>
            </span>
            <span
              className={`mt-1 block text-sm font-medium ${isDone ? 'text-[#9ca3af] line-through' : 'text-[#1a1a1a]'}`}
            >
              {step.title}
            </span>
          </span>
          {expanded ? (
            <ChevronDown size={16} className="mt-1 shrink-0 text-[#9ca3af]" />
          ) : (
            <ChevronRight size={16} className="mt-1 shrink-0 text-[#9ca3af]" />
          )}
        </button>

        {expanded && (
          <div className="space-y-2 border-t border-[#f0ede8] px-3 py-2.5">
            {step.objective && (
              <p className="text-xs leading-relaxed text-[#4b5563]">{step.objective}</p>
            )}

            {step.videos.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-[#9ca3af]">配套视频（都来自你的视频库）</p>
                {step.videos.map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => openVideo(video.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-[#f0ede8] bg-[#faf9f7] px-2 py-1.5 text-left transition hover:border-[#c87d2f] hover:bg-[#fdf6ec]"
                  >
                    <PlayCircle size={14} className="shrink-0 text-[#ec4899]" />
                    <span className="min-w-0 flex-1 truncate text-xs text-[#1a1a1a]">
                      {video.title || `视频 ${video.id}`}
                    </span>
                    {video.duration ? (
                      <span className="shrink-0 text-[10px] text-[#9ca3af]">{formatClock(video.duration)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-[#fdf6ec] px-2 py-1.5 text-[11px] text-[#c87d2f]">
                这一步在你的视频库里暂时没有匹配素材，需要自己找资料补充。
              </p>
            )}

            <div className="flex gap-2 pt-1">
              {!isDone ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAdvance(step)}
                    className="rounded-lg bg-[#16a34a] px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-[#15803d] disabled:opacity-50"
                  >
                    {step.status === 'pending' ? '开始这一步' : '标记完成'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReopen(step)}
                    className="rounded-lg border border-[#e5e2dd] px-2.5 py-1 text-[11px] text-[#6b7280] transition hover:bg-[#f5f5f4] disabled:opacity-50"
                  >
                    重置
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReopen(step)}
                  className="rounded-lg border border-[#e5e2dd] px-2.5 py-1 text-[11px] text-[#6b7280] transition hover:bg-[#f5f5f4] disabled:opacity-50"
                >
                  撤销完成
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
};

export const LearningPathPage: React.FC = () => {
  const [profile, setProfile] = useState<LearningProfileDto | null>(null);
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyStep, setBusyStep] = useState(false);
  // 展开状态放在父层：勾选步骤后会重新拉数据，如果由子组件自己管，
  // 重渲染时会被重置成初始值，用户点第二下就点空了。
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  // 生成表单
  const [title, setTitle] = useState('AI Agent 工程师：补齐工程化闭环');
  const [targetRole, setTargetRole] = useState('AI Agent 工程师');
  const [deadline, setDeadline] = useState('');
  const [weeklyHours, setWeeklyHours] = useState(15);
  const [skills, setSkills] = useState('Python, FastAPI, LangChain, LangGraph, RAG');
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [genError, setGenError] = useState('');
  const [showForm, setShowForm] = useState(true);

  /** silent=true 用于操作后的刷新：不要整页切到 loading，否则展开态和滚动位置都会丢 */
  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setLoadError('');
    try {
      const [nextProfile, nextPaths] = await Promise.all([fetchLearningProfile(), fetchPaths()]);
      setProfile(nextProfile);
      setPaths(nextPaths);
      setActivePathId((current) => {
        if (current && nextPaths.some((p) => p.id === current)) return current;
        const preferred = nextPaths.find((p) => p.status === 'active') ?? nextPaths[0];
        return preferred?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activePath = useMemo(
    () => paths.find((p) => p.id === activePathId) ?? null,
    [paths, activePathId]
  );

  // 默认展开第一个还没做完的步骤；用户手动选过就尊重用户的选择
  useEffect(() => {
    if (!activePath) {
      setOpenStepId(null);
      return;
    }
    setOpenStepId((current) => {
      if (current && activePath.steps.some((s) => s.id === current)) return current;
      return activePath.steps.find((s) => s.status !== 'done')?.id ?? null;
    });
  }, [activePath]);

  const handleGenerate = async () => {
    if (!title.trim()) {
      setGenError('先给这条路径起个名字');
      return;
    }
    setGenerating(true);
    setGenError('');
    setElapsed(0);
    try {
      const { run_id } = await generatePath({
        title: title.trim(),
        target_role: targetRole.trim(),
        deadline,
        weekly_hours: weeklyHours,
        skills: skills.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      const state = await waitForRun(run_id, setElapsed);
      if (state.status === 'failed') {
        setGenError(state.error || state.result?.error || '规划失败了，换个描述再试');
      } else {
        await load();
        setShowForm(false);
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const changeStep = async (step: PathStep, status: StepStatus) => {
    setBusyStep(true);
    try {
      await updateStepStatus(step.id, status);
      // 静默刷新：保持展开状态与滚动位置，用户才能连着点「开始 → 完成」
      await load({ silent: true });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setBusyStep(false);
    }
  };

  const handleAdvance = (step: PathStep) =>
    changeStep(step, step.status === 'pending' ? 'in_progress' : 'done');
  const handleReopen = (step: PathStep) => changeStep(step, 'pending');

  const handleActivate = async (path: LearningPath) => {
    try {
      if (path.status === 'draft') await updatePathStatus(path.id, 'active');
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) {
    return (
      <div className="w-full pt-2">
        <PageTitle title="学习路径" subtitle="把模糊的目标拆成能照着做的步骤" icon={<Route size={22} />} />
        <div className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-8 text-center text-sm text-[#9ca3af]">
          正在载入你的学习数据…
        </div>
      </div>
    );
  }

  return (
    <div className="w-full pt-2 space-y-5">
      <PageTitle
        title="学习路径"
        subtitle="每一步都绑定你视频库里真实存在的视频，不是编出来的课程名"
        icon={<Route size={22} />}
        action={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-[#e5e2dd] bg-white px-3 py-1.5 text-xs text-[#4b5563] transition hover:border-[#c87d2f] hover:text-[#c87d2f]"
          >
            <Sparkles size={14} />
            {showForm ? '收起' : '规划新路径'}
          </button>
        }
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-[#f0dcc0] bg-[#fdf6ec] px-3 py-2 text-xs text-[#c87d2f]">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{loadError}</span>
          <button type="button" onClick={() => void load()} className="underline">重试</button>
        </div>
      )}

      {/* 画像概览 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Clock size={16} />}
          label="累计观看"
          value={formatMinutes(profile?.total_watch_minutes ?? 0)}
          hint={`接触 ${profile?.videos_started ?? 0} 个视频`}
          tone="text-[#c87d2f]"
        />
        <StatCard
          icon={<CheckCircle2 size={16} />}
          label="完成率"
          value={`${Math.round((profile?.completion_rate ?? 0) * 100)}%`}
          hint={`完成 ${profile?.videos_completed ?? 0} 个`}
          tone="text-[#16a34a]"
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="连续学习"
          value={`${profile?.streak_days ?? 0} 天`}
          hint={`近 30 天活跃 ${profile?.active_days_30d ?? 0} 天`}
          tone="text-[#2563eb]"
        />
        <StatCard
          icon={<Target size={16} />}
          label="单次专注"
          value={formatMinutes(profile?.avg_session_minutes ?? 0)}
          hint="按会话聚合的平均值"
          tone="text-[#8b5cf6]"
        />
      </div>

      {/* 生成表单 */}
      {showForm && (
        <div className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
            <Sparkles size={15} className="text-[#c87d2f]" />
            规划一条新路径
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-[#6b7280]">目标</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                className="w-full rounded-lg border border-[#e5e2dd] bg-white px-2.5 py-1.5 text-xs text-[#1a1a1a] outline-none focus:border-[#c87d2f]"
                placeholder="例如：3 个月补齐 RAG 工程能力"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[#6b7280]">目标岗位</span>
              <input
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                className="w-full rounded-lg border border-[#e5e2dd] bg-white px-2.5 py-1.5 text-xs text-[#1a1a1a] outline-none focus:border-[#c87d2f]"
                placeholder="AI Agent 工程师"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[#6b7280]">期限（可空）</span>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-[#e5e2dd] bg-white px-2.5 py-1.5 text-xs text-[#1a1a1a] outline-none focus:border-[#c87d2f]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[#6b7280]">每周可投入（小时）</span>
              <input
                type="number"
                min={1}
                max={80}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Number(e.target.value) || 10)}
                className="w-full rounded-lg border border-[#e5e2dd] bg-white px-2.5 py-1.5 text-xs text-[#1a1a1a] outline-none focus:border-[#c87d2f]"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-[11px] text-[#6b7280]">要覆盖的技能（逗号分隔）</span>
              <input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="w-full rounded-lg border border-[#e5e2dd] bg-white px-2.5 py-1.5 text-xs text-[#1a1a1a] outline-none focus:border-[#c87d2f]"
                placeholder="Python, FastAPI, LangGraph, RAG"
              />
            </label>
          </div>

          {genError && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-[#dc2626]">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {genError}
            </p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={generating}
              onClick={() => void handleGenerate()}
              className="flex items-center gap-1.5 rounded-lg bg-[#c87d2f] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#b06d26] disabled:opacity-60"
            >
              {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? `正在规划… ${elapsed}s` : '生成路径'}
            </button>
            <span className="text-[10px] text-[#9ca3af]">
              规划要 20–40 秒，会依次检索你库里的素材。
            </span>
          </div>
        </div>
      )}

      {/* 路径切换 */}
      {paths.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {paths.map((path) => (
            <button
              key={path.id}
              type="button"
              onClick={() => setActivePathId(path.id)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                path.id === activePathId
                  ? 'border-[#c87d2f] bg-[#fdf6ec] text-[#c87d2f]'
                  : 'border-[#e5e2dd] bg-white text-[#6b7280] hover:border-[#c87d2f]'
              }`}
            >
              {path.title.replace(' · 学习路径', '')}
              <span className="ml-1.5 text-[10px] opacity-70">{path.progress.percent}%</span>
            </button>
          ))}
        </div>
      )}

      {/* 当前路径 */}
      {!activePath ? (
        <div className="rounded-xl border border-dashed border-[#e5e2dd] bg-[#faf9f7] p-10 text-center">
          <Route size={28} className="mx-auto mb-3 text-[#c7c2b8]" />
          <p className="text-sm font-medium text-[#1a1a1a]">还没有学习路径</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#9ca3af]">
            填一下上面的目标，系统会按你的视频库和真实学习数据排一条步骤清晰的路径。
            之后在对话里问「下一步学什么」，助手会直接按这条路径回答。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e5e2dd] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-[#1a1a1a]">{activePath.title}</h3>
                {activePath.summary && (
                  <p className="mt-1 text-xs leading-relaxed text-[#4b5563]">{activePath.summary}</p>
                )}
              </div>
              {activePath.status === 'draft' && (
                <button
                  type="button"
                  onClick={() => void handleActivate(activePath)}
                  className="shrink-0 rounded-lg border border-[#c87d2f] px-2.5 py-1 text-[11px] text-[#c87d2f] transition hover:bg-[#fdf6ec]"
                >
                  设为进行中
                </button>
              )}
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-[#6b7280]">
                <span>
                  {activePath.progress.done}/{activePath.progress.total} 步完成
                </span>
                <span>
                  已投入 {formatMinutes(activePath.progress.done_minutes)} / 共{' '}
                  {formatMinutes(activePath.total_est_minutes)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f0ede8]">
                <div
                  className="h-full rounded-full bg-[#16a34a] transition-all"
                  style={{ width: `${activePath.progress.percent}%` }}
                />
              </div>
            </div>
          </div>

          <ul className="space-y-0">
            {activePath.steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                index={index}
                busy={busyStep}
                expanded={openStepId === step.id}
                onToggle={(id) => setOpenStepId((prev) => (prev === id ? null : id))}
                onAdvance={handleAdvance}
                onReopen={handleReopen}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
