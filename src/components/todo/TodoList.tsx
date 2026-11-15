import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ListTodo, CheckSquare, Trash2, RotateCcw, RotateCw, Undo2, X, SlidersHorizontal, ChevronRight, ChevronDown } from 'lucide-react';
import { getTrashedScheduleItems, useScheduleStore } from '../../stores/scheduleStore';
import { TodoItem } from './TodoItem';
import { TodoForm } from './TodoForm';
import { TodoFilters } from './TodoFilters';
import { InlineAddInput } from './InlineAddInput';
import { Modal, EmptyState, PageTitle, ConfirmDialog, LoadingAnnounce } from '../shared';
import type { ScheduleItem } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { playInteractionSound } from '../../lib/sounds';
import { datePart, hasScheduleTime } from '../../lib/scheduleTime';
import { usePomodoroStore } from '../../stores';
import { calculateSchedulePomodoroRounds } from '../../lib/pomodoroPlanning';

export const TodoList: React.FC = () => {
  const items = useScheduleStore((s) => s.items);
  const itemOrder = useScheduleStore((s) => s.itemOrder);
  const filter = useScheduleStore((s) => s.filter);
  const reorderItems = useScheduleStore((s) => s.reorderItems);
  const clearAllItems = useScheduleStore((s) => s.clearAllItems);
  const restoreItem = useScheduleStore((s) => s.restoreItem);
  const permanentDeleteItem = useScheduleStore((s) => s.permanentDeleteItem);
  const clearTrash = useScheduleStore((s) => s.clearTrash);
  const undo = useScheduleStore((s) => s.undo);
  const redo = useScheduleStore((s) => s.redo);
  const pendingTodoDate = useScheduleStore((s) => s.pendingTodoDate);
  const setPendingTodoDate = useScheduleStore((s) => s.setPendingTodoDate);
  const pendingTodoPriority = useScheduleStore((s) => s.pendingTodoPriority);
  const setPendingTodoPriority = useScheduleStore((s) => s.setPendingTodoPriority);
  const updateItem = useScheduleStore((s) => s.updateItem);
  const pomodoroConfig = usePomodoroStore((s) => s.config);

  // 加载中要单独处理：原来 loading 期间显示的就是「暂无待办事项」，
  // 用户分不清「还在拉数据」和「真没有」，第一反应是去点刷新。
  const loading = useScheduleStore((s) => s.loading);
  const [showForm, setShowForm] = useState(false);
  const [editingTodo, setEditingTodo] = useState<ScheduleItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [collapsedTrash, setCollapsedTrash] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [collapsedFilters, setCollapsedFilters] = useState(false);
  const trashRef = useRef<HTMLDivElement>(null);

  const todos = useMemo(() => Object.values(items).filter((item) => item.type === 'todo' && !item.deletedAt), [items]);
  const filteredTodos = useMemo(() => {
    const query = filter.searchQuery.trim().toLowerCase();
    const orderIndex = new Map(itemOrder.map((id, index) => [id, index]));
    const priorityOrder: Record<ScheduleItem['priority'], number> = { high: 0, medium: 1, low: 2, green: 3 };

    return todos
      .filter((todo) => {
        if (filter.priority && todo.priority !== filter.priority) return false;
        if (filter.status !== 'all' && todo.status !== filter.status) return false;
        if (!query) return true;
        return todo.title.toLowerCase().includes(query) || todo.description.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (a.status !== 'completed' && b.status === 'completed') return -1;
        const orderDiff = (orderIndex.get(a.id) ?? Number.POSITIVE_INFINITY) - (orderIndex.get(b.id) ?? Number.POSITIVE_INFINITY);
        if (orderDiff !== 0) return orderDiff;
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }, [filter, itemOrder, todos]);

  const trashedTodos = useMemo(() => getTrashedScheduleItems(items).filter(({ item }) => item.type === 'todo'), [items]);
  const activeTodos = useMemo(() => filteredTodos.filter((todo) => todo.status !== 'completed'), [filteredTodos]);
  const completedTodos = useMemo(() => filteredTodos.filter((todo) => todo.status === 'completed'), [filteredTodos]);
  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filter.status && filter.status !== 'all') {
      const labels: Record<string, string> = { pending: '待处理', in_progress: '进行中', completed: '已完成' };
      parts.push(labels[filter.status] || filter.status);
    }
    if (filter.priority) parts.push(PRIORITY_LABELS[filter.priority]);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'z') {
        event.preventDefault();
        undo();
        playInteractionSound('restore');
      } else if (event.ctrlKey && event.key === 'y') {
        event.preventDefault();
        redo();
        playInteractionSound('tap');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleCloseForm = useCallback(() => {
    setShowForm(false);
    setEditingTodo(null);
    setPendingTodoDate(null);
    setPendingTodoPriority(null);
  }, [setPendingTodoDate, setPendingTodoPriority]);

  const handleDrop = useCallback((id: string) => {
    if (dragId && dragId !== id) {
      reorderItems(dragId, id);
      playInteractionSound('tap');
    }
    setDragId(null);
    setOverId(null);
  }, [dragId, reorderItems]);

  const moveCompletedToTrash = useCallback(() => {
    completedTodos.forEach((todo) => updateItem(todo.id, { deletedAt: new Date().toISOString() }));
    if (completedTodos.length > 0) {
      playInteractionSound('delete');
      setShowTrash(true);
      setCollapsedTrash(false);
    }
  }, [completedTodos, updateItem]);

  return (
    <div className="space-y-4">
      <div className="md:hidden mb-1 pb-1 border-b border-[var(--border-light)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckSquare size={16} className="text-[var(--accent)]" />
            <h2 className="text-sm font-bold text-[var(--text-primary)]">待办</h2>
            <span className="text-xs text-[var(--text-muted)]">({activeTodos.length + completedTodos.length})</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setShowToolbar(!showToolbar)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${showToolbar ? 'text-[var(--accent)] bg-[var(--bg-accent)]' : 'text-[var(--text-muted)]'}`} title="筛选">
              <SlidersHorizontal size={13} />
              <span>{activeFilterSummary}</span>
            </button>
            <button onClick={() => setShowTrash(!showTrash)} className={`p-1.5 rounded-lg relative ${showTrash ? 'text-[var(--danger)] bg-[var(--danger-bg)]' : 'text-[var(--text-muted)]'}`} title="垃圾箱">
              <Trash2 size={14} />
              {trashedTodos.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--danger)] text-white text-xs rounded-full flex items-center justify-center">{trashedTodos.length}</span>}
            </button>
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <PageTitle
          title="待办事项"
          subtitle="开始时间和截止时间按分钟保存"
          icon={<CheckSquare size={22} />}
          action={
            <div className="flex items-center gap-2">
              <button onClick={() => setShowToolbar(!showToolbar)} className={`p-2 rounded-lg transition-colors ${showToolbar ? 'text-[var(--accent)] bg-[var(--bg-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-accent)]'}`} title="筛选/统计">
                <SlidersHorizontal size={16} />
              </button>
              <button onClick={() => { undo(); playInteractionSound('restore'); }} className="p-2 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-accent)] rounded-lg transition-colors" title="撤销 (Ctrl+Z)">
                <Undo2 size={16} />
              </button>
              <button onClick={() => { redo(); playInteractionSound('tap'); }} className="p-2 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-accent)] rounded-lg transition-colors" title="重做 (Ctrl+Y)">
                <RotateCw size={16} />
              </button>
              <button onClick={() => setShowTrash(!showTrash)} className={`p-2 rounded-lg transition-colors relative ${showTrash ? 'text-[var(--danger)] bg-[var(--danger-bg)]' : 'text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)]'}`} title="垃圾箱">
                <Trash2 size={16} />
                {trashedTodos.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--danger)] text-white text-xs rounded-full flex items-center justify-center">{trashedTodos.length}</span>}
              </button>
              <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] transition-colors">
                <Plus size={16} />
                新建
              </button>
            </div>
          }
        />
      </div>

      {showToolbar && (
        <TodoFilters collapsed={collapsedFilters} onToggle={() => setCollapsedFilters(!collapsedFilters)}>
          {(() => {
            const today = new Date().toISOString().slice(0, 10);
            const todayTodos = todos.filter((todo) => hasScheduleTime(todo) && datePart(todo.dueAt) === today && calculateSchedulePomodoroRounds(todo, pomodoroConfig) > 0);
            if (todayTodos.length === 0) return null;
            const totalRounds = todayTodos.reduce((sum, todo) => sum + calculateSchedulePomodoroRounds(todo, pomodoroConfig), 0);
            const completedRounds = todayTodos.reduce((sum, todo) => sum + Math.min(todo.pomodoroCount, calculateSchedulePomodoroRounds(todo, pomodoroConfig)), 0);
            return (
              <div className="flex items-center gap-3 px-3 py-2 bg-[var(--bg-accent)] border border-[var(--border-light)] rounded-lg text-xs mt-1">
                <span className="text-[var(--accent)] font-medium">今日待办番茄</span>
                <span className="text-[var(--text-primary)] font-bold">{completedRounds}/{totalRounds}</span>
                <div className="flex-1 h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${Math.min(100, (completedRounds / totalRounds) * 100)}%` }} />
                </div>
              </div>
            );
          })()}
        </TodoFilters>
      )}

      {showTrash && (
        <div ref={trashRef} className="border border-[var(--border-light)] rounded-lg bg-[#f8f6f2] overflow-hidden">
          <button
            type="button"
            onClick={() => setCollapsedTrash(!collapsedTrash)}
            aria-expanded={!collapsedTrash}
            className="flex w-full items-center justify-between border-b border-[var(--border-light)] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              {collapsedTrash ? <ChevronRight size={14} aria-hidden="true" className="text-[var(--danger)]" /> : <ChevronDown size={14} aria-hidden="true" className="text-[var(--danger)]" />}
              <Trash2 size={14} className="text-[var(--danger)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">垃圾箱</span>
              <span className="text-xs text-[var(--text-muted)]">({trashedTodos.length})</span>
            </div>
            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              {trashedTodos.length > 0 && !collapsedTrash && (
                <button onClick={() => { clearTrash(); playInteractionSound('delete'); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors px-2 py-1">
                  清空垃圾箱
                </button>
              )}
              <button onClick={() => setShowTrash(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X size={14} />
              </button>
            </div>
          </button>
          {!collapsedTrash && (
            trashedTodos.length === 0 ? (
              <div className="text-center py-6 text-[var(--text-muted)] text-sm">垃圾箱为空</div>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border-light)]">
                {trashedTodos.map(({ item, deletedAt }) => (
                  <div key={item.id} className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-accent)] transition-colors">
                    <div className="w-3 h-3 rounded-lg flex-shrink-0" style={{ backgroundColor: PRIORITY_COLORS[item.priority] }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-[var(--text-primary)] truncate block">{item.title}</span>
                      <span className="text-xs text-[var(--text-muted)]">删除于 {new Date(deletedAt).toLocaleString('zh-CN')}</span>
                    </div>
                    <button onClick={() => { restoreItem(item.id); playInteractionSound('restore'); }} className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-accent)] rounded transition-colors">
                      <RotateCcw size={12} />
                      恢复
                    </button>
                    <button onClick={() => { permanentDeleteItem(item.id); playInteractionSound('delete'); }} className="p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors" title="永久删除">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          <LoadingAnnounce />
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] p-3">
              <div className="mb-2 h-3.5 w-2/5 animate-pulse rounded bg-[var(--bg-elevated)]" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-[var(--bg-elevated)]" />
            </div>
          ))}
        </div>
      ) : filteredTodos.length === 0 ? (
        <>
          <EmptyState icon={<ListTodo size={24} className="text-[var(--text-muted)]" />} title="暂无待办事项" description="在下面输入，回车即可添加" />
          {/* 空状态下也要有输入框。原来这里只有提示没有入口，
              文案写着「点击下方输入框」但那个框在 else 分支里，自相矛盾。 */}
          <div className="mt-3 rounded-xl border border-[var(--border-light)] bg-white py-2">
            <InlineAddInput />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            {activeTodos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onEdit={(item) => { setEditingTodo(item); setShowForm(true); }}
                onDragStart={setDragId}
                onDragOver={(id) => setOverId(id)}
                onDrop={handleDrop}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                isDragging={dragId === todo.id}
                isDropTarget={overId === todo.id && dragId !== todo.id}
              />
            ))}
          </div>

          <div className="py-2 border-t border-[var(--border-light)]">
            <InlineAddInput />
          </div>

          {completedTodos.length > 0 && (
            <div className="space-y-2">
              {completedTodos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onEdit={(item) => { setEditingTodo(item); setShowForm(true); }}
                  onDragStart={setDragId}
                  onDragOver={(id) => setOverId(id)}
                  onDrop={handleDrop}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  isDragging={dragId === todo.id}
                  isDropTarget={overId === todo.id && dragId !== todo.id}
                />
              ))}
              <div className="flex justify-end">
                <button onClick={moveCompletedToTrash} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--danger)] border border-[#fecaca] rounded-lg hover:bg-[var(--danger-bg)] transition-colors" title="把当前列表里已完成的待办移动到垃圾箱，可恢复">
                  <Trash2 size={13} />
                  进垃圾箱（{completedTodos.length}）
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal isOpen={showForm} onClose={handleCloseForm} title={editingTodo ? '编辑待办' : '新建待办'}>
        <TodoForm todo={editingTodo} defaultDate={pendingTodoDate} defaultPriority={pendingTodoPriority} onClose={handleCloseForm} />
      </Modal>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => { clearAllItems(); playInteractionSound('delete'); }}
        title="清空待办"
        message={`确定要清空所有 ${filteredTodos.length} 条待办事项吗？此操作不可撤销。`}
        confirmText="清空"
      />
    </div>
  );
};
