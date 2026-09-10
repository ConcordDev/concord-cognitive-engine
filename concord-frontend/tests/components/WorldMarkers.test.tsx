/**
 * Dead-event-listener fix (verification-audit campaign, 2026-07-06):
 * WorldMarkers.tsx was a fully-built component (real world->screen
 * projection, quest/ally/enemy/ping/loot/interaction categories, a real
 * emitWorldMarker() helper) that was NEVER MOUNTED anywhere in the app —
 * so 'concordia:social-ping' had a real server broadcast, a real
 * socket-to-window bridge (fixed separately this session), and a real
 * listener here, but zero rendered instance to ever receive it.
 *
 * Rewritten to use the same 'concordia:projector-ready' convention as its
 * siblings (DamageBillboard/NPCActivityTag/BazaarLayer) instead of raw
 * camera-vector props, and mounted in components/world/WorldOsSurface.tsx next to
 * DamageBillboard. These tests pin the rendered behavior directly.
 */

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';

import { WorldMarkers, emitWorldMarker, clearWorldMarker } from '@/components/world-lens/WorldMarkers';

type Projector = (w: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean } | null;

function dispatchProjector(stub: Projector) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:projector-ready', { detail: { project: stub } }));
  });
}

async function waitFrame(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('WorldMarkers — mounted overlay (verification-audit fix)', () => {
  it('renders nothing before any marker exists', () => {
    const { container } = render(<WorldMarkers />);
    expect(container.querySelectorAll('[data-marker-id]').length).toBe(0);
  });

  it('renders a marker added via concordia:world-marker:add once the projector is ready', async () => {
    render(<WorldMarkers />);
    dispatchProjector(() => ({ x: 200, y: 150, visible: true }));
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:world-marker:add', {
        detail: { id: 'quest-1', kind: 'quest', position: { x: 5, y: 0, z: 5 }, label: 'Deliver the letter' },
      }));
    });
    await waitFrame();
    const el = document.querySelector('[data-marker-id="quest-1"]');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('data-marker-kind')).toBe('quest');
    expect(el?.textContent).toContain('Deliver the letter');
  });

  it('removes a marker via concordia:world-marker:remove', async () => {
    render(<WorldMarkers />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:world-marker:add', {
        detail: { id: 'loot-1', kind: 'loot', position: { x: 0, y: 0, z: 0 } },
      }));
    });
    await waitFrame();
    expect(document.querySelector('[data-marker-id="loot-1"]')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:world-marker:remove', { detail: { id: 'loot-1' } }));
    });
    await waitFrame();
    expect(document.querySelector('[data-marker-id="loot-1"]')).toBeNull();
  });

  it('auto-creates a pulsing ping marker from a concordia:social-ping event (the real dead-listener case)', async () => {
    render(<WorldMarkers />);
    dispatchProjector(() => ({ x: 300, y: 200, visible: true }));
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:social-ping', {
        detail: { from: 'user-42', type: 'danger', position: { x: 10, y: 0, z: 10 } },
      }));
    });
    await waitFrame();
    const el = document.querySelector('[data-marker-kind="ping"]');
    expect(el).toBeTruthy();
    expect(el?.textContent).toContain('danger');
    expect(el?.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('does not render a marker while the projector reports it out of frustum', async () => {
    render(<WorldMarkers />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: false }));
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:world-marker:add', {
        detail: { id: 'behind-1', kind: 'enemy', position: { x: 0, y: 0, z: 0 } },
      }));
    });
    await waitFrame();
    expect(document.querySelector('[data-marker-id="behind-1"]')).toBeNull();
  });

  it('the emitWorldMarker/clearWorldMarker helpers actually drive a mounted instance end to end', async () => {
    render(<WorldMarkers />);
    dispatchProjector(() => ({ x: 50, y: 50, visible: true }));
    act(() => { emitWorldMarker({ id: 'ally-1', kind: 'ally', position: { x: 1, y: 0, z: 1 } }); });
    await waitFrame();
    expect(document.querySelector('[data-marker-id="ally-1"]')).toBeTruthy();

    act(() => { clearWorldMarker('ally-1'); });
    await waitFrame();
    expect(document.querySelector('[data-marker-id="ally-1"]')).toBeNull();
  });
});
