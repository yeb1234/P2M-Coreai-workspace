import React from 'react';

interface PageTitleProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  dev?: boolean;
}

export const PageTitle: React.FC<PageTitleProps> = React.memo(({ title, subtitle, icon, action, dev }) => {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-[color-mix(in_srgb,var(--border-light)_72%,transparent)] pb-3 pt-1 sm:flex-row sm:items-end sm:justify-between md:pt-0">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--accent)_18%,var(--border-light))] bg-[var(--accent-bg)] text-[var(--accent)] md:rounded-lg">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[1.25rem] font-semibold leading-tight tracking-normal text-[var(--text-primary)] md:text-[1.35rem]">
              {title}
            </h2>
            {dev && (
              <span className="shrink-0 rounded-full border border-[#f59e0b]/30 bg-[var(--warn)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[#d97706]">
                DEV
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-xs leading-snug text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
});
