// F2 frontend contract — the LivenessPanel renders the headline, handles the
// telemetry-off 204, and never white-screens on error.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LivenessPanel } from '@/components/admin/LivenessPanel';

describe('LivenessPanel', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('renders the substrate-gravity + funnel/distribution/economy headline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        headline: { recordsLiving: 1234, recordsPerCreator: 30, last7dRecords: 90, conversionRate: 0.42, abandonRate: 0.1, kFactor: 1.3, viral: true, economySolvent: true },
      }),
    }));
    render(<LivenessPanel />);
    await waitFor(() => expect(screen.getByText('1,234')).toBeTruthy());
    expect(screen.getByText('Records living')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();   // conversion
    expect(screen.getByText('solvent')).toBeTruthy();
    expect(screen.getByText('1.3')).toBeTruthy();   // K-factor
  });

  it('shows the off-note on a 204 (telemetry disabled) without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, json: async () => ({}) }));
    render(<LivenessPanel />);
    await waitFor(() => expect(screen.getByText(/telemetry is off/i)).toBeTruthy());
  });

  it('never white-screens when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const { container } = render(<LivenessPanel />);
    await waitFor(() => expect(screen.getByText('Substrate Liveness')).toBeTruthy());
    expect(container).toBeTruthy();
  });
});
