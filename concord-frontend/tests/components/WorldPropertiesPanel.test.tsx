import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ── lensRun mock — WorldPropertiesPanel calls the object-arg overload
// (`lensRun({ domain, action, input })`), unlike the positional overload
// some other lens components use — both are real, supported shapes of
// concord-frontend/lib/api/client.ts#lensRun. ─────────────────────────────
type LensRunSpec = { domain: string; action: string; input?: Record<string, unknown> };
type LensRunResult = { data: { ok: boolean; result: unknown; error: string | null } };
const lensRunMock = vi.fn<(spec: LensRunSpec) => Promise<LensRunResult>>();
vi.mock('@/lib/api/client', () => ({
  lensRun: (spec: LensRunSpec) => lensRunMock(spec),
}));

import { WorldPropertiesPanel } from '@/components/realestate/WorldPropertiesPanel';

const NOW_S = Math.floor(Date.now() / 1000);

const OVERDUE_RENTAL = {
  id: 'rent_overdue', building_id: 'b1', landlord_user_id: 'me', tenant_kind: 'player',
  tenant_id: 'bob', rent_cents: 5000, period_days: 30,
  next_due_at: NOW_S - 3600, dissolved_at: null, last_paid_at: null,
};
const SOON_RENTAL = {
  id: 'rent_soon', building_id: 'b2', landlord_user_id: 'me', tenant_kind: 'npc',
  tenant_id: 'npc1', rent_cents: 2000, period_days: 7,
  next_due_at: NOW_S + 1800, dissolved_at: null, last_paid_at: null,
};
const LATER_RENTAL = {
  id: 'rent_later', building_id: 'b3', landlord_user_id: 'me', tenant_kind: 'player',
  tenant_id: 'carol', rent_cents: 8000, period_days: 30,
  next_due_at: NOW_S + 30 * 86400, dissolved_at: null, last_paid_at: null,
};

function mockRealEstate(overrides: Partial<{
  listings: unknown[]; owned: unknown[]; landlordRentals: unknown[]; tenantRentals: unknown[];
}> = {}) {
  const {
    listings = [], owned = [], landlordRentals = [], tenantRentals = [],
  } = overrides;
  lensRunMock.mockImplementation(async ({ domain, action, input }: LensRunSpec) => {
    if (domain !== 'real_estate') return { data: { ok: true, result: null, error: null } };
    if (action === 'active_listings') return { data: { ok: true, result: { listings }, error: null } };
    if (action === 'owned') return { data: { ok: true, result: { buildings: owned }, error: null } };
    if (action === 'my_rentals') {
      const role = (input as { role?: string } | undefined)?.role;
      return {
        data: {
          ok: true,
          result: { rentals: role === 'tenant' ? tenantRentals : landlordRentals },
          error: null,
        },
      };
    }
    if (action === 'constants') {
      return { data: { ok: true, result: { constants: { DEFAULT_RENTAL_PERIOD_DAYS: 30 } }, error: null } };
    }
    if (action === 'tick_rentals') {
      return { data: { ok: true, result: { collected: 1, failed: 0 }, error: null } };
    }
    return { data: { ok: true, result: null, error: null } };
  });
}

describe('WorldPropertiesPanel — rent collection (heartbeat + manual fallback)', () => {
  beforeEach(() => {
    lensRunMock.mockClear();
  });

  it('labels an overdue rental as collecting on the next hourly sweep', async () => {
    mockRealEstate({ landlordRentals: [OVERDUE_RENTAL] });
    render(<WorldPropertiesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rentals/i }));
    await waitFor(() => expect(screen.getByText(/auto-collects on the next hourly sweep/i)).toBeInTheDocument());
  });

  it('labels a rental due within the hour as "auto-collects within the hour"', async () => {
    mockRealEstate({ landlordRentals: [SOON_RENTAL] });
    render(<WorldPropertiesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rentals/i }));
    await waitFor(() => expect(screen.getByText(/auto-collects within the hour/i)).toBeInTheDocument());
  });

  it('labels a rental due much later with an estimated auto-collection date, not a fake precise time', async () => {
    mockRealEstate({ landlordRentals: [LATER_RENTAL] });
    render(<WorldPropertiesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rentals/i }));
    await waitFor(() => expect(screen.getByText(/auto-collects ~/i)).toBeInTheDocument());
  });

  it('applies the same auto-collect indicator to tenant-side rentals', async () => {
    mockRealEstate({ tenantRentals: [OVERDUE_RENTAL] });
    render(<WorldPropertiesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rentals/i }));
    await waitFor(() => expect(screen.getByText(/As tenant/i)).toBeInTheDocument());
    expect(screen.getByText(/auto-collects on the next hourly sweep/i)).toBeInTheDocument();
  });

  it('honestly labels automatic collection as hourly, and the button as an explicit manual override', async () => {
    mockRealEstate({ landlordRentals: [OVERDUE_RENTAL] });
    render(<WorldPropertiesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rentals/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/Rent collects automatically on an hourly sweep \(server-side, no tab needed\)/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Collect due rent now \(manual\)/i })).toBeInTheDocument();
  });

  it('the manual "Collect due rent now" fallback still calls tick_rentals and refreshes', async () => {
    mockRealEstate({ landlordRentals: [OVERDUE_RENTAL] });
    render(<WorldPropertiesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rentals/i }));
    await waitFor(() => expect(screen.getByText(/auto-collects on the next hourly sweep/i)).toBeInTheDocument());

    lensRunMock.mockClear();
    mockRealEstate({ landlordRentals: [] }); // simulate rent now collected + list refreshed empty
    fireEvent.click(screen.getByRole('button', { name: /Collect due rent now \(manual\)/i }));

    await waitFor(() =>
      expect(
        lensRunMock.mock.calls.some((c) => c[0]?.domain === 'real_estate' && c[0]?.action === 'tick_rentals'),
      ).toBe(true),
    );
    // Refresh follows a successful manual collection — landlord rentals re-fetched.
    await waitFor(() =>
      expect(
        lensRunMock.mock.calls.filter((c) => c[0]?.domain === 'real_estate' && c[0]?.action === 'my_rentals').length,
      ).toBeGreaterThan(1),
    );
  });
});
