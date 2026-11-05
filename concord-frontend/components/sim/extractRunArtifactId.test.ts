// concord-frontend/components/sim/extractRunArtifactId.test.ts
//
// Pins the F3 fix (sim.md canonical review): `extractRunArtifactId` is the
// exact extraction logic handleRunSimulation uses to turn
// useLensData('sim','run').create()'s return value into the id every
// following updateRunArtifact(...) call targets. Before the fix, the code
// read `.id` directly off the raw `{ ok, artifact }` POST /api/lens/:domain
// envelope (always undefined) and silently fell back to a client-only id
// that was never persisted server-side — so every update 404'd "not found"
// against the real server-assigned artifact id: progress ticks were
// swallowed silently (stuck at "running"/0%), the terminal update threw into
// the catch block (the user-facing "not found" toast), and
// results/sensitivity/comparison-checkbox/CSV-export all read from the real
// artifact that had never received any of it.

import { describe, it, expect } from 'vitest';
import { extractRunArtifactId } from './SimConsole';

describe('extractRunArtifactId', () => {
  it('reads the real server-assigned id from the create() envelope', () => {
    const created = { ok: true, artifact: { id: 'lart_real_server_id' } };
    expect(extractRunArtifactId(created, 'client-fallback-id')).toBe('lart_real_server_id');
  });

  it('falls back to the client id only when the envelope has no artifact (e.g. create failed)', () => {
    expect(extractRunArtifactId({ ok: false }, 'client-fallback-id')).toBe('client-fallback-id');
    expect(extractRunArtifactId(undefined, 'client-fallback-id')).toBe('client-fallback-id');
  });

  it('regression guard: reading .id directly off the envelope (the pre-fix bug) would always be undefined', () => {
    const created = { ok: true, artifact: { id: 'lart_real_server_id' } };
    // The exact mistake the fix corrects — proves the two are NOT equivalent.
    expect((created as { id?: string }).id).toBeUndefined();
    expect(extractRunArtifactId(created, 'client-fallback-id')).not.toBe('client-fallback-id');
  });
});
