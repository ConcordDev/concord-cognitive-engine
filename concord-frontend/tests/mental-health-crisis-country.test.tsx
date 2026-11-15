/**
 * FIX-mental-health-005 exercise pin — the Crisis panel's country switch.
 *
 * The ticket: switching the country selector (US → UK) keeps showing the
 * US 988 line — "the crisis-hotlines country param is not wired". This pin
 * drives the real CrisisPanel with a backend mock in exactly the shapes
 * the real chain produces (server/domains/mentalhealth.js returns
 * { ok, result: { country, available, hotlines: { primary, … } } }, the
 * HTTP shaper peels one envelope, the panel's callMacro unwraps), clicks
 * UK, and expects the UK set (Samaritans 116 123) to REPLACE the US set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: null } })),
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, prop: string) => (props: Record<string, unknown>) =>
      React.createElement(prop === 'div' ? 'div' : 'div', props, (props as { children?: React.ReactNode }).children),
  }),
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

import { CrisisPanel } from '@/components/mental-health/CrisisPanel';

const SETS: Record<string, unknown> = {
  US: {
    country: 'US', available: true,
    hotlines: { primary: { name: '988 Suicide and Crisis Lifeline', phone: '988', availability: '24/7' } },
  },
  UK: {
    country: 'UK', available: true,
    hotlines: { primary: { name: 'Samaritans', phone: '116 123', availability: '24/7' } },
  },
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrisisPanel />
    </QueryClientProvider>,
  );
}

describe('FIX-mental-health-005 — crisis country switch', () => {
  beforeEach(() => {
    runDomain.mockReset();
    runDomain.mockImplementation(async (_domain: string, action: string, arg: { input?: { country?: string } }) => {
      if (action !== 'crisis-hotlines') throw new Error(`unexpected action ${action}`);
      const set = SETS[arg?.input?.country || 'US'] || SETS.US;
      return { data: { ok: true, result: set } };
    });
  });

  it('switching US → UK replaces the hotline set with the UK set', async () => {
    renderPanel();
    // US set lands first.
    expect(await screen.findByText(/988 Suicide and Crisis Lifeline/)).toBeTruthy();
    // Switch to UK.
    fireEvent.click(screen.getByRole('button', { name: 'UK' }));
    // The UK set replaces it — Samaritans appears, the 988 line is gone.
    expect(await screen.findByText(/Samaritans/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/988 Suicide and Crisis Lifeline/)).toBeNull());
    expect(screen.getByText(/116 123/)).toBeTruthy();
    // And the backend was actually asked for the UK, in the panel's { input } wrap.
    expect(runDomain.mock.calls.some((c) => c[1] === 'crisis-hotlines' && c[2]?.input?.country === 'UK')).toBe(true);
  });
});
