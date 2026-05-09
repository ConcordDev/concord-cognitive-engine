/**
 * Theme 4 (game-feel pass): NPCActivityTag overlay tests.
 *
 * Pins:
 *   - Icon renders for known activity_kinds (train/patrol/trade/...)
 *   - Hidden for unknown / null activity
 *   - Hidden past VISIBLE_RADIUS_M from the player
 *   - Renders at projected (x, y) from concordia:projector-ready
 *   - Cleans up when disabled or list empties
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

import { NPCActivityTag } from '@/components/world/NPCActivityTag';

type Projector = (w: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean } | null;

function dispatchProjector(stub: Projector) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:projector-ready', {
      detail: { project: stub },
    }));
  });
}

/** Wait long enough for the rAF loop to fire at least one throttled frame
 *  (FRAME_THROTTLE_MS=80 in the component). */
async function waitForFrame(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('NPCActivityTag', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no NPCs', () => {
    const { container } = render(<NPCActivityTag npcs={[]} />);
    expect(container.querySelector('[data-testid="npc-activity-tag-layer"]')).toBeNull();
  });

  it('renders an icon for each visible NPC with a known activity', async () => {
    const npcs = [
      { id: 'n1', position: { x: 0, z: 0 }, currentActivity: 'train' },
      { id: 'n2', position: { x: 1, z: 1 }, currentActivity: 'trade' },
    ];
    render(<NPCActivityTag npcs={npcs} playerPosition={{ x: 0, z: 0 }} />);
    // After mount the projector-ready listener is attached. Now dispatch.
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    await waitForFrame();
    expect(document.querySelectorAll('[data-npc-id]').length).toBe(2);
  });

  it('hides NPCs without an activity', async () => {
    const npcs = [
      { id: 'n1', position: { x: 0, z: 0 }, currentActivity: null },
      { id: 'n2', position: { x: 0, z: 0 }, currentActivity: 'train' },
    ];
    render(<NPCActivityTag npcs={npcs} playerPosition={{ x: 0, z: 0 }} />);
    dispatchProjector(() => ({ x: 50, y: 50, visible: true }));
    await waitForFrame();
    const tags = document.querySelectorAll('[data-npc-id]');
    expect(tags.length).toBe(1);
    expect(tags[0]?.getAttribute('data-npc-id')).toBe('n2');
  });

  it('hides NPCs with unknown activity_kind', async () => {
    const npcs = [
      { id: 'n1', position: { x: 0, z: 0 }, currentActivity: 'mystery_activity' },
    ];
    render(<NPCActivityTag npcs={npcs} playerPosition={{ x: 0, z: 0 }} />);
    dispatchProjector(() => ({ x: 50, y: 50, visible: true }));
    await waitForFrame();
    expect(document.querySelectorAll('[data-npc-id]').length).toBe(0);
  });

  it('hides NPCs past visibility radius (12m)', async () => {
    const npcs = [
      { id: 'n_close', position: { x: 5, z: 0 }, currentActivity: 'train' },  // 5m
      { id: 'n_far',   position: { x: 30, z: 0 }, currentActivity: 'train' }, // 30m
    ];
    render(<NPCActivityTag npcs={npcs} playerPosition={{ x: 0, z: 0 }} />);
    dispatchProjector(() => ({ x: 50, y: 50, visible: true }));
    await waitForFrame();
    const ids = Array.from(document.querySelectorAll('[data-npc-id]')).map((el) => el.getAttribute('data-npc-id'));
    expect(ids).toContain('n_close');
    expect(ids).not.toContain('n_far');
  });

  it('skips invisible projections', async () => {
    const npcs = [{ id: 'n1', position: { x: 0, z: 0 }, currentActivity: 'craft' }];
    render(<NPCActivityTag npcs={npcs} playerPosition={{ x: 0, z: 0 }} />);
    // First: projector returns visible=false → no tag
    dispatchProjector(() => ({ x: 100, y: 100, visible: false }));
    await waitForFrame();
    expect(document.querySelectorAll('[data-npc-id]').length).toBe(0);
  });

  it('renders nothing when disabled', () => {
    const npcs = [{ id: 'n1', position: { x: 0, z: 0 }, currentActivity: 'train' }];
    const { container } = render(
      <NPCActivityTag npcs={npcs} playerPosition={{ x: 0, z: 0 }} enabled={false} />,
    );
    expect(container.querySelector('[data-testid="npc-activity-tag-layer"]')).toBeNull();
  });

  it('cleans up listeners on unmount', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<NPCActivityTag npcs={[]} />);
    unmount();
    const removed = removeListenerSpy.mock.calls.find(
      ([event]) => event === 'concordia:projector-ready',
    );
    expect(removed).toBeTruthy();
  });
});
