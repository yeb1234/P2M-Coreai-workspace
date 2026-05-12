import { useEffect, useRef } from 'react';
import { useCalendarStore, usePomodoroStore, useNotificationStore, useScheduleStore } from '../stores';
import { PRIORITY_COLORS, type PomodoroSession } from '../types';
import { playBreakSound, playPomodoroCue, playNotificationSound } from '../lib/sounds';
import { toLocalDateString } from '../lib/date';

const TODO_REMINDER_GRACE_MS = 2 * 60 * 1000;

export const useCrossModuleSync = (enabled = true) => {
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>(null);
  const todoReminderRef = useRef<Set<string>>(new Set());
  const todoReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore timer on app load (adjust for elapsed time while page was closed)
  useEffect(() => {
    if (!enabled) return;
    usePomodoroStore.getState().restoreTimer();
    void usePomodoroStore.getState().restoreRemoteState();
  }, [enabled]);

  // Global pomodoro tick - runs on ALL pages
  useEffect(() => {
    if (!enabled) return;
    intervalRef.current = setInterval(() => {
      const { timer, tick } = usePomodoroStore.getState();
      if (timer.status === 'running') {
        tick();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    heartbeatRef.current = setInterval(() => {
      usePomodoroStore.getState().syncRemoteRuntime('heartbeat');
    }, 15_000);

    const flushRuntime = () => {
      usePomodoroStore.getState().syncRemoteRuntime('page-hidden');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushRuntime();
    };

    window.addEventListener('pagehide', flushRuntime);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      window.removeEventListener('pagehide', flushRuntime);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  // Play notification on phase transitions or timer stop
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const runReminderCheck = () => {
      const now = Date.now();
      const notificationStore = useNotificationStore.getState();
      let nextReminderAt = Number.POSITIVE_INFINITY;
      Object.values(useScheduleStore.getState().items).forEach((todo) => {
        if (todo.type !== 'todo') return;
        if (!todo.reminderAt || todo.status === 'completed') return;
        const reminderTime = new Date(todo.reminderAt).getTime();
        if (!Number.isFinite(reminderTime)) return;
        const reminderKey = `todo-reminder:${todo.id}:${todo.reminderAt}`;
        if (todoReminderRef.current.has(reminderKey)) return;
        if (notificationStore.notifications.some((notification) => notification.sourceKey === reminderKey)) {
          todoReminderRef.current.add(reminderKey);
          return;
        }
        if (reminderTime > now) {
          nextReminderAt = Math.min(nextReminderAt, reminderTime);
          return;
        }
        todoReminderRef.current.add(reminderKey);
        if (now - reminderTime > TODO_REMINDER_GRACE_MS) return;

        const added = notificationStore.addNotification({
          type: 'todo',
          title: '待办提醒',
          message: todo.title,
          sourceKey: reminderKey,
        });
        if (added) playNotificationSound();
      });

      if (todoReminderTimerRef.current) clearTimeout(todoReminderTimerRef.current);
      if (Number.isFinite(nextReminderAt)) {
        const delay = Math.max(1000, Math.min(nextReminderAt - Date.now(), 60_000));
        todoReminderTimerRef.current = setTimeout(runReminderCheck, delay);
      }
    };

    runReminderCheck();
    const unsubTodos = useScheduleStore.subscribe(() => {
      if (todoReminderTimerRef.current) clearTimeout(todoReminderTimerRef.current);
      todoReminderTimerRef.current = setTimeout(runReminderCheck, 250);
    });

    return () => {
      unsubTodos();
      if (todoReminderTimerRef.current) clearTimeout(todoReminderTimerRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
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
        const scheduleStore = useScheduleStore.getState();
        const calendarStore = useCalendarStore.getState();

        pending.forEach((session) => {
          const linkedTodo = scheduleStore.items[session.todoId!];
          if (linkedTodo) {
            scheduleStore.updateItem(linkedTodo.id, {
              pomodoroCount: linkedTodo.pomodoroCount + 1,
              totalFocusMinutes: linkedTodo.totalFocusMinutes + session.actualDuration,
              status: 'in_progress',
            });
          }
          const color = linkedTodo ? PRIORITY_COLORS[linkedTodo.priority] : '#10b981';

          const eventId = calendarStore.addEvent({
            title: `专注 ${session.actualDuration}分钟`,
            date: toLocalDateString(session.startTime),
            type: 'pomodoro',
            color,
            todoId: session.todoId,
            pomodoroSessionId: session.id,
          });

          usePomodoroStore.getState().updateSession(session.id, { calendarEventId: eventId });
        });
      }, 0);
    });

    return () => {
      unsubSessions();
    };
  }, [enabled]);
};
