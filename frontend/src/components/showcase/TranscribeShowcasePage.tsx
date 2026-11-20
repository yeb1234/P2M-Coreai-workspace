import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Folder,
  Layers,
  ListChecks,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useUIStore } from '../../stores';
import { MetricCard, SectionHeading, ShowcaseBadge, ShowcasePageHeader } from './ShowcasePrimitives';

const JOBS = [
  { name: 'DAY04_15_langchain使用MCP', state: '转写中', progress: 46, detail: '27:07 · whisper large-v3 · 预计 4 分钟', tone: 'accent' as const },
  { name: '8-3 多Agent系统可视化配置API设计与开发', state: '转写中', progress: 72, detail: '31:00 · 已完成字幕，正在补总结', tone: 'accent' as const },
  { name: 'DAY03_10_使用milvus进行向量检索', state: '排队', progress: 0, detail: '44:51 · 队列第 3 位', tone: 'muted' as const },
  { name: 'DAY02_14_RAG_介绍', state: '已完成', progress: 100, detail: '13:53 · 字幕 + 总结 + 向量均已入库', tone: 'success' as const },
];

const CONSOLE_TREE = [
  { name: '尚硅谷-AI大模型 202601', count: '5,280', active: true },
  { name: 'MCP+A2A 多Agent全栈', count: '1,164', active: false },
  { name: '智选新闻项目', count: '86', active: false },
  { name: '未归类课程', count: '7,850', active: false },
];

const PIPELINE = [
  { title: '扫描', detail: '只扫指定子目录，不误删全库', icon: <Folder size={15} /> },
  { title: 'VAD + ASR', detail: '切掉静音、按语言转写', icon: <Mic size={15} /> },
  { title: '清洗 + 时间戳', detail: '去口头语，保留可回跳的秒数', icon: <Clock size={15} /> },
  { title: '总结 / 向量', detail: '摘要、chunk、embedding 入库', icon: <Database size={15} /> },
  { title: '检索 / Agent', detail: '字幕命中后直接给学习建议', icon: <Search size={15} /> },
];

const DETECTION_APPLICATIONS = [
  {
    title: '内容风险检测',
    detail: '字幕全文与时间轴一起做敏感语义、合规话术、重复灌水筛查；能定位到具体分钟，而不是只给一个视频打标。',
    icon: <ShieldCheck size={16} />,
    tone: 'text-[var(--danger)]',
  },
  {
    title: '课程 / 字幕质量检测',
    detail: '项目已有字幕质量报表，可检查 invalid timestamps、repeat loop、filler 密度；转写链路稳定后，质检不再靠人耳抽听。',
    icon: <ListChecks size={16} />,
    tone: 'text-[var(--warn)]',
  },
  {
    title: '客服 / 会议质检',
    detail: '把通话录音转成带时间戳的文本，再做话术覆盖、情绪、投诉点与流程违规检测；这是转写能力的下游扩展。',
    icon: <Activity size={16} />,
    tone: 'text-[var(--accent)]',
  },
  {
    title: '媒体资产治理',
    detail: '自动打标签、拆章节、生成可检索片段；视频库从“文件夹”变成可搜索、可推荐的内容资产。',
    icon: <Layers size={16} />,
    tone: 'text-[#0f766e]',
  },
];

function ConsolePreview({ onToast }: { onToast: (message: string) => void }) {
  const [scanText, setScanText] = useState('扫描子目录');
  const [queuePaused, setQueuePaused] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#0f766e] text-white"><Mic size={13} /></span>
          <span className="text-xs font-semibold text-[var(--text-primary)]">P2 Transcribe</span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">127.0.0.1:12703</span>
        </div>
        <ShowcaseBadge tone="warn">UI 预览 · 不触发真实任务</ShowcaseBadge>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className={`h-1.5 w-1.5 rounded-full ${queuePaused ? 'bg-[var(--warn)]' : 'bg-[var(--success)]'}`} />
          {queuePaused ? '队列已暂停 · 预览' : '队列运行中 · worker 在线'}
          <button
            type="button"
            onClick={() => {
              setQueuePaused((value) => !value);
              onToast(queuePaused ? '已恢复队列（预览）' : '已暂停队列（预览）');
            }}
            className="ml-1 inline-flex items-center gap-1 rounded border border-[var(--border-light)] bg-[var(--bg-card)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
          >
            {queuePaused ? <Play size={10} /> : <Pause size={10} />}
            {queuePaused ? '恢复' : '暂停'}
          </button>
        </div>
      </div>

      <div className="grid min-h-[22rem] grid-cols-1 divide-y divide-[var(--border-light)] lg:grid-cols-[15rem_minmax(0,1fr)_15rem] lg:divide-x lg:divide-y-0">
        <div className="p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-[var(--text-primary)]">视频目录</p>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">D:/ITJC</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {CONSOLE_TREE.map((node) => (
              <div key={node.name} className={`rounded-lg border px-2 py-1.5 ${node.active ? 'border-[var(--accent)] bg-[var(--accent-bg)]' : 'border-[var(--border-light)] bg-[var(--bg-elevated)]'}`}>
                <div className="flex items-center gap-1.5">
                  <Folder size={12} className={node.active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                  <span className="truncate text-[11px] text-[var(--text-secondary)]">{node.name}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px] text-[var(--text-muted)]">
                  <span>{node.count} 个视频</span>
                  {node.active && <span className="text-[var(--accent)]">当前范围</span>}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setScanText('扫描中…（等待全局锁）');
              onToast('预览不会真的扫描；真实控制台会显示扫描轮次。');
              window.setTimeout(() => setScanText('扫描子目录'), 2200);
            }}
            className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
          >
            <RefreshCw size={11} />
            {scanText}
          </button>
        </div>

        <div className="min-w-0 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold text-[var(--text-primary)]">任务队列</p>
            <span className="rounded-full bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">运行中 2</span>
            <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">排队 7</span>
            <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">今日完成 126h</span>
            <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">limit 100</span>
          </div>
          <div className="mt-2 space-y-2">
            {JOBS.map((job) => (
              <div key={job.name} className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-2.5">
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${job.tone === 'success' ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]' : job.tone === 'accent' ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'bg-[var(--bg-card)] text-[var(--text-muted)]'}`}>
                    {job.tone === 'success' ? <CheckCircle2 size={12} /> : job.tone === 'accent' ? <RefreshCw size={12} className="animate-spin" /> : <Clock size={12} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-[var(--text-primary)]">{job.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--text-muted)]">
                      <span className={job.tone === 'success' ? 'text-[var(--success)]' : job.tone === 'accent' ? 'text-[var(--accent)]' : ''}>{job.state}</span>
                      <span>·</span>
                      <span className="truncate">{job.detail}</span>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-secondary)]">{job.progress}%</span>
                </div>
                <div className="mt-2 h-1 rounded-full bg-[var(--bg-card)]">
                  <div className={`h-1 rounded-full ${job.tone === 'success' ? 'bg-[var(--success)]' : job.tone === 'accent' ? 'bg-[var(--accent)]' : 'bg-[var(--border-light)]'}`} style={{ width: `${Math.max(job.progress, 2)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[9px] text-[var(--text-muted)]">
            <AlertCircle size={10} className="text-[var(--warn)]" />
            子目录扫描只 upsert，不执行全库缺失删除；全局扫描占锁时等待，不直接报失败。
          </div>
        </div>

        <div className="p-3">
          <p className="text-[11px] font-semibold text-[var(--text-primary)]">处理参数</p>
          <div className="mt-2 space-y-1.5 text-[10px]">
            {[
              ['引擎', 'whisper.cpp / ctranslate2'],
              ['模型', 'large-v3'],
              ['语言', '中文'],
              ['VAD', '开启'],
              ['总结', '开启 · 800 字'],
              ['设备', 'CUDA auto'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5">
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className="text-right text-[var(--text-secondary)]">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--success)_24%,var(--border-light))] bg-[color-mix(in_srgb,var(--success)_7%,var(--bg-card))] px-2 py-1.5 text-[9px] leading-relaxed text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--success)]">worker 在线</span> · GPU 队列空闲 38%
          </div>
          <div className="mt-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[9px] leading-relaxed text-[var(--text-muted)]">
            控制台只读本机 <span className="font-mono">OPS_TOKEN</span>，令牌为空时接口关闭而不是放行。
          </div>
        </div>
      </div>
    </div>
  );
}

export function TranscribeShowcasePage() {
  const setActiveView = useUIStore((state) => state.setActiveView);
  const [toast, setToast] = useState('');

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  return (
    <div className="p-3 md:p-5">
      <ShowcasePageHeader
        kicker="P2 TRANSCRIBE · CONTROL PLANE"
        title="转写不是按钮，是一条可管理的时间轴生产线"
        description="P2 Transcribe 是独立的本机控制台：扫描指定目录、批量转写与总结、暂停/恢复队列、监控 worker。它不复制数据面，仍然共用主站后端、PostgreSQL 和 RQ；主站只负责浏览、检索和学习。"
        action={(
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveView('media')}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)]"
            >
              P2 Media 检索链路
              <ArrowRight size={13} />
            </button>
            <button
              type="button"
              onClick={() => setActiveView('videopreview')}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0f766e] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              看视频检索
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-lg">
          {toast}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[color-mix(in_srgb,#0f766e_24%,var(--border-light))] bg-[linear-gradient(130deg,color-mix(in_srgb,#0f766e_10%,var(--bg-card)),var(--bg-card)_58%,color-mix(in_srgb,var(--accent)_6%,var(--bg-card)))] p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
          <div>
            <ShowcaseBadge>管理升级 · 控制面独立</ShowcaseBadge>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
              以前转写是视频站里的一个动作：扫描、入队、轮询、失败重试都堆在主站。现在主站不再轮询 AI 任务，
              Transcribe 在独立入口承担运维动作，视频站只读已经入库的字幕、摘要和检索结果。
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MetricCard value="12703" label="独立控制台" detail="127.0.0.1 回环" />
              <MetricCard value="3" label="worker 容器" detail="转写 + 向量 + 总结" />
              <MetricCard value="10,233" label="视频已总结" detail="字幕/摘要任务" />
              <MetricCard value="566 万" label="字幕段" detail="带时间戳" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)]/80 px-3 py-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <ShieldCheck size={14} className="text-[#0f766e]" />
                控制面搬出去，数据面不复制
              </div>
              <p className="mt-1.5">
                同一个 backend、同一个 PostgreSQL、同一个 RQ。控制台只负责触发和监控，
                不会出现两套任务状态、两份字幕或两个 worker 抢同一批视频。
              </p>
              <p className="mt-2 text-[10px] text-[var(--text-muted)]">当前页面为静态 UI 预览，不调用 `/api/ops`，也不会真的扫描或入队。</p>
            </div>
            <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)]/80 px-3 py-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <ListChecks size={14} className="text-[#0f766e]" />
                这一页的交付边界
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-2">
                  <span className="w-10 shrink-0 text-[10px] font-semibold text-[#0f766e]">已交付</span>
                  <span>扫描、批量转写/总结、队列暂停、worker 监控</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-10 shrink-0 text-[10px] font-semibold text-[#b45309]">扩展</span>
                  <span>内容风险、字幕质量、客服/会议质检等检测模型</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-10 shrink-0 text-[10px] font-semibold text-[var(--text-muted)]">不接</span>
                  <span>不请求视频、转写或 ops 接口，扫描按钮只给反馈</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <SectionHeading
          index="01"
          title="控制台长什么样"
          description="左边选范围，中间看队列，右边改参数。扫描、批量入队、暂停和重试都在这一页完成。"
          action={<ShowcaseBadge tone="muted">界面预览</ShowcaseBadge>}
        />
        <ConsolePreview onToast={showToast} />
      </section>

      <section className="mt-5">
        <SectionHeading
          index="02"
          title="为什么把它拆出来，而不是继续塞在视频站"
          description="不是为了多一个页面，而是把长任务、重试和资源占用从浏览路径里移出去。"
        />
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: '主站不再轮询任务',
              detail: '视频页不挂 AI 任务中心，不做 5 秒轮询；浏览和检索的请求量降下来，页面不再被几千条 queued 任务拖住。',
              icon: <Activity size={16} />,
            },
            {
              title: '扫描范围可控',
              detail: '可按课程子目录增量扫描；子目录扫描只 upsert，不执行全库缺失删除。全局扫描占锁时排队等待。',
              icon: <Folder size={16} />,
            },
            {
              title: '队列和 worker 可见',
              detail: '暂停/恢复队列、取消/重试任务、同步排队任务参数、清理完成任务，都能在控制台里看见结果。',
              icon: <Server size={16} />,
            },
            {
              title: '失败可恢复',
              detail: '任务状态、幂等判断和暂停规则只有一份。控制台重启不会产生第二套状态，失败重试仍沿用原队列语义。',
              icon: <RefreshCw size={16} />,
            },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[color-mix(in_srgb,#0f766e_10%,var(--bg-elevated))] text-[#0f766e]">
                {item.icon}
              </div>
              <p className="mt-2 text-xs font-semibold text-[var(--text-primary)]">{item.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <SectionHeading
          index="03"
          title="Transcribe 的意义：字幕是时序数据，不是一段文本"
          description="转写把音频变成带时间戳的结构化数据；检索、摘要、质检、推荐都建立在这条时间轴上。"
        />
        <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
          <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
            {PIPELINE.map((step, index) => (
              <React.Fragment key={step.title}>
                <div className="min-w-0 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-2.5 md:flex-1">
                  <div className="flex items-center gap-1.5 text-[var(--accent)]">
                    {step.icon}
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">0{index + 1}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-[var(--text-primary)]">{step.title}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--text-muted)]">{step.detail}</p>
                </div>
                {index < PIPELINE.length - 1 && (
                  <div className="hidden shrink-0 items-center justify-center text-[var(--text-muted)] md:flex md:w-4">
                    <ArrowRight size={14} />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="mt-3 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">这就是 AI 检测类应用的底座：</span>
            只有文本没有时间戳，检测只能给整段视频打一个“可疑”；有了时间轴，才能定位到第 12 分钟、第 3 句话、某个说话段。
          </p>
        </div>
      </section>

      <section className="mt-5">
        <SectionHeading
          index="04"
          title="可扩展的 AI 检测类应用"
          description="以下是从“带时间戳的转写 + 摘要 + 向量”自然长出来的方向；当前控制台负责转写与队列，检测模型是下游能力。"
          action={<ShowcaseBadge tone="warn">扩展方向</ShowcaseBadge>}
        />
        <div className="grid gap-2.5 md:grid-cols-2">
          {DETECTION_APPLICATIONS.map((item) => (
            <div key={item.title} className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
              <div className={`flex items-center gap-2 text-xs font-semibold ${item.tone}`}>
                {item.icon}
                {item.title}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{item.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-[var(--warn)]" />
          <span>边界说明：当前已交付的是扫描、批量转写/总结、队列暂停与 worker 监控；内容检测、客服质检等属于可扩展应用，不宣称已经上线。</span>
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">字幕先入库，才有视频检索和 Agent 建议</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">回到 Media 页看真实检索链路，或直接打开 Lite 的两层视频预览。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveView('media')}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)]"
          >
            去 P2 Media
            <ArrowRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => setActiveView('videopreview')}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            视频检索预览
            <ArrowRight size={13} />
          </button>
        </div>
      </section>

      <p className="mt-4 text-center text-[10px] text-[var(--text-muted)]">
        P2 Transcribe 独立控制台默认只绑定 127.0.0.1，正式入口需要本机 OPS_TOKEN；这个页面只做产品说明与界面预览。
      </p>
    </div>
  );
}
