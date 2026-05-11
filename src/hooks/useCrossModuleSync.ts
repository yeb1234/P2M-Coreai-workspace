import { useEffect, useRef } from 'react';
import { useTodoStore, useCalendarStore, usePomodoroStore, useNotificationStore } from '../stores';
import { type PomodoroSession } from '../types';
import { playBreakSound, playPomodoroCue, playNotificationSound } from '../lib/sounds';
import { toLocalDateString } from '../lib/date';
import { buildTodoCalendarSyncPlan } from './todoCalendarSyncPlan';

export const useCrossModuleSync = () => {
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const todoReminderRef = useRef<Set<string>>(new Set());
  const todoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todoReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore timer on app load (adjust for elapsed time while page was closed)
  useEffect(() => {
    usePomodoroStore.getState().restoreTimer();
  }, []);

  // Global pomodoro tick - runs on ALL pages
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const { timer, tick } = usePomodoroStore.getState();
      if (timer.status === 'running') {
        tick();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Play notification on phase transitions or timer stop
  useEffect(() => {
    let prevPhase: string | null = null;
    let prevStatus: string | null = null;

    const unsub = usePomodoroStore.subscribe((state) => {
      const { phase, status } = state.timer;

      // Skip the initial fire
      if (prevPhase === null) {
        prevPhase = phase;
        prevStatus = status;
        return;
      }

      const phaseChanged = phase !== prevPhase;
      const stoppedRunning = prevStatus === 'running' && status !== 'running';

      if (phaseChanged || stoppedRunning) {
        if (phaseChanged && prevPhase === 'work') {
          playBreakSound();
          const completedSessions = state.timer.sessionsCompleted;
          const longBreakInterval = state.config.longBreakInterval;
          useNotificationStore.getState().addNotification({
            type: 'pomodoro',
            title: '专注完成!',
            message: `已完成 ${completedSessions} 个番茄钟${completedSessions % longBreakInterval === 0 ? '，该长休息了' : ''}`,
          });
        } else if (phaseChanged && phase === 'work') {
          playPomodoroCue('start');
        } else if (stoppedRunning) {
          playPomodoroCue('complete');
        }
      }

      prevPhase = phase;
      prevStatus = status;
    });
    return unsub;
  }, []);

  useEffect(() => {
    const runReminderCheck = () => {
      const now = Date.now();
      const notificationStore = useNotificationStore.getState();
      let nextReminderAt = Number.POSITIVE_INFINITY;
      Object.values(useTodoStore.getState().todos).forEach((todo) => {
        if (!todo.reminderAt || todo.status === 'completed') return;
        if (todoReminderRef.current.has(todo.id)) return;
        const reminderTime = new Date(todo.reminderAt).getTime();
        if (!Number.isFinite(reminderTime)) return;
        if (reminderTime > now) {
          nextReminderAt = Math.min(nextReminderAt, reminderTime);
          return;
        }
        todoReminderRef.current.add(todo.id);
        playNotificationSound();
        notificationStore.addNotification({
          type: 'todo',
          title: '待办提醒',
          message: todo.title,
        });
      });

      if (todoReminderTimerRef.current) clearTimeout(todoReminderTimerRef.current);
      if (Number.isFinite(nextReminderAt)) {
        const delay = Math.max(1000, Math.min(nextReminderAt - Date.now(), 60_000));
        todoReminderTimerRef.current = setTimeout(runReminderCheck, delay);
      }
    };

    runReminderCheck();
    const unsubTodos = useTodoStore.subscribe(() => {
      if (todoReminderTimerRef.current) clearTimeout(todoReminderTimerRef.current);
      todoReminderTimerRef.current = setTimeout(runReminderCheck, 250);
    });

    return () => {
      unsubTodos();
      if (todoReminderTimerRef.current) clearTimeout(todoReminderTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const syncTodosToCalendar = () => {
      const todos = useTodoStore.getState().todos;
      const calendarStore = useCalendarStore.getState();
      const plan = buildTodoCalendarSyncPlan(todos, calendarStore.events);

      plan.add.forEach((data) => calendarStore.addEvent(data));
      plan.update.forEach(({ id, data }) => calendarStore.updateEvent(id, data));
      plan.delete.forEach((id) => calendarStore.deleteEvent(id));
    };

    syncTodosToCalendar();

    // Subscribe to todo changes
    const unsubTodos = useTodoStore.subscribe(() => {
      if (todoSyncTimerRef.current) clearTimeout(todoSyncTimerRef.current);
      todoSyncTimerRef.current = setTimeout(syncTodosToCalendar, 120);
    });

    // Subscribe to pomodoro session changes - defer mutations to avoid cascading re-renders
    const unsubSessions = usePomodoroStore.subscribe((state) => {
      const sessions = state.sessions;
      if (!sessions) return;

      const pending = Object.values(sessions as Record<string, PomodoroSession>).filter(
        (s) => s.completed && s.phase === 'work' && s.todoId && !s.calendarEventId
      );

      if (pending.length === 0) return;

      // Defer to avoid mutating stores inside a subscription callback
      setTimeout(() => {
        const todoStore = useTodoStore.getState();
        const calendarStore = useCalendarStore.getState();

        pending.forEach((session) => {
          todoStore.incrementPomodoroCount(session.todoId!, session.actualDuration);

          const eventId = calendarStore.addEvent({
            title: `专注 ${session.actualDuration}分钟`,
            date: toLocalDateString(session.startTime),
            type: 'pomodoro',
            color: '#10b981',
            todoId: session.todoId,
            pomodoroSessionId: session.id,
          });

          usePomodoroStore.getState().updateSession(session.id, { calendarEventId: eventId });
        });
      }, 0);
    });

    return () => {
      unsubTodos();
      if (todoSyncTimerRef.current) clearTimeout(todoSyncTimerRef.current);
      unsubSessions();
    };
  }, []);
};
