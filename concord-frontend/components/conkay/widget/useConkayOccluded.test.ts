/**
 * useConkayOccluded — CK3's real occlusion detector. Pins that it reflects
 * genuine DOM presence of the `data-conkay-occludes-top-right` marker
 * (mounted by SystemGuidePanel.tsx / PersistentChatRail.tsx /
 * AchievementToast.tsx when they truly cover the widget's corner) and
 * nothing else — no timer, no guess, no false positive from an unrelated
 * element.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConkayOccluded } from './useConkayOccluded';

function mountOccluder(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-conkay-occludes-top-right', 'true');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.querySelectorAll('[data-conkay-occludes-top-right]').forEach((n) => n.remove());
});

describe('useConkayOccluded', () => {
  it('starts false when nothing real occupies the corner', () => {
    const { result } = renderHook(() => useConkayOccluded());
    expect(result.current).toBe(false);
  });

  it('is true on mount when a real occluder is already present', async () => {
    mountOccluder();
    const { result } = renderHook(() => useConkayOccluded());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('flips true when a real occluder mounts after the hook is already running', async () => {
    const { result } = renderHook(() => useConkayOccluded());
    expect(result.current).toBe(false);

    act(() => {
      mountOccluder();
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('flips back false when the real occluder unmounts (e.g. panel collapsed)', async () => {
    const el = mountOccluder();
    const { result } = renderHook(() => useConkayOccluded());
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      el.remove();
    });

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('is unaffected by an unrelated DOM mutation elsewhere on the page', async () => {
    const { result } = renderHook(() => useConkayOccluded());
    const decoy = document.createElement('div');
    decoy.textContent = 'unrelated content, not an occluder';
    act(() => {
      document.body.appendChild(decoy);
    });

    // Give the observer's microtask-queued callback a chance to fire (it
    // will — the assertion is that it still resolves to false, not that it
    // never re-checks). MutationObserver callbacks queue as microtasks, so
    // flushing a couple of promise ticks is enough — no real timer needed.
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current).toBe(false);
    decoy.remove();
  });
});
