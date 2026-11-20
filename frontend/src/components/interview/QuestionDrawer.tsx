import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Flag,
  Loader2,
  Sparkles,
  Star,
  Target,
  Video,
  X,
} from 'lucide-react';
import { renderMarkdown } from '../../lib/markdown';
import { IS_LITE } from '../../config/appProfile';
import { useAIStore } from '../../stores';
import { BOOK_TITLES, typeLabel } from '../../data/interview/labels';
import { fetchInterviewQuestionReport, reportInterviewQuestion } from '../../lib/interviewApi';
import type {
  InterviewQuestion,
  InterviewState,
  QuestionReportReason,
} from '../../data/interview/types';

interface QuestionDrawerProps {
  question: InterviewQuestion;
  state?: InterviewState;
  onClose: () => void;
  onStar: (question: InterviewQuestion) => void;
  onMastered: (question: InterviewQuestion, mastered: boolean) => void;
  onConfidence: (question: InterviewQuestion, confidence: number) => void;
  onPractice: (question: InterviewQuestion) => void;
  onOpenBook: (question: InterviewQuestion) => void;
  onAssistant: (question: InterviewQuestion) => void;
}

const REPORT_REASONS: Array<{
  value: QuestionReportReason;
  label: string;
  hint: string;
}> = [
  { value: 'stem', label: '题目描述有误', hint: '题干、条件、题号或原书页码不对' },
  { value: 'answer', label: '参考答案有误', hint: '答案逻辑、结论或代码有问题' },
  { value: 'rubric', label: '评分点/追问有误', hint: '评分点缺失，或追问和题目对不上' },
  { value: 'classification', label: '分类/标签有误', hint: '组别、题型、难度或来源标错' },
  { value: 'typo', label: '错别字/排版', hint: '文字、标点或 Markdown 渲染有问题' },
  { value: 'other', label: '其他问题', hint: '不属于上面几类，请在下面说明' },
];

export const QuestionDrawer: React.FC<QuestionDrawerProps> = ({
  question,
  state,
  onClose,
  onStar,
  onMastered,
  onConfidence,
  onPractice,
  onOpenBook,
  onAssistant,
}) => {
  const [answerOpen, setAnswerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<QuestionReportReason>('stem');
  const [reportDetail, setReportDetail] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [reportError, setReportError] = useState('');
  const [reported, setReported] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const reportCloseRef = useRef<HTMLButtonElement>(null);
  const reportTriggerRef = useRef<HTMLButtonElement>(null);
  const reportOpenRef = useRef(false);
  const answerHtml = useMemo(() => renderMarkdown(question.answer), [question.answer]);
  const bookTitle = question.bookId ? question.bookTitle || BOOK_TITLES[question.bookId] : '';
  const confidence = state?.confidence ?? 0;

  useEffect(() => {
    let alive = true;
    setReported(false);
    setReportOpen(false);
    reportOpenRef.current = false;
    setReportStatus('idle');
    fetchInterviewQuestionReport(question.id)
      .then((result) => {
        if (alive) setReported(result.reported);
      })
      .catch(() => {
        // 反馈状态是辅助信息，读不到不影响做题和提交。
      });
    return () => {
      alive = false;
    };
  }, [question.id]);

  useEffect(() => {
    if (reportOpen) reportCloseRef.current?.focus();
    reportOpenRef.current = reportOpen;
  }, [reportOpen]);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (reportOpenRef.current) {
          reportOpenRef.current = false;
          setReportOpen(false);
          return;
        }
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(question.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const openReport = () => {
    setReportStatus('idle');
    setReportError('');
    setReportDetail('');
    setReportReason('stem');
    setReportOpen(true);
  };

  const closeReport = () => {
    reportOpenRef.current = false;
    setReportOpen(false);
    window.setTimeout(() => reportTriggerRef.current?.focus(), 0);
  };

  const submitReport = async () => {
    if (reportReason === 'other' && reportDetail.trim().length < 5) {
      setReportError('选择「其他」时，请至少写 5 个字说明具体问题。');
      return;
    }
    setReportStatus('submitting');
    setReportError('');
    try {
      await reportInterviewQuestion({
        questionId: question.id,
        reason: reportReason,
        detail: reportDetail.trim(),
      });
      setReportStatus('success');
      setReported(true);
    } catch (error) {
      setReportStatus('error');
      setReportError(error instanceof Error ? error.message : '提交失败，请稍后再试。');
    }
  };

  const askAssistant = (mode: 'explain' | 'video') => {
    const prompt = mode === 'explain'
      ? `请结合当前题库讲透这道题：「${question.id} ${question.title}」。先给答题骨架和评分点的对应关系，再讲 3 个易错点，最后给我 2 个面试官可能追问的问题。`
      : `请针对当前题目「${question.id} ${question.title}」推荐站内相关视频，说明每门为什么相关、先看哪一段；没有合适的就直说。`;
    useAIStore.getState().setPendingPrompt(prompt);
    useAIStore.getState().setChatOpen(true);
    onAssistant(question);
  };

  return (
    <div className="iv-drawer-layer" role="dialog" aria-modal="true" aria-label={`题目详情：${question.title}`}>
      <button className="iv-drawer-backdrop" aria-label="关闭题目详情" onClick={onClose} />
      <aside className="iv-drawer">
        <header className="iv-drawer-head">
          <div className="iv-drawer-kicker">
            <span>{question.source}</span>
            <span>{question.groupLabel}</span>
            <span>{question.resumeGroupLabel}</span>
            <span>{typeLabel(question.type)}</span>
            <span>{question.difficulty}</span>
          </div>
          <button ref={closeRef} className="iv-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="iv-drawer-body">
          <div className="iv-question-title-row">
            <div>
              <h2>{question.title}</h2>
              <p className="iv-question-path">
                {question.chapter}
                {question.bookPage ? ` · 原书 p.${question.bookPage}` : ''}
              </p>
            </div>
            <button
              className={`iv-star-btn ${state?.starred ? 'is-on' : ''}`}
              onClick={() => onStar(question)}
              aria-label={state?.starred ? '取消收藏' : '收藏题目'}
            >
              <Star size={18} fill={state?.starred ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="iv-question-stem">
            <span className="iv-section-mark">题目</span>
            <p>{question.question}</p>
          </div>

          <div className="iv-drawer-actions">
            <button className="iv-btn iv-btn-primary" onClick={() => onPractice(question)}>
              <Target size={15} /> 用这题模拟面试
            </button>
            <button
              className={`iv-btn ${state?.mastered ? 'iv-btn-success' : ''}`}
              onClick={() => onMastered(question, !(state?.mastered ?? false))}
            >
              <CheckCircle2 size={15} /> {state?.mastered ? '已掌握' : '标记掌握'}
            </button>
            {question.bookId && question.bookPage && (
              <button className="iv-btn" onClick={() => onOpenBook(question)}>
                <BookOpen size={15} /> 去书里看
              </button>
            )}
            <button className="iv-btn iv-btn-ai" onClick={() => askAssistant('explain')}>
              <Sparkles size={15} /> 助手讲这题
            </button>
            {!IS_LITE && (
            <button className="iv-btn iv-btn-ai" onClick={() => askAssistant('video')}>
              <Video size={15} /> 推荐相关视频
            </button>
            )}
            <button
              ref={reportTriggerRef}
              className={`iv-btn iv-report-btn ${reported ? 'is-reported' : ''}`}
              onClick={openReport}
            >
              {reported ? <CheckCircle2 size={15} /> : <Flag size={15} />}
              {reported ? '已反馈' : '报告题目错误'}
            </button>
          </div>

          <section className="iv-drawer-section">
            <div className="iv-section-head">
              <span className="iv-section-mark">参考答案</span>
              <div className="iv-section-tools">
                <button className="iv-text-btn" onClick={() => setAnswerOpen((v) => !v)}>
                  {answerOpen ? '收起' : '展开'}
                  <ChevronRight size={14} className={answerOpen ? 'rotate-90' : ''} />
                </button>
                <button className="iv-text-btn" onClick={copyAnswer}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>
            {answerOpen ? (
              <div className="iv-md" dangerouslySetInnerHTML={{ __html: answerHtml }} />
            ) : (
              <button className="iv-answer-teaser" onClick={() => setAnswerOpen(true)}>
                <span>先自己讲一遍，再看参考。</span>
                <span className="iv-answer-teaser-hint">点击展开参考答案</span>
                <ArrowUpRight size={15} />
              </button>
            )}
          </section>

          {question.rubric.length > 0 && (
            <section className="iv-drawer-section">
              <div className="iv-section-head">
                <span className="iv-section-mark">评分点</span>
              </div>
              <ul className="iv-rubric-list">
                {question.rubric.map((item) => (
                  <li key={item}>
                    <Check size={13} /> {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {question.followUps.length > 0 && (
            <section className="iv-drawer-section">
              <div className="iv-section-head">
                <span className="iv-section-mark">会被追问</span>
              </div>
              <ol className="iv-followup-list">
                {question.followUps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </section>
          )}

          <section className="iv-drawer-section iv-selfcheck">
            <div className="iv-section-head">
              <span className="iv-section-mark">自评</span>
              {state?.lastScore != null && <span className="iv-muted">上次 AI 评分 {state.lastScore}</span>}
            </div>
            <div className="iv-confidence-row">
              {[
                { value: 0, label: '不会', hint: '说不出关键机制' },
                { value: 1, label: '模糊', hint: '能讲大意，边界答不全' },
                { value: 2, label: '能讲', hint: '面试里能稳定讲出来' },
              ].map((option) => (
                <button
                  key={option.value}
                  className={`iv-confidence ${confidence === option.value ? 'is-on' : ''}`}
                  onClick={() => onConfidence(question, option.value)}
                  title={option.hint}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="iv-drawer-foot">
          <span>
            {bookTitle || '手写题'} {question.bookPage ? `· p.${question.bookPage}` : ''}
          </span>
          <span>
            {state?.practiceCount ? `练习 ${state.practiceCount} 次` : '还没练过'}
            {state?.lastScore != null ? ` · 最好/最近 ${state.lastScore}` : ''}
          </span>
        </footer>

        {reportOpen && (
          <div className="iv-report-layer">
            <button
              className="iv-report-backdrop"
              aria-label="关闭报告题目错误"
              onClick={closeReport}
            />
            <section
              className="iv-report-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="iv-report-title"
            >
              <header className="iv-report-head">
                <div>
                  <span className="iv-section-mark">题目纠错</span>
                  <h3 id="iv-report-title">报告这道题的问题</h3>
                  <p>
                    {question.id} · {question.title}
                  </p>
                </div>
                <button
                  ref={reportCloseRef}
                  className="iv-icon-btn"
                  onClick={closeReport}
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </header>

              {reportStatus === 'success' ? (
                <div className="iv-report-success">
                  <CheckCircle2 size={30} />
                  <div>
                    <h4>反馈已记录</h4>
                    <p>已收到这道题的纠错，后续会按错误类型统一修题。</p>
                  </div>
                  <div className="iv-report-actions">
                    <button
                      className="iv-btn"
                      onClick={() => {
                        setReportStatus('idle');
                        setReportDetail('');
                        setReportReason('stem');
                      }}
                    >
                      再报一处
                    </button>
                    <button className="iv-btn iv-btn-primary" onClick={closeReport}>
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  className="iv-report-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitReport();
                  }}
                >
                  <div className="iv-report-field">
                    <span className="iv-report-label">错误类型</span>
                    <div className="iv-report-reasons">
                      {REPORT_REASONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`iv-report-reason ${
                            reportReason === option.value ? 'is-on' : ''
                          }`}
                          onClick={() => setReportReason(option.value)}
                          aria-pressed={reportReason === option.value}
                        >
                          <strong>{option.label}</strong>
                          <small>{option.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="iv-report-field">
                    <label className="iv-report-label" htmlFor="iv-report-detail">
                      补充说明 <span>可选</span>
                      <em>{reportDetail.length}/1200</em>
                    </label>
                    <textarea
                      id="iv-report-detail"
                      className="iv-report-textarea"
                      value={reportDetail}
                      maxLength={1200}
                      onChange={(event) => setReportDetail(event.target.value)}
                      placeholder="哪里不对？你预期的正确内容是什么？如果方便，贴出错的位置或正确写法。"
                    />
                  </div>

                  {reportError && (
                    <div className="iv-report-error" role="alert">
                      <AlertTriangle size={15} />
                      {reportError}
                    </div>
                  )}

                  <div className="iv-report-actions">
                    <button type="button" className="iv-btn" onClick={closeReport}>
                      取消
                    </button>
                    <button
                      type="submit"
                      className="iv-btn iv-btn-primary"
                      disabled={
                        reportStatus === 'submitting' ||
                        (reportReason === 'other' && reportDetail.trim().length < 5)
                      }
                    >
                      {reportStatus === 'submitting' ? (
                        <>
                          <Loader2 size={15} className="iv-spin" /> 提交中
                        </>
                      ) : (
                        '提交反馈'
                      )}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
};
