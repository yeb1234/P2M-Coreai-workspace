import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = React.memo(({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-[#f3f2ef] flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-medium text-[#1a1a1a] mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-[#9ca3af] text-center max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  );
});
