// FIX-queue-004 (FE) — the job detail drawer offers Requeue and Edit
// for a completed job; saving the edit calls onUpdate with the parsed
// payload.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JobDetailDrawer } from '@/components/queue/JobDetailDrawer';
import type { QueueJob } from '@/components/queue/JobList';

const JOB: QueueJob = {
  id: 'job_1', queue: 'ingest', name: 'ingest-file', status: 'completed', priority: 'normal',
  payload: { file: 'a.csv' }, attempts: 1, maxAttempts: 3, workerId: 'inline', durationMs: 12,
  createdAt: '2026-11-09T00:00:00.000Z', runAt: '2026-11-09T00:00:00.000Z', error: null,
  result: { ok: true },
} as QueueJob;

afterEach(() => cleanup());

describe('queue job detail edit/requeue', () => {
  it('shows Requeue for a completed job and saves edits via onUpdate', async () => {
    const onRetry = vi.fn();
    const onUpdate = vi.fn();
    render(
      <JobDetailDrawer
        job={JOB}
        history={[]}
        onClose={vi.fn()}
        onProcess={vi.fn()}
        onRetry={onRetry}
        onRemove={vi.fn()}
        onUpdate={onUpdate}
      />,
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Requeue/ })); });
    expect(onRetry).toHaveBeenCalledWith('job_1');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Edit/ })); });
    const payloadBox = screen.getByLabelText('Payload JSON');
    await act(async () => { fireEvent.change(payloadBox, { target: { value: '{"file":"b.csv"}' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [id, fields] = onUpdate.mock.calls[0] as [string, { payload: unknown; name: string }];
    expect(id).toBe('job_1');
    expect(fields.payload).toEqual({ file: 'b.csv' });
    expect(fields.name).toBe('ingest-file');
  });
});
