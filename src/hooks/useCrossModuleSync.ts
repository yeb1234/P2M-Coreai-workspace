import { useEffect, useRef } from 'react';
import { useTodoStore, useCalendarStore, usePomodoroStore, useNotificationStore } from '../stores';
import { PRIORITY_COLORS, type Todo, type PomodoroSession } from '../types';
import { playBreakSound, playPomodoroCue, playNotificationSound } from '../lib/sounds';
import { toLocalDateString } from '../lib/date';

const TODO_DUE_MARKER = 'todo:due';
const TODO_REMINDER_MARKER = 'todo:reminder';

function splitReminderDateTime(reminderAt: string): { date: string; time: string } {
  const date = new Date(reminderAt);
  return {
    date: toLocalDateString(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

export const useCrossModuleSync = () => {
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const todoReminderRef = useRef<Set<string>>(new Set());

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
    const reminderTimer = setInterval(() => {
      const now = Date.now();
      const notificationStore = useNotificationStore.getState();
      Object.values(useTodoStore.getState().todos).forEach((todo) => {
        if (!todo.reminderAt || todo.status === 'completed') return;
        if (todoReminderRef.current.has(todo.id)) return;
        if (new Date(todo.reminderAt).getTime() > now) return;
        todoReminderRef.current.add(todo.id);
        playNotificationSound();
        notificationStore.addNotification({
          type: 'todo',
          title: '待办提醒',
          message: todo.title,
        });
      });
    }, 15000);
    return () => clearInterval(reminderTimer);
  }, []);

  useEffect(() => {
    // Subscribe to todo changes
    const unsubTodos = useTodoStore.subscribe((state) => {
      const todos = state.todos;
      const calendarStore = useCalendarStore.getState();
      const activeTodoIds = new Set(Object.keys(todos));

      Object.values(todos).forEach((todo: Todo) => {
        const existingEvents = calendarStore.getEventsByTodoId(todo.id);
        const dueEvent = existingEvents.find((event) => event.description === TODO_DUE_MARKER);
        const reminderEvent = existingEvents.find((event) => event.description === TODO_REMINDER_MARKER);

        if (todo.dueDate) {
          const dueData = {
            title: todo.title,
            date: todo.dueDate,
            type: 'todo' as const,
            color: PRIORITY_COLORS[todo.priority],
            todoId: todo.id,
            pomodoroSessionId: null,
            description: TODO_DUE_MARKER,
          };
          if (dueEvent) {
            calendarStore.updateEvent(dueEvent.id, dueData);
          } else {
            calendarStore.addEvent({
              ...dueData,
            });
          }
        } else if (dueEvent) {
          calendarStore.deleteEvent(dueEvent.id);
        }

        if (todo.reminderAt) {
          const { date, time } = splitReminderDateTime(todo.reminderAt);
          const reminderData = {
            title: `提醒：${todo.title}`,
            date,
            startTime: time,
            type: 'reminder' as const,
            color: '#f59e0b',
            todoId: todo.id,
            pomodoroSessionId: null,
            description: TODO_REMINDER_MARKER,
          };
          if (reminderEvent) {
            calendarStore.updateEvent(reminderEvent.id, reminderData);
          } else {
            calendarStore.addEvent({
              ...reminderData,
            });
          }
        } else if (reminderEvent) {
          calendarStore.deleteEvent(reminderEvent.id);
        }
      });

      Object.values(calendarStore.events).forEach((event) => {
        if (!event.todoId || activeTodoIds.has(event.todoId)) return;
        if (event.description !== TODO_DUE_MARKER && event.description !== TODO_REMINDER_MARKER) return;
        calendarStore.deleteEvent(event.id);
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
