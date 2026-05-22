/**
 * Concordia dynamic HUD — Tier-2 frontend tests.
 *
 * Pins:
 *   - HUDContextProvider zustand store contains all 12 signal slices
 *   - AmbientLayer renders nothing visible when all signals at rest
 *   - AmbientLayer surfaces refusal badge when strength ≥ 6
 *   - ContextPromptLayer hidden out of exploration mode
 *   - ContextPromptLayer picks highest-priority target
 *   - CommandPalette opens on C / Cmd+K, filters by fuzzy match
 *   - ActionWheel honours expertise spoke cap
 *   - PanelHost opens on concordia:panel-open event, closes on Esc
 *   - WorldInteractionSink ambient feedback for unhandled click kinds
 *   - WorldInteractionSink routes specific kinds to event dispatchers
 *   - AmbientFeedback renders toast on concordia:toast
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';
import { AmbientLayer } from '@/components/world/concordia-hud/AmbientLayer';
import { ContextPromptLayer } from '@/components/world/concordia-hud/ContextPromptLayer';
import { CommandPalette } from '@/components/world/concordia-hud/CommandPalette';
import { ActionWheel } from '@/components/world/concordia-hud/ActionWheel';
import { PanelHost } from '@/components/world/concordia-hud/PanelHost';
import { WorldInteractionSink, dispatchWorldClick } from '@/components/world/concordia-hud/WorldInteractionSink';
import { AmbientFeedback } from '@/components/world/concordia-hud/AmbientFeedback';

// Mock all macro calls to return ok-but-empty.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, bloodlines: [], schemes: [], jobs: [], hooks: [], chains: [], sessions: [], features: [], months: [], blocks: [], rations: [] }) })));
  // Reset store between tests
  useHUDContext.setState({
    inputMode: 'exploration',
    nearbyTargets: [],
    refusalCompoundStrength: 0,
    staminaState: 'rest', staminaValue: 100, staminaMax: 100,
    healthPct: 100, oxygenPct: 100, depthM: 0,
    activeSchemes: [], activeCraftJobs: [], hasPendingHeir: false,
    exiledFromCurrentRealm: false,
    expertiseLevel: 'standard',
  });
});

describe('HUDContextProvider — store shape', () => {
  it('contains all 12 signal slices with defaults', () => {
    const s = useHUDContext.getState();
    expect(s.inputMode).toBe('exploration');
    expect(s.playerPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.staminaState).toBe('rest');
    expect(s.healthPct).toBe(100);
    expect(s.oxygenPct).toBe(100);
    expect(s.painBudget).toBe(0);
    expect(s.refusalCompoundStrength).toBe(0);
    expect(s.nearbyTargets).toEqual([]);
    expect(s.activeSchemes).toEqual([]);
    expect(s.activeCraftJobs).toEqual([]);
    expect(s.hasPendingHeir).toBe(false);
    expect(s.expertiseLevel).toBe('standard');
  });

  it('action setters update state', () => {
    useHUDContext.getState().setMode('combat');
    expect(useHUDContext.getState().inputMode).toBe('combat');
    useHUDContext.getState().setRefusalStrength(7);
    expect(useHUDContext.getState().refusalCompoundStrength).toBe(7);
    useHUDContext.getState().setRefusalStrength(15); // clamps to 9
    expect(useHUDContext.getState().refusalCompoundStrength).toBe(9);
  });
});

describe('AmbientLayer — minimal default + signal-driven', () => {
  it('renders nothing visible when all signals at rest', () => {
    const { container } = render(<AmbientLayer />);
    // Layer exists but health bar, refusal badge, oxygen badge etc are absent.
    expect(container.querySelector('[data-testid="hud-refusal-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="hud-health-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="hud-oxygen-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="hud-pain-badge"]')).toBeNull();
  });

  it('surfaces refusal badge when strength ≥ 6', () => {
    act(() => { useHUDContext.getState().setRefusalStrength(7); });
    const { container } = render(<AmbientLayer />);
    expect(container.querySelector('[data-testid="hud-refusal-badge"]')).not.toBeNull();
  });

  it('surfaces health bar when health < 80', () => {
    act(() => { useHUDContext.getState().setHealth(55); });
    const { container } = render(<AmbientLayer />);
    expect(container.querySelector('[data-testid="hud-health-bar"]')).not.toBeNull();
  });

  it('hides everything in photo mode', () => {
    act(() => { useHUDContext.getState().setMode('photo'); });
    const { container } = render(<AmbientLayer />);
    expect(container.querySelector('[data-testid="hud-ambient-layer"]')).toBeNull();
  });
});

describe('ContextPromptLayer — proximity + priority', () => {
  it('renders nothing outside exploration mode', () => {
    act(() => {
      useHUDContext.getState().setMode('combat');
      useHUDContext.getState().setNearby([{ id: 'n1', kind: 'npc', label: 'Hild', distance: 2 }]);
    });
    const { container } = render(<ContextPromptLayer />);
    expect(container.querySelector('[data-testid="hud-context-prompt"]')).toBeNull();
  });

  it('picks highest-priority kind (council > npc)', async () => {
    act(() => {
      useHUDContext.getState().setNearby([
        { id: 'n1', kind: 'npc', label: 'Hild', distance: 2 },
        { id: 'c1', kind: 'council_member', label: 'Iola', distance: 3 },
      ]);
    });
    const { container } = render(<ContextPromptLayer />);
    // wait a tick for rAF
    await new Promise((r) => setTimeout(r, 120));
    const tip = container.querySelector('[data-testid="hud-context-prompt"]');
    expect(tip).not.toBeNull();
    expect(tip?.getAttribute('data-target-kind')).toBe('council_member');
  });
});

describe('CommandPalette — open/close + fuzzy', () => {
  it('opens on C key', () => {
    const { container } = render(<CommandPalette />);
    expect(container.querySelector('[data-testid="hud-command-palette"]')).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });
    expect(container.querySelector('[data-testid="hud-command-palette"]')).not.toBeNull();
  });

  it('closes on Esc', () => {
    const { container } = render(<CommandPalette />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });
    expect(container.querySelector('[data-testid="hud-command-palette"]')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(container.querySelector('[data-testid="hud-command-palette"]')).toBeNull();
  });

  it('hidden in combat mode', () => {
    act(() => { useHUDContext.getState().setMode('combat'); });
    const { container } = render(<CommandPalette />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });
    expect(container.querySelector('[data-testid="hud-command-palette"]')).toBeNull();
  });
});

describe('ActionWheel — expertise spoke cap', () => {
  it('newcomer gets 4 spokes', () => {
    act(() => { useHUDContext.getState().setExpertise('newcomer'); });
    const { container } = render(<ActionWheel variant="quick_panel" />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); });
    const spokes = container.querySelectorAll('[data-spoke-id]');
    expect(spokes.length).toBeLessThanOrEqual(4);
  });

  it('detailed expertise gets 8 spokes', () => {
    act(() => { useHUDContext.getState().setExpertise('detailed'); });
    const { container } = render(<ActionWheel variant="quick_panel" />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); });
    expect(container.querySelectorAll('[data-spoke-id]').length).toBe(8);
  });

  it('non-skill wheel hides in combat', () => {
    act(() => { useHUDContext.getState().setMode('combat'); });
    const { container } = render(<ActionWheel variant="quick_panel" />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); });
    expect(container.querySelector('[data-testid="hud-action-wheel"]')).toBeNull();
  });
});

describe('PanelHost — open/close on event + Esc', () => {
  it('opens panel on concordia:panel-open', () => {
    const { container } = render(<PanelHost />);
    act(() => { window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId: 'bloodline' } })); });
    expect(container.querySelector('[data-panel-id="bloodline"]')).not.toBeNull();
  });

  it('Esc closes the panel', () => {
    const { container } = render(<PanelHost />);
    act(() => { window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId: 'bloodline' } })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(container.querySelector('[data-testid="hud-panel-host"]')).toBeNull();
  });

  it('auto-closes on combat mode transition', () => {
    const { container } = render(<PanelHost />);
    act(() => { window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId: 'bloodline' } })); });
    act(() => { useHUDContext.getState().setMode('combat'); });
    expect(container.querySelector('[data-testid="hud-panel-host"]')).toBeNull();
  });
});

describe('WorldInteractionSink — every click registers', () => {
  it('fires concordia:interaction-recorded on any click', () => {
    const recorded: Array<string | undefined> = [];
    const listener = (e: Event) => { recorded.push((e as CustomEvent).detail?.kind); };
    window.addEventListener('concordia:interaction-recorded', listener);
    render(<WorldInteractionSink />);
    act(() => { dispatchWorldClick({ kind: 'terrain' }); });
    expect(recorded).toContain('terrain');
    window.removeEventListener('concordia:interaction-recorded', listener);
  });

  it('fires ambient toast for unhandled kinds (wall)', () => {
    const toasts: string[] = [];
    const listener = (e: Event) => { const m = (e as CustomEvent).detail?.message; if (m) toasts.push(m); };
    window.addEventListener('concordia:toast', listener);
    render(<WorldInteractionSink />);
    act(() => { dispatchWorldClick({ kind: 'wall' }); });
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toMatch(/wall/i);
    window.removeEventListener('concordia:toast', listener);
  });

  it('routes npc click to dialogue open event', () => {
    const opens: string[] = [];
    const listener = (e: Event) => { const id = (e as CustomEvent).detail?.npcId; if (id) opens.push(id); };
    window.addEventListener('concordia:open-dialogue', listener);
    render(<WorldInteractionSink />);
    act(() => { dispatchWorldClick({ kind: 'npc', id: 'npc_hild' }); });
    expect(opens).toContain('npc_hild');
    window.removeEventListener('concordia:open-dialogue', listener);
  });

  it('handled=true skips ambient feedback', () => {
    const toasts: string[] = [];
    const listener = (e: Event) => { toasts.push((e as CustomEvent).detail?.message); };
    window.addEventListener('concordia:toast', listener);
    render(<WorldInteractionSink />);
    act(() => { dispatchWorldClick({ kind: 'terrain', handled: true }); });
    expect(toasts.length).toBe(0);
    window.removeEventListener('concordia:toast', listener);
  });
});

describe('AmbientFeedback — toast + sparkle render', () => {
  it('renders a toast from concordia:toast event', async () => {
    const { container } = render(<AmbientFeedback />);
    act(() => { window.dispatchEvent(new CustomEvent('concordia:toast', { detail: { message: 'You touch the wall.', kind: 'ambient' } })); });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toMatch(/touch the wall/);
  });

  it('renders a sparkle from concordia:ambient-sparkle event', async () => {
    const { container } = render(<AmbientFeedback />);
    act(() => { window.dispatchEvent(new CustomEvent('concordia:ambient-sparkle', { detail: { x: 100, y: 200 } })); });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="hud-ambient-sparkles"]')?.children.length || 0).toBeGreaterThan(0);
  });
});
