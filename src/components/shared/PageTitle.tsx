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
    <div className="flex items-end justify-between mb-6 pb-3 border-b border-[#e5e2dd]">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#fef7ed] text-[#c87d2f]">
            {icon}
          </span>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-[#1a1a1a] tracking-tight leading-tight">
              {title}
            </h2>
            {dev && (
              <span className="px-1.5 py-0.5 text-[9px] font-medium bg-[#f59e0b]/15 text-[#d97706] rounded-full border border-[#f59e0b]/30">
                DEV
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-[#b8b4ac] mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
});
