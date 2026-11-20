import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  Folder,
  PlayCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import { useUIStore } from '../../stores';
import { ShowcaseBadge, ShowcasePageHeader } from './ShowcasePrimitives';
import { SHOWCASE_QUERIES, SHOWCASE_VIDEOS, rankShowcaseVideos, type ShowcaseVideo } from './showcaseData';

type SearchMode = 'title' | 'segments';

function ResultCard({ video, index, mode, onOpen }: {
  video: ShowcaseVideo;
  index: number;
  mode: SearchMode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-1 gap-3 rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border-light))] hover:shadow-md sm:grid-cols-[12.5rem_minmax(0,1fr)]"
      aria-label={`打开视频详情：${video.title}`}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <img src={video.cover} alt={`${video.title} 的视频截图`} className="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.02]" />
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {video.duration}
        </span>
        <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white transition-transform group-hover:scale-105">
          <PlayCircle size={18} />
        </span>
      </div>

      <div className="min-w-0 px-1 py-1">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="font-mono text-[var(--accent)]">{String(index + 1).padStart(2, '0')}</span>
          <span className="truncate">{video.folder}</span>
          <span className="ml-auto shrink-0 rounded-full border border-[var(--border-light)] px-1.5 py-0.5">
            {mode === 'title' ? '标题命中' : '字幕命中'}
          </span>
        </div>
        <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)] group-hover:text-[var(--accent)]">
          {video.title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1"><Clock size={11} />{video.duration}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1"><Sparkles size={11} className="text-[var(--success)]" />{video.status}</span>
          <span>·</span>
          <span>演示相关度 {video.score}%</span>
        </div>
        <div className="mt-2.5 rounded-xl border border-[color-mix(in_srgb,var(--accent)_18%,var(--border-light))] bg-[var(--accent-bg)] px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--accent)]">
            <span className="rounded bg-[var(--accent)] px-1 py-0.5 font-mono text-[10px] text-white">{video.hitAt}</span>
            {mode === 'title' ? '标题/目录线索' : '字幕原文命中'}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{video.hitText}</p>
        </div>
      </div>
    </button>
  );
}

function WatchView({ video, onBack, onOpenMedia, onOpenTranscribe }: {
  video: ShowcaseVideo;
  onBack: () => void;
  onOpenMedia: () => void;
  onOpenTranscribe: () => void;
}) {
  const [playHint, setPlayHint] = useState(false);

  return (
    <div className="pb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]"
        >
          <ArrowLeft size={13} />
          返回检索结果
        </button>
        <span>视频检索</span>
        <span>/</span>
        <span className="truncate text-[var(--text-primary)]">视频详情</span>
        <ShowcaseBadge tone="warn">静态观看页 · 不加载真实视频流</ShowcaseBadge>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,0.85fr)]">
        <div className="min-w-0">
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-[var(--border-light)] bg-black">
            <img src={video.cover} alt={`${video.title} 的视频截图`} className="h-full w-full object-cover opacity-85" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
            <button
              type="button"
              onClick={() => setPlayHint((value) => !value)}
              className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-black/55 text-white shadow-xl backdrop-blur-sm transition-transform hover:scale-105"
              aria-label="播放演示视频"
            >
              <PlayCircle size={38} />
            </button>
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-10 text-white">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-white/70">
                <span className="font-mono">00:00</span>
                <div className="h-1 flex-1 rounded-full bg-white/25">
                  <div className="h-1 w-[18%] rounded-full bg-white/80" />
                </div>
                <span className="font-mono">{video.duration}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{video.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/65">{video.folder}</p>
                </div>
                <span className="shrink-0 rounded-md bg-white/15 px-2 py-1 text-[10px] text-white/80">STATIC PREVIEW</span>
              </div>
            </div>
          </div>

          {playHint && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warn)_35%,var(--border-light))] bg-[var(--warn-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--warn)]">
              <FileText size={14} className="mt-0.5 shrink-0" />
              <span>这是静态观看页，只展示播放器版式和字幕/建议的排版；真实视频播放与进度记录在 P2 Media 主站完成。</span>
            </div>
          )}

          <div className="mt-3 rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1"><Folder size={12} />{video.folder}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><Clock size={12} />{video.duration}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-[var(--success)]"><Sparkles size={12} />{video.status}</span>
            </div>
            <h3 className="mt-2 text-lg font-semibold leading-snug text-[var(--text-primary)]">{video.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{video.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {video.chapters.map((chapter) => (
                <span key={chapter.time} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                  <span className="font-mono text-[var(--accent)]">{chapter.time}</span>
                  {chapter.title}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">字幕命中片段</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">真实 Media 会按时间戳跳到对应句，这里只展示静态排版。</p>
              </div>
              <ShowcaseBadge tone="muted">DEMO</ShowcaseBadge>
            </div>
            <div className="space-y-2">
              {video.transcript.map((segment) => (
                <div key={`${segment.time}-${segment.text}`} className="flex gap-3 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setPlayHint(true)}
                    className="h-fit shrink-0 rounded-md bg-[var(--accent-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
                  >
                    {segment.time}
                  </button>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{segment.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_25%,var(--border-light))] bg-[linear-gradient(135deg,var(--accent-bg),var(--bg-card))] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--accent)]">
              <Bot size={16} />
              Agent 学习建议
              <span className="ml-auto rounded-full border border-[var(--border-light)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--text-muted)]">样例</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">{video.advice.headline}</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{video.advice.body}</p>
            <div className="mt-3 space-y-1.5">
              {video.advice.actions.map((action) => (
                <div key={action} className="flex items-start gap-1.5 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)]/80 px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[var(--success)]" />
                  {action}
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
              在真实 Media 里，这几步可以变成待办或笔记；Lite 演示页只展示建议结构，不会写库。
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">这一段为什么被检索出来</h3>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
                <span>字幕相似度</span>
                <span className="font-mono text-[var(--accent)]">0.87</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
                <span>标题/目录命中</span>
                <span className="font-mono text-[var(--accent)]">+0.12</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
                <span>重排后</span>
                <span className="font-mono text-[var(--accent)]">#{video.id === '40676' ? '1' : '3'}</span>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">以上为演示值；真实链路是标题/字幕三路召回、加权 RRF、cross-encoder 重排。</p>
          </div>

          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-4">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">继续了解真实产品</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">这页只是 Media 的界面切片。真实检索、播放和 Agent 联动在主站。</p>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={onOpenMedia}
                className="flex items-center justify-between rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                看 P2 Media 怎么真的搜
                <ArrowRight size={14} />
              </button>
              <button
                type="button"
                onClick={onOpenTranscribe}
                className="flex items-center justify-between rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                了解 P2 Transcribe 控制台
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function VideoPreviewPage() {
  const setActiveView = useUIStore((state) => state.setActiveView);
  const [draftQuery, setDraftQuery] = useState(SHOWCASE_QUERIES[0].value);
  const [query, setQuery] = useState(SHOWCASE_QUERIES[0].value);
  const [mode, setMode] = useState<SearchMode>('segments');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = useMemo(() => rankShowcaseVideos(query), [query]);
  const selectedVideo = selectedId ? SHOWCASE_VIDEOS.find((video) => video.id === selectedId) ?? null : null;

  const openMedia = () => setActiveView('media');
  const openTranscribe = () => setActiveView('transcribe');

  if (selectedVideo) {
    return (
      <div className="p-3 md:p-5">
        <WatchView
          video={selectedVideo}
          onBack={() => setSelectedId(null)}
          onOpenMedia={openMedia}
          onOpenTranscribe={openTranscribe}
        />
      </div>
    );
  }

  return (
    <div className="p-3 md:p-5">
      <ShowcasePageHeader
        kicker="P2 MEDIA · LITE PREVIEW"
        title="视频检索"
        description="从 P2 Media 的视频检索抽出的两层演示：先按标题/字幕找到视频，再点进静态观看页看 AI 总结、字幕片段和学习建议。这里不连 Lite 后端，也不加载真实视频流。"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <ShowcaseBadge tone="warn">Lite 演示数据</ShowcaseBadge>
            <button
              type="button"
              onClick={openMedia}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              真实 Media 能力
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3 md:p-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(draftQuery.trim());
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <div className="relative min-w-0 flex-1">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={draftQuery}
                  onChange={(event) => setDraftQuery(event.target.value)}
                  placeholder="搜视频标题、目录或字幕原话，例如“依赖注入”"
                  className="w-full rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                  aria-label="搜索视频"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                搜索
              </button>
            </form>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">试试：</span>
              {SHOWCASE_QUERIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setDraftQuery(item.value);
                    setQuery(item.value);
                  }}
                  title={item.hint}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    query === item.value
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'border-[var(--border-light)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--accent)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-light)] pt-3">
              <div className="inline-flex rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-0.5">
                {([
                  ['segments', '搜字幕片段'],
                  ['title', '搜标题/目录'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      mode === value ? 'bg-[var(--bg-card)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                演示索引：{SHOWCASE_VIDEOS.length} 条视频 · 5 个真实缩略图 · 0 次后端请求
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-secondary)]">
              找到 <span className="font-mono font-semibold text-[var(--accent)]">{results.length}</span> 条样例
              {query ? <>，当前查询「<span className="text-[var(--text-primary)]">{query}</span>」</> : null}
            </p>
            <span className="text-[10px] text-[var(--text-muted)]">按演示相关度排序</span>
          </div>

          <div className="mt-2 space-y-2.5">
            {results.length > 0 ? results.map((video, index) => (
              <ResultCard
                key={video.id}
                video={video}
                index={index}
                mode={mode}
                onOpen={() => setSelectedId(video.id)}
              />
            )) : (
              <div className="rounded-2xl border border-dashed border-[var(--border-light)] bg-[var(--bg-card)] px-4 py-10 text-center">
                <p className="text-sm font-medium text-[var(--text-primary)]">演示样例里没有命中这一条</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">真实 P2 Media 会在 14,000+ 视频、560 万条字幕里检索；这里是 5 条固定样例。</p>
                <button
                  type="button"
                  onClick={() => {
                    setDraftQuery(SHOWCASE_QUERIES[0].value);
                    setQuery(SHOWCASE_QUERIES[0].value);
                  }}
                  className="mt-3 rounded-lg border border-[var(--border-light)] px-3 py-1.5 text-xs text-[var(--accent)]"
                >
                  回到默认样例
                </button>
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <Sparkles size={14} className="text-[var(--accent)]" />
              这一层在演示什么
            </div>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div className="rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
                <span className="font-medium text-[var(--text-primary)]">第一层：检索列表</span>
                <p className="mt-0.5 text-[var(--text-muted)]">标题/目录和字幕片段两种模式，命中的时间点直接露在卡片上。</p>
              </div>
              <div className="rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
                <span className="font-medium text-[var(--text-primary)]">第二层：静态观看</span>
                <p className="mt-0.5 text-[var(--text-muted)]">点任意结果，看播放器版式、AI 总结、字幕段落和 Agent 建议。</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3.5">
            <div className="text-xs font-semibold text-[var(--text-primary)]">演示边界</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
              标题和缩略图来自本机 P2 Media 视频库；命中时间和相关度是演示值。Lite 没有视频库、embedding 和转写 worker，不会假装后端能搜。
            </p>
          </div>

          <button
            type="button"
            onClick={openTranscribe}
            className="w-full rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3.5 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border-light))]"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <FileText size={14} className="text-[#0f766e]" />
              这些字幕从哪来
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">转写、总结和队列管理已经被拆到 P2 Transcribe，点这里看它的控制台和 AI 检测价值。</p>
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)]">
              了解 P2 Transcribe <ArrowRight size={12} />
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}
