// World Lens plan Phase 5 (Panels: Glance → Summon → Sanctum) — wiring the
// real expertise level into the two surfaces players actually discover
// lenses through: the Sidebar's Extensions list and the ⌘K command
// palette. The gating logic itself (meetsExpertiseGate,
// getCommandPaletteLenses, getExtensionsByCategory) has real behavioral
// coverage in tests/lib/lens-registry-sanctum-gate.test.ts; this file
// pins that both consumer components actually read the live
// useHUDContext().expertiseLevel value (the same store
// ConcordiaScene.tsx's context-sensitive FOV reads) rather than silently
// keeping their old, ungated call.
//
// Stability audit (2026-07-20) — CommandPalette.tsx now ALSO threads the
// real useUIStore userRole through getCommandPaletteLenses, so sovereign
// lenses (admin/command-center) are hidden from ⌘K search the same way
// Sidebar.tsx already hides them from getExtensionsByCategory (see
// lens-registry-sovereign-gate.test.ts for the gating logic's own
// coverage). The regex pins below were updated to match the two-argument
// call + widened dependency array.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidebarSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/shell/Sidebar.tsx'),
  'utf8'
);
const paletteSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/common/CommandPalette.tsx'),
  'utf8'
);

describe('Sidebar.tsx reads the real expertise level and threads it into the gate', () => {
  it('imports useHUDContext', () => {
    expect(sidebarSrc).toMatch(/import \{ useHUDContext \} from '@\/components\/world\/concordia-hud\/HUDContextProvider';/);
  });

  it('reads expertiseLevel via a selector', () => {
    expect(sidebarSrc).toMatch(/const expertiseLevel = useHUDContext\(\(s\) => s\.expertiseLevel\);/);
  });

  it('passes it into getExtensionsByCategory alongside userRole', () => {
    expect(sidebarSrc).toMatch(/getExtensionsByCategory\(userRole, expertiseLevel\)/);
  });

  it('the memo dependency array includes expertiseLevel (not a stale closure)', () => {
    expect(sidebarSrc).toMatch(/\[userRole, expertiseLevel\]/);
  });
});

describe('CommandPalette.tsx reads the real expertise level and threads it into the gate', () => {
  it('imports useHUDContext', () => {
    expect(paletteSrc).toMatch(/import \{ useHUDContext \} from '@\/components\/world\/concordia-hud\/HUDContextProvider';/);
  });

  it('reads expertiseLevel via a selector', () => {
    expect(paletteSrc).toMatch(/const expertiseLevel = useHUDContext\(\(s\) => s\.expertiseLevel\);/);
  });

  it('passes it into getCommandPaletteLenses and depends on it in the memo', () => {
    expect(paletteSrc).toMatch(/getCommandPaletteLenses\(expertiseLevel, userRole\)/);
    expect(paletteSrc).toMatch(/\}, \[expertiseLevel, userRole\]\);/);
  });
});

describe('CommandPalette.tsx reads the real user role and threads it into the sovereign-lens gate', () => {
  it('reads userRole from useUIStore', () => {
    expect(paletteSrc).toMatch(/const userRole = useUIStore\(\(s\) => s\.userRole\);/);
  });
});
