import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProjectStatusMenu } from '@/components/projects/ProjectStatusMenu';
import type { StatusFacts } from '@/components/projects/projectStatusReport';

const facts: StatusFacts = {
  project: { id: 'prj_1', name: 'North Star', key: 'NS', status: 'started', health: 'at_risk' },
  dashboard: { totalTasks: 12, done: 7, completionPct: 58, overdue: 2, activeSprints: 1, openMilestones: 2, members: 4 },
  velocity: { series: [], avgVelocity: 8, completedSprints: 1 },
  cycle: { completedTasks: 7, avgCycleDays: 3.4, avgLeadDays: 5.1 },
  forecast: { remainingPoints: 5, avgVelocity: 8, projectedSprints: 1, basis: 1 },
  risks: [{ id: 'r1', name: 'Flaky ingest', severity: 'high', score: 12 }],
  milestones: [{ id: 'm1', name: 'Beta', dueDate: '2026-11-01', status: 'open' }],
};

const save = () => screen.getByRole('button', { name: /Save report as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  // The reload index reads Thread's drafts; stay quiet unless a test says otherwise.
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('project status report handoff', () => {
  it('will not draft before the report is saved', () => {
    render(<ProjectStatusMenu facts={facts} />);
    expect(draft()).toBeDisabled();
    expect(screen.getByText(/North Star \(NS\)/)).toBeTruthy();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_rep1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<ProjectStatusMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_rep1\./)).toBeTruthy());

    const order = () => lensRunMock.mock.calls.map((c) => `${c[0]}.${c[1]}`);
    expect(order().indexOf('dtu.create')).toBeLessThan(order().indexOf('dtu.get'));

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_rep1\. Not posted\./)).toBeTruthy());

    // create → read-back → draft, in that order.
    expect(order().indexOf('thread.thread-draft')).toBeGreaterThan(order().indexOf('dtu.get'));

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_rep1');
    expect((draftCall?.[2] as Record<string, unknown>).content).toContain('Nothing was published');
  });

  it('does not claim a save when the read-back does not return the record', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProjectStatusMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/read-back did not return it/)).toBeTruthy());
    expect(screen.queryByText(/^Saved as private DTU/)).toBeNull();
    expect(draft()).toBeDisabled();
  });

  it('repeats a refused save instead of reporting one', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu') return { data: { ok: false, error: 'duplicate_blocked' } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProjectStatusMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. duplicate_blocked/)).toBeTruthy());
    expect(screen.queryByText(/^Saved as private DTU/)).toBeNull();
  });

  it('repeats a refused draft instead of reporting one', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      if (domain === 'thread' && action === 'thread-draft') return { data: { ok: false, error: 'cited DTU not found: dtu_rep1' } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProjectStatusMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_rep1\./)).toBeTruthy());
    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Not drafted\. cited DTU not found: dtu_rep1/)).toBeTruthy());
  });

  it('shows the existing draft after a reload without drafting again', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_rep1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_rep1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProjectStatusMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_rep1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeTruthy());
    expect(screen.getByText(/Drafted in Thread as th_9\. Not posted\./)).toBeTruthy();
  });

  it('teaches the job when there is no project to report on', () => {
    render(<ProjectStatusMenu facts={{ ...facts, project: null }} />);
    expect(screen.getByText(/Pick a project to build a status report/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save report as DTU/i })).toBeNull();
  });
});
