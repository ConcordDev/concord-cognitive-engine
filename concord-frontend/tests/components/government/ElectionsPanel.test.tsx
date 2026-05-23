import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ElectionsPanel } from '@/components/government/ElectionsPanel';

const REGISTRATION = {
  id: 'reg1', fullName: 'Jane Voter', residentialAddress: '1 St', dateOfBirth: '1990-01-01',
  stateCode: 'CA', partyPreference: 'democratic', mailInRequested: true, status: 'active', submittedAt: '2026-01-01',
};

describe('ElectionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { registration: null } } });
  });

  it('shows the registration form when not registered', async () => {
    render(<ElectionsPanel />);
    expect(await screen.findByPlaceholderText('Full legal name')).toBeInTheDocument();
  });

  it('renders the registration summary when registered', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { registration: REGISTRATION } } });
    render(<ElectionsPanel />);
    expect(await screen.findByText('Jane Voter')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('requested')).toBeInTheDocument();
  });

  it('rejects an incomplete registration with an error', async () => {
    render(<ElectionsPanel />);
    await screen.findByPlaceholderText('Full legal name');
    fireEvent.click(screen.getByText('Submit registration'));
    expect(await screen.findByText(/All fields required/)).toBeInTheDocument();
  });

  it('submits a complete registration', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'voter-registration-submit'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { registration: null } } }),
    );
    render(<ElectionsPanel />);
    await screen.findByPlaceholderText('Full legal name');
    fireEvent.change(screen.getByPlaceholderText('Full legal name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('Residential address'), { target: { value: '1 Main' } });
    const dob = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dob, { target: { value: '1990-05-05' } });
    fireEvent.change(screen.getByPlaceholderText('ST'), { target: { value: 'ca' } });
    fireEvent.click(screen.getByText('Submit registration'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'voter-registration-submit' }),
      ),
    );
  });

  it('looks up elections and renders results', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'elections-upcoming')
        return Promise.resolve({ data: { ok: true, result: { elections: [{ id: 'e1', name: 'General Election', electionDay: '2026-11-03', ocdDivisionId: 'x' }] } } });
      return Promise.resolve({ data: { ok: true, result: { registration: null } } });
    });
    render(<ElectionsPanel />);
    await screen.findByPlaceholderText('Full legal name');
    fireEvent.click(screen.getByText('Look up'));
    expect(await screen.findByText('General Election')).toBeInTheDocument();
  });

  it('shows an elections error on ok:false', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'elections-upcoming')
        return Promise.resolve({ data: { ok: false, error: 'no civic api key' } });
      return Promise.resolve({ data: { ok: true, result: { registration: null } } });
    });
    render(<ElectionsPanel />);
    await screen.findByPlaceholderText('Full legal name');
    fireEvent.click(screen.getByText('Look up'));
    expect(await screen.findByText('no civic api key')).toBeInTheDocument();
  });

  it('does not look up polling with a blank address', async () => {
    render(<ElectionsPanel />);
    await screen.findByPlaceholderText('Full legal name');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Find'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'polling-place-lookup' }));
  });

  it('looks up polling places and early-vote sites', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'polling-place-lookup')
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              pollingLocations: [{ name: 'School Gym', line1: '5 Elm', city: 'Town', state: 'CA', zip: '90001', pollingHours: '7-8', notes: '' }],
              earlyVoteSites: [{ name: 'Library', line1: '9 Oak', city: 'Town', state: 'CA' }],
            },
          },
        });
      return Promise.resolve({ data: { ok: true, result: { registration: null } } });
    });
    render(<ElectionsPanel />);
    await screen.findByPlaceholderText('Full legal name');
    fireEvent.change(screen.getByPlaceholderText('Your registered address'), { target: { value: '1 Main St' } });
    fireEvent.click(screen.getByText('Find'));
    expect(await screen.findByText('School Gym')).toBeInTheDocument();
    expect(screen.getByText(/Library/)).toBeInTheDocument();
  });

  it('tolerates a fetch rejection on registration load', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ElectionsPanel />);
    expect(await screen.findByPlaceholderText('Full legal name')).toBeInTheDocument();
  });
});
