import { useSyncExternalStore } from 'react';

let now = new Date();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick() {
  now = new Date();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  return now;
}

export function useClockNow() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
