import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  color: string;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = React.memo(({ children, color, size = 'sm' }) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses[size]}`}
      style={{
        backgroundColor: `${color}15`,
        color: color,
      }}
    >
      {children}
    </span>
  );
});
