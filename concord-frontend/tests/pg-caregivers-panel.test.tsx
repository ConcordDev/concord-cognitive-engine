// Caregiver sharing UI: roster shows a display name and an opaque id,
// codes say they are single-use, and a non-owner does not get a remove control.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PgCaregiversPanel } from '@/components/parenting/PgCaregiversPanel';
import { ParentingSection } from '@/components/parenting/ParentingSection';

const CAREGIVER = {
  id: 'cg_opaque',
  displayName: 'Nia Nanny',
  role: 'nanny',
  childId: 'kid_1',
  joinedAt: '2026-10-11T12:00:00.000Z',
};

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('PgCaregiversPanel', () => {
  it('shows the caregiver display name and removes by the opaque id', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'caregiver-list') {
        return Promise.resolve({
          data: { ok: true, result: { caregivers: [CAREGIVER], count: 1, canManage: true } },
        });
      }
      if (action === 'caregiver-remove') {
        return Promise.resolve({ data: { ok: true, result: { removed: 'cg_opaque' } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<PgCaregiversPanel childId="kid_1" />);
    await waitFor(() => expect(screen.getByText('Nia Nanny')).toBeInTheDocument());
    expect(screen.queryByText('user_b')).not.toBeInTheDocument();
    expect(screen.getByText(/one canonical baby log/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove caregiver' }));
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('parenting', 'caregiver-remove', { id: 'cg_opaque' });
    });
  });

  it('hides remove when the viewer cannot manage the roster', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { caregivers: [CAREGIVER], count: 1, canManage: false } },
    });
    render(<PgCaregiversPanel childId="kid_1" />);
    await waitFor(() => expect(screen.getByText('Nia Nanny')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Remove caregiver' })).not.toBeInTheDocument();
  });

  it('tells the owner a code is single-use and expires', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'caregiver-invite') {
        return Promise.resolve({
          data: {
            ok: true,
            result: { code: 'AB23CD', childId: 'kid_1', childName: 'Ada', role: 'nanny', expiresAt: '2026-10-18T00:00:00.000Z' },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: { caregivers: [], count: 0, canManage: true } } });
    });
    render(<PgCaregiversPanel childId="kid_1" />);
    await waitFor(() => expect(screen.getByText('No caregivers have joined yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Generate code/ }));
    await waitFor(() => expect(screen.getByText('AB23CD')).toBeInTheDocument());
    expect(screen.getByText('Single-use. Expires 2026-10-18.')).toBeInTheDocument();
  });

  it('says the baby log is shared only after redeem succeeds', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'caregiver-redeem') return Promise.resolve({ data: { ok: true, result: { childId: 'kid_1', role: 'nanny' } } });
      return Promise.resolve({ data: { ok: true, result: { caregivers: [], count: 0, canManage: false } } });
    });
    render(<PgCaregiversPanel childId="kid_1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('6-character code'), { target: { value: 'AB23CD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(screen.getByText('Joined — you now share this baby log.')).toBeInTheDocument());
  });
});

describe('ParentingSection shared children', () => {
  it('marks a shared child and does not offer to delete them', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'child-list') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              children: [
                { id: 'kid_own', name: 'Bea', ageDisplay: '1y', birthDate: '2025-01-01', sex: 'girl', ageMonths: 12, shared: false },
                { id: 'kid_shared', name: 'Ada', ageDisplay: '3 months', birthDate: '2026-07-01', sex: 'girl', ageMonths: 3, shared: true },
              ],
            },
          },
        });
      }
      if (action === 'parenting-dashboard') {
        return Promise.resolve({ data: { ok: true, result: { hasChild: true, feedsToday: 0, sleepMinToday: 0, diapersToday: 0, lastFeed: null } } });
      }
      if (action === 'day-timeline') {
        return Promise.resolve({ data: { ok: true, result: { events: [] } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<ParentingSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ada · 3 months · shared' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Bea · 1y' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Bea' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).not.toBeInTheDocument();
  });
});
