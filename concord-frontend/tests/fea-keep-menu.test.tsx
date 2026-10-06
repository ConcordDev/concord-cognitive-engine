import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { EngineeringKeepMenu } from '@/components/engineering/EngineeringKeepMenu';
import type { EngineeringFacts } from '@/components/engineering/feaReport';

const facts: EngineeringFacts = {
  jobName: 'Cantilever Beam',
  result: {
    jobId: 'sim_001',
    elapsedMs: 37,
    summary: { maxDisplacement: 0.0125, maxUtilization: 0.72, allPass: true, memberCount: 3, nodeCount: 4 },
    utilization: [{ id: 'M1', utilization: 0.72, pass: true }],
  },
};

const save = () => screen.getByRole('button', { name: /Save FEA as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('engineering FEA report handoff', () => {
  it('will not draft before the report is saved', () => {
    render(<EngineeringKeepMenu facts={facts} />);
    expect(draft()).toBeDisabled();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_fea1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<EngineeringKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_fea1\./)).toBeTruthy());

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_fea1\. Not posted\./)).toBeTruthy());

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_fea1');
    expect((draftCall?.[2] as Record<string, unknown>).content).toContain('Cantilever Beam');
  });

  it('does not claim a save when the read-back fails', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<EngineeringKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/read-back did not return it/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });

  it('repeats a refused save', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu') return { data: { ok: false, error: 'duplicate_blocked' } };
      return { data: { ok: true, result: {} } };
    });

    render(<EngineeringKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. duplicate_blocked/)).toBeTruthy());
  });

  it('repeats a refused draft', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      if (domain === 'thread' && action === 'thread-draft') return { data: { ok: false, error: 'cited DTU not found: dtu_fea1' } };
      return { data: { ok: true, result: {} } };
    });

    render(<EngineeringKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_fea1\./)).toBeTruthy());
    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Not drafted\. cited DTU not found: dtu_fea1/)).toBeTruthy());
  });

  it('shows the existing draft after a reload', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_fea1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_fea1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<EngineeringKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_fea1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeTruthy());
  });
});