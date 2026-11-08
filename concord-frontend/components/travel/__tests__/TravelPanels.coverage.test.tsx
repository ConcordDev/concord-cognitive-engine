// Render + behaviour coverage for the travel lens panels: National Parks, trip planner (country,
// visa and currency), and Zippopotam postal lookup.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const COUNTRY = { name: 'Japan', officialName: 'Japan', iso2: 'JP', iso3: 'JPN', capital: 'Tokyo', region: 'Asia', subregion: 'Eastern Asia', population: 125000000, areaKm2: 377930, currencies: [{ code: 'JPY', name: 'Yen', symbol: '¥' }], languages: ['Japanese'], timezones: ['UTC+09:00'], callingCode: '+81', drivingSide: 'left', flag: '🇯🇵' };

function resultFor(action: string, name?: string): unknown {
  switch (name || action) {
    case 'live_nps_parks': return { parks: [{ parkCode: 'yose', name: 'Yosemite National Park', states: 'CA', designation: 'National Park', description: 'Granite cliffs', url: 'https://nps.gov/yose', latitude: '37.8', longitude: '-119.5' }, { parkCode: 'grca', name: 'Grand Canyon', states: 'AZ', designation: 'National Park', description: '', url: 'https://nps.gov/grca' }], total: 2 };
    case 'live_zippopotam': case 'zippopotam': return { places: [{ placeName: 'Beverly Hills', latitude: 34.09, longitude: -118.41, state: 'California', stateAbbrev: 'CA' }], postalCode: '90210', country: 'United States' };
    case 'country-info': return COUNTRY;
    case 'visaCheck': return { arrangement: 'visa-free', visaRequired: false, maxFreeStay: '90 days', note: 'Tourist stays' };
    case 'currency-convert': case 'convert': return { from: 'USD', to: 'JPY', amount: 100, rate: 150.2, converted: 15020, date: '2026-03-02' };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ParksPanel } from '../ParksPanel';
import { TripPlannerPanel } from '../TripPlannerPanel';
import { ZippopotamPanel } from '../ZippopotamPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => { const o = a[0] as { name?: string } | string; return { data: { ok: true, result: resultFor(actionOf(a), typeof o === 'object' ? o.name : undefined) } }; });
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['ParksPanel', () => <ParksPanel />],
  ['TripPlannerPanel', () => <TripPlannerPanel />],
  ['ZippopotamPanel', () => <ZippopotamPanel domain="travel" />],
];

describe('travel panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 3, text: 'Japan' });
    await settle();
    await exercise({ passes: 1, text: '90210' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', reason: 'fetch_failed' } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('travel flows', () => {
  it('parks list by state, refresh, and explain a missing API key and an empty state', async () => {
    const view = render(<ParksPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/Yosemite/);
    const sel = view.container.querySelector('select') as HTMLSelectElement | null;
    if (sel) fireEvent.change(sel, { target: { value: 'AZ' } });
    await press(/Refresh|Load|Go/i);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, reason: 'missing_api_key', envVar: 'NPS_API_KEY', signupUrl: 'https://nps.gov/api' } }));
    const key = render(<ParksPanel />);
    await settle();
    expect(key.container.textContent).toMatch(/NPS_API_KEY|key/i);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { parks: [], total: 0 } } }));
    const empty = render(<ParksPanel />);
    await settle();
    expect(empty.container.textContent).toMatch(/No parks/);
  });

  it('the trip planner needs a destination, then resolves country, visa and currency', async () => {
    render(<TripPlannerPanel />);
    await settle();
    await press(/Plan|Look ?up|Search|Go/i);
    expect(document.body.textContent?.length).toBeGreaterThan(20);
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(boxes[0], { target: { value: 'Japan' } });
    if (boxes[1]) fireEvent.change(boxes[1], { target: { value: 'US' } });
    for (const n of screen.queryAllByRole('spinbutton') as HTMLInputElement[]) fireEvent.change(n, { target: { value: '14' } });
    await press(/Plan|Look ?up|Search|Go/i);
    await settle();
    expect(document.body.textContent).toMatch(/Tokyo|Japan/);
    expect(runDomain.mock.calls.map((c) => String(c[1]))).toEqual(expect.arrayContaining(['country-info']));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'country lookup failed' } }));
    await press(/Plan|Look ?up|Search|Go/i);
    await settle();
    expect(document.body.textContent).toMatch(/failed|lookup/i);
  });

  it('postal lookup resolves places for a country and reports a miss', async () => {
    const view = render(<ZippopotamPanel domain="travel" />);
    await settle();
    const sel = view.container.querySelector('select') as HTMLSelectElement | null;
    if (sel) fireEvent.change(sel, { target: { value: 'ca' } });
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '90210' } });
    await press(/Look ?up|Search|Go|Find/i);
    await settle();
    expect(view.container.textContent).toMatch(/Beverly Hills|90210/);
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'fetch_failed' } }));
    await press(/Look ?up|Search|Go|Find/i);
    await settle();
    expect(view.container.textContent).toMatch(/No match|unreachable|failed/i);
  });
});
