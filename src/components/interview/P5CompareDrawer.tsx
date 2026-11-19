import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Loader2, RefreshCw, Scale, X } from 'lucide-react';
import { compareKnowledgeBase, fetchP5Baseline } from '../../lib/interviewApi';
import type { KbBaseline, KbCompareResult } from '../../data/interview/types';
import './P5CompareDrawer.css';

interface P5CompareDrawerProps {
  open: boolean;
  seedText?: string;
  onClose: () => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  ingestion: '数据接入与解析',
  retrieval: '检索与融合',
  security: '权限与多租户',
  traceability: '可追溯与版本',
  async: '异步与可靠性',
  eval: '评测与观测',
  delivery: '交付与运维',
  governance: '知识治理',
};

function winnerLabel(winner: KbCompareResult['winner']): string {
  if (winner === 'mine') return '我的 P5 更强';
  if (winner === 'candidate') return '考生方案更强';
  return '整体打平';
}

function winnerShort(winner: KbCompareResult['winner']): string {
  if (winner === 'mine') return '我的基线领先';
  if (winner === 'candidate') return '考生领先';
  return '打平';
}

const ScoreBar: React.FC<{ score: number; tone?: 'mine' | 'candidate' }> = ({ score, tone = 'mine' }) => (
  <span className={`p5-scorebar p5-scorebar-${tone}`} aria-hidden="true">
    <i style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
  </span>
);

export const P5CompareDrawer: React.FC<P5CompareDrawerProps> = ({ open, seedText = '', onClose }) => {
  const [baseline, setBaseline] = useState<KbBaseline | null>(null);
  const [baselineError, setBaselineError] = useState('');
  const [profile, setProfile] = useState('');
  const [result, setResult] = useState<KbCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) return;
    setProfile(seedText || '');
    setResult(null);
    setError('');
  }, [open, seedText]);

  useEffect(() => {
    if (!open || baseline) return;
    let cancelled = false;
    setBaselineError('');
    fetchP5Baseline()
      .then((data) => {
        if (!cancelled) setBaseline(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBaselineError(err instanceof Error ? err.message : '基线加载失败');
      });
    return () => { cancelled = true; };
  }, [open, baseline]);

  useEffect(() => {
    if (!loading || startedAt == null) return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [loading, startedAt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const baselineDims = useMemo(() => baseline?.dimensions ?? [], [baseline]);

  const submit = async () => {
    if (loading) return;
    const text = profile.trim();
    if (text.length < 20) {
      setError('至少写 20 个字：数据怎么进、怎么检索、权限怎么管。');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setStartedAt(Date.now());
    setElapsed(0);
    try {
      const data = await compareKnowledgeBase(text);
      setResult(data);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'P5 对标失败');
    } finally {
      setLoading(false);
      setStartedAt(null);
    }
  };

  if (!open) return null;

  return (
    <div className="p5-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="p5-drawer" role="dialog" aria-modal="true" aria-label="P5 知识库复杂度对标">
        <header className="p5-head">
          <div>
            <span className="p5-eyebrow"><Scale size={14} /> P5 BENCH / 知识库复杂度对标</span>
            <h2>我的 P5 vs 考生方案</h2>
            <p>八个维度、固定基线、服务端算加权总分。不是看谁写得长，是看谁的链路更完整。</p>
          </div>
          <button className="p5-close" onClick={onClose} aria-label="关闭对标">
            <X size={16} />
          </button>
        </header>

        <div className="p5-body">
          <section className="p5-baseline-card" aria-label="我的 P5 基线">
            <div className="p5-baseline-head">
              <div>
                <span className="p5-label">我的基线</span>
                <h3>{baseline?.projectName ?? 'P5 企业级知识库'}</h3>
                <p>{baseline?.subtitle ?? 'React + FastAPI + PostgreSQL + Milvus + Redis/Celery + DeepSeek'}</p>
              </div>
              <div className="p5-baseline-score">
                <strong>{baseline?.overall ?? '—'}</strong>
                <span>复杂度分</span>
              </div>
            </div>

            {baselineError ? (
              <div className="p5-inline-error">
                <span>{baselineError}</span>
                <button className="p5-link" onClick={() => { setBaseline(null); setBaselineError(''); }}>
                  <RefreshCw size={12} /> 重试
                </button>
              </div>
            ) : (
              <div className="p5-baseline-grid">
                {baselineDims.map((dim) => (
                  <div key={dim.key} className="p5-baseline-dim">
                    <div>
                      <strong>{dim.name}</strong>
                      <span>{dim.weight}%</span>
                    </div>
                    <div className="p5-baseline-dim-line">
                      <ScoreBar score={dim.score} />
                      <b>{dim.score}</b>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {baseline?.limits?.length ? (
              <details className="p5-limits">
                <summary>我的已知边界（{baseline.limits.length} 条）</summary>
                <ul>
                  {baseline.limits.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="p5-input-card" aria-label="考生方案输入">
            <div className="p5-input-head">
              <div>
                <span className="p5-label">考生方案</span>
                <h3>把你的 RAG 知识库贴进来</h3>
              </div>
              <span className="p5-count">{profile.length} / 12000</span>
            </div>
            <textarea
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
              maxLength={12000}
              placeholder="建议按链路写：数据接入与解析 → 切片/向量化 → 检索/重排 → 权限/多租户 → 引用/版本 → 异步任务 → 评测 → 交付。比如：支持 PDF/Word、分片上传；PG 全文 + pgvector 混合检索 + RRF；租户/部门 RBAC；回答带引用；Celery 入库；RAGAS 评测……"
            />
            <div className="p5-input-foot">
              <span>没提到的能力按未实现处理，不替考生补。</span>
              <button className="p5-primary" onClick={() => void submit()} disabled={loading}>
                {loading ? <Loader2 size={14} className="is-spinning" /> : <BarChart3 size={14} />}
                {loading ? `对标中 ${elapsed}s` : '开始对标'}
              </button>
            </div>
            {error && <div className="p5-error">{error}</div>}
          </section>

          {result && (
            <section className="p5-result" aria-label="对标结果">
              <div className={`p5-verdict p5-verdict-${result.winner}`}>
                <div className="p5-verdict-copy">
                  <span className="p5-label">对标结论</span>
                  <strong>{winnerLabel(result.winner)}</strong>
                  <p>{result.summary}</p>
                </div>
                <div className="p5-score-pair">
                  <div>
                    <span>我的基线</span>
                    <b>{result.baseline.overall}</b>
                  </div>
                  <div>
                    <span>考生方案</span>
                    <b>{result.candidateScore}</b>
                  </div>
                  <div>
                    <span>差值</span>
                    <b>{result.margin > 0 ? `+${result.margin}` : result.margin}</b>
                  </div>
                </div>
              </div>

              <div className="p5-dim-table" role="table" aria-label="维度对比">
                <div className="p5-dim-table-head" role="row">
                  <span>维度</span>
                  <span>我的基线</span>
                  <span>考生</span>
                  <span>结论</span>
                </div>
                {result.dimensions.map((dim) => (
                  <div key={dim.key} className={`p5-dim-row p5-dim-${dim.winner}`} role="row">
                    <div className="p5-dim-name" role="cell">
                      <strong>{DIMENSION_LABELS[dim.key] ?? dim.name}</strong>
                      <em>{dim.weight}% · {dim.delta > 0 ? `+${dim.delta}` : dim.delta}</em>
                    </div>
                    <div className="p5-dim-score" role="cell">
                      <span className="p5-dim-score-tag">我</span>
                      <ScoreBar score={dim.baselineScore} />
                      <b>{dim.baselineScore}</b>
                    </div>
                    <div className="p5-dim-score" role="cell">
                      <span className="p5-dim-score-tag is-candidate">考</span>
                      <ScoreBar score={dim.candidateScore} tone="candidate" />
                      <b>{dim.candidateScore}</b>
                    </div>
                    <div className="p5-dim-verdict" role="cell">
                      <span>{winnerShort(dim.winner)}</span>
                      <p>{dim.comment}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p5-feedback-grid">
                <div className="p5-feedback-block is-candidate">
                  <span className="p5-label">考生更强项</span>
                  {result.candidateStrengths.length ? (
                    <ul>{result.candidateStrengths.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : <p className="p5-muted">这一轮没有明显强于我的维度。</p>}
                </div>
                <div className="p5-feedback-block is-mine">
                  <span className="p5-label">我更强项</span>
                  {result.candidateGaps.length ? (
                    <ul>{result.candidateGaps.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : <p className="p5-muted">这一轮没有明显掉队的维度。</p>}
                </div>
                <div className="p5-feedback-block is-next">
                  <span className="p5-label">下一步补什么</span>
                  {result.nextActions.length ? (
                    <ul>{result.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : <p className="p5-muted">继续补评测与交付证据。</p>}
                </div>
              </div>

              <div className="p5-result-foot">
                <span><CheckCircle2 size={12} /> 分数已按权重重算，模型只负责维度评分</span>
                <span>{result.model ? `${result.model} · ${result.latencyMs ?? 0}ms` : ''}</span>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
