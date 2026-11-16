import React from 'react';

/**
 * 加载态的可访问性：屏幕阅读器需要被告知「正在加载」。
 *
 * 视觉骨架对读屏软件是不可见的（aria-hidden），所以必须单独播报。
 *
 * 注：原来这个文件里还有 Skeleton / SkeletonList 两个骨架屏组件，
 * 但全项目零引用（只有 barrel 里 re-export）—— 页面各自的 loading 态
 * 早就用别的写法了。2026-11 清理时删掉，只留这个真正在用的。
 */
export const LoadingAnnounce: React.FC<{ label?: string }> = ({ label = '正在加载' }) => (
  <span role="status" aria-live="polite" className="sr-only">
    {label}
  </span>
);
