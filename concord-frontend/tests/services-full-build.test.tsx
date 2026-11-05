/**
 * build(services) GB-1088 — FE behaviour pins for the full lens build.
 *
 * The union (F3) lives in the Desk's derivations and renders, projected
 * through concord-frontend/components/services/services-model.ts — the
 * one shared code path both panels use. This suite mocks only the
 * transport boundary (useLensData per type + lensRun for the suite
 * store) and renders the REAL ServicesDeskPanel:
 *   S1 — a suite (Booking Grid) booking dated today counts on the
 *        Dashboard's "Today's Appointments" and renders in the
 *        Appointments tab with its source badge;
 *   S1 — a suite-only client profile renders in the Clients tab;
 *   S1 — the Dashboard low-stock count uses the shared predicate
 *        (reorderLevel defaults to 5, exactly as the Inventory Check's
 *        supplyCheck payload computes it);
 *   +  the services-model helpers themselves (projection, join key).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { calendarDateKey } from '@/lib/calendar-date';
import { isLowStock, normalizeClientKey, deskAppointmentAsBooking } from '@/components/services/services-model';

type Item = { id: string; title: string; data: Record<string, unknown>; meta: { status: string } };
const book: Record<string, Item[]> = {
  Appointment: [], Client: [], ServiceItem: [], StaffMember: [], Transaction: [], Product: [],
};
const suite: { bookings: unknown[]; profiles: unknown[] } = { bookings: [], profiles: [] };

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => ({
    items: book[type] || [],
    total: (book[type] || []).length,
    isLoading: false,
    isError: false,
    error: null,
    isSeeding: false,
    refetch: vi.fn(),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(() => Promise.resolve({ ok: true, result: {} })), isPending: false }),
  useCreateArtifact: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useUpdateArtifact: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { artifacts: [] } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn((_domain: string, name: string) => {
    if (name === 'bookingGridList') return Promise.resolve({ data: { ok: true, result: { bookings: suite.bookings, count: suite.bookings.length, staffLanes: [], utilization: {} } } });
    if (name === 'clientProfileList') return Promise.resolve({ data: { ok: true, result: { profiles: suite.profiles, count: suite.profiles.length } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  }),
  isForbidden: () => false,
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/services/BookingActionDock', () => ({ BookingActionDock: () => null, EndOfDayClose: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { ServicesDeskPanel } from '@/components/services/ServicesDeskPanel';

const today = calendarDateKey();
const suiteBookingToday = {
  id: 'bk_1', client: 'Grid Greta', clientUserId: null, service: 'Cut', staff: 'Jo',
  date: today, time: '10:00', duration: 60, price: 50, status: 'booked', source: 'grid',
};

beforeEach(() => {
  for (const k of Object.keys(book)) book[k] = [];
  suite.bookings = [];
  suite.profiles = [];
});

describe('services-model — the shared union projections', () => {
  it('isLowStock applies the reorder default of 5 — the Inventory Check rule', () => {
    expect(isLowStock({ stockLevel: 2 })).toBe(true);
    expect(isLowStock({ stockLevel: 2, reorderLevel: undefined })).toBe(true);
    expect(isLowStock({ stockLevel: 2, reorderLevel: 1 })).toBe(false);
    expect(isLowStock({ stockLevel: 6 })).toBe(false);
  });

  it('normalizeClientKey is the suite join key (trimmed, lowercased)', () => {
    expect(normalizeClientKey('  Ada Lovelace ')).toBe('ada lovelace');
  });

  it('deskAppointmentAsBooking projects a Desk appointment into the booking shape', () => {
    const b = deskAppointmentAsBooking({
      id: 'a1', meta: { status: 'confirmed' },
      data: {
        clientName: 'Desk Dan', serviceType: 'Shave', provider: 'Jo', date: today, time: '09:00',
        duration: 30, price: 25, recurring: false, recurringFrequency: '', noShowCount: 0, notes: '', reminderSent: false,
      },
    });
    expect(b).toMatchObject({ id: 'a1', client: 'Desk Dan', service: 'Shave', staff: 'Jo', date: today, time: '09:00', status: 'confirmed', source: 'desk' });
  });
});

describe('ServicesDeskPanel — the union, rendered', () => {
  it("Dashboard counts today's suite bookings in Today's Appointments", async () => {
    suite.bookings = [suiteBookingToday];
    render(<ServicesDeskPanel />);
    const label = await screen.findByText("Today's Appointments");
    const card = label.closest('div')?.parentElement;
    await waitFor(() => expect(card?.textContent).toContain('1'));
  });

  it("Dashboard does NOT count a suite booking dated tomorrow as today's", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    suite.bookings = [{ ...suiteBookingToday, date: tomorrow }];
    render(<ServicesDeskPanel />);
    const label = await screen.findByText("Today's Appointments");
    const card = label.closest('div')?.parentElement;
    await waitFor(() => expect(card?.textContent).toContain('0'));
  });

  it('Dashboard low-stock alerts use the shared predicate (default reorder level)', async () => {
    book.Product = [{
      id: 'p1', title: 'Shampoo', meta: { status: 'active' },
      data: { sku: 'S1', category: 'Hair Care', costPrice: 5, retailPrice: 12, stockLevel: 2, salesVelocity: 1, supplier: '', lastRestocked: '', description: '' },
    }];
    render(<ServicesDeskPanel />);
    await waitFor(() => expect(screen.getByText(/1 low stock alerts/)).toBeTruthy());
  });

  it('Appointments tab renders suite bookings with a source badge', async () => {
    suite.bookings = [suiteBookingToday];
    render(<ServicesDeskPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /^Appointments/ }));
    expect(await screen.findByText('Grid Greta')).toBeTruthy();
    expect(await screen.findByText('Booking grid')).toBeTruthy();
  });

  it('Clients tab renders a suite-only client profile', async () => {
    suite.profiles = [{ clientKey: 'suite sue', name: 'Suite Sue', email: 'sue@x.io', phone: '', preferences: '' }];
    render(<ServicesDeskPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /^Clients/ }));
    expect(await screen.findByText('Suite Sue')).toBeTruthy();
    expect(await screen.findByText('Suite profile')).toBeTruthy();
  });
});
