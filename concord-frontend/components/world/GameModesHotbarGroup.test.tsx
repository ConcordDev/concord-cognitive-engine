/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the useState→useEffect fix for the `concordia:start-mode` listener.
//
// GameModesHotbarGroup used to register its palette-driven mode-start
// listener inside `useState(() => { ...; return cleanup; })` instead of
// `useEffect`. useState's lazy initializer runs once and its return value
// becomes state — the returned cleanup function is never invoked by React,
// so every remount of this persistent hotbar component permanently added
// one more `window` listener that was never removed. This test proves the
// listener is added on mount and removed on unmount — not accumulated
// across repeated mount/unmount cycles.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

import { GameModesHotbarGroup } from './GameModesHotbarGroup';

describe('GameModesHotbarGroup — concordia:start-mode listener lifecycle', () => {
  afterEach(() => cleanup());

  it('adds exactly one start-mode listener per mount and removes it on unmount, across repeated cycles', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const CYCLES = 3;
    for (let i = 0; i < CYCLES; i++) {
      const { unmount } = render(<GameModesHotbarGroup worldId="concordia-hub" />);

      const addedSoFar = addSpy.mock.calls.filter(([type]) => (type as string) === 'concordia:start-mode').length;
      expect(addedSoFar).toBe(i + 1);

      unmount();

      const removedSoFar = removeSpy.mock.calls.filter(([type]) => (type as string) === 'concordia:start-mode').length;
      expect(removedSoFar).toBe(i + 1);
    }

    // After N mount/unmount cycles, adds and removes are equal — no leak.
    const totalAdded = addSpy.mock.calls.filter(([type]) => (type as string) === 'concordia:start-mode').length;
    const totalRemoved = removeSpy.mock.calls.filter(([type]) => (type as string) === 'concordia:start-mode').length;
    expect(totalAdded).toBe(CYCLES);
    expect(totalRemoved).toBe(CYCLES);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('still reacts to a concordia:start-mode event while mounted (behavior preserved)', () => {
    render(<GameModesHotbarGroup worldId="concordia-hub" />);

    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'horde' } }));
    });

    // The confirm modal opens with the matched mode's label.
    expect(document.body.textContent).toContain('Start Horde?');
  });
});
