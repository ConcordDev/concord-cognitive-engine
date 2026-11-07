// Behaviour coverage for the game-design section shell: project chips, create / edit / export,
// two-step delete, dashboard counters and every tab (child panels stubbed).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
let games = [
  { id: 'g1', title: 'Star Hopper', genre: 'platformer', platform: 'web', pitch: 'Jump between stars' },
  { id: 'g2', title: 'Deep Delve', genre: 'rpg', platform: '', pitch: null },
];
function resultFor(action: string): unknown {
  switch (action) {
    case 'game-list': return { games };
    case 'game-dashboard': return { title: 'Star Hopper', gddSections: 4, mechanics: 3, loops: 2, entities: 8, levels: 5, narrativeNodes: 6 };
    case 'game-export': return { json: '{"title":"Star Hopper"}' };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <span>{children}</span> }),
}));
for (const n of ['GdGddPanel', 'GdMechanicsPanel', 'GdEntitiesPanel', 'GdLevelPanel', 'GdLoopsPanel', 'GdNarrativePanel', 'GdAssetsPanel', 'GdAnimationPanel', 'GdBehaviorPanel', 'GdRuntimePanel', 'GdCollabPanel', 'GdAnalysisPanel', 'AssetStudioPanel', 'CreatureStudioPanel']) {
  vi.doMock(`../${n}`, () => ({ [n]: ({ gameId }: { gameId?: string }) => <span>{n}-stub:{gameId}</span> }));
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
const mount = async () => { const { GameDesignSection } = await import('../GameDesignSection'); const v = render(<GameDesignSection />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  games = [
    { id: 'g1', title: 'Star Hopper', genre: 'platformer', platform: 'web', pitch: 'Jump between stars' },
    { id: 'g2', title: 'Deep Delve', genre: 'rpg', platform: '', pitch: null },
  ];
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
});

describe('GameDesignSection', () => {
  it('shows projects with the dashboard and walks every tab', async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Star Hopper/);
    expect(v.container.textContent).toMatch(/GDD sections/);
    for (const t of ['Design Doc', 'Mechanics', 'Loops', 'Entities', 'Levels', 'Narrative', 'Assets', 'Animation', 'Behavior', 'Play & Test', 'Collab', 'Analysis', 'Asset Studio', 'Creature Studio']) {
      await click(btn(new RegExp(`^${t.replace(/[&]/g, '\\&')}$`)));
    }
    expect(v.container.textContent).toMatch(/CreatureStudioPanel-stub/);
    await click(screen.getByText('Deep Delve'));
    expect(sent().filter((x) => x === 'game-dashboard').length).toBeGreaterThan(1);
  });

  it('creates a game (validated), edits it, exports it and closes the export', async () => {
    const v = await mount();
    await click(btn(/Game$/));
    expect(v.container.textContent).toMatch(/Game title is required/);
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('New game title'), { target: { value: 'New Quest' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Genre'), { target: { value: '' } }); });
    await click(btn(/Game$/));
    expect(lensRunMock.mock.calls.find((c) => actionOf(c) === 'game-create')?.[2]).toEqual({ title: 'New Quest', genre: 'platformer' });
    await click(btn(/Edit/));
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Star Hopper 2' } }); });
    const sel = v.container.querySelector('select') as HTMLSelectElement;
    await act(async () => { fireEvent.change(sel, { target: { value: 'puzzle' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Platform'), { target: { value: 'ios' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('One-line pitch'), { target: { value: 'New pitch' } }); });
    await click(btn(/^Save/));
    expect(sent()).toContain('game-update');
    await click(btn(/Export/));
    expect(v.container.textContent).toMatch(/"title":"Star Hopper"/);
    await click(screen.getByLabelText(/Close whole-project export/i));
    await click(btn(/Edit/));
    await click(btn(/Cancel|Discard/));
  });

  it('arms then confirms a delete, and reports failures with retry', async () => {
    const v = await mount();
    await click(screen.getByLabelText('Delete Star Hopper'));
    await click(btn(/Delete\?/));
    expect(sent()).toContain('game-delete');
    lensRunMock.mockImplementation(async (...a: unknown[]) => ['game-create', 'game-update', 'game-export'].includes(actionOf(a)) ? { data: { ok: false, error: 'server said no' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('New game title'), { target: { value: 'Z' } }); });
    await click(btn(/Game$/));
    expect(v.container.textContent).toMatch(/server said no/);
    await click(btn(/Edit/));
    await click(btn(/^Save/));
    await click(btn(/Cancel|Discard/));
    await click(btn(/Export/));
    expect(v.container.textContent).toMatch(/server said no|Export failed/);
  });

  it('shows the empty state, and a load failure with retry', async () => {
    games = [];
    const v = await mount();
    expect(v.container.textContent).toMatch(/Create a game project/);
    cleanup();
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'game-list' ? { data: { ok: false, error: 'games offline' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/games offline/);
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
    games = [{ id: 'g1', title: 'Back Online', genre: 'rpg', platform: '', pitch: null }];
    await click(btn(/Retry/));
    expect(bad.container.textContent).toMatch(/Back Online/);
    cleanup();
    lensRunMock.mockRejectedValue(new Error('thrown list'));
    const thrown = await mount();
    expect(thrown.container.textContent).toMatch(/thrown list/);
  });
});
