import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LiveBuild, LiveBuildStream } from './LiveBuild';
import { liveReducer, LIVE_INITIAL, latestSnapshot, liveStreamUrl, type LiveEvent } from '@/lib/conkay/live-api';

vi.mock('next/dynamic', () => ({ default: () => (props: { url: string }) => <div data-testid="stl" data-url={props.url} /> }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

/** The recorded electric-car run (server/lib/conkay/showcase/live/ev-180.json), trimmed to what the page reads. */
const EVENTS: LiveEvent[] = [
  { id: 1, type: 'start', initialState: { brief: 'Design a car that can go 180 mph, seats 4 people.', fuelType: 'electric', tailExtensionM: 0.22 } },
  { id: 2, type: 'evaluated', label: 'initial design', failingChecks: ['requirement.check@REQ_topSpeed', 'vehicle.acceptance@VEH'], envelopes: { PASS: 137, FAIL: 4 }, snapshot: { kind: 'stl', file: '9887766c0116.stl', sha256: '9887766c0116f602', triangles: 15546 } },
  {
    id: 3, type: 'iteration', iteration: 1, failingChecks: ['requirement.check@REQ_topSpeed'],
    candidates: [
      { rule: 'top-speed.next-drive-unit', variable: 'motorId', value: 'motor.cascadia.im-375-dz', label: 'drive unit motor.cascadia.im-225-dz -> motor.cascadia.im-375-dz', gain: 0.169251, dMassKg: 9.4, perKg: 0.018, fixes: ['requirement.check@REQ_topSpeed'], regressions: [] },
      { rule: 'aero.rear-slant.tail-length', variable: 'tailExtensionM', value: 0.32, label: 'tail 0.22 m -> 0.32 m', gain: 0.123591, dMassKg: 1.9, perKg: 0.065, fixes: [], regressions: [] },
    ],
    change: { rule: 'top-speed.next-drive-unit', variable: 'motorId', value: 'motor.cascadia.im-375-dz', label: 'drive unit motor.cascadia.im-225-dz -> motor.cascadia.im-375-dz', reason: 'clears requirement.check@REQ_topSpeed with no new failure (9.4 kg)' },
    rerunNodes: ['a', 'b', 'c'], envelopes: { PASS: 141, WARN: 12 }, snapshot: { kind: 'stl', file: 'b90b1f523394.stl', sha256: 'b90b1f523394da89', triangles: 15396 },
  },
  { id: 4, type: 'done', outcome: { kind: 'all-pass', warnings: ['package.tub-fit@VEH', 'vehicle.traction-battery@VEH'] }, receiptSha256: '5f5ce815011faf5c', snapshot: { kind: 'stl', file: 'b90b1f523394.stl', sha256: 'b90b1f523394da89', triangles: 15396 } },
];

class MockEventSource {
  static last: MockEventSource | null = null;
  url: string; readyState = 0; closed = false; onerror: (() => void) | null = null;
  listeners = new Map<string, ((m: { data: string }) => void)[]>();
  constructor(url: string) { this.url = url; MockEventSource.last = this; }
  addEventListener(t: string, fn: (m: { data: string }) => void) { this.listeners.set(t, [...(this.listeners.get(t) || []), fn]); }
  emit(e: LiveEvent) { for (const fn of this.listeners.get(e.type) || []) fn({ data: JSON.stringify(e) }); }
  close() { this.closed = true; this.readyState = 2; }
}

describe('live-api reducer', () => {
  it('keeps events once, in id order; a replayed id after a reconnect is dropped', () => {
    let s = LIVE_INITIAL;
    for (const e of [EVENTS[0], EVENTS[1], EVENTS[1], EVENTS[2]]) s = liveReducer(s, e);
    expect(s.events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(s.done).toBe(false);
    s = liveReducer(s, EVENTS[3]);
    expect(s.done).toBe(true);
    expect(latestSnapshot(s.events)?.file).toBe('b90b1f523394.stl');
    expect(liveStreamUrl('ev-180')).toBe('/api/conkay/demo/designs/ev-180/live');
  });
});

describe('LiveBuild', () => {
  beforeEach(() => { (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource; });
  afterEach(() => { delete (globalThis as unknown as { EventSource?: unknown }).EventSource; });

  it('shows every iteration in order: what failed, the candidates with margins, what changed and why, the outcome', () => {
    render(<LiveBuild id="ev-180" />);
    const es = MockEventSource.last!;
    expect(es.url).toBe('/api/conkay/demo/designs/ev-180/live');
    act(() => { for (const e of EVENTS) es.emit(e); });
    const steps = screen.getByTestId('live-timeline').querySelectorAll('[data-testid^="live-step-"], [data-testid="live-outcome"]');
    expect([...steps].map((n) => n.getAttribute('data-testid'))).toEqual(['live-step-2', 'live-step-3', 'live-outcome']);
    expect(screen.getByTestId('live-brief').textContent).toMatch(/180 mph/);
    const rows = screen.getByTestId('live-candidates').querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toMatch(/▸ drive unit/);
    expect(rows[0].textContent).toMatch(/0\.169/);
    expect(rows[1].textContent).toMatch(/improves/);
    expect(screen.getByTestId('live-change').textContent).toMatch(/clears requirement\.check@REQ_topSpeed/);
    expect(screen.getByTestId('live-outcome').textContent).toMatch(/Every check passes/);
    expect(screen.getByTestId('live-outcome').textContent).toMatch(/vehicle\.traction-battery@VEH/);
    expect(screen.getByTestId('live-receipt').textContent).toMatch(/5f5ce815/);
    expect(screen.getByTestId('stl').getAttribute('data-url')).toBe('/api/conkay/demo/designs/ev-180/live/files/b90b1f523394.stl');
    expect(screen.getByTestId('live-conn').textContent).toMatch(/Complete/);
    expect(es.closed).toBe(true);
  });

  it('a dropped connection says it is reconnecting, and the resumed stream does not repeat a step', () => {
    render(<LiveBuild id="ev-180" />);
    const es = MockEventSource.last!;
    act(() => { es.emit(EVENTS[0]); es.emit(EVENTS[1]); });
    act(() => { es.readyState = 0; es.onerror?.(); });
    expect(screen.getByTestId('live-conn').textContent).toMatch(/Reconnecting/);
    // the browser reconnects with Last-Event-ID; a server may resend the last event
    act(() => { es.emit(EVENTS[1]); es.emit(EVENTS[2]); es.emit(EVENTS[3]); });
    expect(screen.getAllByTestId('live-step-2').length).toBe(1);
    expect(screen.getByTestId('live-outcome')).toBeTruthy();
  });

  it('an unknown run says so', () => {
    render(<LiveBuild id="nope" />);
    const es = MockEventSource.last!;
    act(() => { es.readyState = 2; es.onerror?.(); });
    expect(screen.getByRole('alert').textContent).toMatch(/No live run/);
  });
});

describe('LiveBuildStream embedded (hideViewer)', () => {
  beforeEach(() => { (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource; });
  afterEach(() => { delete (globalThis as unknown as { EventSource?: unknown }).EventSource; });

  it('hideViewer drops the side-panel body: an embedding page draws the body once', () => {
    render(<LiveBuildStream id="ev-180" hideViewer />);
    const es = MockEventSource.last!;
    act(() => { for (const e of EVENTS) es.emit(e); });
    // the timeline still streams...
    expect(screen.getByTestId('live-timeline')).toBeTruthy();
    expect(screen.getByTestId('live-step-3')).toBeTruthy();
    expect(screen.getByTestId('live-outcome').textContent).toMatch(/Every check passes/);
    // ...but no viewer of its own: no StlViewer, no snapshot caption
    expect(screen.queryByTestId('stl')).toBeNull();
    expect(screen.queryByTestId('live-snapshot')).toBeNull();
  });

  it('without hideViewer the stream keeps its side-panel viewer (the standalone page)', () => {
    render(<LiveBuildStream id="ev-180" />);
    const es = MockEventSource.last!;
    act(() => { for (const e of EVENTS) es.emit(e); });
    expect(screen.getByTestId('stl').getAttribute('data-url')).toBe('/api/conkay/demo/designs/ev-180/live/files/b90b1f523394.stl');
    expect(screen.getByTestId('live-snapshot').textContent).toMatch(/15396 triangles/);
  });
});
