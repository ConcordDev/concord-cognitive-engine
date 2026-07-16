/**
 * PrivacyVerifyForm — Wave 4 gap-closure coverage for docs/WAVE4_INVENTORY.md's
 * atlas row: `cortex.privacy.zones`/`.stats`/`.verify` had a real, complete
 * backend (interior-never-generated guarantee for residential/medical/religious
 * zones) with zero frontend surface.
 *
 * Pins: an honest empty state when no zones exist yet (never a fabricated
 * placeholder zone), the zone picker is populated ONLY from real zones passed
 * in (never free-typed), and a verify submission calls
 * `apiHelpers.atlasTomography.privacyZones('verify', { zoneId })` with the
 * selected zone's real id and renders the real verification result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const privacyZones = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    atlasTomography: {
      privacyZones: (...args: unknown[]) => privacyZones(...args),
    },
  },
}));

import { PrivacyVerifyForm } from '@/components/atlas/PrivacyVerifyForm';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const ZONES = [
  { id: 'zone_abc123456789', classification: 'residential', protection_level: 'ABSOLUTE' },
  { id: 'zone_def987654321', classification: 'medical', protection_level: 'RESTRICTED' },
];

describe('PrivacyVerifyForm', () => {
  beforeEach(() => {
    privacyZones.mockReset();
  });

  it('shows an honest empty state — no fabricated placeholder zone — when zero zones exist', () => {
    const { getByText, queryByRole } = renderWithQuery(<PrivacyVerifyForm zones={[]} />);
    expect(getByText('No privacy zones exist yet to verify.')).toBeInTheDocument();
    expect(queryByRole('combobox')).not.toBeInTheDocument();
    expect(privacyZones).not.toHaveBeenCalled();
  });

  it('populates the zone picker only from real zones passed in, not free text', () => {
    const { getByLabelText, getByText } = renderWithQuery(<PrivacyVerifyForm zones={ZONES} />);
    const select = getByLabelText('Select privacy zone to verify') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(getByText(/residential \(ABSOLUTE\)/)).toBeInTheDocument();
    expect(getByText(/medical \(RESTRICTED\)/)).toBeInTheDocument();
  });

  it('submits the real selected zone id and renders the real verification result', async () => {
    privacyZones.mockResolvedValue({
      data: {
        ok: true,
        view: 'verify',
        verify: {
          zone_id: 'zone_abc123456789',
          classification: 'residential',
          protection_level: 'ABSOLUTE',
          interior_data_exists: false,
          interior_reconstructable: false,
          integrity: 'verified',
        },
      },
    });

    const { getByLabelText, getByText, findByText, findAllByText } = renderWithQuery(<PrivacyVerifyForm zones={ZONES} />);
    fireEvent.change(getByLabelText('Select privacy zone to verify'), { target: { value: 'zone_abc123456789' } });
    fireEvent.click(getByText('Verify'));

    await waitFor(() => expect(privacyZones).toHaveBeenCalledTimes(1));
    expect(privacyZones).toHaveBeenCalledWith('verify', { zoneId: 'zone_abc123456789' });

    expect(await findByText(/Zone Integrity: verified/)).toBeInTheDocument();
    expect(await findAllByText('NO')).toHaveLength(2);
  });

  it('surfaces an honest error state on a failed lookup without fabricating a result', async () => {
    privacyZones.mockRejectedValue(new Error('network down'));

    const { getByLabelText, getByText, findByRole } = renderWithQuery(<PrivacyVerifyForm zones={ZONES} />);
    fireEvent.change(getByLabelText('Select privacy zone to verify'), { target: { value: 'zone_abc123456789' } });
    fireEvent.click(getByText('Verify'));

    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/could not reach/i);
  });

  it('surfaces a not-found verification honestly (zone deleted between list + verify)', async () => {
    privacyZones.mockResolvedValue({ data: { ok: false, view: 'verify', error: 'zone_not_found' } });

    const { getByLabelText, getByText, findByText } = renderWithQuery(<PrivacyVerifyForm zones={ZONES} />);
    fireEvent.change(getByLabelText('Select privacy zone to verify'), { target: { value: 'zone_abc123456789' } });
    fireEvent.click(getByText('Verify'));

    expect(await findByText('zone_not_found')).toBeInTheDocument();
  });
});
