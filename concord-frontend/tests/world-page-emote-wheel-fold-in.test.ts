/**
 * World Lens plan Phase 6d — pins world/page.tsx's side of the EmoteWheel
 * fold-in: the old bespoke components/imports/state/mounts are gone, and
 * the new concordia:emote-play listener + ActionWheel 'emote' mount are
 * wired. Source-pinning (not a render test) per this session's
 * established pattern for this 7,000+ line, Three.js-heavy page.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'), 'utf8');

describe('world/page.tsx — EmoteWheel fold-in (Phase 6d)', () => {
  it('no longer imports either deleted EmoteWheel component', () => {
    expect(src).not.toMatch(/from '@\/components\/world\/EmoteWheel'/);
    expect(src).not.toMatch(/from '@\/components\/concordia\/social\/EmoteWheel'/);
    expect(src).not.toMatch(/EmoteWheelLegacy/);
  });

  it('no longer has the showEmoteWheel state or the G-key toggle effect', () => {
    expect(src).not.toMatch(/showEmoteWheel/);
    expect(src).not.toMatch(/G key: toggle emote wheel/);
  });

  it('QuickMessageBar is still mounted in social/exploration mode (was NOT deleted alongside the legacy wheel)', () => {
    expect(src).toMatch(/inputMode === 'social' \|\| inputMode === 'exploration'/);
    expect(src).toMatch(/<QuickMessageBar/);
  });

  it('mounts the folded-in ActionWheel emote variant', () => {
    expect(src).toMatch(/<ConcordiaHUD\.ActionWheel variant="emote" \/>/);
  });

  it('handles concordia:emote-play by calling handleAvatarEmote (reusing the one real apply-emote path, not a 3rd copy)', () => {
    const listenerIdx = src.indexOf("window.addEventListener('concordia:emote-play', onEmotePlay);");
    expect(listenerIdx).toBeGreaterThan(-1);
    const handlerDeclIdx = src.indexOf('function onEmotePlay(e: Event) {');
    expect(handlerDeclIdx).toBeGreaterThan(-1);
    expect(listenerIdx).toBeGreaterThan(handlerDeclIdx);
    const handlerSlice = src.slice(handlerDeclIdx, listenerIdx);
    expect(handlerSlice).toMatch(/handleAvatarEmote\(emoteId\)/);
  });

  it('the emote-play effect depends on handleAvatarEmote (no stale-closure risk)', () => {
    expect(src).toMatch(/\}, \[handleAvatarEmote\]\);/);
  });
});
