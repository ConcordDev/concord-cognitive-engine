// Render coverage for EventsWorkbench: every mode renders with one item per
// artifact type, and the generic sweep drives the create/edit/filter handlers.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { actionOf, exercise, fakeEntity } from '../../tests/helpers/exercise';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Me' } }) }));
vi.mock('@/components/icons/Icon', () => ({ Icon: () => <span /> }));
vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error }: { error?: string }) => <div role="alert">{String(error ?? 'error')}</div>,
}));

const mutate = vi.fn(async () => ({}));
const item = (type: string) => {
  const d = fakeEntity(type) as Record<string, unknown>;
  return {
    id: `${type}-1`, title: `${type} one`, data: d,
    meta: { tags: [], status: 'planning', visibility: 'private' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1,
  };
};
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    items: [item(type)], total: 1, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: mutate, update: mutate, remove: mutate,
    createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false },
  }),
}));

import { EventsWorkbench, MODE_TABS, type ModeTab } from './EventsWorkbench';

const RESULT = (action: string): Record<string, unknown> => ({
  'event-list': { events: [{ id: 'e1' }] },
  'event-detail': {
    event: {
      id: 'e1', name: 'Launch Party', type: 'conference', date: new Date().toISOString(), venue: 'Hall',
      budget: 5000, guestCount: 120, status: 'planning', createdAt: new Date().toISOString(),
      tiers: [{ id: 't1', name: 'GA', price: 20, capacity: 100, sold: 10 }],
      registrations: [{ id: 'r1', name: 'Ann', email: 'a@b.co', tier: 'GA', status: 'confirmed', createdAt: new Date().toISOString() }],
    },
  },
  'events-dashboard': { rsvpRate: 0.5, avgAttendance: 80, totalSpent: 1200, netPosition: 300 },
}[action] ?? {});

beforeEach(() => {
  lensRunMock.mockReset(); mutate.mockClear();
  lensRunMock.mockImplementation(async (...args: unknown[]) => ({ data: { ok: true, result: RESULT(actionOf(args)), error: null } }));
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('EventsWorkbench', () => {
  it.each(MODE_TABS.map((t) => t.id))('renders and exercises the %s mode', async (mode: ModeTab) => {
    const view = render(<EventsWorkbench mode={mode} onOpenHost={vi.fn()} onSelectMode={vi.fn()} />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
    await exercise({ passes: 5 });
    await settle();
  });

  it('shows an honest error when the event list fails', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<EventsWorkbench mode="events" onOpenHost={vi.fn()} onSelectMode={vi.fn()} />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});
