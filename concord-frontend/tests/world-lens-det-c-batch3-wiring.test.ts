// DET-C batch 3 — dead-event-listener resolutions in components/world/WorldOsSurface.tsx.
//
// Three real dead listeners the detector's own maintainer comment names
// explicitly (server/lib/detectors/dead-event-listener-detector.js) get
// bridged via SR_BRIDGE_EVENTS: DreamReader.tsx's 'concordia:dream-composed',
// ForwardPredictionsPanel.tsx's 'concordia:prediction-realised',
// NPCSchemeOverhearTip.tsx's 'concordia:npc-scheme-resolved', plus a new
// backend signal 'character:updated' for CharacterSheetPanel.tsx's
// 'concordia:character-updated'. Separately, AdaptiveMusicEngine.tsx's
// 'concordia:combat-engaged' / 'concordia:calm' listeners get a real
// edge-detected dispatch off the same `inCombat` boolean the page already
// computes for CombatMusicSystem — no new combat-detection logic invented.
//
// page.tsx pulls in Three.js scene construction that isn't mountable in
// jsdom — this follows the established source-pinning pattern
// (tests/world-lens-cinematic-camera-mode.test.ts, tests/world-lens-free-camera-mode.test.ts).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'),
  'utf8'
);

describe('DET-C batch 3 — SR_BRIDGE_EVENTS additions', () => {
  it('bridges dream:composed, prediction:realised, npc:scheme-resolved, character:updated', () => {
    const arrayBlock = pageSrc.match(/const SR_BRIDGE_EVENTS = \[[\s\S]*?\];/);
    expect(arrayBlock).toBeTruthy();
    const body = arrayBlock![0];
    expect(body).toMatch(/'dream:composed'/);
    expect(body).toMatch(/'prediction:realised'/);
    expect(body).toMatch(/'npc:scheme-resolved'/);
    expect(body).toMatch(/'character:updated'/);
  });

  it('derives the exact window-event names the dead listeners subscribe to', () => {
    // winName = `concordia:${kind.replace(/:/g, '-')}` — verify the
    // transform line itself is still present and unedited.
    expect(pageSrc).toMatch(/const winName = `concordia:\$\{kind\.replace\(\/:\/g, '-'\)\}`;/);
    // Sanity: the derived names match what each dead listener subscribes to
    // (DreamReader.tsx / ForwardPredictionsPanel.tsx / NPCSchemeOverhearTip.tsx
    // / CharacterSheetPanel.tsx) — spelled out here so a future rename of
    // the SR_BRIDGE_EVENTS entries above is caught even though the
    // transform itself is generic.
    const derived = ['dream:composed', 'prediction:realised', 'npc:scheme-resolved', 'character:updated']
      .map((k) => `concordia:${k.replace(/:/g, '-')}`);
    expect(derived).toEqual([
      'concordia:dream-composed',
      'concordia:prediction-realised',
      'concordia:npc-scheme-resolved',
      'concordia:character-updated',
    ]);
  });
});

describe('DET-C batch 3 — AdaptiveMusicEngine combat-engaged/calm, source-text pin (page.tsx can\'t mount in jsdom — see file header)', () => {
  it('the source tracks an inCombat edge and contains two literal, statically-greppable event strings, one per branch (source-text pin — proves the strings exist as static text; does not prove either one executes)', () => {
    const frameBlock = pageSrc.match(/function musicFrame\(now: number\) \{[\s\S]*?\n {4}\}/);
    expect(frameBlock).toBeTruthy();
    const body = frameBlock![0];
    expect(body).toMatch(/if \(inCombat !== wasInCombat\)/);
    // Each branch must use a LITERAL string argument (not a ternary passed
    // to `new CustomEvent(...)`) — a dynamic ternary is invisible to the
    // dead-event-listener detector's static DISPATCH_RE, which is exactly
    // the false-positive class already on file for dtu:updated/quality:approved.
    // Two literal strings, not one dynamic one.
    expect(body).toMatch(/window\.dispatchEvent\(new CustomEvent\('concordia:combat-engaged'\)\);/);
    expect(body).toMatch(/window\.dispatchEvent\(new CustomEvent\('concordia:calm'\)\);/);
  });

  it('the source\'s inCombat derivation is identical, character-for-character, to the check CombatMusicSystem already uses (source-text pin keeping the two usage sites in sync, no new detection logic)', () => {
    const frameBlock = pageSrc.match(/function musicFrame\(now: number\) \{[\s\S]*?\n {4}\}/);
    expect(frameBlock![0]).toMatch(
      /const inCombat = !!\(combatStateRef\.current\.target && !combatStateRef\.current\.isDead\);/
    );
  });
});
