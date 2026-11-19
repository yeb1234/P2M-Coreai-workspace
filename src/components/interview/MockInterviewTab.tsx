import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { evaluateInterviewAnswer, fetchInterviewQuestionDetail, fetchInterviewQuestionSummaries } from '../../lib/interviewApi';
import { GROUP_LABELS, GROUP_ORDER, typeLabel } from '../../data/interview/labels';
import { profileForQuestion, projectProfilePrompt } from '../../data/interview/projectProfiles';
import { renderMarkdown } from '../../lib/markdown';
import {
  CUSTOM_ROUND_CONFIG,
  ROUND_CATEGORY_LABELS,
  ROUND_CATEGORY_ORDER,
  ROUND_PRESETS,
  buildRoundQuestions,
  roundConfigSummary,
  roundConfigTotal,
} from '../../lib/interviewRound';
import type { RoundCategory, RoundConfig } from '../../lib/interviewRound';
import type { InterviewAttempt, InterviewEvaluation, InterviewQuestionSummary, InterviewState } from '../../data/interview/types';

interface MockInterviewTabProps {
  progress: Record<string, InterviewState>;
  attempts: InterviewAttempt[];
  pinnedQuestionId: string | null;
  onEvaluationDone: (result: InterviewEvaluation) => void;
  onOpenDetail: (question: InterviewQuestionSummary) => void;
  onMastered: (question: { id: string }, mastered: boolean) => void;
  onOpenP5Compare: (seedText?: string) => void;
}

const CAPABILITY_DEFS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '全部' },
  ...GROUP_ORDER.map((key) => ({ key, label: GROUP_LABELS[key] })),
  { key: 'project', label: '项目题' },
  { key: 'personal', label: '个人项目' },
];

const RESUME_DEFS: Array<{ key: string; label: string }> = [
  { key: 'resume:core-agent', label: '核心 Agent&LLM' },
  { key: 'resume:backend-pipeline', label: '后端 & 异步管线' },
  { key: 'resume:automation', label: '自动化 & 交付' },
  { key: 'resume:light-demo', label: '轻量 Demo' },
];

function poolForScope(scope: string, questions: InterviewQuestionSummary[]): InterviewQuestionSummary[] {
  if (scope.startsWith('resume:')) {
    const resumeGroup = scope.slice('resume:'.length);
    return questions.filter((q) => q.resumeGroup === resumeGroup);
  }
  if (scope === 'project') return questions.filter((q) => q.type === 'project');
  if (scope === 'personal') return questions.filter((q) => q.source === '个人项目');
  if (scope === 'all') return questions;
  return questions.filter((q) => q.group === scope);
}

function scopeLabel(scope: string): string {
  if (scope.startsWith('resume:')) {
    return RESUME_DEFS.find((item) => item.key === scope)?.label ?? '简历组';
  }
  if (scope === 'project') return '项目题';
  return CAPABILITY_DEFS.find((item) => item.key === scope)?.label ?? '全部';
}

function pickRandom<T extends { id: string }>(pool: T[], excludeId?: string): T {
  const safe = pool.filter((q) => q.id !== excludeId);
  const source = safe.length ? safe : pool;
  return source[Math.floor(Math.random() * source.length)];
}

const verdictText: Record<string, { label: string; hint: string }> = {
  pass: { label: '过了', hint: '继续追边界和数字，别停在定义。' },
  borderline: { label: '边缘', hint: '能讲，但面试官再追一层就会露底。' },
  fail: { label: '没过', hint: '先把主链路讲顺，再补边界和项目证据。' },
};

export const MockInterviewTab: React.FC<MockInterviewTabProps> = ({
  progress,
  attempts,
  pinnedQuestionId,
  onEvaluationDone,
  onOpenDetail,
  onMastered,
  onOpenP5Compare,
}) => {
  const [scope, setScope] = useState('all');
  const [useMyProject, setUseMyProject] = useState(true);
  const [evaluatedWithProject, setEvaluatedWithProject] = useState(false);
  const [questions, setQuestions] = useState<InterviewQuestionSummary[]>([]);
  const [bankState, setBankState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bankError, setBankError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selected, setSelected] = useState<InterviewQuestionSummary | null>(null);
  const [answer, setAnswer] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(90);
  const [timerRunning, setTimerRunning] = useState(false);
  const [result, setResult] = useState<InterviewEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roundPreset, setRoundPreset] = useState<'first' | 'second' | 'custom'>('first');
  const [roundLabel, setRoundLabel] = useState('一面 · 基础筛');
  const [customConfig, setCustomConfig] = useState<RoundConfig>(CUSTOM_ROUND_CONFIG);
  const [roundQuestions, setRoundQuestions] = useState<InterviewQuestionSummary[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundFinished, setRoundFinished] = useState(false);
  const [roundScores, setRoundScores] = useState<Record<string, number>>({});
  const answerCacheRef = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    let alive = true;
    setBankState('loading');
    setBankError('');
    fetchInterviewQuestionSummaries({ limit: 400 })
      .then((page) => {
        if (!alive) return;
        setQuestions(page.items);
        setBankState('ready');
        setSelected((current) => {
          const same = current ? page.items.find((q) => q.id === current.id) : null;
          const pinned = pinnedQuestionId ? page.items.find((q) => q.id === pinnedQuestionId) : null;
          return same ?? pinned ?? (page.items.length ? pickRandom(page.items) : null);
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setBankError(err instanceof Error ? err.message : '题库摘要加载失败');
        setBankState('error');
      });
    return () => { alive = false; };
  }, [loadAttempt]);

  const capabilityScopes = useMemo(
    () => CAPABILITY_DEFS.map((item) => ({
      ...item,
      count: item.key === 'all'
        ? questions.length
        : item.key === 'project'
          ? questions.filter((q) => q.type === 'project').length
          : item.key === 'personal'
            ? questions.filter((q) => q.source === '个人项目').length
            : questions.filter((q) => q.group === item.key).length,
    })),
    [questions],
  );
  const resumeScopes = useMemo(
    () => RESUME_DEFS.map((item) => ({
      ...item,
      count: questions.filter((q) => q.resumeGroup === item.key.slice('resume:'.length)).length,
    })),
    [questions],
  );

  const pool = useMemo(() => poolForScope(scope, questions), [scope, questions]);
  const projectProfile = useMemo(() => (selected ? profileForQuestion(selected) : null), [selected]);
  const activeRoundConfig = useMemo(
    () => roundPreset === 'custom' ? customConfig : ROUND_PRESETS.find((item) => item.key === roundPreset)?.config ?? CUSTOM_ROUND_CONFIG,
    [customConfig, roundPreset],
  );
  const roundTotal = roundConfigTotal(activeRoundConfig);
  const hasRound = roundQuestions.length > 0;
  const roundPresetLabel = ROUND_PRESETS.find((item) => item.key === roundPreset)?.label ?? '自定义套卷';
  const roundAnsweredCount = roundQuestions.filter((question) => roundScores[question.id] != null).length;
  const roundAverage = roundAnsweredCount
    ? Math.round(roundQuestions.reduce((total, question) => total + (roundScores[question.id] ?? 0), 0) / roundAnsweredCount)
    : null;


  // 父级从题目详情点「用这题模拟」时，把题换过来。
  React.useEffect(() => {
    if (!pinnedQuestionId || !questions.length) return;
    const pinned = questions.find((q) => q.id === pinnedQuestionId);
    if (pinned) {
      setScope(pinned.type === 'project' ? 'project' : pinned.group);
      setSelected(pinned);
      setAnswer('');
      setResult(null);
      setError('');
      setSecondsLeft(90);
      setTimerRunning(false);
      setEvaluatedWithProject(false);
      setRoundQuestions([]);
      setRoundIndex(0);
      setRoundFinished(false);
      setRoundScores({});
    }
  }, [pinnedQuestionId, questions]);

  React.useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  const currentState = selected ? progress[selected.id] : undefined;
  const answerReady = Boolean(selected) && answer.trim().length >= 8;
  const timeLabel = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

  const resetAnswerState = (question: InterviewQuestionSummary) => {
    setSelected(question);
    setAnswer('');
    setResult(null);
    setError('');
    setSecondsLeft(90);
    setTimerRunning(false);
    setEvaluatedWithProject(false);
  };

  const clearRoundState = () => {
    setRoundQuestions([]);
    setRoundIndex(0);
    setRoundFinished(false);
    setRoundScores({});
  };

  const chooseQuestion = (question: InterviewQuestionSummary) => {
    clearRoundState();
    resetAnswerState(question);
  };

  const chooseScope = (nextScope: string) => {
    setScope(nextScope);
    const nextPool = poolForScope(nextScope, questions);
    if (nextPool.length) {
      clearRoundState();
      resetAnswerState(pickRandom(nextPool, selected?.id));
    }
  };

  const updateCustomCount = (key: RoundCategory, rawValue: number) => {
    const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(6, Math.round(rawValue))) : 0;
    setCustomConfig((previous) => ({ ...previous, [key]: value }));
  };

  const startRound = () => {
    if (roundTotal < 1 || roundTotal > 12 || !questions.length) return;
    const drawn = buildRoundQuestions(activeRoundConfig, questions);
    if (!drawn.length) return;
    setRoundLabel(roundPresetLabel);
    setRoundQuestions(drawn);
    setRoundIndex(0);
    setRoundFinished(false);
    setRoundScores({});
    resetAnswerState(drawn[0]);
  };

  const exitRound = () => {
    clearRoundState();
    if (pool.length) resetAnswerState(pickRandom(pool, selected?.id));
  };

  const nextQuestion = () => {
    if (hasRound) {
      if (roundIndex + 1 >= roundQuestions.length) {
        setRoundFinished(true);
        setTimerRunning(false);
        return;
      }
      const nextIndex = roundIndex + 1;
      setRoundIndex(nextIndex);
      resetAnswerState(roundQuestions[nextIndex]);
      return;
    }
    if (!pool.length) return;
    resetAnswerState(pickRandom(pool, selected?.id));
  };

  const submit = async () => {
    if (!selected || !answerReady || loading || roundFinished) return;
    setLoading(true);
    setError('');
    try {
      let reference = answerCacheRef.current.get(selected.id);
      if (reference === undefined) {
        const detail = await fetchInterviewQuestionDetail(selected.id);
        reference = detail.answer;
        answerCacheRef.current.set(selected.id, reference);
      }
      const data = await evaluateInterviewAnswer({
        questionId: selected.id,
        question: selected.question,
        reference,
        answer: answer.trim(),
        qtype: selected.type,
        difficulty: selected.difficulty,
        title: selected.title,
        groupKey: selected.group,
        projectContext: useMyProject && projectProfile ? projectProfilePrompt(projectProfile) : '',
      });
      setResult(data);
      setEvaluatedWithProject(Boolean(useMyProject && projectProfile));
      setTimerRunning(false);
      if (hasRound) {
        setRoundScores((previous) => ({ ...previous, [selected.id]: data.score }));
      }
      onEvaluationDone(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '评估失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setAnswer('');
    setResult(null);
    setError('');
    setSecondsLeft(90);
    setTimerRunning(false);
    setRoundFinished(false);
  };

  if (bankState === 'loading') {
    return (
      <div className="iv-bank">
        <div className="iv-empty">
          <Loader2 size={26} className="iv-spin" />
          <p>题库摘要加载中…</p>
          <span className="iv-muted">只拉列表，参考答案在提交或看详情时才按题读取。</span>
        </div>
      </div>
    );
  }

  if (bankState === 'error') {
    return (
      <div className="iv-bank">
        <div className="iv-empty">
          <AlertCircle size={26} />
          <p>题库摘要接口不可用：{bankError}</p>
          <button className="iv-btn" onClick={() => setLoadAttempt((value) => value + 1)}>
            <RefreshCw size={14} /> 重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="iv-bank">
        <div className="iv-empty">
          <AlertCircle size={26} />
          <p>题库为空，暂时没有可模拟的题目。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="iv-mock">
      <div className="iv-mock-top">
        <div>
          <span className="iv-eyebrow">Mock Room / 单题压力面 + 随机套题</span>
          <h2>先讲，再让面试官拆。</h2>
          <p>90 秒准备，不给提示；题库只拉摘要抽题，参考答案在提交或看详情时才按题读取。</p>
        </div>
        <div className="iv-mock-groups">
          <div className="iv-mock-scope-row">
            <span className="iv-mock-scope-label">能力组</span>
            <div className="iv-mock-group">
              {capabilityScopes.map((item) => (
                <button
                  key={item.key}
                  className={`iv-chip ${scope === item.key ? 'is-on' : ''}`}
                  onClick={() => chooseScope(item.key)}
                  aria-pressed={scope === item.key}
                >
                  {item.label} <em className="iv-chip-count">{item.count}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="iv-mock-scope-row">
            <span className="iv-mock-scope-label">简历组</span>
            <div className="iv-mock-group">
              {resumeScopes.map((item) => (
                <button
                  key={item.key}
                  className={`iv-chip ${scope === item.key ? 'is-on' : ''}`}
                  onClick={() => chooseScope(item.key)}
                  aria-pressed={scope === item.key}
                >
                  {item.label} <em className="iv-chip-count">{item.count}</em>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="iv-round-builder" aria-label="随机套题模拟">
        <div className="iv-round-builder-head">
          <div>
            <span className="iv-eyebrow">Random Round / 随机套题</span>
            <h3>一面筛基础，二面拆项目。</h3>
            <p>按分组抽一套卷子，连续作答；每题独立评分，最后汇总整卷表现。</p>
          </div>
          <div className="iv-round-total">
            <small>本套</small>
            <strong>{roundTotal}</strong>
            <em>题</em>
          </div>
        </div>

        <div className="iv-round-presets" role="group" aria-label="套卷预设">
          {ROUND_PRESETS.map((preset, index) => {
            const total = roundConfigTotal(preset.config);
            const selectedPreset = roundPreset === preset.key;
            return (
              <button
                key={preset.key}
                className={`iv-round-preset ${selectedPreset ? 'is-on' : ''}`}
                onClick={() => setRoundPreset(preset.key)}
                aria-pressed={selectedPreset}
              >
                <span className="iv-round-preset-index">{index < 2 ? `0${index + 1}` : <SlidersHorizontal size={13} />}</span>
                <span className="iv-round-preset-copy">
                  <strong>{preset.label}</strong>
                  <small>{preset.tagline}</small>
                </span>
                <em>{total} 题 · {preset.minutes}</em>
              </button>
            );
          })}
        </div>

        <div className="iv-round-config">
          <div className="iv-round-config-head">
            <span>{roundPreset === 'custom' ? '自定义题量' : '默认搭配'}</span>
            <small>{roundConfigSummary(activeRoundConfig) || '还没有选题'}</small>
          </div>
          <div className="iv-round-counts">
            {ROUND_CATEGORY_ORDER.map((key) => (
              <label key={key} className={`iv-round-count ${activeRoundConfig[key] === 0 ? 'is-empty' : ''}`}>
                <span>{ROUND_CATEGORY_LABELS[key]}</span>
                {roundPreset === 'custom' ? (
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={activeRoundConfig[key]}
                    onChange={(event) => updateCustomCount(key, Number(event.target.value))}
                    aria-label={`${ROUND_CATEGORY_LABELS[key]}题量`}
                  />
                ) : (
                  <strong>{activeRoundConfig[key]}</strong>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="iv-round-actions">
          <span>{roundPreset === 'custom' ? '每个分组 0–6 题，整卷最多 12 题。' : '抽题不会重复；作答顺序按抽出的题目走。'}</span>
          <button
            className="iv-btn iv-btn-primary"
            onClick={startRound}
            disabled={roundTotal < 1 || roundTotal > 12}
          >
            <Play size={14} /> 开始抽一套 {roundTotal} 题
          </button>
        </div>
      </section>

      {roundFinished && (
        <section className="iv-round-summary" aria-label="套卷结果">
          <div className="iv-round-summary-head">
            <div>
              <span className="iv-eyebrow">Round Complete / 本套完成</span>
              <h3>{roundLabel} · {roundQuestions.length} 题</h3>
              <p>{roundAnsweredCount} 题已答{roundAverage != null ? ` · 平均 ${roundAverage} 分` : ''}</p>
            </div>
            <div className="iv-round-summary-actions">
              <button className="iv-btn iv-btn-sm" onClick={startRound}>
                <RefreshCw size={13} /> 再抽一套
              </button>
              <button className="iv-btn iv-btn-sm" onClick={exitRound}>回到单题</button>
            </div>
          </div>
          <div className="iv-round-summary-list">
            {roundQuestions.map((question, index) => (
              <div key={question.id} className="iv-round-summary-row">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{question.title}</strong>
                <em className={roundScores[question.id] == null ? 'is-empty' : roundScores[question.id] >= 60 ? 'is-mid' : 'is-low'}>
                  {roundScores[question.id] ?? '未答'}
                </em>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="iv-mock-grid">
        <aside className="iv-mock-side">
          <div className="iv-mock-side-head">
            <span className="iv-eyebrow">
              {hasRound
                ? `${roundLabel} · ${roundFinished ? '已完成' : `第 ${roundIndex + 1}/${roundQuestions.length} 题`}`
                : `当前题目 · ${scopeLabel(scope)} · ${pool.length} 题`}
            </span>
            <button className="iv-text-btn" onClick={hasRound ? exitRound : nextQuestion}>
              <RefreshCw size={13} /> {hasRound ? '退出套题' : '换一题'}
            </button>
          </div>

          {hasRound ? (
            <div className="iv-round-mini-list" aria-label="本套题目">
              {roundQuestions.map((question, index) => (
                <div
                  key={question.id}
                  className={`iv-round-mini-row ${index === roundIndex ? 'is-current' : ''} ${roundScores[question.id] != null ? 'is-done' : ''}`}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong title={question.title}>{question.title}</strong>
                  <em>{roundScores[question.id] ?? '待答'}</em>
                </div>
              ))}
            </div>
          ) : (
            <select
              className="iv-question-select"
              value={selected.id}
              onChange={(event) => {
                const question = questions.find((q) => q.id === event.target.value);
                if (question) chooseQuestion(question);
              }}
              aria-label="从题库选题"
            >
              {pool.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.title}
                </option>
              ))}
            </select>
          )}

          <div className="iv-mock-question-card" data-source={selected.source}>
            <div className="iv-q-card-top">
              <span className={`iv-source iv-source-${selected.source}`}>{selected.source}</span>
              <span className="iv-q-type">{typeLabel(selected.type)}</span>
              <span className="iv-q-difficulty">{selected.difficulty}</span>
            </div>
            <h3>{selected.title}</h3>
            <p>{selected.question}</p>
            <div className="iv-mock-question-meta">
              <span>{selected.groupLabel}</span>
              <span>·</span>
              <span>{selected.resumeGroupLabel}</span>
              <span>·</span>
              <span>{selected.chapter}</span>
            </div>
            <button className="iv-text-btn" onClick={() => onOpenDetail(selected)}>
              <BookOpen size={13} /> 看评分点 / 追问
            </button>
          </div>

          {projectProfile && (
            <div className="iv-project-mode">
              <label className="iv-project-toggle">
                <input
                  type="checkbox"
                  checked={useMyProject}
                  onChange={(event) => setUseMyProject(event.target.checked)}
                />
                <span className="iv-project-toggle-track" aria-hidden="true"><i /></span>
                <span>用我的项目档案</span>
                <em>{projectProfile.short}</em>
              </label>

              {useMyProject ? (
                <div className="iv-project-profile">
                  <div className="iv-project-profile-head">
                    <strong>{projectProfile.name}</strong>
                    <span>{projectProfile.role}</span>
                  </div>
                  <p>{projectProfile.summary}</p>
                  <div className="iv-project-stack">
                    {projectProfile.stack.slice(0, 5).map((item) => <span key={item}>{item}</span>)}
                  </div>
                  <ul>
                    {projectProfile.proofs.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <div className="iv-project-profile-foot">
                    <span>评分会对齐档案里的真实约束，不用通用模板糊过去</span>
                    {projectProfile.id === 'P5' && (
                      <button className="iv-text-btn" onClick={() => onOpenP5Compare(answer)}>
                        <BarChart3 size={13} /> P5 知识库对标
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="iv-project-mode-off">已关闭：按通用项目题评分，不注入我的项目档案。</p>
              )}
            </div>
          )}

          <div className="iv-mock-timer">
            <div className="iv-mock-timer-head">
              <span>
                <Clock3 size={14} /> 作答计时
              </span>
              <strong className={secondsLeft <= 15 ? 'is-low' : ''}>{timeLabel}</strong>
            </div>
            <div className="iv-timer-track">
              <span style={{ width: `${(secondsLeft / 90) * 100}%` }} />
            </div>
            <div className="iv-mock-timer-actions">
              <button className="iv-btn iv-btn-sm" onClick={() => setTimerRunning((value) => !value)}>
                <Play size={12} /> {timerRunning ? '暂停' : '开始'}
              </button>
              <button className="iv-text-btn" onClick={() => { setSecondsLeft(90); setTimerRunning(false); }}>
                <RotateCcw size={12} /> 重置
              </button>
            </div>
          </div>

          <div className="iv-mock-history">
            <span className="iv-eyebrow">最近作答</span>
            {attempts.length === 0 ? (
              <p className="iv-muted">还没有记录。交一次答案就会出现在这里。</p>
            ) : (
              attempts.slice(0, 6).map((attempt) => (
                <div key={attempt.id} className="iv-history-row">
                  <span className={`iv-history-score ${attempt.score != null && attempt.score >= 80 ? 'is-high' : attempt.score != null && attempt.score >= 60 ? 'is-mid' : 'is-low'}`}>
                    {attempt.score ?? '—'}
                  </span>
                  <span title={attempt.questionTitle}>{attempt.questionTitle}</span>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="iv-mock-work">
          {hasRound && (
            <div className="iv-round-work-head">
              <span>{roundFinished ? '本套已完成' : `套卷进度 · 第 ${roundIndex + 1} / ${roundQuestions.length} 题`}</span>
              <div className="iv-round-work-track">
                <i style={{ width: `${Math.min(100, ((roundIndex + (result ? 1 : 0)) / roundQuestions.length) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="iv-mock-work-head">
            <div>
              <span className="iv-eyebrow">你的回答</span>
              <span className="iv-muted">先给结论，再讲链路，最后补边界/数字。</span>
            </div>
            <span className="iv-char-count">{answer.trim().length} 字</span>
          </div>
          <textarea
            className="iv-answer-input"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="按面试口述的方式写：结论 → 关键机制 → 失败路径 → 项目里怎么落地。不要堆名词。"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={loading || roundFinished}
            aria-label="面试回答"
          />
          <div className="iv-answer-actions">
            <span className="iv-muted">
              {currentState?.practiceCount ? `这题已练 ${currentState.practiceCount} 次` : '第一次答这题'}
              {currentState?.lastScore != null ? ` · 上次 ${currentState.lastScore}` : ''}
            </span>
            <div className="iv-answer-buttons">
              {result && (
                <button className="iv-btn" onClick={reset}>
                  <RotateCcw size={14} /> 再答一次
                </button>
              )}
              <button className="iv-btn iv-btn-primary" onClick={() => void submit()} disabled={!answerReady || loading || roundFinished}>
                {loading ? <Loader2 size={15} className="iv-spin" /> : <Sparkles size={15} />}
                {loading ? '正在取参考答案并评估…' : '提交，交给 AI 面试官'}
              </button>
            </div>
          </div>

          {error && (
            <div className="iv-error">
              <AlertCircle size={16} />
              <div>
                <strong>这次没评成</strong>
                <p>{error}</p>
              </div>
              <button className="iv-text-btn" onClick={() => void submit()}>重试</button>
            </div>
          )}

          {loading && (
            <div className="iv-evaluating">
              <div className="iv-evaluating-orbit" />
              <div>
                <strong>正在按五个维度打分</strong>
                <p>概念准确性 · 链路完整性 · 边界与失败路径 · 项目落地 · 表达结构</p>
              </div>
            </div>
          )}

          {result && !loading && (
            <div className="iv-evaluation">
              <div className="iv-eval-head">
                <div
                  className="iv-score-ring"
                  style={{ background: `conic-gradient(var(--iv-accent) ${result.score}%, color-mix(in srgb, var(--border-light) 75%, transparent) 0)` }}
                >
                  <div>
                    <strong>{result.score}</strong>
                    <span>/100</span>
                  </div>
                </div>
                <div className="iv-eval-verdict">
                  <span className={`iv-verdict iv-verdict-${result.verdict}`}>{verdictText[result.verdict]?.label ?? result.verdict}</span>
                  <h3>{verdictText[result.verdict]?.hint}</h3>
                  <div className="iv-eval-scope">
                    <span>{selected.groupLabel}</span>
                    <span>{selected.resumeGroupLabel}</span>
                    {evaluatedWithProject && <span className="iv-eval-project">按我的项目档案评分</span>}
                  </div>
                  <p>
                    {result.provider ? `${result.provider} · ${result.model || ''}` : 'AI 评估'}
                    {result.latencyMs ? ` · ${(result.latencyMs / 1000).toFixed(1)}s` : ''}
                  </p>
                </div>
                <div className="iv-eval-actions">
                  <button className="iv-btn iv-btn-sm" onClick={() => onMastered(selected, true)}>
                    <CheckCircle2 size={13} /> 收进已掌握
                  </button>
                  <button className="iv-btn iv-btn-sm" onClick={nextQuestion} disabled={roundFinished}>
                    {hasRound && roundIndex + 1 >= roundQuestions.length ? '完成本套' : '下一题'} <ArrowRight size={13} />
                  </button>
                </div>
              </div>

              <div className="iv-dimensions">
                {result.dimensions.map((dimension) => (
                  <div key={dimension.name} className="iv-dimension">
                    <div className="iv-dimension-head">
                      <span>{dimension.name}</span>
                      <strong>{dimension.score}</strong>
                    </div>
                    <div className="iv-dimension-track">
                      <span
                        style={{
                          width: `${dimension.score}%`,
                          background: dimension.score >= 80 ? 'var(--success)' : dimension.score >= 60 ? 'var(--iv-accent)' : 'var(--danger)',
                        }}
                      />
                    </div>
                    <p>{dimension.comment}</p>
                  </div>
                ))}
              </div>

              <div className="iv-eval-columns">
                <div className="iv-eval-list iv-eval-good">
                  <div className="iv-section-head"><span className="iv-section-mark">答对了</span></div>
                  {result.strengths.length ? (
                    <ul>{result.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : (
                    <p className="iv-muted">这次没有明显亮点，先把主链路讲完整。</p>
                  )}
                </div>
                <div className="iv-eval-list iv-eval-gap">
                  <div className="iv-section-head"><span className="iv-section-mark">会被追问</span></div>
                  {result.gaps.length ? (
                    <ul>{result.gaps.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : (
                    <p className="iv-muted">没有抓到明显缺口，但别把“没被指出”当成“答满了”。</p>
                  )}
                </div>
              </div>

              <div className="iv-rewrite">
                <div className="iv-section-head">
                  <span className="iv-section-mark">可以直接背的版本</span>
                  <span className="iv-badge-soft"><ShieldCheck size={12} /> 已按你的题校准</span>
                </div>
                <div className="iv-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.rewrite) }} />
              </div>

              {result.followUps.length > 0 && (
                <div className="iv-rewrite iv-followups">
                  <div className="iv-section-head"><span className="iv-section-mark">下一层追问</span></div>
                  <ol>
                    {result.followUps.map((item) => <li key={item}>{item}</li>)}
                  </ol>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
