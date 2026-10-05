import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { AstronomyKeepMenu } from '@/components/astronomy/AstronomyKeepMenu';
import type { AstroObservation } from '@/components/astronomy/astronomyReport';

const obs: AstroObservation = {
  id: 'obs_1',
  targetId: 'tgt_1',
  targetName: 'Andromeda Galaxy',
  date: '2026-10-05',
  conditions: 'clear',
  notes: 'bright core',
  rating: 5,
  createdAt: '2026-10-05',
};

const save = () => screen.getByRole('button', { name: /Save observation as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('astronomy observation handoff', () => {
  it('will not draft before the observation is saved', () => {
    render(<AstronomyKeepMenu observation={obs} />);
    expect(draft()).toBeDisabled();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_s1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_s1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_s1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<AstronomyKeepMenu observation={obs} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_s1\./)).toBeTruthy());

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_s1\. Not posted\./)).toBeTruthy());

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_s1');
    expect(String((draftCall?.[2] as Record<string, unknown>).content)).toContain('Andromeda Galaxy');
  });

  it('does not claim a save when the read-back fails', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_s1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<AstronomyKeepMenu observation={obs} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/read-back did not return it/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });

  it('does not claim a save when the store refuses', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: false, error: 'quota exceeded' } };
      return { data: { ok: true, result: {} } };
    });

    render(<AstronomyKeepMenu observation={obs} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. quota exceeded/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });

  it('renders nothing when there is no honest sentence', () => {
    const { container } = render(<AstronomyKeepMenu observation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the observation has no target name', () => {
    const { container } = render(<AstronomyKeepMenu observation={{ id: 'obs_1', targetName: '' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows already-drafted when Thread already cites this DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_s1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_s1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_s1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<AstronomyKeepMenu observation={obs} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_s1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeDisabled());
    expect(screen.getByText(/Drafted in Thread as th_9/)).toBeTruthy();
  });
});