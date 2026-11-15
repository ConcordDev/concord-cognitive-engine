// CB-0438 cluster 4 — deletes that fired instantly now arm the shared
// sticky confirm first (queue-003 · saved-005 · legacy-001 ·
// productivity-009 · retail-008 · self-007 · legal-009 delete leg).
// Each test: the arm click sends NOTHING; Confirm sends the delete
// with the row's own id; the confirm names the record where the
// surface knows it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => <div>chart</div>,
  TreeDiagram: () => <div>tree</div>,
  TimelineView: () => <div>timeline</div>,
}));

import { JobList, type QueueJob } from '@/components/queue/JobList';
import { JobDetailDrawer } from '@/components/queue/JobDetailDrawer';
import { FoldersSidebar } from '@/components/saved/FoldersSidebar';
import { CodebaseScanner } from '@/components/legacy/CodebaseScanner';
import { ProductivityTaskRow } from '@/components/productivity/ProductivityTaskRow';
import { CustomersPanel } from '@/components/retail/CustomersPanel';
import { GoalsPanel } from '@/components/self/GoalsPanel';
import { TimeTracker } from '@/components/legal/TimeTracker';

type Call = { domain?: string; action?: string; input?: Record<string, unknown> };
const norm = (c: unknown[]): Call => {
  const a = c as [unknown, unknown, unknown];
  if (typeof a[0] === 'object' && a[0] !== null) return a[0] as Call;
  return { domain: a[0] as string, action: a[1] as string, input: a[2] as Record<string, unknown> };
};
const calls = () => lensRunMock.mock.calls.map(norm);
const sent = (action: string) => calls().find((c) => c.action === action);

const JOB: QueueJob = {
  id: 'job-1', queue: 'default', name: 'nightly-export', status: 'failed', priority: 'normal',
  payload: {}, attempts: 1, maxAttempts: 3, error: 'boom', result: null,
  createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', runAt: '2026-11-10T00:00:00Z',
  startedAt: null, finishedAt: null, workerId: null, durationMs: null,
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => {
    const { action } = norm(a);
    switch (action) {
      case 'listCodebases':
        return { data: { ok: true, result: { codebases: [{ id: 'cb-1', name: 'qa5', scannedAt: '2026-11-09T00:00:00Z', languages: [], summary: { fileCount: 12, totalLinesOfCode: 3400, productionFiles: 9, avgComplexity: 4.2, testToCodeRatio: 0.3, legacyLanguageFiles: 1, totalTodos: 5, avgCommentRatio: 0.12 } }] } } };
      case 'customers-list':
        return { data: { ok: true, result: { customers: [{ id: 'cu-1', name: 'Ada Lovelace', email: 'ada@example.com', city: 'Poughkeepsie', state: 'NY', totalSpent: 120, orderCount: 2, acceptsMarketing: false }] } } };
      case 'customers-segments':
        return { data: { ok: true, result: { segments: null } } };
      case 'matters-list':
        return { data: { ok: true, result: { matters: [] } } };
      case 'timer-list':
        return { data: { ok: true, result: { timers: [] } } };
      case 'time-entries-list':
        return { data: { ok: true, result: { entries: [{ id: 'te-1', status: 'unbilled', date: '2026-11-10', description: 'Draft motion', matterName: 'Duncan v. City', hours: 1.5, rate: 200, amount: 300 }] } } };
      case 'goals':
        return { data: { ok: true, result: { goals: [{ metric: 'water', label: 'Water', unit: ' glasses', period: 'daily', target: 8, current: 3, percent: 38, met: false }], available: {} } } };
      default:
        return { data: { ok: true, result: {} } };
    }
  });
});
afterEach(() => cleanup());

describe('CB-0438 cluster 4 — sticky delete confirms', () => {
  it('queue-003: JobList remove arms first; confirm removes the job', () => {
    const onRemove = vi.fn();
    render(<JobList jobs={[JOB]} busyId={null} onProcess={vi.fn()} onRetry={vi.fn()} onRemove={onRemove} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove job nightly-export' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm remove job nightly-export' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove job nightly-export' }));
    expect(onRemove).toHaveBeenCalledWith('job-1');
  });

  it('queue-003: JobDetailDrawer remove arms first; confirm removes the job', () => {
    const onRemove = vi.fn();
    render(<JobDetailDrawer job={JOB} history={[]} onClose={vi.fn()} onProcess={vi.fn()} onRetry={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove job nightly-export' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove job nightly-export' }));
    expect(onRemove).toHaveBeenCalledWith('job-1');
  });

  it('saved-005: collection (folder) delete arms first; confirm deletes it', () => {
    const onDelete = vi.fn();
    render(<FoldersSidebar folders={[{ id: 'f-1', name: 'Case law', itemCount: 4 } as never]} unfiledCount={0} totalCount={4} activeFolderId={undefined} onSelect={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete collection Case law' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm delete collection Case law' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete collection Case law' }));
    expect(onDelete).toHaveBeenCalledWith('f-1');
  });

  it('legacy-001: codebase delete arms first; confirm deletes it', async () => {
    render(<CodebaseScanner />);
    const arm = await screen.findByRole('button', { name: 'Delete qa5' });
    fireEvent.click(arm);
    expect(sent('deleteCodebase')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete qa5' }));
    await waitFor(() => expect(sent('deleteCodebase')?.input).toMatchObject({ id: 'cb-1' }));
  });

  it('productivity-009: task delete arms first; confirm deletes the task', async () => {
    render(<ProductivityTaskRow task={{ id: 't-1', content: 'File the motion', priority: 2, dueDate: null, labels: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete task File the motion' }));
    expect(sent('task-delete')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete task' }));
    await waitFor(() => expect(sent('task-delete')?.input).toMatchObject({ id: 't-1' }));
  });

  it('retail-008: customer delete arms first; confirm deletes the customer', async () => {
    render(<CustomersPanel />);
    const arm = await screen.findByRole('button', { name: 'Delete customer Ada Lovelace' });
    fireEvent.click(arm);
    expect(sent('customers-delete')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete customer Ada Lovelace' }));
    await waitFor(() => expect(sent('customers-delete')?.input).toMatchObject({ id: 'cu-1' }));
  });

  it('self-007: goal remove arms first; confirm removes the goal', async () => {
    render(<GoalsPanel />);
    const arm = await screen.findByRole('button', { name: 'Remove Water goal' });
    fireEvent.click(arm);
    expect(sent('removeGoal')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Confirm remove Water goal' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Water goal' }));
    await waitFor(() => expect(sent('removeGoal')?.input).toMatchObject({ metric: 'water' }));
  });

  it('legal-009 (delete leg): time-entry delete arms first; confirm deletes the entry', async () => {
    render(<TimeTracker />);
    const arm = await screen.findByRole('button', { name: 'Delete time entry Draft motion' });
    fireEvent.click(arm);
    expect(sent('time-entries-delete')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete time entry' }));
    await waitFor(() => expect(sent('time-entries-delete')?.input).toMatchObject({ id: 'te-1' }));
  });
});
