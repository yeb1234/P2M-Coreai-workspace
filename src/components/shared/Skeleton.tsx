import React from 'react';

/**
 * 骨架屏。
 *
 * 为什么需要：项目里 12 个模块，只有 JourneyPage 处理了 loading。
 * 其余页面在数据到达前显示的是「空状态」——用户分不清「还在加载」
 * 和「确实没数据」，通常会去点刷新。
 *
 * 这里刻意不画精细的灰块形状，而是用几条等宽短线：
 * 骨架屏的价值是「告诉用户马上有东西」，不是「精确预告内容的排版」。
 * 画得太像反而在真实内容到达时产生跳变。
 */

interface SkeletonProps {
  /** 行数，默认 3 */
  lines?: number;
  /** 每行高度，默认 14（接近一行正文） */
  height?: number;
  /** 最后一行宽度，制造自然的参差感 */
  lastLineWidth?: string;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  lines = 3,
  height = 14,
  lastLineWidth = '62%',
  className = '',
}) => (
  <div className={`space-y-2.5 ${className}`} aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        className="animate-pulse rounded bg-[var(--bg-elevated)]"
        style={{
          height,
          width: i === lines - 1 ? lastLineWidth : '100%',
        }}
      />
    ))}
  </div>
);

/** 列表骨架：n 个卡片位，每个带标题行 + 一行正文 */
export const SkeletonList: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-2" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] p-3"
      >
        <div className="mb-2 h-3.5 w-2/5 animate-pulse rounded bg-[var(--bg-elevated)]" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--bg-elevated)]" />
      </div>
    ))}
  </div>
);

/**
 * 加载态的可访问性：屏幕阅读器需要被告知「正在加载」。
 * 视觉骨架对读屏软件是不可见的（aria-hidden），所以必须单独播报。
 */
export const LoadingAnnounce: React.FC<{ label?: string }> = ({ label = '正在加载' }) => (
  <span role="status" aria-live="polite" className="sr-only">
    {label}
  </span>
);

export default Skeleton;
