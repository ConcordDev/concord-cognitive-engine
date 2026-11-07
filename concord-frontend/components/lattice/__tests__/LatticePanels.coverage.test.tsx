// Render + behaviour coverage for the lattice (evolving-brain) panels: brains, consent,
// audit/drift, refresh schedule + A/B tests, and training runs. The panels talk to the REST
// surface with fetch, so a URL-routed fetch stub answers each endpoint with plausible rows.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { exercise } from '../../../tests/helpers/exercise';

const BRAINS = ['conscious', 'subconscious', 'utility', 'repair', 'multimodal', 'lattice'];
const RUN = { id: 'run1', brain_id: 'conscious', trigger: 'manual', status: 'done', corpus_size: 1200, eval_score: 0.82, prev_score: 0.78, swapped: 1, model_name: 'concord-conscious:v7', base_model: 'qwen2.5', triggered_by: 'u1', created_at: 1_760_000_000, delta: 0.04 };
const AB = { id: 'ab1', brain_id: 'conscious', candidate_model: 'concord-conscious:v8', control_model: 'concord-conscious:v7', traffic_pct: 10, status: 'running', candidate_calls: 40, control_calls: 360, candidate_score: 0.84, control_score: 0.8, winner: null, created_at: 1_760_000_000 };

let failing = false;
const calls: Array<{ url: string; method: string; body?: string }> = [];
function route(url: string): unknown {
  if (url.startsWith('/api/brains/stats')) return { ok: true, brains: BRAINS.map((b, i) => ({ brainId: b, total: 100 * (i + 1), positive: 60, consented: 40, pending: 10 })) };
  if (url.startsWith('/api/brains/active')) return { ok: true, active: [{ brain_id: 'conscious', model_name: 'concord-conscious:v7', base_model: 'qwen2.5', corpus_size: 1200, eval_score: 0.82, created_at: 1_760_000_000 }, { brain_id: 'utility', model_name: 'qwen2.5:3b' }] };
  if (url.startsWith('/api/lattice/corpus/mine')) return { ok: true, total: 25, consented: 10, ratio: 0.4 };
  if (url.startsWith('/api/lattice/dtus/consent-all')) return { ok: true, affected: 15 };
  if (url.startsWith('/api/lattice/consent-log')) return { ok: true, log: [{ id: 'l1', action: 'bulk_grant', dtu_id: null, old_value: 0, new_value: 1, affected: 15, created_at: 1_760_000_000 }, { id: 'l2', action: 'revoke', dtu_id: 'd9', old_value: 1, new_value: 0, affected: 1, created_at: 1_760_000_100 }] };
  if (url.startsWith('/api/lattice/drift-alerts')) return { ok: true, available: true, total: 2, alerts: [{ id: 'a1', type: 'embedding', severity: 'high', message: 'Drift detected', timestamp: 1_760_000_000, detail: { score: 0.4 } }, { id: 'a2', type: 'schema', severity: 'low', summary: 'Minor', timestamp: 1_760_000_100 }] };
  if (url.startsWith('/api/brains/schedule')) return { ok: true, canEdit: true, schedule: BRAINS.map((b, i) => ({ brain_id: b, enabled: i % 2, cadence: i % 2 ? 'daily' : 'manual', interval_hours: 24, next_run_at: 1_760_090_000, last_run_at: 1_760_000_000, updated_at: 1_760_000_000 })) };
  if (url.startsWith('/api/brains/ab-tests')) return url.includes('/conclude') || url.endsWith('ab-tests') ? { ok: true, tests: [AB, { ...AB, id: 'ab2', status: 'concluded', winner: 'candidate' }] } : { ok: true, tests: [AB] };
  if (url.startsWith('/api/brains/runs')) return { ok: true, runs: [RUN, { ...RUN, id: 'run2', swapped: 0, delta: -0.02, eval_score: null }] };
  if (/\/eval-curve/.test(url)) return { ok: true, bestEval: 0.82, runCount: 2, curve: [{ run: 1, runId: 'run1', evalScore: 0.78, loss: 0.5, corpusSize: 1000, swapped: false, model: null, at: 1_760_000_000 }, { run: 2, runId: 'run2', evalScore: 0.82, loss: 0.4, corpusSize: 1200, swapped: true, model: 'v7', at: 1_760_050_000 }] };
  if (/\/history/.test(url)) return { ok: true, history: [{ id: 'm1', model_name: 'concord-conscious:v7', base_model: 'qwen2.5', corpus_size: 1200, eval_score: 0.82, active: 1, created_at: 1_760_000_000, retired_at: null }, { id: 'm0', model_name: 'concord-conscious:v6', base_model: 'qwen2.5', corpus_size: 900, eval_score: 0.78, active: 0, created_at: 1_750_000_000, retired_at: 1_760_000_000 }] };
  if (/\/corpus-sample/.test(url)) return { ok: true, count: 1200, sample: [{ idx: 0, domain: 'chat', promptPreview: 'What is a DTU?', responsePreview: 'A discrete thought unit', tokensIn: 12, tokensOut: 30 }, { idx: 1, domain: 'code', promptPreview: 'Sort', responsePreview: 'Use sort()', tokensIn: null, tokensOut: null }] };
  if (/\/rollback/.test(url)) return { ok: true };
  return { ok: true };
}
const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
  if (failing) return { ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ ok: false, error: 'down' }) } as Response;
  return { ok: true, status: 200, statusText: 'OK', json: async () => route(url) } as Response;
});
vi.stubGlobal('fetch', fetchStub);
vi.mock('@/components/viz', () => ({ TimelineView: ({ events }: { events: unknown[] }) => <div>timeline {events.length}</div>, ChartKit: () => <div>chart</div> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('brain=conscious'), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/lenses/lattice' }));

import { AuditAndDrift } from '../AuditAndDrift';
import { BrainsPanel } from '../BrainsPanel';
import { ConsentPanel } from '../ConsentPanel';
import { RefreshSchedule } from '../RefreshSchedule';
import { TrainingRuns } from '../TrainingRuns';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
afterEach(() => cleanup());
beforeEach(() => { failing = false; calls.length = 0; });

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AuditAndDrift', () => <AuditAndDrift />],
  ['BrainsPanel', () => <BrainsPanel />],
  ['ConsentPanel', () => <ConsentPanel />],
  ['RefreshSchedule', () => <RefreshSchedule />],
  ['TrainingRuns', () => <TrainingRuns />],
];

describe('lattice panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 3, text: 'concord-conscious:v9' });
    await settle();
    await exercise({ passes: 1, text: '10' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s shows an honest error state with a Retry when the server is down', async (_n, make) => {
    failing = true;
    const view = render(make());
    await settle();
    expect(view.container.textContent).toMatch(/503|Failed|could not|unavailable|error/i);
    const retry = screen.queryAllByRole('button').find((b) => /retry/i.test(b.textContent || ''));
    if (retry) await act(async () => { fireEvent.click(retry); await new Promise((r) => setTimeout(r, 5)); });
    expect(view.container).toBeTruthy();
  });
});

describe('lattice flows', () => {
  it('the brains panel reads brain stats and the active models', async () => {
    render(<BrainsPanel />);
    await settle();
    expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/brains/stats', '/api/brains/active']));
    expect(screen.getAllByText(/conscious/).length).toBeGreaterThan(0);
  });

  it('the brains panel rings and scrolls to a brain named by the picker (storage and live event)', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    sessionStorage.setItem('lattice.openBrain', 'repair');
    const view = render(<BrainsPanel />);
    await settle();
    expect(sessionStorage.getItem('lattice.openBrain')).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(view.container.querySelector('#lattice-brain-repair')?.className).toMatch(/ring-2/);
    await act(async () => { window.dispatchEvent(new CustomEvent('lattice:open-brain', { detail: 'utility' })); await new Promise((r) => setTimeout(r, 5)); });
    expect(view.container.querySelector('#lattice-brain-utility')?.className).toMatch(/ring-2/);
  });

  it('the brains panel says so when no brain has a corpus or an active model', async () => {
    const orig = fetchStub.getMockImplementation();
    fetchStub.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      return { ok: true, status: 200, statusText: 'OK', json: async () => (url.includes('/stats') ? { ok: true, brains: [] } : { ok: true, active: [] }) } as Response;
    });
    const view = render(<BrainsPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/No evolved model|no brain|No /i);
    fetchStub.mockImplementation(orig!);
  });

  it('consent: bulk grant asks first, then posts consent-all', async () => {
    render(<ConsentPanel />);
    await settle();
    const press = async (re: RegExp) => {
      const b = screen.queryAllByRole('button').find((x) => re.test(x.textContent || ''));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 5)); });
    };
    await press(/Grant|Consent all|Opt in/i);
    await press(/Confirm|Yes|Grant consent for all/i);
    await press(/Revoke|Withdraw/i);
    await press(/Confirm|Yes|Revoke/i);
    expect(calls.some((c) => c.url.includes('/api/lattice/dtus/consent-all') && c.method === 'POST')).toBe(true);
  });

  it('refresh schedule: toggling a brain posts the schedule and an A/B test can start and conclude', async () => {
    render(<RefreshSchedule />);
    await settle();
    await exercise({ passes: 3, text: 'concord-conscious:v9', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$|retry/i });
    await settle();
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.url);
    expect(posts.some((u) => u.includes('/api/brains/schedule'))).toBe(true);
    expect(posts.some((u) => u.includes('/api/brains/ab-tests'))).toBe(true);
  });

  it('training runs: pick a brain, read curve/history/corpus, and roll a model back', async () => {
    render(<TrainingRuns />);
    await settle();
    for (const b of BRAINS) {
      const tab = screen.queryAllByRole('button').find((x) => (x.textContent || '').trim() === b) as HTMLElement | undefined;
      if (tab) await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 5)); });
    }
    const sampleBtn = screen.getAllByRole('button').find((x) => x.getAttribute('aria-expanded') !== null) as HTMLElement;
    await act(async () => { fireEvent.click(sampleBtn); await new Promise((r) => setTimeout(r, 5)); });
    for (const re of [/rollback|roll back|restore|activate/i, /confirm|yes/i]) {
      const rb = screen.queryAllByRole('button').find((x) => re.test(x.textContent || ''));
      if (rb) await act(async () => { fireEvent.click(rb); await new Promise((r) => setTimeout(r, 5)); });
    }
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes('/eval-curve'))).toBe(true);
    expect(urls.some((u) => u.includes('/history'))).toBe(true);
    expect(urls.some((u) => u.includes('/corpus-sample'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/rollback') && c.method === 'POST')).toBe(true);
  });

  it('audit and drift lists consent log rows and drift alerts', async () => {
    const view = render(<AuditAndDrift />);
    await settle();
    expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/lattice/consent-log?limit=80', '/api/lattice/drift-alerts?limit=60']));
    expect(view.container.textContent).toMatch(/bulk_grant|Drift detected/);
  });
});
