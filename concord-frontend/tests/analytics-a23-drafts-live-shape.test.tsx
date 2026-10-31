/**
 * /lenses/analytics — A23's three protocol drafts survive the LIVE tab
 * switch shape (F8 successor; Review 4 Addenda 5 + 8).
 *
 * The graded fields are Addendum 5's protocol set, quoted verbatim:
 * Funnels "Funnel name", Funnels steps, Advanced "dashboard name".
 * PR #1894 persisted the Actions bench's drafts instead (a scoping
 * miss traced in f8-successor-trace-2026-10-30.md) and proved them
 * with a single-panel unmount/remount. Addendum 8's re-check failed
 * field-for-field on the live shape — because the live switch is not
 * a panel unmount: app/lenses/analytics/page.tsx renders ONE body
 * component per tab, so a switch tears down the whole subtree.
 *
 * This suite therefore exercises the live shape, as the sanction's
 * gate condition binds: a harness that selects its body exactly the
 * way the page does (one body, replaced per tab), both real form
 * components, all three protocol fields typed, switches through the
 * harness's tab mechanism (Advanced → Events → Funnels and back —
 * Addendum 8's path), and an other-lens round trip (full unmount +
 * remount; the store is localStorage, so drafts must survive that
 * too, as they did not in Addendum 8).
 *
 * lensRun is mocked at '@/lib/api/client' in the envelopes served.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { get: vi.fn() },
  apiHelpers: { dtus: { myDtus: vi.fn() } },
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
}));

import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';
import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';

type TabId = 'funnels' | 'events' | 'advanced';

/** The page's body-selection mechanism in miniature: one body per tab,
 *  replaced (unmounted) on every switch — page.tsx lines 74–86. */
function LensTabsHarness() {
  const [active, setActive] = useState<TabId>('advanced');
  let body: React.ReactNode = null;
  if (active === 'advanced') body = <AdvancedAnalytics />;
  else if (active === 'events') body = <div>events-body</div>;
  else body = <FunnelsPanel />;
  return (
    <div>
      <button onClick={() => setActive('funnels')}>tab-funnels</button>
      <button onClick={() => setActive('events')}>tab-events</button>
      <button onClick={() => setActive('advanced')}>tab-advanced</button>
      {body}
    </div>
  );
}

const FUNNEL_NAME = 'PR4 A23 Successor Funnel';
const FUNNEL_STEPS = 'successor-one, successor-two, successor-three';
const DASH_NAME = 'PR4 A23 Successor Dashboard';

function mockRun() {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'event-stats') {
      return Promise.resolve({ data: { ok: true, result: { topEvents: [] } } });
    }
    if (action === 'funnel-list') {
      return Promise.resolve({ data: { ok: true, result: { funnels: [] } } });
    }
    if (action === 'dashboard-list') {
      return Promise.resolve({ data: { ok: true, result: { dashboards: [] } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

async function typeDashboardDraft() {
  const input = (await screen.findByPlaceholderText('dashboard name')) as HTMLInputElement;
  fireEvent.change(input, { target: { value: DASH_NAME } });
  expect(input.value).toBe(DASH_NAME);
}

async function typeFunnelDrafts() {
  const name = (await screen.findByPlaceholderText('Funnel name')) as HTMLInputElement;
  const steps = (await screen.findByPlaceholderText('step1, step2, step3')) as HTMLInputElement;
  fireEvent.change(name, { target: { value: FUNNEL_NAME } });
  fireEvent.change(steps, { target: { value: FUNNEL_STEPS } });
  expect(name.value).toBe(FUNNEL_NAME);
  expect(steps.value).toBe(FUNNEL_STEPS);
}

async function expectFunnelDrafts() {
  const name = (await screen.findByPlaceholderText('Funnel name')) as HTMLInputElement;
  const steps = (await screen.findByPlaceholderText('step1, step2, step3')) as HTMLInputElement;
  await waitFor(() => expect(name.value).toBe(FUNNEL_NAME));
  expect(steps.value).toBe(FUNNEL_STEPS);
}

async function expectDashboardDraft() {
  const input = (await screen.findByPlaceholderText('dashboard name')) as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe(DASH_NAME));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockRun();
});

describe('A23 protocol drafts — live tab-switch shape (F8 successor)', () => {
  it('all three drafts survive the protocol switch path and an other-lens round trip', async () => {
    const first = render(<LensTabsHarness />);

    // Advanced is the harness's opening tab (the protocol starts there).
    await typeDashboardDraft();
    fireEvent.click(screen.getByText('tab-funnels'));
    await typeFunnelDrafts();

    // Addendum 8's path: (Funnels →) Events → Advanced, and back.
    fireEvent.click(screen.getByText('tab-events'));
    expect(screen.getByText('events-body')).toBeTruthy();
    fireEvent.click(screen.getByText('tab-advanced'));
    await expectDashboardDraft();

    fireEvent.click(screen.getByText('tab-events'));
    fireEvent.click(screen.getByText('tab-funnels'));
    await expectFunnelDrafts();

    // Other-lens round trip: the whole lens unmounts; the store is
    // localStorage, so a fresh mount must restore the same drafts.
    first.unmount();
    render(<LensTabsHarness />);
    await expectDashboardDraft();
    fireEvent.click(screen.getByText('tab-funnels'));
    await expectFunnelDrafts();
  });

  it('control: with an empty store the three fields start empty', async () => {
    render(<LensTabsHarness />);
    const dash = (await screen.findByPlaceholderText('dashboard name')) as HTMLInputElement;
    expect(dash.value).toBe('');
    fireEvent.click(screen.getByText('tab-funnels'));
    const name = (await screen.findByPlaceholderText('Funnel name')) as HTMLInputElement;
    const steps = (await screen.findByPlaceholderText('step1, step2, step3')) as HTMLInputElement;
    expect(name.value).toBe('');
    expect(steps.value).toBe('');
  });
});
