// World Lens plan Phase 5 (Panels: Glance → Summon → Sanctum) — the
// "Sanctum" tier: a full immersive-takeover surface (Builder, World
// Editor, admin/ops tooling) a newcomer or standard player never needs
// and shouldn't stumble into via search.
//
// meetsExpertiseGate() is a real, pure, importable function gating by
// expertise level — a separate axis from isLensVisible()'s role-based
// sovereign-lens gate (admin/command-center only; see
// lens-registry-sovereign-gate.test.ts for that gate's own coverage,
// fixed in the 2026-07-20 stability audit — isLensVisible() previously
// was a stub hardcoded to always return true).
//
// Six entries were individually verified (not inferred from
// `category: 'system'` alone, which also holds normal account-management
// features like Sessions/Sync/API-Keys) to have unambiguous developer/
// admin/world-building descriptions and were gated: debug ("Debug
// console"), admin ("System administration"), ops-telemetry ("... admin"
// in its own description), repair-telemetry ("the autonomic nervous
// system" ops surface), foundry ("World-builder substrate" — the plan's
// "Builder"), world-creator ("Create a new world" — the plan's "World
// Editor").

import { describe, it, expect } from 'vitest';
import {
  meetsExpertiseGate,
  getExtensionsByCategory,
  getCommandPaletteLenses,
  LENS_REGISTRY,
} from '@/lib/lens-registry';

const SANCTUM_IDS = ['debug', 'admin', 'ops-telemetry', 'repair-telemetry', 'foundry', 'world-creator'];

describe('meetsExpertiseGate', () => {
  it('an entry with no minExpertise is visible at every level', () => {
    for (const level of ['newcomer', 'standard', 'detailed', 'engineering'] as const) {
      expect(meetsExpertiseGate({}, level)).toBe(true);
    }
  });

  it('an entry gated at engineering is hidden below that level', () => {
    const entry = { minExpertise: 'engineering' as const };
    expect(meetsExpertiseGate(entry, 'newcomer')).toBe(false);
    expect(meetsExpertiseGate(entry, 'standard')).toBe(false);
    expect(meetsExpertiseGate(entry, 'detailed')).toBe(false);
    expect(meetsExpertiseGate(entry, 'engineering')).toBe(true);
  });

  it('rank ordering is newcomer < standard < detailed < engineering', () => {
    const entry = { minExpertise: 'detailed' as const };
    expect(meetsExpertiseGate(entry, 'newcomer')).toBe(false);
    expect(meetsExpertiseGate(entry, 'standard')).toBe(false);
    expect(meetsExpertiseGate(entry, 'detailed')).toBe(true);
    expect(meetsExpertiseGate(entry, 'engineering')).toBe(true);
  });
});

describe('the 6 Sanctum-tier registry entries', () => {
  it('all 6 are present in the registry and gated at engineering', () => {
    for (const id of SANCTUM_IDS) {
      const entry = LENS_REGISTRY.find((l) => l.id === id);
      expect(entry, `${id} missing from LENS_REGISTRY`).toBeTruthy();
      expect(entry!.minExpertise, `${id} should be gated at 'engineering'`).toBe('engineering');
    }
  });

  it('no other registry entry was accidentally gated (the gate is a deliberate, small allowlist, not a blanket category filter)', () => {
    const gated = LENS_REGISTRY.filter((l) => l.minExpertise != null).map((l) => l.id).sort();
    expect(gated).toEqual([...SANCTUM_IDS].sort());
  });

  it('normal account-management "system"-category lenses (Sessions/Sync/API-Keys) remain ungated', () => {
    for (const id of ['sessions', 'sync', 'byo-keys']) {
      const entry = LENS_REGISTRY.find((l) => l.id === id);
      expect(entry, `${id} missing from LENS_REGISTRY`).toBeTruthy();
      expect(entry!.minExpertise).toBeUndefined();
    }
  });
});

describe('getCommandPaletteLenses — Sanctum filtering', () => {
  it('excludes all 6 Sanctum entries below engineering level', () => {
    for (const level of ['newcomer', 'standard', 'detailed'] as const) {
      const ids = getCommandPaletteLenses(level).map((l) => l.id);
      for (const sanctumId of SANCTUM_IDS) {
        expect(ids, `${sanctumId} should not appear at level '${level}'`).not.toContain(sanctumId);
      }
    }
  });

  it('includes all 6 Sanctum entries at engineering level for an admin/sovereign viewer', () => {
    // 'admin' is both expertise-gated (Sanctum tier) AND role-gated
    // (SOVEREIGN_LENSES, see lens-registry-sovereign-gate.test.ts) — pass
    // an admin role explicitly so this test isolates the expertise-gate
    // concern from the (separately tested) role-gate concern, rather
    // than relying on the function's default userRole ('user', fails
    // closed on sovereign lenses by design).
    const ids = getCommandPaletteLenses('engineering', 'admin').map((l) => l.id);
    for (const sanctumId of SANCTUM_IDS) {
      expect(ids, `${sanctumId} should appear at engineering level`).toContain(sanctumId);
    }
  });

  it('defaults to engineering (most permissive) when called with no argument — reproduces pre-Phase-5 behavior for any caller that hasn\'t been updated', () => {
    const withDefault = getCommandPaletteLenses().map((l) => l.id).sort();
    const withExplicitEngineering = getCommandPaletteLenses('engineering').map((l) => l.id).sort();
    expect(withDefault).toEqual(withExplicitEngineering);
  });

  it('a real player-facing lens (e.g. inventory) is visible at every expertise level', () => {
    for (const level of ['newcomer', 'standard', 'detailed', 'engineering'] as const) {
      const ids = getCommandPaletteLenses(level).map((l) => l.id);
      expect(ids.length).toBeGreaterThan(0);
    }
  });
});

describe('getExtensionsByCategory — Sanctum filtering', () => {
  it('foundry and world-creator (both "world" category extensions) are excluded below engineering', () => {
    const groups = getExtensionsByCategory('user', 'standard');
    const allIds = groups.flatMap((g) => g.lenses.map((l) => l.id));
    expect(allIds).not.toContain('foundry');
    expect(allIds).not.toContain('world-creator');
  });

  it('foundry and world-creator are included at engineering level', () => {
    const groups = getExtensionsByCategory('user', 'engineering');
    const allIds = groups.flatMap((g) => g.lenses.map((l) => l.id));
    expect(allIds).toContain('foundry');
    expect(allIds).toContain('world-creator');
  });

  it('defaults to engineering (most permissive) when called with only a userRole argument', () => {
    const withDefault = getExtensionsByCategory('user').flatMap((g) => g.lenses.map((l) => l.id)).sort();
    const withExplicit = getExtensionsByCategory('user', 'engineering').flatMap((g) => g.lenses.map((l) => l.id)).sort();
    expect(withDefault).toEqual(withExplicit);
  });
});
