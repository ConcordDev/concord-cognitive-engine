/**
 * Theme 5 (game-feel pass): DamageBillboard overlay tests.
 *
 * Pins:
 *   - Renders a billboard for a `concordia:damage-billboard` event with
 *     position + value
 *   - Multiple events stack
 *   - Hard cap of 32 entries enforced
 *   - kind ('hit'|'crit'|'block'|'dodge'|'kill') drives colour class
 *   - Auto-removes after ttlMs has elapsed
 *   - Hides when projector returns visible=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

import { DamageBillboard } from '@/components/world/DamageBillboard';

type Projector = (w: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean } | null;

function dispatchProjector(stub: Projector) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:projector-ready', {
      detail: { project: stub },
    }));
  });
}

function dispatchSpawn(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:damage-billboard', { detail }));
  });
}

async function waitFrame(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('DamageBillboard', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no events have fired', () => {
    const { container } = render(<DamageBillboard />);
    expect(container.querySelector('[data-testid="damage-billboard-layer"]')).toBeNull();
  });

  it('spawns a billboard for a damage-billboard event', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    dispatchSpawn({ position: { x: 0, y: 0, z: 0 }, value: '17', kind: 'hit', ttlMs: 1500 });
    await waitFrame();
    const els = document.querySelectorAll('[data-billboard-id]');
    expect(els.length).toBe(1);
    expect(els[0]?.textContent).toBe('17');
    expect(els[0]?.getAttribute('data-billboard-kind')).toBe('hit');
  });

  it('crits use a different colour class (visual differentiation)', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    dispatchSpawn({ position: { x: 0, y: 0, z: 0 }, value: '99', kind: 'crit' });
    await waitFrame();
    const el = document.querySelector('[data-billboard-id]');
    expect(el?.getAttribute('data-billboard-kind')).toBe('crit');
    expect(el?.className.includes('text-red-300')).toBe(true);
  });

  it('multiple events stack, capped at 32', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    for (let i = 0; i < 50; i++) {
      dispatchSpawn({ position: { x: 0, y: 0, z: 0 }, value: String(i), ttlMs: 5000 });
    }
    await waitFrame();
    expect(document.querySelectorAll('[data-billboard-id]').length).toBeLessThanOrEqual(32);
  });

  it('auto-removes entries after ttlMs', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    dispatchSpawn({ position: { x: 0, y: 0, z: 0 }, value: '7', ttlMs: 100 });
    await waitFrame(50);
    expect(document.querySelectorAll('[data-billboard-id]').length).toBeGreaterThanOrEqual(1);
    // Wait past ttl + a couple throttle frames so the cull pass runs
    await waitFrame(300);
    expect(document.querySelectorAll('[data-billboard-id]').length).toBe(0);
  });

  it('skips invisible projections', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: false }));
    dispatchSpawn({ position: { x: 0, y: 0, z: 0 }, value: '5' });
    await waitFrame();
    expect(document.querySelectorAll('[data-billboard-id]').length).toBe(0);
  });

  it('ignores spawn events without position', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    dispatchSpawn({ value: '10' });
    await waitFrame();
    expect(document.querySelectorAll('[data-billboard-id]').length).toBe(0);
  });

  it('ignores spawn events without value', async () => {
    render(<DamageBillboard />);
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    dispatchSpawn({ position: { x: 0, y: 0, z: 0 } });
    await waitFrame();
    expect(document.querySelectorAll('[data-billboard-id]').length).toBe(0);
  });
});
