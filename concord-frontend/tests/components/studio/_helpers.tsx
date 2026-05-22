/**
 * Shared test helpers for the studio lens component tests.
 *
 * Studio panels call `lensRun` from `@/lib/api/client`; the audio-heavy
 * components import `@/lib/daw/engine` (Web Audio) and `@/lib/daw/dtu-hooks`
 * (DTU emit side-effects). jsdom has no Web Audio, so tests mock those
 * modules at the file level (see each test file's `vi.mock` calls).
 */
import React from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

/** lensRun envelope: an axios-shaped `{ data: { ok, result, error } }`. */
export function okResult<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}
export function errResult(error = 'lens error') {
  return { data: { ok: false, result: null, error } };
}

/** Render an element wrapped in a fresh QueryClientProvider. */
export function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** A `vi.mock` factory for lucide-react that turns every icon into a span. */
export async function lucideMockFactory(importOriginal: () => Promise<Record<string, unknown>>) {
  const ReactMod = await import('react');
  const actual = await importOriginal();
  const make = (name: string) => {
    const Icon = ReactMod.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactMod.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
}

/** Build a deferred-resolution lensRun mock controlled per-call by a queue. */
export function makeLensRunMock() {
  return vi.fn();
}
