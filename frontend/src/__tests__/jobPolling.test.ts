import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_POLL_MS,
  HIDDEN_ACTIVE_JOB_POLL_MS,
  HIDDEN_IDLE_JOB_POLL_MS,
  IDLE_JOB_POLL_MS,
  JOB_RECONCILE_INTERVAL_MS,
  getJobPollDelay,
  shouldReconcileJobs,
} from '../lib/jobPolling';

describe('job polling cadence', () => {
  it('polls active jobs faster than an idle queue', () => {
    expect(getJobPollDelay(true, 'visible')).toBe(ACTIVE_JOB_POLL_MS);
    expect(getJobPollDelay(false, 'visible')).toBe(IDLE_JOB_POLL_MS);
  });

  it('backs off when the page is hidden', () => {
    expect(getJobPollDelay(true, 'hidden')).toBe(HIDDEN_ACTIVE_JOB_POLL_MS);
    expect(getJobPollDelay(false, 'hidden')).toBe(HIDDEN_IDLE_JOB_POLL_MS);
  });

  it('reconciles DB/RQ at most once per interval', () => {
    const last = 1_000;
    expect(shouldReconcileJobs(last, last + JOB_RECONCILE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldReconcileJobs(last, last + JOB_RECONCILE_INTERVAL_MS)).toBe(true);
  });
});
