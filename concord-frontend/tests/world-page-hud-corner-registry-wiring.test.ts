/**
 * World Lens plan Phase 6b — pins that world/page.tsx's 8 corner-anchored
 * HUD wrapper divs actually use hud-corner-registry.ts's `hudCornerStyle()`
 * instead of the old hand-guessed `top-4`/`top-32`/`bottom-24` Tailwind
 * classes (the registry's own behavior is covered separately, with real
 * function calls, in tests/lib/hud-corner-registry.test.ts — this file
 * only proves page.tsx is actually wired to it, matching this session's
 * established pattern for the 7,250-line page that's too Three.js/DOM-
 * heavy to mount in jsdom).
 *
 * Two of the eight were CONFIRMED, currently-shipping visual collisions
 * before this fix (both literally `absolute top-4 left-4`, both literally
 * `absolute top-4 right-4`) — pinned here as a regression guard so a
 * future edit can't silently reintroduce a hardcoded offset at these
 * call sites.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'), 'utf8');

describe('world/page.tsx — hud-corner-registry source-shape pins (the registry function\'s own behavior is real-tested in tests/lib/hud-corner-registry.test.ts; Phase 6b)', () => {
  it('page.tsx source imports hudCornerStyle from the registry (real behavior of hudCornerStyle itself: tests/lib/hud-corner-registry.test.ts)', () => {
    expect(src).toMatch(/import \{ hudCornerStyle \} from '@\/lib\/world-lens\/hud-corner-registry';/);
  });

  const ids = [
    'fullscreen-toggle',
    'theme-picker',
    'camera-controls',
    'run-mode-hotbar',
    'gameplay-toolbar',
    'resource-bars',
    'quest-tracker',
    'season-banner',
  ];

  it('all 8 registered corner-anchored mounts pass style={hudCornerStyle(id)}', () => {
    for (const id of ids) {
      const re = new RegExp(`style=\\{hudCornerStyle\\('${id}'\\)\\}`);
      expect(src, `missing hudCornerStyle('${id}') wiring`).toMatch(re);
    }
  });

  it('none of the 8 registered mounts still carry a hardcoded top-4/top-32/top-2/bottom-4/bottom-24 Tailwind offset class', () => {
    for (const id of ids) {
      const re = new RegExp(`style=\\{hudCornerStyle\\('${id}'\\)\\}[^\\n]*className=\\{\`[^\`]*\\b(top-4|top-32|top-2\\b|bottom-4\\b|bottom-24)\\b`);
      expect(src, `${id}'s className still has a hardcoded stacking offset`).not.toMatch(re);
    }
  });

  it('page.tsx source no longer contains the confirmed top-left collision pair\'s (fullscreen-toggle, resource-bars) old identical "top-4 left-4" class (regression guard against reintroducing the confirmed visual collision)', () => {
    expect(src).not.toMatch(/className=\{`absolute top-4 left-4 z-30/);
    expect(src).not.toMatch(/className=\{`absolute top-4 left-4 z-20 pointer-events-none/);
  });

  it('page.tsx source no longer contains the confirmed top-right collision pair\'s (theme-picker, camera-controls) old identical "top-4 right-4" class (regression guard against reintroducing the confirmed visual collision)', () => {
    expect(src).not.toMatch(/className=\{`absolute top-4 right-4 z-20 flex items-center gap-1\.5 bg-black\/50/);
    expect(src).not.toMatch(/className=\{`absolute top-4 right-4 z-20 \$\{hudHidden/);
  });

  it('page.tsx source shape: each mount keeps its edge-inset (left-4/right-4/left-1\\/2) and z-index classes unchanged alongside the hudCornerStyle(id) offset', () => {
    expect(src).toMatch(/style=\{hudCornerStyle\('fullscreen-toggle'\)\} className=\{`absolute left-4 z-30/);
    expect(src).toMatch(/style=\{hudCornerStyle\('theme-picker'\)\} className=\{`absolute right-4 z-20/);
    expect(src).toMatch(/style=\{hudCornerStyle\('camera-controls'\)\} className=\{`absolute right-4 z-20/);
    expect(src).toMatch(/style=\{hudCornerStyle\('run-mode-hotbar'\)\} className=\{`pointer-events-auto fixed right-4 z-20/);
    expect(src).toMatch(/style=\{hudCornerStyle\('gameplay-toolbar'\)\} className=\{`absolute left-1\/2 -translate-x-1\/2 z-20/);
    expect(src).toMatch(/style=\{hudCornerStyle\('resource-bars'\)\} className=\{`absolute left-4 z-20/);
    expect(src).toMatch(/style=\{hudCornerStyle\('quest-tracker'\)\} className=\{`absolute right-4 z-25/);
    expect(src).toMatch(/style=\{hudCornerStyle\('season-banner'\)\} className=\{`absolute left-1\/2 -translate-x-1\/2 z-20/);
  });
});
