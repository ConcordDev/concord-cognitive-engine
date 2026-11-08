// Render + behaviour coverage for the events lens: event planner (tasks, vendors), event ops
// (ticketing, attendees, floor plan, budget, run of show, check-in, blasts, public page, production)
// and NASA EONET natural events.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const publicLookup = vi.hoisted(() => vi.fn());
const TIER = { id: 'ti1', name: 'General', price: 50, quantity: 100, sold: 40, description: 'GA', perks: 'Entry', saleStart: null, saleEnd: null, remaining: 60, soldOut: false, revenue: 2000 };
const REG = { id: 'rg1', name: 'Ann', email: 'ann@x.org', tierId: 'ti1', tierName: 'General', quantity: 2, amountPaid: 100, checkedIn: false, checkedInAt: null, ticketCode: 'TKT-1', notes: '', registeredAt: '2026-03-01' };
const EVT = { id: 'ev1', name: 'Summit', type: 'conference', date: '2026-06-01', venue: 'Hall A', budget: 20000, status: 'planning', taskCount: 3, doneTaskCount: 1, vendorCost: 4000 };

function resultFor(action: string): unknown {
  switch (action) {
    case 'event-list': return { events: [EVT, { ...EVT, id: 'ev2', name: 'Wedding', type: 'wedding', status: 'confirmed' }] };
    case 'events-dashboard': return { totalEvents: 2, upcoming: 1, totalBudget: 50000, openTasks: 4 };
    case 'event-detail': return { event: { ...EVT, guestCount: 120, tasks: [{ id: 'tk1', title: 'Book venue', dueDate: '2026-04-01', done: false }, { id: 'tk2', title: 'Send invites', dueDate: null, done: true }], vendors: [{ id: 'vd1', name: 'Caterer', role: 'food', cost: 3000, booked: true }], budgetLines: [{ id: 'bl1', label: 'Venue hire', category: 'venue', kind: 'expense', budgeted: 5000, actual: 4800, paid: true }, { id: 'bl2', label: 'Tickets', category: 'tickets', kind: 'revenue', budgeted: 8000, actual: 2000, paid: false }], publicPage: { slug: 'summit', published: true, headline: 'Join us', blurb: 'Big day', views: 12 } }, budgetRemaining: 16000 };
    case 'tier-list': return { tiers: [TIER, { ...TIER, id: 'ti2', name: 'VIP', soldOut: true, remaining: 0 }], totalRevenue: 4000, totalSold: 60, totalCapacity: 120 };
    case 'registration-list': return { registrations: [REG, { ...REG, id: 'rg2', checkedIn: true, name: 'Bo' }], totalTickets: 4, capacity: 120, revenue: 200, capacityPct: 3.3, checkedInCount: 1 };
    case 'floor-plan': return { tables: [{ id: 'tb1', label: 'Table 1', capacity: 8, shape: 'round', x: 10, y: 20, seats: [{ guestName: 'Ann', registrationId: 'rg1' }, { guestName: '', registrationId: null }] }], totalSeats: 8, assignedSeats: 1, openSeats: 7 };
    case 'budget-summary': return { budgetedExpense: 5000, actualExpense: 4800, ticketRevenue: 2000, actualRevenue: 2000, netProfit: -2800, variance: 200, overBudget: false, byCategory: { venue: { budgeted: 5000, actual: 4800 } } };
    case 'agenda-timeline': return { items: [{ id: 'ag1', title: 'Keynote', day: '2026-06-01', startTime: '09:00', durationMin: 45, track: 'Main', owner: 'Ann', notes: '', endTime: '09:45' }], dayCount: 1, totalDurationMin: 45 };
    case 'check-in-status': return { checkedInCount: 1, totalRegistered: 4, attendanceRate: 25 };
    case 'blast-list': return { blasts: [{ id: 'bs1', subject: 'Welcome', body: 'Hi all', segment: 'all', recipientCount: 4, sentAt: '2026-03-02', delivered: 3, status: 'partial', notSentReason: 'bounced', recipients: [{ name: 'Ann', email: 'ann@x.org', sent: true }, { email: 'bad@x', sent: false, reason: 'bounce' }] }] };
    case 'check-in': return { ok: true, registration: REG, message: 'Checked in' };
    case 'advanceSheet': return { event: 'Summit', date: '2026-06-01', venue: { name: 'Hall A', address: '1 Main', capacity: 500, contact: 'Lee' }, schedule: { loadIn: '08:00', soundcheck: '10:00', doors: '17:00', showTime: '19:00', curfew: '23:00' }, production: { stage: '8x6', sound: 'PA', lighting: 'LED', backline: 'Drums' }, hospitality: { catering: 'Hot', greenRoom: 'Yes', parking: '2' }, generatedAt: '2026-03-02' };
    case 'techRiderMatch': return { performer: 'Band', matches: [{ requirement: 'Drums', quantity: 1, available: true, notes: '' }, { requirement: 'Piano', quantity: 1, available: false, notes: 'Rent' }], fulfilled: 1, total: 2, fulfillmentRate: 50 };
    case 'settlementCalc': return { performer: 'Band', guarantee: 1000, doorSplit: '80%', grossDoor: 4000, artistDoorShare: 3200, settlement: 3200, method: 'door split', ticketsSold: 100 };
    case 'budgetReconcile': return { event: 'Summit', projectedBudget: 5000, totalExpenses: 4800, totalRevenue: 6000, netProfit: 1200, variance: 200, overBudget: false, byCategory: { venue: 4800 } };
    case 'public-page': case 'publish-page': return { page: { slug: 'summit', published: true, headline: 'Join us', blurb: 'Big day', views: 12 }, url: '/e/summit' };
    case 'event-create': return { event: { ...EVT, id: 'ev9', name: 'New event', guestCount: 0, tasks: [], vendors: [] } };
    default: return { ok: true, id: 'new-1', tier: TIER, registration: REG };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/lib/public-lookup', () => ({ publicLookup: (...a: unknown[]) => publicLookup(...a), carryLookupMeta: vi.fn(), lookupMeta: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/common/LookupNotice', () => ({ LookupNotice: () => <div>lookup notice</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EventOps } from '../EventOps';
import { EventPlanner } from '../EventPlanner';
import { NasaEarthEvents } from '../NasaEarthEvents';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); publicLookup.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  publicLookup.mockResolvedValue({ events: [{ id: 'EONET_1', title: 'Wildfire in OR', description: 'Big fire', link: 'https://eonet.gsfc.nasa.gov/1', categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [{ id: 'IRWIN', url: 'https://x' }], geometry: [{ date: '2026-03-01', type: 'Point', coordinates: [-120, 44] }] }, { id: 'EONET_2', title: 'Storm', link: 'https://x/2', closed: '2026-03-02', categories: [{ id: 'severeStorms', title: 'Storms' }], sources: [], geometry: [{ date: '2026-03-01', type: 'Polygon', coordinates: [[-1, 2], [3, 4]] }] }] });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['EventOps', () => <EventOps />],
  ['EventPlanner', () => <EventPlanner />],
  ['NasaEarthEvents', () => <NasaEarthEvents />],
];

describe('events panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 3, text: 'Summit', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await settle();
    await exercise({ passes: 1, text: '25' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    publicLookup.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('events flows', () => {
  it('the planner opens an event, tracks tasks and vendors, changes status and deletes', async () => {
    render(<EventPlanner />);
    await settle();
    await press(/Summit/);
    await exercise({ passes: 3, text: 'Book band', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Book venue|Send invites/);
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) for (const o of Array.from(sel.options)) { fireEvent.change(sel, { target: { value: o.value } }); await settle(); }
    await press(/Delete|Trash|Remove/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toEqual(expect.arrayContaining(['event-list', 'events-dashboard', 'event-detail']));
    expect(sent().some((x) => /event-create|task-add|task-toggle|vendor-add|event-update|event-delete|vendor-remove|task-delete/.test(x))).toBe(true);
  });

  it('event ops walks every tab and drives its macros', async () => {
    const view = render(<EventOps />);
    await settle();
    const tabs = ['Ticketing', 'Attendees', 'Floor Plan', 'Budget', 'Run of Show', 'Check-in', 'Blasts', 'Public Page', 'Production'];
    const skip = new RegExp(`^(${tabs.join('|').replace(/ /g, '\\s')})$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$`, 'i');
    for (const t of tabs) {
      await press(new RegExp(`^${t}$`));
      await settle();
      await exercise({ passes: 3, text: '25', skip });
      await settle();
      await exercise({ passes: 1, text: 'Summit kickoff', skip });
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['event-list', 'tier-list', 'registration-list', 'floor-plan', 'budget-summary', 'agenda-timeline', 'check-in-status', 'blast-list']));
    expect(a.filter((x) => /tier-create|register-attendee|table-add|budget-line-add|agenda-item-add|blast-send|publish-page|advanceSheet|techRiderMatch|settlementCalc|budgetReconcile|check-in|seat-assign/.test(x)).length).toBeGreaterThan(2);
  });

  it('ops creates an event and scans a ticket at check-in', async () => {
    render(<EventOps />);
    await settle();
    await press(/^\s*(New|Create|Add) event|^\s*\+/i);
    const name = screen.queryAllByRole('textbox').find((i) => /name|event/i.test((i as HTMLInputElement).placeholder || ''));
    if (name) fireEvent.change(name, { target: { value: 'Launch party' } });
    await press(/^(Create|Save)$/i);
    await press(/^Check-in$/);
    await settle();
    const code = screen.queryAllByRole('textbox').find((i) => /ticket|code|scan/i.test((i as HTMLInputElement).placeholder || ''));
    if (code) { fireEvent.change(code, { target: { value: 'TKT-1' } }); fireEvent.keyDown(code, { key: 'Enter' }); }
    await press(/Scan|Check in|Verify/i);
    expect(sent().some((x) => /event-create|check-in$/.test(x))).toBe(true);
  });

  it('natural events filter by category and status', async () => {
    const view = render(<NasaEarthEvents />);
    await settle();
    expect(view.container.textContent).toMatch(/Wildfire in OR/);
    const [cat, stat] = Array.from(view.container.querySelectorAll('select')) as HTMLSelectElement[];
    for (const c of ['wildfires', 'severeStorms', 'volcanoes', 'seaLakeIce', 'drought', 'floods', '']) { fireEvent.change(cat, { target: { value: c } }); await settle(); }
    for (const s of ['closed', 'all', 'open']) { fireEvent.change(stat, { target: { value: s } }); await settle(); }
    expect(publicLookup.mock.calls.length).toBeGreaterThan(2);
  });
});
