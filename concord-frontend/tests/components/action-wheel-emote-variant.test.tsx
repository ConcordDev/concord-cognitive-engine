/**
 * World Lens plan Phase 6d — ActionWheel's new 'emote' variant, folded in
 * from the two deleted bespoke radial-menu components
 * (`components/world/EmoteWheel.tsx` and `components/concordia/social/
 * EmoteWheel.tsx`). Real behavioral render test — ActionWheel is a plain
 * React component (useHUDContext + keyboard listeners, no Three.js), so
 * it mounts fine in jsdom, unlike the heavy imperative Three.js files
 * elsewhere in the World Lens that need source-pinning instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ActionWheel, EMOTES } from '@/components/world/concordia-hud/ActionWheel';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';

describe('ActionWheel — emote variant (Phase 6d fold-in)', () => {
  beforeEach(() => {
    useHUDContext.setState({ inputMode: 'exploration', expertiseLevel: 'engineering' });
  });

  afterEach(() => {
    cleanup();
  });

  it('is closed by default (hold-to-open, not permanently visible — the bug being fixed)', () => {
    render(<ActionWheel variant="emote" />);
    expect(document.querySelector('[data-testid="hud-action-wheel"]')).toBeNull();
  });

  it('opens on holding "z" and renders all 8 emote spokes with the real catalog labels/glyphs', () => {
    render(<ActionWheel variant="emote" />);
    fireEvent.keyDown(window, { key: 'z' });
    const wheel = document.querySelector('[data-testid="hud-action-wheel"][data-variant="emote"]');
    expect(wheel).toBeTruthy();
    for (const id of Object.keys(EMOTES)) {
      const btn = wheel!.querySelector(`[data-spoke-id="${id}"]`);
      expect(btn, `missing spoke for ${id}`).toBeTruthy();
      expect(btn!.textContent).toContain(EMOTES[id as keyof typeof EMOTES].icon);
    }
  });

  it('closes on releasing "z"', () => {
    render(<ActionWheel variant="emote" />);
    fireEvent.keyDown(window, { key: 'z' });
    expect(document.querySelector('[data-testid="hud-action-wheel"]')).toBeTruthy();
    fireEvent.keyUp(window, { key: 'z' });
    expect(document.querySelector('[data-testid="hud-action-wheel"]')).toBeNull();
  });

  it('hovering a spoke then releasing "z" dispatches concordia:emote-play with that emote id', () => {
    render(<ActionWheel variant="emote" />);
    fireEvent.keyDown(window, { key: 'z' });
    const waveBtn = document.querySelector('[data-spoke-id="wave"]') as HTMLElement;
    fireEvent.mouseEnter(waveBtn);

    const handler = vi.fn();
    window.addEventListener('concordia:emote-play', handler);
    fireEvent.keyUp(window, { key: 'z' });
    window.removeEventListener('concordia:emote-play', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ emoteId: 'wave' });
  });

  it('clicking a spoke directly also dispatches concordia:emote-play', () => {
    render(<ActionWheel variant="emote" />);
    fireEvent.keyDown(window, { key: 'z' });
    const danceBtn = document.querySelector('[data-spoke-id="dance"]') as HTMLElement;

    const handler = vi.fn();
    window.addEventListener('concordia:emote-play', handler);
    fireEvent.click(danceBtn);
    window.removeEventListener('concordia:emote-play', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ emoteId: 'dance' });
  });

  it('expertise level gates the visible spoke count, same as the other 3 variants', () => {
    useHUDContext.setState({ expertiseLevel: 'newcomer' });
    const { unmount } = render(<ActionWheel variant="emote" />);
    fireEvent.keyDown(window, { key: 'z' });
    let wheel = document.querySelector('[data-testid="hud-action-wheel"]')!;
    expect(wheel.querySelectorAll('[role="menuitem"]').length).toBe(4);
    unmount();

    useHUDContext.setState({ expertiseLevel: 'standard' });
    render(<ActionWheel variant="emote" />);
    fireEvent.keyDown(window, { key: 'z' });
    wheel = document.querySelector('[data-testid="hud-action-wheel"]')!;
    expect(wheel.querySelectorAll('[role="menuitem"]').length).toBe(6);
  });

  it('is hidden during combat/dialogue/vehicle mode, matching quick_panel/tool (not the skill-wheel exception)', () => {
    for (const mode of ['combat', 'dialogue', 'vehicle'] as const) {
      useHUDContext.setState({ inputMode: mode });
      const { unmount } = render(<ActionWheel variant="emote" />);
      fireEvent.keyDown(window, { key: 'z' });
      expect(document.querySelector('[data-testid="hud-action-wheel"]'), `should be hidden in ${mode}`).toBeNull();
      unmount();
    }
  });

  it('accepts a holdKey override', () => {
    render(<ActionWheel variant="emote" holdKey="x" />);
    fireEvent.keyDown(window, { key: 'z' });
    expect(document.querySelector('[data-testid="hud-action-wheel"]')).toBeNull();
    fireEvent.keyDown(window, { key: 'x' });
    expect(document.querySelector('[data-testid="hud-action-wheel"]')).toBeTruthy();
  });
});
