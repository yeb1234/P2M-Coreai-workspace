import { useEffect, useRef } from 'react';
import { usePomodoroStore, useNotificationStore, useScheduleStore } from '../stores';
import { type PomodoroSession } from '../types';
import { playBreakSound, playPomodoroCue, playNotificationSound } from '../lib/sounds';
import { toISODateTimeString } from '../lib/date';
import { calculateSchedulePomodoroRounds } from '../lib/pomodoroPlanning';

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
    let prevSessionsCompleted = 0;

    const unsub = usePomodoroStore.subscribe((state) => {
      const { phase, status, sessionsCompleted } = state.timer;

      // Skip the initial fire
      if (prevPhase === null) {
        prevPhase = phase;
        prevStatus = status;
        prevSessionsCompleted = sessionsCompleted;
        return;
      }

      const phaseChanged = phase !== prevPhase;
      const stoppedRunning = prevStatus === 'running' && status !== 'running';
      const sessionCompleted = sessionsCompleted > prevSessionsCompleted;

      if (phaseChanged || stoppedRunning) {
        if (phaseChanged && prevPhase === 'work') {
          if (sessionCompleted) {
            playBreakSound();
            const completedSessions = state.timer.sessionsCompleted;
            const longBreakInterval = state.config.longBreakInterval;
            useNotificationStore.getState().addNotification({
              type: 'pomodoro',
              title: '专注完成!',
              message: `已完成 ${completedSessions} 个番茄钟${completedSessions % longBreakInterval === 0 ? '，该长休息了' : ''}`,
            });
          } else {
            useNotificationStore.getState().addNotification({
              type: 'pomodoro',
              title: '已跳过',
              message: '当前专注阶段已跳过，不计入完成番茄',
            });
          }
        } else if (phaseChanged && phase === 'work') {
          playPomodoroCue('start');
        } else if (stoppedRunning) {
          playPomodoroCue('complete');
        }
      }

      prevPhase = phase;
      prevStatus = status;
      prevSessionsCompleted = sessionsCompleted;
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
      setTimeout(async () => {
        const scheduleStore = useScheduleStore.getState();

        for (const session of pending) {
          const linkedTodo = session.todoId ? scheduleStore.items[session.todoId] : null;
          if (linkedTodo && !linkedTodo.deletedAt) {
            // 番茄结束时的计数与专注时长已经由 pomodoroStore 写回待办，这里只补
            // “是否达成计划番茄数”的状态，避免同一轮完成被重复累加。
            const pomodoroConfig = usePomodoroStore.getState().config;
            const plannedPomodoros = calculateSchedulePomodoroRounds(linkedTodo, pomodoroConfig);
            const reachedTarget =
              plannedPomodoros > 0 && linkedTodo.pomodoroCount >= plannedPomodoros;
            if (reachedTarget && linkedTodo.status !== 'completed') {
              scheduleStore.updateItem(linkedTodo.id, { status: 'completed' });
            }
          }

          try {
            // 专注记录必须和日历页读同一张 schedule_items，否则日历上看不到
            // 番茄产生的专注事件；legacy calendar_events 不再写入。
            const start = new Date(session.startTime);
            const end = session.endTime ? new Date(session.endTime) : null;
            const dueAt = end && end.getTime() > start.getTime()
              ? session.endTime!
              : toISODateTimeString(
                  new Date(start.getTime() + Math.max(1, session.actualDuration) * 60_000),
                );
            const eventId = await scheduleStore.addEvent({
              title: `专注 ${Math.max(1, session.actualDuration)}分钟`,
              description: session.todoId ? '番茄钟专注记录' : '',
              startAt: session.startTime,
              dueAt,
              priority: linkedTodo?.priority || 'green',
            });
            usePomodoroStore.getState().updateSession(session.id, { calendarEventId: eventId });
          } catch {
            // 保存专注记录失败时不阻塞 pomodoro 状态更新
          }
        }
      }, 0);
    });

    return () => {
      unsubSessions();
    };
  }, [enabled]);
};
