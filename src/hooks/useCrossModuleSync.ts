import { useEffect, useRef } from 'react';
import { useTodoStore, useCalendarStore, usePomodoroStore, useNotificationStore } from '../stores';
import { PRIORITY_COLORS, type Todo, type PomodoroSession } from '../types';
import { playBreakSound, playPomodoroCue } from '../lib/sounds';
import { toLocalDateString } from '../lib/date';

export const useCrossModuleSync = () => {
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

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
    // Subscribe to todo changes
    const unsubTodos = useTodoStore.subscribe((state) => {
      const todos = state.todos;
      const calendarStore = useCalendarStore.getState();

      Object.values(todos).forEach((todo: Todo) => {
        if (todo.dueDate) {
          const existingEvents = calendarStore.getEventsByTodoId(todo.id);
          if (existingEvents.length === 0) {
            calendarStore.addEvent({
              title: todo.title,
              date: todo.dueDate,
              type: 'todo',
              color: PRIORITY_COLORS[todo.priority],
              todoId: todo.id,
              pomodoroSessionId: null,
            });
          }
        }
      });
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
      unsubSessions();
    };
  }, []);
};
