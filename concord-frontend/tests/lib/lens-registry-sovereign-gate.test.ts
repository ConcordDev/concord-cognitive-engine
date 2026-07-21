// Stability audit (2026-07-20) — "make sure no one sees the sovereign
// lenses" fix. `isLensVisible()` previously was a stub hardcoded to
// always return `true` ("Every lens is visible to all authenticated
// users. No exceptions.") despite its own doc comment — and its two real
// callers' — claiming it filtered by role. `SOVEREIGN_LENSES` was also
// an intentionally-emptied `[]`. This file pins the real implementation:
// `SOVEREIGN_LENSES` now lists `admin`/`command-center` (mirroring the
// `Sovereign` sidebar category), `isLensVisible` gates on
// `role === 'admin' || role === 'sovereign'` for those two lens ids and
// is a pass-through for every other lens, and both real consumers
// (`getExtensionsByCategory`, `getCommandPaletteLenses`) correctly hide
// the two sovereign lenses for a non-admin/sovereign viewer while
// leaving every other lens's expertise-only gating untouched.
//
// This is a SEPARATE axis from `lens-registry-sanctum-gate.test.ts`'s
// expertise-level gate (debug/admin/ops-telemetry/repair-telemetry/
// foundry/world-creator, gated by `viewerExpertise`) — `admin` happens to
// be gated on BOTH axes (Sanctum-tier by expertise AND sovereign by
// role), `command-center` only on the role axis.

import { describe, it, expect } from 'vitest';
import {
  SOVEREIGN_LENSES,
  isLensVisible,
  getExtensionsByCategory,
  getCommandPaletteLenses,
  toLensConfig,
  getLensById,
} from '@/lib/lens-registry';

describe('SOVEREIGN_LENSES', () => {
  it('lists exactly admin and command-center', () => {
    expect([...SOVEREIGN_LENSES].sort()).toEqual(['admin', 'command-center']);
  });
});

describe('isLensVisible', () => {
  it('hides both sovereign lenses from a plain "user" role', () => {
    expect(isLensVisible('admin', 'user')).toBe(false);
    expect(isLensVisible('command-center', 'user')).toBe(false);
  });

  it('hides both sovereign lenses from member/spectator roles', () => {
    for (const role of ['member', 'spectator', '', undefined as unknown as string]) {
      expect(isLensVisible('admin', role)).toBe(false);
      expect(isLensVisible('command-center', role)).toBe(false);
    }
  });

  it('shows both sovereign lenses to an admin role', () => {
    expect(isLensVisible('admin', 'admin')).toBe(true);
    expect(isLensVisible('command-center', 'admin')).toBe(true);
  });

  it('shows both sovereign lenses to a sovereign role', () => {
    expect(isLensVisible('admin', 'sovereign')).toBe(true);
    expect(isLensVisible('command-center', 'sovereign')).toBe(true);
  });

  it('every non-sovereign lens is visible regardless of role (no accidental over-gating)', () => {
    const sample = ['chat', 'inventory', 'crafting', 'music', 'research', 'code'];
    for (const id of sample) {
      expect(isLensVisible(id, 'user')).toBe(true);
      expect(isLensVisible(id, 'spectator')).toBe(true);
      expect(isLensVisible(id, 'admin')).toBe(true);
    }
  });
});

describe('toLensConfig — sovereignOnly flag', () => {
  it('flags admin and command-center as sovereignOnly', () => {
    const adminEntry = getLensById('admin');
    const ccEntry = getLensById('command-center');
    expect(adminEntry).toBeTruthy();
    expect(ccEntry).toBeTruthy();
    expect(toLensConfig(adminEntry!).sovereignOnly).toBe(true);
    expect(toLensConfig(ccEntry!).sovereignOnly).toBe(true);
  });

  it('does not flag an ordinary lens as sovereignOnly', () => {
    const entry = getLensById('chat');
    expect(entry).toBeTruthy();
    expect(toLensConfig(entry!).sovereignOnly).toBeFalsy();
  });
});

describe('getExtensionsByCategory — sovereign filtering', () => {
  it('hides admin and command-center for a plain user role', () => {
    const groups = getExtensionsByCategory('user', 'engineering');
    const allIds = groups.flatMap((g) => g.lenses.map((l) => l.id));
    expect(allIds).not.toContain('admin');
    expect(allIds).not.toContain('command-center');
  });

  it('shows admin and command-center for an admin role (at engineering expertise, since admin is also Sanctum-gated)', () => {
    const groups = getExtensionsByCategory('admin', 'engineering');
    const allIds = groups.flatMap((g) => g.lenses.map((l) => l.id));
    expect(allIds).toContain('admin');
    expect(allIds).toContain('command-center');
  });

  it('defaults userRole to "user" (fails closed) when omitted', () => {
    // getExtensionsByCategory's signature defaults userRole = 'user'.
    const groups = (getExtensionsByCategory as (role?: string, expertise?: string) => ReturnType<typeof getExtensionsByCategory>)(undefined, 'engineering');
    const allIds = groups.flatMap((g) => g.lenses.map((l) => l.id));
    expect(allIds).not.toContain('admin');
    expect(allIds).not.toContain('command-center');
  });

  it('does not over-gate an ordinary extension lens for a plain user role', () => {
    const groups = getExtensionsByCategory('user', 'engineering');
    const allIds = groups.flatMap((g) => g.lenses.map((l) => l.id));
    expect(allIds.length).toBeGreaterThan(50);
  });
});

describe('getCommandPaletteLenses — sovereign filtering', () => {
  it('hides admin and command-center for a plain user role (the new default)', () => {
    const ids = getCommandPaletteLenses('engineering').map((l) => l.id);
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('command-center');
  });

  it('hides admin and command-center for an explicit non-privileged role', () => {
    const ids = getCommandPaletteLenses('engineering', 'member').map((l) => l.id);
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('command-center');
  });

  it('shows admin and command-center for an admin role', () => {
    const ids = getCommandPaletteLenses('engineering', 'admin').map((l) => l.id);
    expect(ids).toContain('admin');
    expect(ids).toContain('command-center');
  });

  it('shows admin and command-center for a sovereign role', () => {
    const ids = getCommandPaletteLenses('engineering', 'sovereign').map((l) => l.id);
    expect(ids).toContain('admin');
    expect(ids).toContain('command-center');
  });

  it('does not over-gate an ordinary command-palette-eligible lens', () => {
    const ids = getCommandPaletteLenses('engineering', 'user').map((l) => l.id);
    expect(ids.length).toBeGreaterThan(20);
  });
});
