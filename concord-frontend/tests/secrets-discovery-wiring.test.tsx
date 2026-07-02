/**
 * SecretsDiscovery — H3 wiring: the journal's npc-secret entries are backed by
 * the REAL `secrets` substrate (macros secrets.list_discovered /
 * secrets.discover — the same channel SecretsCodex uses).
 *
 * Pins:
 *   1. HYDRATION — on mount (entered + authenticated) the journal loads from
 *      secrets.list_discovered {includeBody:true}, mapping real row fields
 *      only (id → sec_<id>, discovered_at seconds → ms, body → description).
 *   2. GUARD — no `concord_entered` flag → zero backend calls (anon-safe);
 *      failed hydration → empty journal, nothing fabricated.
 *   3. PERSIST — checkDiscovery('npc-secret') with a REAL backend secretId
 *      fires secrets.discover {secretId, via} (fire-and-forget, idempotent).
 *   4. HONESTY — other discovery types (easter-egg, etc.) and npc-secret
 *      WITHOUT a secretId never call the macro: they have no server
 *      substrate and stay session-only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import SecretsDiscovery, { useDiscovery } from '@/components/world-lens/SecretsDiscovery';

type DiscoveryAPI = ReturnType<typeof useDiscovery>;

function makeProbe() {
  const ref: { api: DiscoveryAPI | null } = { api: null };
  function Probe() {
    ref.api = useDiscovery();
    return null;
  }
  return { ref, Probe };
}

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

/** Default channel: authenticated user, empty discovered-secrets list. */
function baseLensRun(domain: string, action: string): Promise<unknown> {
  if (domain === 'auth' && action === 'whoami') return ok({ userId: 'u1' });
  if (domain === 'secrets' && action === 'list_discovered') return ok({ ok: true, secrets: [] });
  if (domain === 'secrets' && action === 'discover') return ok({ ok: true, action: 'discovered' });
  return ok({});
}

function discoverCalls() {
  return lensRun.mock.calls.filter((c) => c[0] === 'secrets' && c[1] === 'discover');
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(baseLensRun);
  window.localStorage.clear();
  window.localStorage.setItem('concord_entered', '1');
});

describe('SecretsDiscovery — hydration from the real secrets substrate', () => {
  it('hydrates the journal from secrets.list_discovered, mapping real row fields only', async () => {
    lensRun.mockImplementation((domain: string, action: string, input?: Record<string, unknown>) => {
      if (domain === 'secrets' && action === 'list_discovered') {
        expect(input).toMatchObject({ includeBody: true });
        return ok({
          ok: true,
          secrets: [{
            id: 's1',
            holder_npc_id: 'npc_kael',
            subject_kind: 'npc',
            subject_id: 'npc_orin',
            kind: 'debt',
            body: 'Kael owes the Masons a blood debt.',
            discovered_at: 1750000000, // unix SECONDS
            via: 'surveillance',
            weaponised_at: null,
          }],
        });
      }
      return baseLensRun(domain, action);
    });

    const { ref, Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);

    await waitFor(() => expect(ref.api!.getJournal().length).toBe(1));
    const entry = ref.api!.getJournal()[0];
    expect(entry.discovery.id).toBe('sec_s1');
    expect(entry.discovery.type).toBe('npc-secret');
    expect(entry.discovery.description).toBe('Kael owes the Masons a blood debt.'); // real body, verbatim
    expect(entry.discovery.title).toContain('npc_kael');            // real holder, no invented name
    expect(entry.timestamp).toBe(1750000000 * 1000);                // real discovered_at, seconds → ms
    expect(entry.discovery.discoveredAt).toBe(new Date(1750000000 * 1000).toISOString());
    expect(entry.discovery.rewards).toEqual([]);                    // no reward substrate — never fabricated
  });

  it('GUARD: makes NO backend calls before the user has entered (no concord_entered)', async () => {
    window.localStorage.removeItem('concord_entered');
    const { Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);
    await new Promise((r) => setTimeout(r, 20));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('failed hydration → empty journal, nothing fabricated', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'secrets' && action === 'list_discovered') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'no_db' } });
      }
      return baseLensRun(domain, action);
    });
    const { ref, Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[0] === 'secrets' && c[1] === 'list_discovered')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(ref.api!.getJournal()).toEqual([]);
  });
});

describe('SecretsDiscovery — npc-secret persistence via secrets.discover', () => {
  it('persists an npc-secret carrying a REAL backend secretId (fire-and-forget, via passthrough)', async () => {
    const { ref, Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);
    await waitFor(() => expect(ref.api).toBeTruthy());

    let result: ReturnType<DiscoveryAPI['checkDiscovery']> = null;
    act(() => {
      result = ref.api!.checkDiscovery({
        type: 'npc-secret',
        data: {
          secretId: 's9',
          npcId: 'npc_kael',
          npcName: 'Kael',
          secret: 'The ledger in the cellar is forged.',
          via: 'surveillance_roll',
        },
      });
    });

    expect(result).toBeTruthy();
    expect(result!.id).toBe('sec_s9'); // matches hydration ids → reload dedupes
    expect(result!.description).toBe('The ledger in the cellar is forged.'); // server-shipped content only
    await waitFor(() => expect(discoverCalls().length).toBe(1));
    expect(discoverCalls()[0][2]).toEqual({ secretId: 's9', via: 'surveillance_roll' });

    // Journalled once, deduped against a later hydration of the same id.
    expect(ref.api!.getJournal().some((e) => e.discovery.id === 'sec_s9')).toBe(true);
  });

  it('defaults via to "dialogue" when the payload has none', async () => {
    const { ref, Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);
    await waitFor(() => expect(ref.api).toBeTruthy());

    act(() => {
      ref.api!.checkDiscovery({ type: 'npc-secret', data: { secretId: 's10', npcName: 'Orin' } });
    });
    await waitFor(() => expect(discoverCalls().length).toBe(1));
    expect(discoverCalls()[0][2]).toEqual({ secretId: 's10', via: 'dialogue' });
  });

  it('does NOT call the macro for non-npc-secret types (no substrate — session-only)', async () => {
    const { ref, Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);
    await waitFor(() => expect(ref.api).toBeTruthy());

    act(() => {
      ref.api!.checkDiscovery({ type: 'easter-egg', data: { eggId: 'e1', title: 'Hidden mural' } });
      ref.api!.checkDiscovery({
        type: 'terrain-feature',
        data: { cellId: 'F-7-3', district: 'forge' },
      });
      ref.api!.checkDiscovery({
        type: 'perfect-validation',
        data: { buildingId: 'b1', categories: { a: { score: 0.99 } } },
      });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(discoverCalls().length).toBe(0);
  });

  it('does NOT call the macro for an npc-secret without a backend secretId (legacy session path)', async () => {
    const { ref, Probe } = makeProbe();
    render(<SecretsDiscovery><Probe /></SecretsDiscovery>);
    await waitFor(() => expect(ref.api).toBeTruthy());

    act(() => {
      // Legacy demo-DB npc — no `secrets`-table row backs it, so nothing persists.
      ref.api!.checkDiscovery({ type: 'npc-secret', data: { npcId: 'npc-forge-master' } });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(discoverCalls().length).toBe(0);
  });
});
