/**
 * Tier-2 frontend tests for RulerOverlay + DecreePanel.
 *
 * Pins:
 *   - RulerOverlay renders nothing when rulerOfRealmId is null
 *   - RulerOverlay shows realm name + legitimacy + treasury when set
 *   - Rebellion risk ≥ 0.7 surfaces the "REBELLION IMMINENT" warning
 *   - Threats list renders up to 3 entries
 *   - "Issue decree" button fires concordia:panel-open with panelId='decree'
 *   - DecreePanel lists 8 decree kinds
 *   - DecreePanel renders empty-state when myRealm is null
 *   - Selecting a decree shows back/submit + the field inputs
 *   - Mode transitions (combat/dialogue/photo) hide the overlay
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';
import { RulerOverlay } from '@/components/world/concordia-hud/RulerOverlay';
import { DecreePanel } from '@/components/world/concordia-hud/panels/DecreePanel';

function setRuler(extras?: Partial<ReturnType<typeof useHUDContext.getState>>) {
  useHUDContext.setState({
    rulerOfRealmId: 'realm_dinye',
    myRealm: {
      id: 'realm_dinye',
      name: 'Dinye',
      world_id: 'tunya',
      faction_id: 'dinye',
      legitimacy: 65,
      treasury: 1200,
      tax_rate: 0.10,
      capital_settlement_id: 'dinye_seven_villages',
    },
    realmLoyalty: { citizen_count: 23, avg_loyalty: 55 },
    realmRebellionRisk: 0.3,
    activeDecrees: [],
    pendingThreats: [],
    inputMode: 'exploration',
    ...extras,
  });
}

beforeEach(() => {
  // Reset store
  useHUDContext.setState({
    rulerOfRealmId: null,
    myRealm: null,
    realmLoyalty: null,
    realmRebellionRisk: 0,
    activeDecrees: [],
    pendingThreats: [],
    inputMode: 'exploration',
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })));
});

describe('RulerOverlay — visibility', () => {
  it('renders nothing when not ruling any realm', () => {
    const { container } = render(<RulerOverlay />);
    expect(container.querySelector('[data-testid="hud-ruler-overlay"]')).toBeNull();
  });

  it('renders when player is current head of a realm', () => {
    setRuler();
    const { container } = render(<RulerOverlay />);
    const el = container.querySelector('[data-testid="hud-ruler-overlay"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-realm-id')).toBe('realm_dinye');
    expect(container.textContent).toMatch(/Dinye/);
  });

  it('hides in combat mode', () => {
    setRuler({ inputMode: 'combat' });
    const { container } = render(<RulerOverlay />);
    expect(container.querySelector('[data-testid="hud-ruler-overlay"]')).toBeNull();
  });

  it('hides in dialogue mode', () => {
    setRuler({ inputMode: 'dialogue' });
    const { container } = render(<RulerOverlay />);
    expect(container.querySelector('[data-testid="hud-ruler-overlay"]')).toBeNull();
  });

  it('hides in photo mode', () => {
    setRuler({ inputMode: 'photo' });
    const { container } = render(<RulerOverlay />);
    expect(container.querySelector('[data-testid="hud-ruler-overlay"]')).toBeNull();
  });
});

describe('RulerOverlay — content surfaces', () => {
  it('shows legitimacy, treasury, tax rate', () => {
    setRuler();
    const { container } = render(<RulerOverlay />);
    expect(container.textContent).toMatch(/65\/100/);
    expect(container.textContent).toMatch(/1,200 CC/);
    expect(container.textContent).toMatch(/10%/);
  });

  it('shows citizen loyalty aggregate', () => {
    setRuler();
    const { container } = render(<RulerOverlay />);
    expect(container.textContent).toMatch(/55/);
    expect(container.textContent).toMatch(/n=23/);
  });

  it('surfaces REBELLION IMMINENT when risk ≥ 0.7', () => {
    setRuler({ realmRebellionRisk: 0.85 });
    const { container } = render(<RulerOverlay />);
    expect(container.textContent).toMatch(/Rebellion imminent/i);
  });

  it('does NOT show rebellion warning when risk < 0.7', () => {
    setRuler({ realmRebellionRisk: 0.3 });
    const { container } = render(<RulerOverlay />);
    expect(container.textContent).not.toMatch(/Rebellion imminent/i);
  });

  it('lists up to 3 threats', () => {
    setRuler({
      pendingThreats: [
        { kind: 'rebellion', source: 'npc_a', severity: 0.6 },
        { kind: 'rebellion', source: 'npc_b', severity: 0.5 },
        { kind: 'rebellion', source: 'npc_c', severity: 0.4 },
        { kind: 'rebellion', source: 'npc_d', severity: 0.3 },
      ],
    });
    const { container } = render(<RulerOverlay />);
    const items = container.querySelectorAll('[data-threat-source]');
    expect(items.length).toBe(3);
    expect(container.textContent).toMatch(/\+1 more/);
  });
});

describe('RulerOverlay — issue decree button', () => {
  it('fires concordia:panel-open with panelId=decree', () => {
    setRuler();
    const events: Array<{ panelId?: string }> = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('concordia:panel-open', listener);
    const { container } = render(<RulerOverlay />);
    const btn = container.querySelector('button[aria-label="Issue decree"]')!;
    fireEvent.click(btn);
    expect(events.length).toBe(1);
    expect(events[0].panelId).toBe('decree');
    window.removeEventListener('concordia:panel-open', listener);
  });
});

describe('DecreePanel — empty state', () => {
  it('shows "do not rule" message when myRealm is null', () => {
    useHUDContext.setState({ rulerOfRealmId: null, myRealm: null });
    const { container } = render(<DecreePanel />);
    expect(container.textContent).toMatch(/don.t rule a realm/i);
  });
});

describe('DecreePanel — 8 decree kinds', () => {
  it('lists all 8 decree types', () => {
    setRuler();
    const { container } = render(<DecreePanel />);
    const buttons = container.querySelectorAll('button[data-decree-kind]');
    expect(buttons.length).toBe(8);
  });

  it('selecting a decree shows the back/submit + field inputs', () => {
    setRuler();
    const { container } = render(<DecreePanel />);
    const festivalBtn = container.querySelector('button[data-decree-kind="festival"]') as HTMLButtonElement;
    act(() => { festivalBtn.click(); });
    expect(container.querySelector('button[aria-label="Back"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Submit decree"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Theme"]')).not.toBeNull();
  });

  it('Back button returns to the decree list', () => {
    setRuler();
    const { container } = render(<DecreePanel />);
    act(() => { (container.querySelector('button[data-decree-kind="festival"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('button[data-decree-kind="festival"]')).toBeNull();
    act(() => { (container.querySelector('button[aria-label="Back"]') as HTMLButtonElement).click(); });
    expect(container.querySelectorAll('button[data-decree-kind]').length).toBe(8);
  });
});
