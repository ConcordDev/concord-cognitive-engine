/**
 * Pinning test for WorldEntryOverlay — the Concordia entry/loading sequence.
 *
 * The invariant this locks: the overlay is HONEST — every visible stage is a
 * pure function of a real load signal (engineReady / dataState / sceneReady),
 * and it dismisses on the real "scene painted" signal. It replaced a dead
 * `LoadingTransitions` that was permanently mounted at a hardcoded
 * `progress={0}`. If someone reintroduces a fake/timed progress or breaks the
 * dismiss-on-ready handoff, these assertions go red.
 */

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';

import WorldEntryOverlay from '@/components/world-lens/WorldEntryOverlay';

describe('WorldEntryOverlay', () => {
  it('shows the destination + a pending stage while the scene is not ready', () => {
    const { getByTestId } = render(
      <WorldEntryOverlay worldName="Pioneer Valley" engineReady={false} dataState="loading" sceneReady={false} />,
    );
    const overlay = getByTestId('world-entry-overlay');
    expect(overlay.getAttribute('data-leaving')).toBeNull();
    expect(overlay.textContent).toMatch(/Pioneer Valley/);
    // Real stage labels — nothing is "done" yet.
    expect(overlay.textContent).toMatch(/Loading renderer/);
    // Determinate progress reflects zero completed real stages.
    expect(overlay.textContent).toMatch(/0\/3/);
  });

  it('reflects real completed stages in the count (engine + live data)', () => {
    const { getByTestId } = render(
      <WorldEntryOverlay worldName="Pioneer Valley" engineReady dataState="live" sceneReady={false} />,
    );
    const overlay = getByTestId('world-entry-overlay');
    // Two real stages done (renderer + world data), scene still building.
    expect(overlay.textContent).toMatch(/2\/3/);
    expect(overlay.textContent).toMatch(/Building the world/);
  });

  it('labels an offline data outcome as a local preview, not a fabricated success', () => {
    const { getByTestId } = render(
      <WorldEntryOverlay worldName="Pioneer Valley" engineReady dataState="offline" sceneReady={false} />,
    );
    expect(getByTestId('world-entry-overlay').textContent).toMatch(/local preview/i);
  });

  it('begins fading out once the scene is painted (dismiss on real ready signal)', () => {
    const { getByTestId, rerender } = render(
      <WorldEntryOverlay worldName="Pioneer Valley" engineReady dataState="live" sceneReady={false} />,
    );
    expect(getByTestId('world-entry-overlay').getAttribute('data-leaving')).toBeNull();
    act(() => {
      rerender(
        <WorldEntryOverlay worldName="Pioneer Valley" engineReady dataState="live" sceneReady />,
      );
    });
    expect(getByTestId('world-entry-overlay').getAttribute('data-leaving')).toBe('true');
  });

  it('never mounts if the scene is already ready on first render', () => {
    const { queryByTestId } = render(
      <WorldEntryOverlay worldName="Pioneer Valley" engineReady dataState="live" sceneReady />,
    );
    expect(queryByTestId('world-entry-overlay')).toBeNull();
  });
});
