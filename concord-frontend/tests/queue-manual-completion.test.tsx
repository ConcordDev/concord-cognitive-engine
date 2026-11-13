// FIX-queue-001 (FE) — a manually-marked completion is labelled as
// manual in the job list and stated in words in the detail drawer, so
// the surfaces agree with the stored result ({ manual: true }): the
// bare 'completed' badge read as if a worker had executed the job.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { JobList, type QueueJob } from '@/components/queue/JobList';
import { JobDetailDrawer } from '@/components/queue/JobDetailDrawer';

const base = {
  queue: 'autocrawl', priority: 'normal', payload: {}, attempts: 1, maxAttempts: 3,
  error: null, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  runAt: '2026-11-09T00:00:00.000Z', startedAt: null, finishedAt: null, workerId: 'inline', durationMs: 4,
} as const;

const MANUAL_JOB: QueueJob = {
  ...base, id: 'job_m', name: 'qa5', status: 'completed',
  result: { ok: true, manual: true, output: 'marked completed manually — no worker executed qa5' },
} as QueueJob;
const WORKER_JOB: QueueJob = {
  ...base, id: 'job_w', name: 'qa7', status: 'completed', result: { ok: true, output: 'done' },
} as QueueJob;

afterEach(() => cleanup());

describe('manual completion labelling', () => {
  it('the list chips a manual completion and leaves an ordinary one bare', () => {
    const { rerender } = render(
      <JobList jobs={[MANUAL_JOB]} onSelect={vi.fn()} onProcess={vi.fn()} onRetry={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText(/manual · no worker ran this/)).toBeTruthy();
    rerender(
      <JobList jobs={[WORKER_JOB]} onSelect={vi.fn()} onProcess={vi.fn()} onRetry={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/manual · no worker ran this/)).toBeNull();
  });

  it('the drawer states the manual mark in words above the raw result', () => {
    render(
      <JobDetailDrawer
        job={MANUAL_JOB} history={[]} onClose={vi.fn()} onProcess={vi.fn()}
        onRetry={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText('marked completed manually — no worker executed qa5')).toBeTruthy();
  });
});
