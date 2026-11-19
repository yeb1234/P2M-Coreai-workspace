import React from 'react';
import type { TodoPriority } from '../../types';
import { PRIORITY_COLORS } from '../../types';

interface TodoBadgeProps {
  priority: TodoPriority;
}

export const TodoBadge: React.FC<TodoBadgeProps> = React.memo(({ priority }) => {
  const color = PRIORITY_COLORS[priority];
  return (
    <span
      className="inline-block w-3 h-3 rounded-lg flex-shrink-0"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
        boxShadow: `1px 1px 0px ${color}40`,
      }}
    />
  );
});
