/**
 * SyncAnalysisPanel — "Analyze local store" reports the store's real
 * conflict state (FIX-offline-003).
 *
 * The panel used to fabricate a second replica holding a "simulated
 * concurrent edit" of every local doc (an altered body at a later
 * timestamp), so the syncConflict math reported a conflict on every
 * key — 100% rate, HIGH, "LWW: replica B wins" — on a store that holds
 * exactly one copy of each document. These pins drive the real panel
 * against the REAL offline.syncConflict macro (imported from the
 * server domain): a single unsynced doc analyzes to 0 conflicts, and
 * the request the panel sends carries exactly one replica — the local
 * docs as stored, at their real timestamps.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

// The real server macro, captured through its registrar.
import registerOfflineActions from '../../server/domains/offline.js';

const serverActions: Record<string, (ctx: unknown, artifact: unknown, params: never) => unknown> = {};
registerOfflineActions((domain: string, name: string, fn: never) => {
  serverActions[`${domain}.${name}`] = fn as never;
});

const lensRun = vi.fn(async (domain: string, action: string, input: Record<string, unknown>) => {
  const fn = serverActions[`${domain}.${action}`];
  if (!fn) return { data: { ok: false, error: `no macro ${domain}.${action}` } };
  const out = fn({ userId: 'u1', actor: { userId: 'u1' } }, { data: input }, input as never) as { ok: boolean; result?: unknown; error?: string };
  return { data: out };
});
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

const DOCS = [
  { id: 'doc-1', body: { title: 'Field notes', n: 1 }, rev: null, baseRev: null, updatedAt: '2026-11-13T10:00:00.000Z', dirty: true, deleted: false, deviceId: null },
];
vi.mock('@/components/offline/local-store', () => ({ allDocs: async () => DOCS }));

import { SyncAnalysisPanel } from '@/components/offline/SyncAnalysisPanel';

async function until(pred: () => boolean, ms = 2500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => { lensRun.mockClear(); });
afterEach(() => { cleanup(); });

describe('offline conflict analysis (FIX-offline-003)', () => {
  it('a single unsynced doc analyzes to 0 conflicts — no fabricated replica', async () => {
    render(<SyncAnalysisPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Analyze local store/ }));
    await until(() => screen.queryByText(/Need at least 2 replicas/) != null);

    // The honest outcome is presented with the store's real counts.
    expect(screen.getByText(/no divergent second copy to conflict with/)).toBeInTheDocument();
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getByText('Conflict rate')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText(/replica B wins/i)).not.toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();

    // The request carried exactly ONE replica: the doc as stored.
    const call = lensRun.mock.calls.find((c) => c[1] === 'syncConflict');
    expect(call).toBeTruthy();
    const input = call![2] as { replicas: { replicaId: string; state: Record<string, { value: unknown; timestamp: number; vectorClock?: unknown }> }[] };
    expect(input.replicas).toHaveLength(1);
    expect(input.replicas[0].replicaId).toBe('local');
    const entry = input.replicas[0].state['doc-1'];
    expect(entry.value).toEqual({ title: 'Field notes', n: 1 });
    expect(entry.timestamp).toBe(Date.parse('2026-11-13T10:00:00.000Z'));
    expect(entry.vectorClock).toBeUndefined();
  });
});
