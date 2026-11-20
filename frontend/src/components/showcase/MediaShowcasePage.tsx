import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileText,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useUIStore } from '../../stores';
import { MetricCard, SectionHeading, ShowcaseBadge, ShowcasePageHeader, TextLink } from './ShowcasePrimitives';
import { SHOWCASE_VIDEOS } from './showcaseData';

const SEARCH_STEPS = [
  { label: '视频 / 字幕', detail: '标题、目录、566 万条字幕段', icon: <Database size={16} /> },
  { label: '三路召回', detail: '关键词、向量、元数据', icon: <Search size={16} /> },
  { label: '加权 RRF', detail: '把三路结果合成一个候选池', icon: <Layers size={16} /> },
  { label: 'Cross-encoder', detail: '按 query 与片段语义重排', icon: <Sparkles size={16} /> },
  { label: '带时间戳', detail: '回到视频对应秒数', icon: <Clock size={16} /> },
];

const AGENT_TOOLS = [
  { name: 'search_videos', note: '找到相关视频与字幕片段' },
  { name: 'get_video_summary', note: '拿章节、总结与上下文' },
  { name: 'get_learning_profile', note: '读观看历史、收藏与画像' },
  { name: 'recommend_next_videos', note: '给出下一步学习顺序' },
  { name: 'create_todo', note: '把建议落成可执行待办' },
];

const MEDIA_RESULT = SHOWCASE_VIDEOS[0];
const MEDIA_RESULT_2 = SHOWCASE_VIDEOS[2];

export function MediaShowcasePage() {
  const setActiveView = useUIStore((state) => state.setActiveView);

  return (
    <div className="p-3 md:p-5">
      <ShowcasePageHeader
        kicker="P2 MEDIA · REAL CAPABILITY"
        title="不是壳子：视频、字幕、Agent 共用同一条检索链路"
        description="Lite 里的视频页是静态切片；真正的 P2 Media 会把视频、字幕、摘要、观看记录和向量索引连成一条线。搜到的不只是“一个视频”，而是视频里的某句话、某个章节和下一步该学什么。"
        action={(
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveView('videopreview')}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)]"
            >
              看视频检索预览
              <ArrowRight size={13} />
            </button>
            <button
              type="button"
              onClick={() => setActiveView('transcribe')}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              看 P2 Transcribe
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      />

      <section className="overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--accent)_22%,var(--border-light))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_14%,var(--bg-card)),var(--bg-card)_52%,color-mix(in_srgb,#ec4899_8%,var(--bg-card)))] p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-end">
          <div>
            <ShowcaseBadge>本机真实数据</ShowcaseBadge>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
              P2 Media 不是把视频文件丢进目录就结束。它把每个视频拆成可检索的字幕段，建立向量索引，
              再用标题、字幕和元数据三路召回。Agent 拿到的是同一批带时间戳的证据，而不是一份编出来的推荐列表。
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              {['标题 / 文件夹检索', '字幕 hybrid search', '时间戳回跳', 'AI 总结', '观看画像'].map((item) => (
                <span key={item} className="rounded-full border border-[var(--border-light)] bg-[var(--bg-card)] px-2.5 py-1 text-[var(--text-secondary)]">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricCard value="14,380" label="视频入库" detail="本机 Media 当前" />
            <MetricCard value="566 万" label="字幕段" detail="可定位到秒" />
            <MetricCard value="98,271" label="语义块" detail="已向量化" />
          </div>
        </div>
      </section>

      <section className="mt-5">
        <SectionHeading
          index="01"
          title="真的能搜到对应视频，而不是搜到标题"
          description="搜索有两种入口：标题/目录用于找课程，字幕片段用于找“哪一集讲过这句话”。两条都返回视频和时间点。"
        />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              <Search size={14} className="text-[var(--accent)]" />
              <span className="font-medium text-[var(--text-primary)]">FastAPI 依赖注入</span>
              <span className="ml-auto rounded-md bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">字幕模式</span>
            </div>
            <div className="mt-2 space-y-2">
              {[MEDIA_RESULT, MEDIA_RESULT_2, SHOWCASE_VIDEOS[1]].map((video, index) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => setActiveView('videopreview')}
                  className="group flex w-full items-center gap-2.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-2 text-left transition-colors hover:border-[var(--accent)]"
                >
                  <img src={video.cover} alt="" className="aspect-video w-24 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <span className="font-mono text-[var(--accent)]">{video.hitAt}</span>
                      <span>·</span>
                      <span className="truncate">{video.folder}</span>
                      <span className="ml-auto shrink-0">#{index + 1}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)]">{video.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-muted)]">{video.hitText}</p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
              这是真实 Media 的检索结构；上面三条是本机库里的真实视频，命中分数为演示值。点击会回到 Lite 的静态观看页。
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <Layers size={14} className="text-[var(--accent)]" />
              一条 query 在 Media 里怎么走
            </div>
            <div className="space-y-2">
              {SEARCH_STEPS.map((step, index) => (
                <div key={step.label} className="flex items-start gap-2">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] text-[var(--accent)]">
                    {step.icon}
                  </div>
                  <div className="min-w-0 flex-1 border-b border-[var(--border-light)] pb-2 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-[var(--text-primary)]">{step.label}</span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">0{index + 1}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--success)_25%,var(--border-light))] bg-[color-mix(in_srgb,var(--success)_9%,var(--bg-card))] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--success)]">可验证结果：</span>
              后端 `/ready` 当前向量覆盖率 98,271 / 98,271，查询能落到具体字幕段和秒数。
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <SectionHeading
          index="02"
          title="Agent 不只推荐视频，它给带证据的学习建议"
          description="检索结果、观看历史、学习路径和写工具都在同一个 Agent 里。建议会指向具体视频的具体片段，也能落成待办或笔记。"
        />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_24%,var(--border-light))] bg-[var(--bg-card)] p-3.5">
            <div className="flex items-center gap-2 border-b border-[var(--border-light)] pb-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent-bg)] text-[var(--accent)]"><Bot size={17} /></span>
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">灵境小助手 · 学习复盘</p>
                <p className="text-[10px] text-[var(--text-muted)]">P2 Media 完整版 · 带页面上下文</p>
              </div>
              <ShowcaseBadge tone="muted">示例对话</ShowcaseBadge>
            </div>
            <div className="mt-3 space-y-2.5">
              <div className="ml-8 rounded-xl rounded-tr-sm bg-[var(--accent-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                我最近在补 FastAPI 和 Agent，接下来该看哪段？别只给我课程名。
              </div>
              <div className="mr-4 rounded-xl rounded-tl-sm border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                <p>
                  你昨天看了《RAG 介绍》11 分钟，但《Milvus 向量检索》只停了 3 分钟。先别换新课，
                  回看 <span className="font-medium text-[var(--text-primary)]">50160 的 20:30</span>，把 top-k 与重排的关系补齐；
                  再用 <span className="font-medium text-[var(--text-primary)]">40676 的 12:40</span> 对照你项目里的 FastAPI Depends 边界。
                </p>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">依据：3 条字幕命中 + 近 7 天观看记录 + 你的学习路径。</p>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-8">
                {['定位到 20:30', '生成 2 条待办', '写入学习笔记'].map((action) => (
                  <span key={action} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                    <CheckCircle2 size={10} className="text-[var(--success)]" />
                    {action}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <ShieldCheck size={14} className="text-[var(--success)]" />
              Agent 调用的不是“想象”，是同一套工具
            </div>
            <div className="space-y-1.5">
              {AGENT_TOOLS.map((tool) => (
                <div key={tool.name} className="flex items-center gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-1.5">
                  <span className="font-mono text-[10px] text-[var(--accent)]">{tool.name}</span>
                  <span className="ml-auto text-right text-[10px] text-[var(--text-muted)]">{tool.note}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">写动作仍走 HITL：</span>
              Agent 可以生成待办或笔记草稿，但真正落库前会弹确认卡；Lite 也一样，不因为页面是演示就放开直写。
            </div>
            <div className="mt-3">
              <TextLink onClick={() => setActiveView('videopreview')}>打开视频检索，走一遍两层演示</TextLink>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <SectionHeading
          index="03"
          title="Lite 与 Media 的边界，写清楚比藏起来更重要"
          description="Lite 是 2GB 轻量站，不建视频库、不跑 embedding、不排队转写；它展示的是 Media 的界面切片和产品说明。"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--success)_24%,var(--border-light))] bg-[color-mix(in_srgb,var(--success)_7%,var(--bg-card))] p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--success)]">
              <CheckCircle2 size={14} />
              P2 Media 完整版
            </div>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <li>真实视频文件、缩略图、字幕与 AI 总结</li>
              <li>标题/文件夹 + 字幕 hybrid search，带时间戳回跳</li>
              <li>观看记录、收藏、学习画像、推荐与路径</li>
              <li>Agent 调用 search_videos 等完整工具集</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <FileText size={14} className="text-[var(--text-muted)]" />
              P2 Lite / 本 Demo
            </div>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <li>只保留 Agent、面试、笔记、待办、日历等 OLTP 页面</li>
              <li>视频检索页是静态样例，不请求视频/embedding 接口</li>
              <li>这里展示的是“如果接完整版，产品长什么样”</li>
              <li>真实视频、转写和向量能力需要部署 P2 Media + worker</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-[color-mix(in_srgb,#0f766e_24%,var(--border-light))] bg-[linear-gradient(120deg,color-mix(in_srgb,#0f766e_9%,var(--bg-card)),var(--bg-card))] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0f766e]">
              <FileText size={14} />
              视频检索之前，字幕从哪来？
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--text-muted)]">
              转写不是主站上的一个按钮了。P2 Transcribe 把它变成独立控制台：扫描路径、批量转写、补总结、暂停队列、看 worker。字幕有了，检索和 Agent 才有证据。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveView('transcribe')}
            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            进入 P2 Transcribe
            <ArrowRight size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}
