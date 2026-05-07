import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Plus, ListTodo, CheckSquare, Trash2, RotateCcw, RotateCw, Undo2, X } from 'lucide-react';
import { useTodoStore } from '../../stores';
import { TodoItem } from './TodoItem';
import { TodoForm } from './TodoForm';
import { TodoFilters } from './TodoFilters';
import { Modal, EmptyState, PageTitle, ConfirmDialog } from '../shared';
import type { Todo, TodoPriority } from '../../types';
import { PRIORITY_COLORS } from '../../types';

const PRIORITY_SHORTCUTS: Record<string, TodoPriority> = {
  '/g': 'green',
  '/p': 'high',
  '/y': 'medium',
  '/b': 'low',
};

const InlineAddInput: React.FC = () => {
  const addTodo = useTodoStore((s) => s.addTodo);
  const [active, setActive] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSubmit = useCallback(() => {
    let title = value.trim();
    let priority: TodoPriority = 'green';
    for (const [shortcut, p] of Object.entries(PRIORITY_SHORTCUTS)) {
      if (title.endsWith(shortcut)) {
        title = title.slice(0, -shortcut.length).trim();
        priority = p;
        break;
      }
    }
    if (title) {
      addTodo({ title, description: '', priority, dueDate: null });
    }
    setValue('');
    setActive(false);
  }, [value, addTodo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setValue('');
      setActive(false);
    }
  }, [handleSubmit]);

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="w-full flex items-center gap-3 px-3 py-3 text-sm text-[#b8b4ac] hover:text-[#c87d2f] hover:bg-[#fef7ed] rounded-lg transition-all group"
      >
        <div className="w-4 flex-shrink-0" />
        <div className="w-5 h-5 border-2 border-dashed border-[#d1cdc6] rounded-full flex items-center justify-center group-hover:border-[#c87d2f] transition-colors flex-shrink-0">
          <Plus size={12} />
        </div>
        <span className="flex-1 text-left">新提醒事项</span>
        <div className="w-[76px] flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-lg border border-[#c87d2f] bg-[#faf9f7] shadow-sm">
      <div className="w-4 flex-shrink-0" />
      <div className="w-5 h-5 border-2 border-[#c87d2f] rounded-full flex items-center justify-center flex-shrink-0">
        <div className="w-2 h-2 bg-[#c87d2f] rounded-full" />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        className="flex-1 text-sm text-[#1a1a1a] bg-transparent outline-none placeholder:text-[#d1cdc6]"
        placeholder="输入待办...（/g绿色 /p粉色）"
      />
      <div className="w-[76px] flex-shrink-0" />
    </div>
  );
};

export const TodoList: React.FC = () => {
  // Subscribe to raw data so component re-renders on changes
  const todos = useTodoStore((s) => s.todos);
  const todoOrder = useTodoStore((s) => s.todoOrder);
  const filter = useTodoStore((s) => s.filter);
  const trash = useTodoStore((s) => s.trash);
  const getFilteredTodos = useTodoStore((s) => s.getFilteredTodos);
  const getTrashedTodos = useTodoStore((s) => s.getTrashedTodos);
  const reorderTodos = useTodoStore((s) => s.reorderTodos);
  const clearAllTodos = useTodoStore((s) => s.clearAllTodos);
  const restoreTodo = useTodoStore((s) => s.restoreTodo);
  const permanentDeleteTodo = useTodoStore((s) => s.permanentDeleteTodo);
  const clearTrash = useTodoStore((s) => s.clearTrash);
  const undo = useTodoStore((s) => s.undo);
  const redo = useTodoStore((s) => s.redo);
  const pendingTodoDate = useTodoStore((s) => s.pendingTodoDate);
  const setPendingTodoDate = useTodoStore((s) => s.setPendingTodoDate);
  const pendingTodoPriority = useTodoStore((s) => s.pendingTodoPriority);
  const setPendingTodoPriority = useTodoStore((s) => s.setPendingTodoPriority);

  const [showForm, setShowForm] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const trashRef = useRef<HTMLDivElement>(null);

  // Call getters now that we subscribe to the underlying data
  const filteredTodos = getFilteredTodos();
  const trashedTodos = getTrashedTodos();

  const activeTodos = useMemo(() => filteredTodos.filter((t) => t.status !== 'completed'), [filteredTodos]);
  const completedTodos = useMemo(() => filteredTodos.filter((t) => t.status === 'completed'), [filteredTodos]);

  useEffect(() => {
    if (pendingTodoDate) {
      setShowForm(true);
    }
  }, [pendingTodoDate]);

  useEffect(() => {
    if (showTrash && trashRef.current) {
      trashRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showTrash]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleEdit = useCallback((todo: Todo) => {
    setEditingTodo(todo);
    setShowForm(true);
  }, []);

  const handleCloseForm = useCallback(() => {
    setShowForm(false);
    setEditingTodo(null);
    setPendingTodoDate(null);
    setPendingTodoPriority(null);
  }, [setPendingTodoDate, setPendingTodoPriority]);

  const handleDrop = useCallback((id: string) => {
    if (dragId && dragId !== id) {
      reorderTodos(dragId, id);
    }
    setDragId(null);
    setOverId(null);
  }, [dragId, reorderTodos]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle
        title="待办事项"
        subtitle="拖动左侧手柄调整顺序"
        icon={<CheckSquare size={22} />}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              className="p-2 text-[#9ca3af] hover:text-[#c87d2f] hover:bg-[#fef7ed] rounded-lg transition-colors"
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={redo}
              className="p-2 text-[#9ca3af] hover:text-[#c87d2f] hover:bg-[#fef7ed] rounded-lg transition-colors"
              title="重做 (Ctrl+Y)"
            >
              <RotateCw size={16} />
            </button>
            <button
              onClick={() => setShowTrash(!showTrash)}
              className={`p-2 rounded-lg transition-colors relative ${
                showTrash ? 'text-[#dc3545] bg-[#fef2f2]' : 'text-[#9ca3af] hover:text-[#dc3545] hover:bg-[#fef2f2]'
              }`}
              title="垃圾箱"
            >
              <Trash2 size={16} />
              {trashedTodos.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#dc3545] text-white text-[9px] rounded-full flex items-center justify-center">
                  {trashedTodos.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d20] transition-colors"
            >
              <Plus size={16} />
              新建
            </button>
          </div>
        }
      />

      <TodoFilters />

      {showTrash && (
        <div ref={trashRef} className="border border-[#e5e2dd] rounded-lg bg-[#f8f6f2] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#e5e2dd]">
            <div className="flex items-center gap-2">
              <Trash2 size={14} className="text-[#dc3545]" />
              <span className="text-sm font-medium text-[#1a1a1a]">垃圾箱</span>
              <span className="text-xs text-[#9ca3af]">({trashedTodos.length})</span>
            </div>
            <div className="flex items-center gap-1">
              {trashedTodos.length > 0 && (
                <button
                  onClick={clearTrash}
                  className="text-xs text-[#9ca3af] hover:text-[#dc3545] transition-colors px-2 py-1"
                >
                  清空垃圾箱
                </button>
              )}
              <button
                onClick={() => setShowTrash(false)}
                className="p-1 text-[#9ca3af] hover:text-[#1a1a1a] transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {trashedTodos.length === 0 ? (
            <div className="text-center py-6 text-[#9ca3af] text-sm">垃圾箱为空</div>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y divide-[#e5e2dd]">
              {trashedTodos.map(({ todo, deletedAt }) => (
                <div key={todo.id} className="flex items-center gap-3 px-3 py-2 hover:bg-[#fef7ed] transition-colors">
                  <div
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: PRIORITY_COLORS[todo.priority] }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-[#1a1a1a] truncate block">{todo.title}</span>
                    <span className="text-[10px] text-[#b8b4ac]">删除于 {new Date(deletedAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <button
                    onClick={() => restoreTodo(todo.id)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-[#c87d2f] hover:bg-[#fef7ed] rounded transition-colors"
                  >
                    <RotateCcw size={12} />
                    恢复
                  </button>
                  <button
                    onClick={() => permanentDeleteTodo(todo.id)}
                    className="p-1 text-[#9ca3af] hover:text-[#dc3545] transition-colors"
                    title="永久删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {filteredTodos.length === 0 ? (
        <EmptyState
          icon={<ListTodo size={24} className="text-[#9ca3af]" />}
          title="暂无待办事项"
          description="点击下方输入框快速添加待办"
        />
      ) : (
        <>
          <div className="space-y-2">
            {activeTodos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onEdit={handleEdit}
                onDragStart={setDragId}
                onDragOver={setOverId}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragging={dragId === todo.id}
                isDropTarget={overId === todo.id && dragId !== todo.id}
              />
            ))}
          </div>

          <div className="py-2 border-t border-[#e5e2dd]">
            <InlineAddInput />
          </div>

          {completedTodos.length > 0 && (
            <div className="space-y-2">
              {completedTodos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onEdit={handleEdit}
                  onDragStart={setDragId}
                  onDragOver={setOverId}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  isDragging={dragId === todo.id}
                  isDropTarget={overId === todo.id && dragId !== todo.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={showForm}
        onClose={handleCloseForm}
        title={editingTodo ? '编辑待办' : '新建待办'}
      >
        <TodoForm todo={editingTodo} defaultDate={pendingTodoDate} defaultPriority={pendingTodoPriority} onClose={handleCloseForm} />
      </Modal>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={clearAllTodos}
        title="清空待办"
        message={`确定要清空所有 ${filteredTodos.length} 条待办事项吗？此操作不可撤销。`}
        confirmText="清空"
      />
    </div>
  );
};
