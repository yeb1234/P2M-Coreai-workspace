import React from 'react';

/**
 * 卡片内的空状态。
 *
 * ## 为什么需要它
 *
 * 卡片改成同行等高后，内容少的卡片（今日无事件、暂无待办）会剩一大片
 * 空白。各页面原来各写各的：待办是「暂无待办」居中的一行灰字，
 * 日历是「今日无事件」带 py-3，番茄钟是「今天还没有专注记录」——
 * 三种写法、三种留白、三种语气。
 *
 * 统一成一个块：淡色圆底图标 + 一句状态 + 一句下一步。
 * `flex-1` 让它吃满剩余空间并垂直居中，空白就变成「有引导的留白」，
 * 不再是「卡片没填满」。
 *
 * 能点就传 onClick —— 空状态最适合承担「下一步做什么」，
 * 比让用户自己去找入口强。
 */
export const SummaryEmpty: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  onClick?: () => void;
}> = ({ icon, title, hint, onClick }) => {
  const base =
    'flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[var(--r-1)] px-3 py-4 text-center';

  const inner = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">
        {icon}
      </span>
      <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
      {hint && <span className="text-[11px] leading-4 text-[var(--text-muted)]">{hint}</span>}
    </>
  );

  if (!onClick) {
    return <div className={base}>{inner}</div>;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // 卡片本身也是可点的（跳转到对应页面），这里要阻止冒泡，
        // 否则点空状态会先触发卡片跳转、再触发一次本按钮的跳转。
        event.stopPropagation();
        onClick();
      }}
      className={`${base} transition-colors hover:bg-[var(--bg-elevated)]`}
    >
      {inner}
    </button>
  );
};
