import React from 'react';

interface PageTitleProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export const PageTitle: React.FC<PageTitleProps> = React.memo(({ title, subtitle, icon, action }) => {
  return (
    <div className="flex items-end justify-between mb-6 pb-3 border-b border-[#e5e2dd]">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#fef7ed] text-[#c87d2f]">
            {icon}
          </span>
        )}
        <div>
          <h2 className="text-xl font-bold text-[#1a1a1a] tracking-tight leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-[#b8b4ac] mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
});
