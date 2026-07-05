/**
 * Pins the /api/lens/run envelope-unwrap fix for SchemeBoard (findings 26-27).
 *
 * Pre-fix, refresh() read `a?.schemes` / `b?.schemes` off the top-level
 * transport response instead of `.result.schemes` (both `schemes.list_for_user`
 * and `schemes.list_against_user` return `{ ok, schemes }` as the macro
 * payload) — "Your schemes" and "Schemes against you" were always empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import SchemeBoard from '@/components/concordia/hud/SchemeBoard';

const MINE = {
  id: 'sch-1', kind: 'sabotage_decree', target_id: 'npc-orin',
  phase: 'gathering_evidence' as const, success_pct: 40, discovery_pct: 10,
  evidence_count: 1, accomplice_count: 0,
};

const AGAINST = {
  id: 'sch-2', kind: 'blackmail', plotter_id: 'npc-kael',
  phase: 'planning' as const, success_pct: 20, discovery_pct: 5,
  evidence_count: 0, accomplice_count: 1,
};

function envelope(macroPayload: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: macroPayload }),
  });
}

function fetchRouter() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) || '{}');
    if (body?.name === 'list_for_user') return envelope({ ok: true, schemes: [MINE] });
    if (body?.name === 'list_against_user') return envelope({ ok: true, schemes: [AGAINST] });
    return envelope({ ok: false, reason: 'unknown_macro' });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchRouter());
});

describe('SchemeBoard — envelope unwrap (findings 26-27)', () => {
  it('populates "Your schemes" from result.schemes (finding 26)', async () => {
    const { container } = render(<SchemeBoard open onClose={() => {}} />);
    await waitFor(() => expect(container.textContent).toMatch(/sabotage_decree/));
    expect(container.textContent).not.toMatch(/No active schemes\./);
  });

  it('populates "Schemes against you" from result.schemes (finding 27)', async () => {
    const { container } = render(<SchemeBoard open onClose={() => {}} />);
    await waitFor(() => expect(container.textContent).toMatch(/blackmail/));
    expect(container.textContent).not.toMatch(/None known\./);
  });

  it('renders nothing when closed', () => {
    const { container } = render(<SchemeBoard open={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });
});
