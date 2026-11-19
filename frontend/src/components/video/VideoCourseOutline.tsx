import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, PlayCircle, ListVideo } from 'lucide-react';
import { fetchVideos, type CategoryTree, type VideoItem } from '../../lib/videoApi';
import { useVideoStore } from '../../stores/videoStore';
import { formatVideoDuration } from './videoFormat';

interface OutlineModule {
  id: number;
  name: string;
  lessons: OutlineLesson[];
}

interface OutlineLesson {
  id: number;
  title: string;
  duration: number | null;
  completed: boolean;
  watchProgress: number | null;
  isCurrent: boolean;
}

function displayModuleName(name: string): string {
  return name.includes(' / ') ? name.split(' / ').pop()! : name;
}

function buildOutline(
  nodes: CategoryTree[],
  videosByCategory: Map<number, VideoItem[]>,
  currentVideoId: number | null
): OutlineModule[] {
  const result: OutlineModule[] = [];
  function walk(items: CategoryTree[]) {
    for (const node of items) {
      const videos = videosByCategory.get(node.id) ?? [];
      const lessons: OutlineLesson[] = videos.map((v) => ({
        id: v.id,
        title: v.title,
        duration: v.duration,
        completed: v.completed,
        watchProgress: v.watch_progress,
        isCurrent: v.id === currentVideoId,
      }));
      // 递归子文件夹
      if (node.children.length > 0) {
        walk(node.children);
      }
      // 只显示包含视频的文件夹
      if (lessons.length > 0) {
        result.push({
          id: node.id,
          name: displayModuleName(node.name),
          lessons,
        });
      }
    }
  }
  walk(nodes);
  return result;
}

export const VideoCourseOutline: React.FC = () => {
  const { selectVideo, currentVideo, categoryTree } = useVideoStore();
  const [allVideos, setAllVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    hasScrolledRef.current = false;
    fetchVideos(1, 1000)
      .then((page) => {
        if (cancelled) return;
        setAllVideos(page.items);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const videosByCategory = useMemo(() => {
    const map = new Map<number, VideoItem[]>();
    for (const v of allVideos) {
      if (v.category_id !== null) {
        const arr = map.get(v.category_id) ?? [];
        arr.push(v);
        map.set(v.category_id, arr);
      }
    }
    return map;
  }, [allVideos]);

  const outline = useMemo(
    () => buildOutline(categoryTree, videosByCategory, currentVideo?.id ?? null),
    [categoryTree, videosByCategory, currentVideo]
  );

  const { totalLessons, completedLessons, progressPercent } = useMemo(() => {
    let total = 0;
    let completed = 0;
    for (const mod of outline) {
      total += mod.lessons.length;
      for (const l of mod.lessons) {
        if (l.completed) completed++;
      }
    }
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { totalLessons: total, completedLessons: completed, progressPercent: pct };
  }, [outline]);

  // 自动滚动到当前正在看的课时（仅首次加载后执行一次）
  useEffect(() => {
    if (!loading && activeRef.current && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      const timer = setTimeout(() => {
        activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const handleSelectLesson = (lessonId: number) => {
    const v = allVideos.find((x) => x.id === lessonId);
    if (v) selectVideo(v);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <ListVideo size={18} className="animate-pulse" />
          加载课程大纲...
        </div>
      </div>
    );
  }

  if (outline.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <PlayCircle size={32} className="text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">暂无课程数据</p>
        <p className="text-xs text-[var(--text-muted)]">请先扫描并添加视频文件夹</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-2 py-2">
      {outline.map((mod) => (
        <div key={mod.id} className="space-y-2">
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{mod.name}</h3>
          <div className="space-y-0.5">
            {mod.lessons.map((lesson) => {
              const isActive = lesson.isCurrent;
              return (
                <div
                  key={lesson.id}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => handleSelectLesson(lesson.id)}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,#fee2e2_55%,var(--bg-card))]'
                      : 'hover:bg-[var(--bg-accent)]'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {lesson.completed ? (
                      <CheckCircle2 size={18} className="text-[#16a34a]" />
                    ) : isActive ? (
                      <Clock size={18} className="text-[#ef4444]" />
                    ) : (
                      <Circle size={18} className="text-[var(--text-muted)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm font-medium ${
                        isActive ? 'text-[#dc2626]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {lesson.title}
                    </p>
                    <p
                      className={`mt-0.5 text-xs ${
                        isActive ? 'text-[#fca5a5]' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      Video · {formatVideoDuration(lesson.duration)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* 底部总进度 */}
      <div className="sticky bottom-0 space-y-1 border-t border-[var(--border-light)] bg-[var(--bg-body)]/90 px-1 pt-3 pb-4 backdrop-blur-sm">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>总进度</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="theme-progress-track h-1.5 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-[#ef4444] transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
          <span>
            {completedLessons} / {totalLessons} 课时已完成
          </span>
        </div>
      </div>
    </div>
  );
};
