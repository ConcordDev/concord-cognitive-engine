import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ShippingProfilesPanel } from '@/components/marketplace/ShippingProfilesPanel';

const PROFILES = [
  {
    id: 'p1', number: 'SP-1', name: 'Standard', originCountry: 'US',
    processingDaysMin: 1, processingDaysMax: 3,
    zones: [
      { region: 'Domestic', rateUsd: 5, additionalItemUsd: 1 },
      { region: 'International', rateUsd: 15, additionalItemUsd: 0 },
    ],
    createdAt: '2026-05-01',
  },
  {
    id: 'p2', number: 'SP-2', name: 'Express', originCountry: '',
    processingDaysMin: 0, processingDaysMax: 1, zones: [], createdAt: '2026-05-02',
  },
];

describe('ShippingProfilesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { profiles: [] } } });
  });

  it('shows empty state when no profiles', async () => {
    render(<ShippingProfilesPanel />);
    expect(await screen.findByText('No shipping profiles yet.')).toBeInTheDocument();
  });

  it('renders profiles with zones and no-origin fallback', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { profiles: PROFILES } } });
    render(<ShippingProfilesPanel />);
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Express')).toBeInTheDocument();
    expect(screen.getByText(/Domestic: \$5\.00/)).toBeInTheDocument();
    expect(screen.getByText(/no origin/)).toBeInTheDocument();
  });

  it('opens the new-profile editor with a default zone row', async () => {
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    expect(screen.getByPlaceholderText('Profile name *')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Domestic')).toBeInTheDocument();
  });

  it('adds and removes zone rows in the editor', async () => {
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    fireEvent.click(screen.getByText('Add zone'));
    expect(screen.getAllByPlaceholderText('Region').length).toBe(2);
    fireEvent.click(screen.getAllByLabelText('Remove zone')[1]);
    expect(screen.getAllByPlaceholderText('Region').length).toBe(1);
  });

  it('updates every editor field including all zone inputs', async () => {
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    fireEvent.change(screen.getByPlaceholderText('Profile name *'), { target: { value: 'P' } });
    fireEvent.change(screen.getByPlaceholderText('Origin country'), { target: { value: 'CA' } });
    fireEvent.change(screen.getByPlaceholderText('Proc. min'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('Proc. max'), { target: { value: '7' } });
    fireEvent.change(screen.getByPlaceholderText('Region'), { target: { value: 'EU' } });
    fireEvent.change(screen.getByPlaceholderText('Base rate $'), { target: { value: '9' } });
    fireEvent.change(screen.getByPlaceholderText('+item $'), { target: { value: '3' } });
    expect(screen.getByDisplayValue('P')).toBeInTheDocument();
    expect(screen.getByDisplayValue('EU')).toBeInTheDocument();
    expect(screen.getByDisplayValue('9')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
  });

  it('updates zone inputs across multiple zone rows', async () => {
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    fireEvent.click(screen.getByText('Add zone'));
    const regions = screen.getAllByPlaceholderText('Region');
    fireEvent.change(regions[1], { target: { value: 'Zone2' } });
    const rates = screen.getAllByPlaceholderText('Base rate $');
    fireEvent.change(rates[1], { target: { value: '20' } });
    const adds = screen.getAllByPlaceholderText('+item $');
    fireEvent.change(adds[1], { target: { value: '4' } });
    expect(screen.getByDisplayValue('Zone2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });

  it('does not save without a profile name', async () => {
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Save profile'));
    expect(lensRun).not.toHaveBeenCalledWith(
      'marketplace', 'shipping-profiles-save', expect.anything(),
    );
  });

  it('saves a new profile and closes the editor', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'shipping-profiles-save')
        return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve({ data: { ok: true, result: { profiles: [] } } });
    });
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    fireEvent.change(screen.getByPlaceholderText('Profile name *'), {
      target: { value: 'My Profile' },
    });
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'shipping-profiles-save',
        expect.objectContaining({ name: 'My Profile' }),
      ),
    );
  });

  it('shows an error when save returns ok:false', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'shipping-profiles-save')
        return Promise.resolve({ data: { ok: false, error: 'invalid zone' } });
      return Promise.resolve({ data: { ok: true, result: { profiles: [] } } });
    });
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    fireEvent.change(screen.getByPlaceholderText('Profile name *'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save profile'));
    expect(await screen.findByText('invalid zone')).toBeInTheDocument();
  });

  it('edits an existing profile (pre-fills the draft)', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { profiles: PROFILES } } });
    render(<ShippingProfilesPanel />);
    await screen.findByText('Standard');
    fireEvent.click(screen.getAllByText('Edit')[0]);
    expect(screen.getByDisplayValue('Standard')).toBeInTheDocument();
    expect(screen.getByDisplayValue('International')).toBeInTheDocument();
  });

  it('cancels the editor', async () => {
    render(<ShippingProfilesPanel />);
    await screen.findByText('No shipping profiles yet.');
    fireEvent.click(screen.getByText('New profile'));
    expect(screen.getByPlaceholderText('Profile name *')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Profile name *')).not.toBeInTheDocument();
  });

  it('deletes a profile after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'shipping-profiles-list')
        return Promise.resolve({ data: { ok: true, result: { profiles: PROFILES } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ShippingProfilesPanel />);
    await screen.findByText('Standard');
    fireEvent.click(screen.getAllByLabelText('Delete profile')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('marketplace', 'shipping-profiles-delete', { id: 'p1' }),
    );
    confirmSpy.mockRestore();
  });

  it('does not delete when confirm cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockResolvedValue({ data: { ok: true, result: { profiles: PROFILES } } });
    render(<ShippingProfilesPanel />);
    await screen.findByText('Standard');
    fireEvent.click(screen.getAllByLabelText('Delete profile')[0]);
    expect(lensRun).not.toHaveBeenCalledWith(
      'marketplace', 'shipping-profiles-delete', expect.anything(),
    );
    confirmSpy.mockRestore();
  });

  it('tolerates a list rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ShippingProfilesPanel />);
    expect(await screen.findByText('No shipping profiles yet.')).toBeInTheDocument();
  });
});
