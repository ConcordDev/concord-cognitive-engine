/**
 * World Lens plan Phase 6b — hud-corner-registry.ts. Real behavioral
 * coverage (pure function, zero DOM/Three.js dependency) for the
 * deterministic corner-stacking allocator that replaces page.tsx's
 * hand-guessed `top-4`/`top-32`/`bottom-24` Tailwind offsets.
 *
 * The two collision cases pinned here (fullscreen-toggle vs resource-bars
 * both wanting `top-4 left-4`; theme-picker vs camera-controls both
 * wanting `top-4 right-4`) were confirmed live in page.tsx before this
 * fix — grep showed the literal identical Tailwind classes on both pairs.
 */

import { describe, it, expect } from 'vitest';
import {
  HUD_CORNER_SLOTS,
  HUD_EDGE_INSET_PX,
  hudCornerOffsetPx,
  hudCornerStyle,
} from '@/lib/world-lens/hud-corner-registry';

describe('hud-corner-registry', () => {
  it('an order-0 slot in a plain corner sits at the edge inset', () => {
    expect(hudCornerOffsetPx('fullscreen-toggle')).toBe(HUD_EDGE_INSET_PX);
    expect(hudCornerOffsetPx('theme-picker')).toBe(HUD_EDGE_INSET_PX);
    expect(hudCornerOffsetPx('season-banner')).toBe(HUD_EDGE_INSET_PX);
    expect(hudCornerOffsetPx('gameplay-toolbar')).toBe(HUD_EDGE_INSET_PX);
  });

  it('resource-bars stacks below fullscreen-toggle (the confirmed top-left collision)', () => {
    const toggleOffset = hudCornerOffsetPx('fullscreen-toggle');
    const barsOffset = hudCornerOffsetPx('resource-bars');
    expect(barsOffset).toBeGreaterThan(toggleOffset);
    const toggleSlot = HUD_CORNER_SLOTS.find((s) => s.id === 'fullscreen-toggle')!;
    expect(barsOffset).toBe(toggleOffset + toggleSlot.sizePx + (toggleSlot.gapPx ?? 8));
    // No overlap: the gap between them is strictly positive.
    expect(barsOffset - (toggleOffset + toggleSlot.sizePx)).toBeGreaterThan(0);
  });

  it('camera-controls stacks below theme-picker (the confirmed top-right collision)', () => {
    const pickerOffset = hudCornerOffsetPx('theme-picker');
    const controlsOffset = hudCornerOffsetPx('camera-controls');
    expect(controlsOffset).toBeGreaterThan(pickerOffset);
  });

  it('run-mode-hotbar stacks below camera-controls, third in the top-right corner', () => {
    const controlsOffset = hudCornerOffsetPx('camera-controls');
    const hotbarOffset = hudCornerOffsetPx('run-mode-hotbar');
    expect(hotbarOffset).toBeGreaterThan(controlsOffset);
  });

  it('no two slots sharing a corner produce the same offset', () => {
    const byCorner = new Map<string, number[]>();
    for (const slot of HUD_CORNER_SLOTS) {
      const offset = hudCornerOffsetPx(slot.id);
      const list = byCorner.get(slot.corner) ?? [];
      list.push(offset);
      byCorner.set(slot.corner, list);
    }
    for (const [corner, offsets] of byCorner) {
      expect(new Set(offsets).size, `duplicate offset within corner ${corner}`).toBe(offsets.length);
    }
  });

  it('quest-tracker preserves its original bottom-24 (96px) reserved space for HUDOverlay\'s bottom bar', () => {
    expect(hudCornerOffsetPx('quest-tracker')).toBe(96);
  });

  it('an unregistered id degrades to the plain edge inset rather than throwing', () => {
    expect(hudCornerOffsetPx('does-not-exist')).toBe(HUD_EDGE_INSET_PX);
  });

  it('hudCornerStyle returns `top` for top-stacking corners and `bottom` for bottom ones', () => {
    expect(hudCornerStyle('fullscreen-toggle')).toEqual({ top: HUD_EDGE_INSET_PX });
    expect(hudCornerStyle('theme-picker')).toEqual({ top: HUD_EDGE_INSET_PX });
    expect(hudCornerStyle('season-banner')).toEqual({ top: HUD_EDGE_INSET_PX });
    expect(hudCornerStyle('gameplay-toolbar')).toEqual({ bottom: HUD_EDGE_INSET_PX });
    expect(hudCornerStyle('quest-tracker')).toEqual({ bottom: 96 });
  });

  it('every registered slot has a non-negative sizePx and a unique id', () => {
    const ids = new Set<string>();
    for (const slot of HUD_CORNER_SLOTS) {
      expect(slot.sizePx).toBeGreaterThan(0);
      expect(ids.has(slot.id), `duplicate slot id ${slot.id}`).toBe(false);
      ids.add(slot.id);
    }
  });
});
