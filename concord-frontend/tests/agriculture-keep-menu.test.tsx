import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { AgricultureKeepMenu } from '@/components/agriculture/AgricultureKeepMenu';
import type { AgField } from '@/components/agriculture/agricultureReport';

const field: AgField = {
  id: 'field_1',
  name: 'North 40',
  acreage: 40,
  lat: 40.0,
  lng: -100.0,
  soilType: 'loam',
  currentCrop: 'corn',
  createdAt: '2026-10-05',
};

const save = () => screen.getByRole('button', { name: /Save field as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('agriculture field handoff', () => {
  it('will not draft before the field is saved', () => {
    render(<AgricultureKeepMenu field={field} />);
    expect(draft()).toBeDisabled();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_a1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_a1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_a1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<AgricultureKeepMenu field={field} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_a1\./)).toBeTruthy());

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_a1\. Not posted\./)).toBeTruthy());

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_a1');
    expect(String((draftCall?.[2] as Record<string, unknown>).content)).toContain('North 40');
  });

  it('does not claim a save when the read-back fails', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_a1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<AgricultureKeepMenu field={field} />);
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

    render(<AgricultureKeepMenu field={field} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. quota exceeded/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });

  it('renders nothing when there is no honest sentence', () => {
    const { container } = render(<AgricultureKeepMenu field={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the field has no name', () => {
    const { container } = render(<AgricultureKeepMenu field={{ id: 'field_1', name: '' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows already-drafted when Thread already cites this DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_a1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_a1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_a1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<AgricultureKeepMenu field={field} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_a1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeDisabled());
    expect(screen.getByText(/Drafted in Thread as th_9/)).toBeTruthy();
  });
});