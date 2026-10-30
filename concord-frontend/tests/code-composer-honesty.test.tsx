/**
 * S5 (PR #1707): Composer honesty in the panel.
 *
 * F4's worst defect was a "done" button that flipped a RUNNING,
 * zero-change task to COMPLETED. These tests pin the rebuilt panel:
 *  - no "done" affordance exists for a running task;
 *  - "Verify & complete" asks the server, and when the server gate
 *    refuses (nothing changed) the refusal renders and the task
 *    stays RUNNING — the panel never certifies completion itself;
 *  - a completed task shows the server-derived changed files and
 *    hash receipts, not anything the panel made up;
 *  - failed/cancelled are explicit terminal actions.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// The diff review pulls Monaco — not under test here; stub it out.
vi.mock('@/components/code/MultiFileAgentReview', () => ({
  default: () => null,
}));

import { AgentComposerPanel } from '@/components/code/AgentComposerPanel';

type Call = { domain: string; action: string; input: Record<string, unknown> };
const calls = () => lensRunMock.mock.calls.map((c) => c[0] as Call);

const RUNNING = {
  id: 'task1', number: 'T-00001', projectId: 'p1', prompt: 'Add a comment to main.js',
  status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
  plan: [{ action: 'docs', summary: 'Add header comment.' }], filesChanged: [], source: 'deterministic',
};
const COMPLETED = {
  id: 'task2', number: 'T-00002', projectId: 'p1', prompt: 'Fix the bug',
  status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  plan: [], filesChanged: ['src/a.ts'], source: 'deterministic',
  changeReceipts: [{ path: 'src/a.ts', before: null, after: 'abcdef012345' }],
};

beforeEach(() => { lensRunMock.mockReset(); });

describe('AgentComposerPanel (S5)', () => {
  it('offers no way to flip a running task to COMPLETED from the panel', async () => {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'agent-tasks-list') return Promise.resolve({ data: { ok: true, result: { tasks: [RUNNING] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AgentComposerPanel projectId="p1" />);
    await screen.findByText('Add a comment to main.js');
    expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Verify & complete/ })).toBeTruthy();
    expect(screen.getByText(/nothing is applied to your files until you review and accept edits/)).toBeTruthy();
  });

  it('when the server gate refuses completion, the refusal renders and the task stays running', async () => {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'agent-tasks-list') return Promise.resolve({ data: { ok: true, result: { tasks: [RUNNING] } } });
      if (req.action === 'agent-task-finish') {
        return Promise.resolve({ data: { ok: false, error: 'no files changed — a task that changed nothing cannot be marked completed', result: { task: RUNNING, changedFiles: [] } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AgentComposerPanel projectId="p1" />);
    await screen.findByText('Add a comment to main.js');
    fireEvent.click(screen.getByRole('button', { name: /Verify & complete/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Not completed: no files have changed/);
    // Still rendered as running, never as completed.
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.queryByText('completed')).toBeNull();
    const fin = calls().find((c) => c.action === 'agent-task-finish');
    expect(fin?.input).toEqual({ id: 'task1', status: 'completed' });
  });

  it('cancel and mark-failed send their explicit statuses', async () => {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'agent-tasks-list') return Promise.resolve({ data: { ok: true, result: { tasks: [RUNNING] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AgentComposerPanel projectId="p1" />);
    await screen.findByText('Add a comment to main.js');
    fireEvent.click(screen.getByRole('button', { name: /Mark failed/ }));
    await waitFor(() => expect(calls().some((c) => c.action === 'agent-task-finish' && c.input.status === 'failed')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(calls().some((c) => c.action === 'agent-task-finish' && c.input.status === 'cancelled')).toBe(true));
  });

  it('a completed task renders the server-derived receipts', async () => {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'agent-tasks-list') return Promise.resolve({ data: { ok: true, result: { tasks: [COMPLETED] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AgentComposerPanel projectId="p1" />);
    await screen.findByText('Fix the bug');
    expect(screen.getByText(/Files changed \(verified against the task-start record\): src\/a\.ts/)).toBeTruthy();
    expect(screen.getByText(/src\/a\.ts: new → abcdef012345/)).toBeTruthy();
    // No action buttons on a terminal task.
    expect(screen.queryByRole('button', { name: /Verify & complete/ })).toBeNull();
  });
});
