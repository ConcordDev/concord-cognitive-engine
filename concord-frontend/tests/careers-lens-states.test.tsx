/**
 * /lenses/careers — four-UX-state contract.
 *
 * Pins that the Careers lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('careers', …) → POST /api/lens/run), plus a11y (the track select +
 * skill slider carry accessible names; loading is role=status; error is
 * role=alert).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, exactly the shape server/domains/careers.js returns. The
 * headless LensShell is stubbed so the test stays on the page's state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell: render-only stub ────────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import CareersLens from '@/app/lenses/careers/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const TRACKS = [
  { id: 'chef', category: 'Culinary', activity: 'cook', branch: ['chef', 'mixologist'] },
  { id: 'smith', category: 'Industrial', activity: 'forge', branch: ['smith', 'engineer'] },
];
const CONTRACT = {
  id: 'ctr_abc', track_id: 'chef', tier: 3, role: 'Line Cook',
  base_wage_sparks: 40, status: 'active', employer_id: 'emp', worker_id: 'me',
};

beforeEach(() => { lensRun.mockReset(); });

describe('careers lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while tracks are in flight', async () => {
    // tracks never resolves → page stays in the loading state.
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'tracks') return new Promise(() => {});
      return reply({ ok: true, contracts: [] });
    });
    const { getByText, container } = render(<CareersLens />);
    await waitFor(() => expect(getByText(/Loading careers/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('DISABLED: shows the honest disabled-by-config note when the career system is off', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'tracks' ? reply({ ok: false, reason: 'disabled' }) : reply({ ok: true, contracts: [] }));
    const { getByText } = render(<CareersLens />);
    await waitFor(() => expect(getByText(/disabled on this server/i)).toBeInTheDocument());
  });

  it('EMPTY: shows the honest "no professions" CTA when tracks === 0', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'tracks' ? reply({ ok: true, tracks: [] }) : reply({ ok: true, contracts: [] }));
    const { getByText } = render(<CareersLens />);
    await waitFor(() => expect(getByText(/No professions available yet/i)).toBeInTheDocument());
  });

  it('ERROR: a failed tracks load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'tracks') {
        if (fail) return Promise.reject(new Error('network down'));
        return reply({ ok: true, tracks: TRACKS });
      }
      return reply({ ok: true, contracts: [] });
    });
    const { getByText, container } = render(<CareersLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/network down/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'tracks').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'tracks').length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Work a shift')).toBeInTheDocument());
  });

  it('a11y: the track select and skill slider carry accessible names', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'tracks' ? reply({ ok: true, tracks: TRACKS }) : reply({ ok: true, contracts: [] }));
    const { getByLabelText } = render(<CareersLens />);
    await waitFor(() => expect(getByLabelText('Profession track')).toBeInTheDocument());
    expect(getByLabelText(/skill/i)).toBeInTheDocument();
  });

  it('POPULATED: renders professions, contracts, and a real "work a shift" round-trip crediting sparks', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'tracks') return reply({ ok: true, tracks: TRACKS });
      if (name === 'contracts') return reply({ ok: true, contracts: [CONTRACT] });
      if (name === 'work') return reply({ ok: true, trackId: 'chef', tier: 5, performanceScore: 0.82, wage: 38, xp: 12, paid: true });
      return reply({ ok: true });
    });
    const { getByText, getAllByText } = render(<CareersLens />);
    await waitFor(() => expect(getByText('Work a shift')).toBeInTheDocument());

    // taxonomy + contract row from real macro data
    expect(getAllByText('chef').length).toBeGreaterThan(0);
    expect(getByText(/My contracts \(1\)/)).toBeInTheDocument();
    expect(getByText(/40 sparks · active/)).toBeInTheDocument();

    // play a shift → the work macro fires and the wage shows
    await act(async () => { fireEvent.click(getByText('Play shift')); });
    await waitFor(() => expect(getByText(/earned 38 sparks/i)).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[1] === 'work')).toBe(true);
  });

  it('POPULATED (empty contracts): shows the honest "no active contracts" hint', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'tracks' ? reply({ ok: true, tracks: TRACKS }) : reply({ ok: true, contracts: [] }));
    const { getByText } = render(<CareersLens />);
    await waitFor(() => expect(getByText(/No active contracts/i)).toBeInTheDocument());
  });
});
