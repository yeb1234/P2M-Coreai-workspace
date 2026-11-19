/**
 * 转写任务轮询节奏。
 *
 * 转写是长任务，页面不需要按秒级刷新；尤其是转写页会同时渲染任务列表，
 * 高频 + 大列表会把浏览器主线程和后端 DB 连接一起拖慢。这里统一成：
 * - 有任务在跑：前台 10 秒，后台 30 秒；
 * - 队列空闲：前台 60 秒，后台 120 秒；
 * - DB/RQ 对账单独限到 60 秒一次，不必每轮都扫 running 任务。
 */
export const ACTIVE_JOB_POLL_MS = 10_000;
export const HIDDEN_ACTIVE_JOB_POLL_MS = 30_000;
export const IDLE_JOB_POLL_MS = 60_000;
export const HIDDEN_IDLE_JOB_POLL_MS = 120_000;
export const JOB_RECONCILE_INTERVAL_MS = 60_000;

export function getJobPollDelay(
  hasActiveJobs: boolean,
  visibility: DocumentVisibilityState = 'visible',
): number {
  const hidden = visibility !== 'visible';
  if (hasActiveJobs) {
    return hidden ? HIDDEN_ACTIVE_JOB_POLL_MS : ACTIVE_JOB_POLL_MS;
  }
  return hidden ? HIDDEN_IDLE_JOB_POLL_MS : IDLE_JOB_POLL_MS;
}

export function shouldReconcileJobs(
  lastReconcileAt: number,
  now = Date.now(),
  intervalMs = JOB_RECONCILE_INTERVAL_MS,
): boolean {
  return now - lastReconcileAt >= intervalMs;
}
