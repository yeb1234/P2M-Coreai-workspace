import { ListTodo } from 'lucide-react';
import type { Plugin } from '../types/plugin';
import { TodoSummary } from '../components/dashboard/summaries/TodoSummary';

export const todoPlugin: Plugin = {
  metadata: {
    id: 'todo',
    name: '待办事项',
    icon: <ListTodo size={20} />,
    description: '管理您的待办事项',
    defaultPosition: 0,
    color: 'text-[var(--accent)]',
    defaultSize: 'small',
    summaryComponent: TodoSummary,
  },
};
