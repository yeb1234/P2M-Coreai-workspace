import { ListTodo } from 'lucide-react';
import type { Plugin } from '../types/plugin';
import { TodoPage } from '../components/todo';
import { TodoSummary } from '../components/dashboard/summaries/TodoSummary';

export const todoPlugin: Plugin = {
  metadata: {
    id: 'todo',
    name: '待办事项',
    icon: <ListTodo size={20} />,
    description: '管理您的待办事项',
    defaultPosition: 0,
    color: 'text-[#c87d2f]',
    defaultSize: 'small',
    summaryComponent: TodoSummary,
  },
  panel: {
    component: TodoPage,
  },
};
