import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Plus, ListTodo, CheckSquare, Trash2, RotateCcw, RotateCw, Undo2, X, SlidersHorizontal, ChevronRight, ChevronDown } from 'lucide-react';
import { useTodoStore } from '../../stores';
import { TodoItem } from './TodoItem';
import { TodoForm } from './TodoForm';
import { TodoFilters } from './TodoFilters';
import { InlineAddInput } from './InlineAddInput';
import { Modal, EmptyState, PageTitle, ConfirmDialog } from '../shared';
import type { Todo } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';

export const TodoList: React.FC = () => {
  // Subscribe to raw data so component re-renders on changes
  const todos = useTodoStore((s) => s.todos);
  useTodoStore((s) => s.todoOrder);
  useTodoStore((s) => s.filter);
  useTodoStore((s) => s.trash);
  const getFilteredTodos = useTodoStore((s) => s.getFilteredTodos);
  const getTrashedTodos = useTodoStore((s) => s.getTrashedTodos);
  const reorderTodos = useTodoStore((s) => s.reorderTodos);
  const clearAllTodos = useTodoStore((s) => s.clearAllTodos);
  const trashCompletedTodos = useTodoStore((s) => s.trashCompletedTodos);
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
  const [showToolbar, setShowToolbar] = useState(true);
  const [collapsedTrash, setCollapsedTrash] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom'>('bottom');
  const trashRef = useRef<HTMLDivElement>(null);
  const [collapsedFilters, setCollapsedFilters] = useState(false);

  // Call getters now that we subscribe to the underlying data
  const filteredTodos = getFilteredTodos();
  const trashedTodos = getTrashedTodos();

  const activeTodos = useMemo(() => filteredTodos.filter((t) => t.status !== 'completed'), [filteredTodos]);
  const completedTodos = useMemo(() => {
    return filteredTodos
      .filter((t) => t.status === 'completed')
      .sort((a, b) => {
        const aTime = new Date(a.completedAt ?? a.updatedAt ?? a.createdAt).getTime();
        const bTime = new Date(b.completedAt ?? b.updatedAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [filteredTodos]);

  const filter = useTodoStore((s) => s.filter);
  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filter.status && filter.status !== 'all') {
      const labels: Record<string, string> = { pending: '待处理', in_progress: '进行中', completed: '已完成' };
      parts.push(labels[filter.status] || filter.status);
    }
    if (filter.priority) {
      parts.push(PRIORITY_LABELS[filter.priority]);
    }
    return parts.length > 0 ? parts.join('/') : '全部';
  }, [filter]);

  useEffect(() => {
    if (pendingTodoDate) {
      const openForm = setTimeout(() => setShowForm(true), 0);
      return () => clearTimeout(openForm);
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

  const moveCompletedToTrash = useCallback(() => {
    const moved = trashCompletedTodos(completedTodos.map((todo) => todo.id));
    if (moved > 0) {
      setShowTrash(true);
      setCollapsedTrash(false);
    }
  }, [completedTodos, trashCompletedTodos]);

  return (
    <div className="space-y-4">
      {/* Mobile compact header */}
      <div className="md:hidden mb-1 pb-1 border-b border-[#e5e2dd]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckSquare size={16} className="text-[#c87d2f]" />
            <h2 className="text-sm font-bold text-[#1a1a1a]">待办</h2>
            <span className="text-[10px] text-[#9ca3af]">({activeTodos.length + completedTodos.length})</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setShowToolbar(!showToolbar)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${showToolbar ? 'text-[#c87d2f] bg-[#fef7ed]' : 'text-[#9ca3af]'}`} title="筛选">
              <SlidersHorizontal size={13} />
              <span>{activeFilterSummary}</span>
            </button>
            <button onClick={() => setShowTrash(!showTrash)} className={`p-1.5 rounded-lg relative ${showTrash ? 'text-[#dc3545] bg-[#fef2f2]' : 'text-[#9ca3af]'}`} title="垃圾箱">
              <Trash2 size={14} />
              {trashedTodos.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#dc3545] text-white text-[7px] rounded-full flex items-center justify-center">{trashedTodos.length}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Desktop header */}
      <div className="hidden md:block">
        <PageTitle
          title="待办事项"
          subtitle="拖动左侧手柄调整顺序"
          icon={<CheckSquare size={22} />}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowToolbar(!showToolbar)}
                className={`p-2 rounded-lg transition-colors ${showToolbar ? 'text-[#c87d2f] bg-[#fef7ed]' : 'text-[#9ca3af] hover:text-[#c87d2f] hover:bg-[#fef7ed]'}`}
                title="筛选/统计"
              >
                <SlidersHorizontal size={16} />
              </button>
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
      </div>

      {showToolbar && (
        <TodoFilters
          collapsed={collapsedFilters}
          onToggle={() => setCollapsedFilters(!collapsedFilters)}
        >
          {(() => {
            const today = new Date().toISOString().slice(0, 10);
            const allTodos = Object.values(todos);
            const todayTodos = allTodos.filter((t) => t.dueDate === today && t.pomodoroRounds > 0);
            if (todayTodos.length === 0) return null;
            const totalRounds = todayTodos.reduce((s, t) => s + t.pomodoroRounds, 0);
            const completedRounds = todayTodos.reduce((s, t) => s + Math.min(t.pomodoroCount, t.pomodoroRounds), 0);
            return (
              <div className="flex items-center gap-3 px-3 py-2 bg-[#fef7ed] border border-[#e5e2dd] rounded-lg text-xs mt-1">
                <span className="text-[#c87d2f] font-medium">今日待办番茄</span>
                <span className="text-[#1a1a1a] font-bold">{completedRounds}/{totalRounds}</span>
                <div className="flex-1 h-1.5 bg-[#e5e2dd] rounded-full overflow-hidden">
                  <div className="h-full bg-[#c87d2f] rounded-full transition-all" style={{ width: `${Math.min(100, (completedRounds / totalRounds) * 100)}%` }} />
                </div>
              </div>
            );
          })()}
        </TodoFilters>
      )}

      {showTrash && (
        <div ref={trashRef} className="border border-[#e5e2dd] rounded-lg bg-[#f8f6f2] overflow-hidden">
          <button
            onClick={() => setCollapsedTrash(!collapsedTrash)}
            className="w-full flex items-center justify-between px-3 py-2 border-b border-[#e5e2dd]"
          >
            <div className="flex items-center gap-2">
              {collapsedTrash ? <ChevronRight size={14} className="text-[#dc3545]" /> : <ChevronDown size={14} className="text-[#dc3545]" />}
              <Trash2 size={14} className="text-[#dc3545]" />
              <span className="text-sm font-medium text-[#1a1a1a]">垃圾箱</span>
              <span className="text-xs text-[#9ca3af]">({trashedTodos.length})</span>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {trashedTodos.length > 0 && !collapsedTrash && (
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
          </button>
          {!collapsedTrash && (
            trashedTodos.length === 0 ? (
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
            )
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
                onDragOver={(id, pos) => { setOverId(id); setDropPosition(pos); }}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragging={dragId === todo.id}
                isDropTarget={overId === todo.id && dragId !== todo.id}
                dropPosition={overId === todo.id ? dropPosition : 'bottom'}
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
                  onDragOver={(id, pos) => { setOverId(id); setDropPosition(pos); }}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  isDragging={dragId === todo.id}
                  isDropTarget={overId === todo.id && dragId !== todo.id}
                  dropPosition={overId === todo.id ? dropPosition : 'bottom'}
                />
              ))}
              <div className="flex justify-end">
                <button
                  onClick={moveCompletedToTrash}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#dc3545] border border-[#fecaca] rounded-lg hover:bg-[#fef2f2] transition-colors"
                  title="把当前列表里已完成的待办移动到垃圾箱，可恢复"
                >
                  <Trash2 size={13} />
                  进垃圾箱（{completedTodos.length}）
                </button>
              </div>
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
