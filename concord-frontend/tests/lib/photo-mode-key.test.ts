/**
 * World Lens plan Phase 2 ("Activate Existing Rendering") — real behavioral
 * coverage (pure functions, zero DOM/Three.js dependency beyond jsdom's
 * built-in KeyboardEvent) for the Photo Mode P-key guard logic extracted out
 * of components/world/WorldOsSurface.tsx's `handlePhotoModeKey`. See
 * tests/world-page-photo-mode-activation.test.ts for the page.tsx wiring
 * pins (imports + calls this module) — this file exercises the actual
 * decision logic with constructed events instead of regex-matching source.
 */

import { describe, it, expect } from 'vitest';
import { shouldTogglePhotoMode, resolvePhotoModeCanvas } from '@/lib/world-lens/photo-mode-key';

function keyEvent(key: string, target?: Partial<HTMLElement>): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key });
  if (target) {
    Object.defineProperty(e, 'target', { value: target, configurable: true });
  }
  return e;
}

describe('shouldTogglePhotoMode', () => {
  const openCtx = { dialogueNPC: null, combatTarget: null };

  it('returns true for a bare lowercase "p" outside dialogue/combat', () => {
    expect(shouldTogglePhotoMode(keyEvent('p'), openCtx)).toBe(true);
  });

  it('returns true for uppercase "P" too (case-insensitive)', () => {
    expect(shouldTogglePhotoMode(keyEvent('P'), openCtx)).toBe(true);
  });

  it('returns false for any other key', () => {
    expect(shouldTogglePhotoMode(keyEvent('o'), openCtx)).toBe(false);
    expect(shouldTogglePhotoMode(keyEvent('Escape'), openCtx)).toBe(false);
  });

  it('returns false when the event target is an INPUT', () => {
    const target = { tagName: 'INPUT', isContentEditable: false } as HTMLElement;
    expect(shouldTogglePhotoMode(keyEvent('p', target), openCtx)).toBe(false);
  });

  it('returns false when the event target is a TEXTAREA', () => {
    const target = { tagName: 'TEXTAREA', isContentEditable: false } as HTMLElement;
    expect(shouldTogglePhotoMode(keyEvent('p', target), openCtx)).toBe(false);
  });

  it('returns false when the event target is contentEditable', () => {
    const target = { tagName: 'DIV', isContentEditable: true } as HTMLElement;
    expect(shouldTogglePhotoMode(keyEvent('p', target), openCtx)).toBe(false);
  });

  it('returns true when the target is a plain, non-editable element', () => {
    const target = { tagName: 'DIV', isContentEditable: false } as HTMLElement;
    expect(shouldTogglePhotoMode(keyEvent('p', target), openCtx)).toBe(true);
  });

  it('returns false while a dialogue is open', () => {
    expect(shouldTogglePhotoMode(keyEvent('p'), { dialogueNPC: { id: 'npc-1' }, combatTarget: null })).toBe(false);
  });

  it('returns false while the player has a live combat target', () => {
    expect(shouldTogglePhotoMode(keyEvent('p'), { dialogueNPC: null, combatTarget: { id: 'mob-1' } })).toBe(false);
  });

  it('returns false when both dialogue and combat are active', () => {
    expect(shouldTogglePhotoMode(keyEvent('p'), { dialogueNPC: { id: 'npc-1' }, combatTarget: { id: 'mob-1' } })).toBe(false);
  });
});

describe('resolvePhotoModeCanvas', () => {
  it('returns the domElement from window.__concordiaRenderer when present', () => {
    const fakeCanvas = {} as HTMLCanvasElement;
    const fakeWin = { __concordiaRenderer: { domElement: fakeCanvas } } as unknown as Window;
    expect(resolvePhotoModeCanvas(fakeWin)).toBe(fakeCanvas);
  });

  it('returns null when __concordiaRenderer is absent', () => {
    const fakeWin = {} as unknown as Window;
    expect(resolvePhotoModeCanvas(fakeWin)).toBeNull();
  });

  it('returns null when __concordiaRenderer exists but has no domElement', () => {
    const fakeWin = { __concordiaRenderer: {} } as unknown as Window;
    expect(resolvePhotoModeCanvas(fakeWin)).toBeNull();
  });

  it('returns null instead of throwing if accessing the global throws', () => {
    const fakeWin = {
      get __concordiaRenderer(): never {
        throw new Error('boom');
      },
    } as unknown as Window;
    expect(resolvePhotoModeCanvas(fakeWin)).toBeNull();
  });
});
