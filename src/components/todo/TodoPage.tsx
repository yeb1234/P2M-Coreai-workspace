import React from 'react';
import { TodoList } from './TodoList';

export const TodoPage: React.FC = () => {
  return (
    <div className="w-full pt-2">
      <TodoList />
    </div>
  );
};
