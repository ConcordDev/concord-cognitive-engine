import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

/**
 * /lenses/creatures — closes the Wave 4 inventory gap "No global
 * keyboard-shortcut registration (useLensCommand)" (docs/WAVE4_INVENTORY.md
 * line 142; see docs/lens-specs/creatures-capability-map.md for the finding
 * this closes).
 *
 * Every registered shortcut binds to a REAL, already-existing page action
 * (refresh populations, focus the species-codex search input, focus the
 * lineage-browser input, breed the selected pair) — nothing fabricated.
 *
 * Same mocking convention as tests/components/LfgLensPage.test.tsx /
 * WellnessLensPage.test.tsx (stub @/hooks/useLensCommand instead of standing
 * up a real KeyboardProvider + react-hotkeys-hook), except the mock here
 * CAPTURES the registered command array instead of no-op'ing it, so the
 * shortcut config + bound actions are directly testable: we invoke each
 * command's `action()` exactly as the real hook would when its key fires,
 * and assert the real, observable effect (macro re-dispatched, real input
 * focused, real state mutated) — plus that the visible discoverability
 * affordance (kbd hints / placeholder hints) actually renders.
 */

interface CapturedCommand {
  id: string;
  keys: string;
  description: string;
  category?: string;
  action: () => void;
  enabled?: boolean;
}

let capturedCommands: CapturedCommand[] = [];
let capturedOptions: { lensId: string } | null = null;

vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: CapturedCommand[], options: { lensId: string }) => {
    capturedCommands = commands;
    capturedOptions = options;
  },
}));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import CreaturesLensPage from '@/app/lenses/creatures/page';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

const POP_A = { id: 'pop_a', world_id: 'concordia-hub', biome: 'forest', species_id: 'wolf', lifestyle: 'pack', current_count: 4 };
const POP_B = { id: 'pop_b', world_id: 'concordia-hub', biome: 'forest', species_id: 'deer', lifestyle: 'herd', current_count: 6 };

function wireLensRun(overrides: Partial<Record<string, (input: unknown) => Promise<unknown>>> = {}) {
  lensRun.mockImplementation((domain: string, action: string, input: unknown) => {
    if (domain !== 'creatures') return ok({});
    if (overrides[action]) return overrides[action](input);
    if (action === 'roster') return ok({ ok: true, populations: [POP_A, POP_B] });
    if (action === 'species') return ok({ ok: true, species: [] });
    if (action === 'breed') return ok({ ok: true, hybrid: { id: 'hy_1', species_id: 'wolf-deer' }, stability: 0.7, generation: 1 });
    if (action === 'lineage') return ok({ ok: true, lineage: { self: null, descendants: [] } });
    return ok({});
  });
}

function byId(id: string): CapturedCommand {
  const cmd = capturedCommands.find((c) => c.id === id);
  if (!cmd) throw new Error(`no captured command with id "${id}" (have: ${capturedCommands.map((c) => c.id).join(', ')})`);
  return cmd;
}

const realFetch = global.fetch;

beforeEach(() => {
  capturedCommands = [];
  capturedOptions = null;
  lensRun.mockReset();
  wireLensRun();
  // The page's optional "emotional weather" enrichment hits raw fetch and is
  // wrapped in try/catch in the page — never blocks the real roster load.
  global.fetch = vi.fn().mockRejectedValue(new Error('affect fetch not exercised in this test')) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  vi.clearAllMocks();
});

async function renderPopulated() {
  render(<CreaturesLensPage />);
  await waitFor(() => expect(screen.getByText('wolf')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('deer')).toBeInTheDocument());
}

describe('CreaturesLensPage — keyboard shortcuts (useLensCommand)', () => {
  it('registers all four shortcuts under the creatures lensId', async () => {
    await renderPopulated();
    expect(capturedOptions).toEqual({ lensId: 'creatures' });
    expect(capturedCommands.map((c) => c.id).sort()).toEqual(
      ['breed-pair', 'focus-codex-search', 'focus-lineage', 'refresh-populations'].sort(),
    );
    expect(byId('refresh-populations').keys).toBe('r');
    expect(byId('focus-codex-search').keys).toBe('/');
    expect(byId('focus-lineage').keys).toBe('l');
    expect(byId('breed-pair').keys).toBe('b');
  });

  it('"r" re-dispatches the real creatures.roster macro (the same one the Refresh button calls)', async () => {
    await renderPopulated();
    const rosterCallsBefore = lensRun.mock.calls.filter((c) => c[0] === 'creatures' && c[1] === 'roster').length;

    await act(async () => {
      byId('refresh-populations').action();
      await Promise.resolve();
    });

    await waitFor(() => {
      const rosterCallsAfter = lensRun.mock.calls.filter((c) => c[0] === 'creatures' && c[1] === 'roster').length;
      expect(rosterCallsAfter).toBeGreaterThan(rosterCallsBefore);
    });
  });

  it('"/" focuses the real species-codex search input (id="codex-search")', async () => {
    await renderPopulated();
    const input = screen.getByLabelText('Search species codex');
    expect(document.activeElement).not.toBe(input);

    act(() => { byId('focus-codex-search').action(); });

    expect(document.activeElement).toBe(input);
  });

  it('"l" focuses the real lineage-browser input (id="creature-lineage-id")', async () => {
    await renderPopulated();
    const input = screen.getByLabelText('Creature id');
    expect(document.activeElement).not.toBe(input);

    act(() => { byId('focus-lineage').action(); });

    expect(document.activeElement).toBe(input);
  });

  it('"b" (breed) starts disabled — no pair picked yet, nothing to breed', async () => {
    await renderPopulated();
    expect(byId('breed-pair').enabled).toBe(false);
  });

  it('"b" becomes enabled once a real pair is picked (the same click flow a mouse user drives), and fires the real breed macro', async () => {
    await renderPopulated();

    // Real UI interaction: click the two population cards, exactly like a
    // mouse-driven user picking a crossbreeding pair.
    fireEvent.click(screen.getByText('wolf'));
    fireEvent.click(screen.getByText('deer'));

    await waitFor(() => expect(byId('breed-pair').enabled).toBe(true));

    await act(async () => {
      byId('breed-pair').action();
      await Promise.resolve();
    });

    await waitFor(() => {
      const breedCall = lensRun.mock.calls.find((c) => c[0] === 'creatures' && c[1] === 'breed');
      expect(breedCall).toBeTruthy();
      expect(breedCall![2]).toMatchObject({
        a: { id: 'pop_a', species_id: 'wolf', lifestyle: 'pack' },
        b: { id: 'pop_b', species_id: 'deer', lifestyle: 'herd' },
      });
    });
  });

  it('"b" is disabled again while a breed request is already in flight', async () => {
    let resolveBreed: (v: unknown) => void = () => {};
    wireLensRun({ breed: () => new Promise((resolve) => { resolveBreed = resolve; }) });

    await renderPopulated();
    fireEvent.click(screen.getByText('wolf'));
    fireEvent.click(screen.getByText('deer'));
    await waitFor(() => expect(byId('breed-pair').enabled).toBe(true));

    act(() => { byId('breed-pair').action(); });

    await waitFor(() => expect(byId('breed-pair').enabled).toBe(false));

    // Clean up the in-flight promise so React doesn't warn post-test.
    await act(async () => { resolveBreed({ data: { ok: true, result: { ok: true }, error: null } }); });
  });
});

describe('CreaturesLensPage — shortcut discoverability', () => {
  it('renders a visible kbd hint next to the refresh control', async () => {
    await renderPopulated();
    const kbdTexts = Array.from(document.querySelectorAll('kbd')).map((k) => k.textContent);
    expect(kbdTexts).toContain('R');
  });

  it('names the search-focus shortcut in the codex search placeholder', async () => {
    await renderPopulated();
    const input = screen.getByLabelText('Search species codex') as HTMLInputElement;
    expect(input.placeholder).toMatch(/\/ focuses/);
  });

  it('names the lineage-focus shortcut in the lineage input placeholder', async () => {
    await renderPopulated();
    const input = screen.getByLabelText('Creature id') as HTMLInputElement;
    expect(input.placeholder).toMatch(/L focuses/);
  });

  it('renders a visible kbd hint on the Breed button once a pair is selected', async () => {
    await renderPopulated();
    fireEvent.click(screen.getByText('wolf'));
    fireEvent.click(screen.getByText('deer'));

    const breedButton = await screen.findByRole('button', { name: /Breed/i });
    expect(breedButton.querySelector('kbd')?.textContent).toBe('B');
  });

  it('every registered shortcut has a non-empty human-readable description (surfaced by the global "?" help modal)', async () => {
    await renderPopulated();
    expect(capturedCommands.length).toBeGreaterThan(0);
    for (const cmd of capturedCommands) {
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });
});
