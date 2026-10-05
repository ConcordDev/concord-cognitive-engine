import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PhysicsKeepMenu } from '@/components/physics/PhysicsKeepMenu';
import type { PhysicsFacts } from '@/components/physics/physicsSceneReport';

const facts: PhysicsFacts = {
  scene: {
    id: 'scene_001',
    name: 'Pendulum Lab',
    bodies: [{ id: 'b1', mass: 1.0, kind: 'circle' }],
    constraints: [{ id: 'c1', kind: 'rod' }],
    fluids: [],
  },
  summary: { id: 'scene_001', name: 'Pendulum Lab', bodyCount: 1, constraintCount: 1, fluidCount: 0 },
};

const save = () => screen.getByRole('button', { name: /Save scene as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('physics scene report handoff', () => {
  it('will not draft before the report is saved', () => {
    render(<PhysicsKeepMenu facts={facts} />);
    expect(draft()).toBeDisabled();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_sc1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<PhysicsKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_sc1\./)).toBeTruthy());

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_sc1\. Not posted\./)).toBeTruthy());

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_sc1');
    expect((draftCall?.[2] as Record<string, unknown>).content).toContain('Pendulum Lab');
  });

  it('does not claim a save when the read-back fails', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<PhysicsKeepMenu facts={facts} />);
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

    render(<PhysicsKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. duplicate_blocked/)).toBeTruthy());
  });

  it('repeats a refused draft', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      if (domain === 'thread' && action === 'thread-draft') return { data: { ok: false, error: 'cited DTU not found: dtu_sc1' } };
      return { data: { ok: true, result: {} } };
    });

    render(<PhysicsKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_sc1\./)).toBeTruthy());
    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Not drafted\. cited DTU not found: dtu_sc1/)).toBeTruthy());
  });

  it('shows the existing draft after a reload', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_sc1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_sc1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<PhysicsKeepMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_sc1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeTruthy());
  });
});