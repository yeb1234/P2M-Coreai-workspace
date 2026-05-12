import { getUserData, hasAuthToken, setUserData } from './authApi';
import type { ID, PomodoroConfig, PomodoroSession, PomodoroTimerState } from '../types';

export const POMODORO_REMOTE_RUNTIME_KEY = 'p2m-pomodoro-runtime-v2';
export const POMODORO_REMOTE_CONFIG_KEY = 'p2m-pomodoro-config-v2';
export const POMODORO_REMOTE_HISTORY_KEY = 'p2m-pomodoro-history-v2';
export const POMODORO_LEGACY_REMOTE_RUNTIME_KEY = 'p2m-pomodoro-runtime';

export interface PomodoroRemoteRuntimeSnapshot {
  kind: 'pomodoro-runtime-v2';
  timer: PomodoroTimerState;
  activeSession: PomodoroSession | null;
  lastTickTimestamp: number | null;
  action: string;
  deviceId: string;
  updatedAt: string;
}

export interface PomodoroRemoteConfigSnapshot {
  kind: 'pomodoro-config-v2';
  config: PomodoroConfig;
  deviceId: string;
  updatedAt: string;
}

export interface PomodoroRemoteHistorySnapshot {
  kind: 'pomodoro-history-v2';
  sessions: Record<ID, PomodoroSession>;
  deviceId: string;
  updatedAt: string;
}

export interface PomodoroRemoteState {
  runtime: PomodoroRemoteRuntimeSnapshot | null;
  config: PomodoroRemoteConfigSnapshot | null;
  history: PomodoroRemoteHistorySnapshot | null;
}

const DEVICE_ID_KEY = 'p2m-device-id';

function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'server';
  const saved = localStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

function timestamp(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function completedSessionsOnly(sessions: Record<ID, PomodoroSession>): Record<ID, PomodoroSession> {
  return Object.fromEntries(
    Object.entries(sessions).filter(([, session]) => session.completed && Boolean(session.endTime)),
  );
}

function isRuntimeSnapshot(value: unknown): value is PomodoroRemoteRuntimeSnapshot {
  const snapshot = value as PomodoroRemoteRuntimeSnapshot;
  return snapshot?.kind === 'pomodoro-runtime-v2' && Boolean(snapshot.timer) && typeof snapshot.updatedAt === 'string';
}

function isConfigSnapshot(value: unknown): value is PomodoroRemoteConfigSnapshot {
  const snapshot = value as PomodoroRemoteConfigSnapshot;
  return snapshot?.kind === 'pomodoro-config-v2' && Boolean(snapshot.config) && typeof snapshot.updatedAt === 'string';
}

function isHistorySnapshot(value: unknown): value is PomodoroRemoteHistorySnapshot {
  const snapshot = value as PomodoroRemoteHistorySnapshot;
  return snapshot?.kind === 'pomodoro-history-v2' && Boolean(snapshot.sessions) && typeof snapshot.updatedAt === 'string';
}

async function loadJson<T>(key: string, guard: (value: unknown) => value is T): Promise<T | null> {
  if (!hasAuthToken()) return null;
  try {
    const raw = await getUserData(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveJson(key: string, value: unknown): Promise<void> {
  if (!hasAuthToken()) return;
  try {
    await setUserData(key, JSON.stringify(value));
  } catch {
    // Local timer state remains authoritative when the backend is unavailable.
  }
}

export function buildPomodoroRemoteRuntimeSnapshot(
  timer: PomodoroTimerState,
  sessions: Record<ID, PomodoroSession>,
  lastTickTimestamp: number | null,
  action: string,
  updatedAt = nowIso(),
): PomodoroRemoteRuntimeSnapshot {
  const activeSession = timer.currentSessionId ? sessions[timer.currentSessionId] : null;
  return {
    kind: 'pomodoro-runtime-v2',
    timer,
    activeSession: activeSession && !activeSession.completed ? activeSession : null,
    lastTickTimestamp,
    action,
    deviceId: getDeviceId(),
    updatedAt,
  };
}

export function buildPomodoroRemoteConfigSnapshot(
  config: PomodoroConfig,
  updatedAt = nowIso(),
): PomodoroRemoteConfigSnapshot {
  return {
    kind: 'pomodoro-config-v2',
    config,
    deviceId: getDeviceId(),
    updatedAt,
  };
}

export function buildPomodoroRemoteHistorySnapshot(
  sessions: Record<ID, PomodoroSession>,
  updatedAt = nowIso(),
): PomodoroRemoteHistorySnapshot {
  return {
    kind: 'pomodoro-history-v2',
    sessions: completedSessionsOnly(sessions),
    deviceId: getDeviceId(),
    updatedAt,
  };
}

export async function savePomodoroRemoteRuntime(snapshot: PomodoroRemoteRuntimeSnapshot): Promise<void> {
  await saveJson(POMODORO_REMOTE_RUNTIME_KEY, snapshot);
}

export async function savePomodoroRemoteConfig(snapshot: PomodoroRemoteConfigSnapshot): Promise<void> {
  await saveJson(POMODORO_REMOTE_CONFIG_KEY, snapshot);
}

export async function savePomodoroRemoteHistory(snapshot: PomodoroRemoteHistorySnapshot): Promise<void> {
  await saveJson(POMODORO_REMOTE_HISTORY_KEY, snapshot);
}

export async function loadPomodoroRemoteRuntime(): Promise<PomodoroRemoteRuntimeSnapshot | null> {
  return loadJson(POMODORO_REMOTE_RUNTIME_KEY, isRuntimeSnapshot);
}

export async function loadPomodoroRemoteConfig(): Promise<PomodoroRemoteConfigSnapshot | null> {
  return loadJson(POMODORO_REMOTE_CONFIG_KEY, isConfigSnapshot);
}

export async function loadPomodoroRemoteHistory(): Promise<PomodoroRemoteHistorySnapshot | null> {
  return loadJson(POMODORO_REMOTE_HISTORY_KEY, isHistorySnapshot);
}

export async function loadPomodoroRemoteState(): Promise<PomodoroRemoteState> {
  const [runtime, config, history] = await Promise.all([
    loadPomodoroRemoteRuntime(),
    loadPomodoroRemoteConfig(),
    loadPomodoroRemoteHistory(),
  ]);
  return { runtime, config, history };
}

export function isRemotePomodoroRuntimeNewer(
  remote: PomodoroRemoteRuntimeSnapshot,
  localUpdatedAt: string | number | null,
): boolean {
  const remoteUpdatedAt = timestamp(remote.updatedAt);
  if (!remoteUpdatedAt) return false;
  return remoteUpdatedAt > timestamp(localUpdatedAt);
}

export function isRemotePomodoroConfigNewer(
  remote: PomodoroRemoteConfigSnapshot,
  localUpdatedAt: string | number | null,
): boolean {
  return isRemotePomodoroSnapshotNewer(remote.updatedAt, localUpdatedAt);
}

export function isRemotePomodoroSnapshotNewer(
  remoteUpdatedAtValue: string,
  localUpdatedAt: string | number | null,
): boolean {
  const remoteUpdatedAt = timestamp(remoteUpdatedAtValue);
  if (!remoteUpdatedAt) return false;
  return remoteUpdatedAt > timestamp(localUpdatedAt);
}

export function mergePomodoroSessionHistories(
  localSessions: Record<ID, PomodoroSession>,
  remoteSessions: Record<ID, PomodoroSession>,
): Record<ID, PomodoroSession> {
  const merged: Record<ID, PomodoroSession> = { ...localSessions };

  Object.entries(completedSessionsOnly(remoteSessions)).forEach(([id, remoteSession]) => {
    const localSession = merged[id];
    merged[id] = {
      ...localSession,
      ...remoteSession,
      calendarEventId: remoteSession.calendarEventId || localSession?.calendarEventId || null,
    };
  });

  return merged;
}
