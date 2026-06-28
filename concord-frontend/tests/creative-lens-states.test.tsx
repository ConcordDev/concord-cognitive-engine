/**
 * /lenses/creative — four-UX-state contract for the producer-bench calculator
 * surface (CreativeActionPanel).
 *
 * The panel's compute channel is `apiHelpers.lens.runDomain('creative', action,
 * { input })` → POST /api/lens/run. This test mocks ONLY that channel and drives
 * the four honest states:
 *   IDLE      — no result card rendered before any run.
 *   BUSY      — a spinner shows while the request is in flight (button disabled).
 *   ERROR     — a backend { ok:false } / a thrown fetch surfaces a role-bearing
 *               error message and does NOT silently render an empty result card.
 *   POPULATED — a real { ok:true, result } renders the EXACT fields the panel
 *               reads (totalShots / estimatedRuntime), with real values.
 *
 * Load-bearing wiring assertion: runDomain is invoked with domain 'creative' and
 * the single-wrap `{ artifact: { data } }` payload (a regression to a 2-key body
 * would defeat the dispatch peel and re-break the dist calculator).
 *
 * No fabricated data — every state is driven by the mocked runDomain in the exact
 * envelope shape the real backend returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { result: {} } })),
}));

// panel-polish: inert provider + hooks so the panel mounts without the pipe bus.
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { CreativeActionPanel } from '@/components/creative/CreativeActionPanel';

beforeEach(() => {
  runDomain.mockReset();
});

function typeScenes(container: HTMLElement, json: string) {
  // First textarea is "Scenes JSON".
  const ta = container.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: json } });
}

describe('creative producer bench — wiring', () => {
  it('drives runDomain on the creative domain with a single-wrap payload', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { shots: [], totalShots: 0, estimatedRuntime: 0, equipmentList: [] } } });
    const { container, getByText } = render(<CreativeActionPanel />);
    typeScenes(container, JSON.stringify({ type: 'video', scenes: [] }));
    await act(async () => { fireEvent.click(getByText('Shots')); });
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const [domain, action, payload] = runDomain.mock.calls[0];
    expect(domain).toBe('creative');
    expect(action).toBe('shotListGenerate');
    // single-wrap: input.artifact.data is the ONLY input key (no sibling that defeats the peel).
    const input = (payload as { input: Record<string, unknown> }).input;
    expect(Object.keys(input)).toEqual(['artifact']);
  });
});

describe('creative producer bench — four UX states', () => {
  it('IDLE: renders no result card before any run', () => {
    const { queryByText } = render(<CreativeActionPanel />);
    // The Shots result card header "Shots · ~Nmin" only appears with a result.
    expect(queryByText(/min$/i)).toBeNull();
  });

  it('BUSY: shows a spinner while the request is in flight', async () => {
    let resolveRun: (v: unknown) => void = () => {};
    runDomain.mockImplementation(() => new Promise((res) => { resolveRun = res; }));
    const { container, getByText } = render(<CreativeActionPanel />);
    typeScenes(container, JSON.stringify({ type: 'video', scenes: [{ type: 'wide', duration: 10 }] }));
    await act(async () => { fireEvent.click(getByText('Shots')); });
    // A spinner (animate-spin) is mounted while busy.
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeTruthy());
    await act(async () => { resolveRun({ data: { ok: true, result: { shots: [], totalShots: 0, estimatedRuntime: 0, equipmentList: [] } } }); });
  });

  it('ERROR: a backend { ok:false } surfaces a message and renders NO result card', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'shotlist offline' } });
    const { container, getByText, queryByText } = render(<CreativeActionPanel />);
    typeScenes(container, JSON.stringify({ type: 'video', scenes: [{ type: 'wide', duration: 10 }] }));
    await act(async () => { fireEvent.click(getByText('Shots')); });
    await waitFor(() => expect(getByText(/shotlist offline/i)).toBeInTheDocument());
    // swallowed-fetch guard: no empty result card silently shown.
    expect(queryByText(/equipment:/i)).toBeNull();
  });

  it('ERROR: a thrown fetch surfaces a message (not a silent empty)', async () => {
    runDomain.mockRejectedValue(new Error('network down'));
    const { container, getByText } = render(<CreativeActionPanel />);
    typeScenes(container, JSON.stringify({ type: 'video', scenes: [{ type: 'wide', duration: 10 }] }));
    await act(async () => { fireEvent.click(getByText('Shots')); });
    await waitFor(() => expect(getByText(/network down/i)).toBeInTheDocument());
  });

  it('POPULATED: renders the EXACT computed fields from a real envelope', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          shots: [{ shotNumber: 1, type: 'wide', duration: 90 }, { shotNumber: 2, type: 'close', duration: 30 }],
          totalShots: 2,
          estimatedRuntime: 2,
          equipmentList: ['tripod', 'gimbal'],
        },
      },
    });
    const { container, getByText, getAllByText } = render(<CreativeActionPanel />);
    typeScenes(container, JSON.stringify({ type: 'video', scenes: [{ type: 'wide', duration: 90 }, { type: 'close', duration: 30 }] }));
    await act(async () => { fireEvent.click(getByText('Shots')); });
    // EXACT rendered fields: totalShots (big number) + estimatedRuntime in the header.
    await waitFor(() => expect(getAllByText('2').length).toBeGreaterThan(0));
    expect(getByText(/Shots · ~2min/i)).toBeInTheDocument();
    expect(getByText(/tripod, gimbal/i)).toBeInTheDocument();
  });
});
