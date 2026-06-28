// Wiring + four-UX-state test for the move-builder lens page.
//
// Drives the mocked `move-builder.*` macros through every state the page can be
// in: loading (role=status), error (role=alert + working Retry), empty
// (populated catalog, zero minted moves), and populated (a minted move in the
// list). Also asserts the real macro names the page calls — pinning that the
// previously-dangling `lens.move-builder.*` phantom refs are gone and the page
// reaches the registered `move-builder` domain.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
// LensShell pulls in the UI store / a11y context — stub to a passthrough so the
// test focuses on the page's own four states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MoveBuilderLensPage from '@/app/lenses/move-builder/page';

const CATALOG = {
  ok: true,
  skillKinds: ['fighting_style', 'spell', 'biopower', 'cyber_ability'],
  elements: ['fire', 'ice', 'lightning', 'physical'],
  aspects: ['power', 'speed', 'area', 'efficiency', 'control'],
  defaultBudget: 6,
};

const COMPOSED = {
  ok: true, skillKind: 'spell', element: 'fire', tier: 1,
  motion: {
    motionFamily: 'magic', motionArchetype: 'cast_channel', effectArchetype: 'projectile',
    element: 'fire', resourceGauge: 'mana', leadingLimb: 'both_arms', targetShape: 'single',
  },
  budget: { ok: true, spent: 5, budget: 6, overspent: false, balanced: true, dominantAspect: 'power', effective: { power: 1.9, speed: 1, area: 1, efficiency: 1, control: 0 } },
};

// Route a mocked lensRun call to the right canned response by (domain, action).
function router(moves: unknown[]) {
  return (domain: string, action: string) => {
    if (domain !== 'move-builder') throw new Error(`unexpected domain ${domain}`);
    if (action === 'catalog') return Promise.resolve({ data: { ok: true, result: CATALOG } });
    if (action === 'list') return Promise.resolve({ data: { ok: true, result: { ok: true, moves } } });
    if (action === 'compose') return Promise.resolve({ data: { ok: true, result: COMPOSED } });
    if (action === 'mint') return Promise.resolve({ data: { ok: true, result: { ok: true, moveId: 'move:u1:abcd1234', name: 'Cinder Lance' } } });
    return Promise.resolve({ data: { ok: true, result: { ok: true } } });
  };
}

describe('move-builder lens — wiring + four UX states', () => {
  // Pending catalog/list promises that the loading test holds open; resolved in
  // afterEach so a never-settling render can't bleed into the next test.
  let pendingResolvers: Array<(v: unknown) => void> = [];

  beforeEach(() => { lensRun.mockReset(); pendingResolvers = []; });
  afterEach(() => {
    pendingResolvers.forEach((r) => r({ data: { ok: true, result: { ok: true, moves: [] } } }));
    pendingResolvers = [];
    cleanup();
  });

  it('shows a loading state (role=status) before data resolves', async () => {
    // Catalog/list stay pending → the page stays in its loading state.
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'compose') return Promise.resolve({ data: { ok: true, result: COMPOSED } });
      return new Promise((resolve) => { pendingResolvers.push(resolve); });
    });
    render(<MoveBuilderLensPage />);
    expect(await screen.findByRole('status')).toHaveTextContent(/loading/i);
  });

  it('shows an error state (role=alert) with a working Retry on load failure', async () => {
    let attempt = 0;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'compose') return Promise.resolve({ data: { result: COMPOSED } });
      attempt += 1;
      if (attempt <= 2) return Promise.resolve({ data: { ok: false, result: null, error: 'backend down' } });
      // After retry, succeed.
      if (action === 'catalog') return Promise.resolve({ data: { ok: true, result: CATALOG } });
      return Promise.resolve({ data: { ok: true, result: { ok: true, moves: [] } } });
    });
    render(<MoveBuilderLensPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/backend down/i);

    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    // After retry the populated builder renders (no alert).
    expect(await screen.findByLabelText(/move name/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the empty state when no moves are minted', async () => {
    lensRun.mockImplementation(router([]));
    render(<MoveBuilderLensPage />);
    expect(await screen.findByText(/no moves yet/i)).toBeInTheDocument();
    // The compose surface is present + a11y-labelled.
    expect(screen.getByLabelText(/element/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/skill kind/i)).toBeInTheDocument();
  });

  it('renders the populated state with a minted move, and calls the REAL macros', async () => {
    lensRun.mockImplementation(router([
      { id: 'move:u1:abcd1234', name: 'Cinder Lance', element: 'fire', skillKind: 'spell', tier: 1 },
    ]));
    render(<MoveBuilderLensPage />);

    expect(await screen.findByText('Cinder Lance')).toBeInTheDocument();
    // The live preview is a pure function of the compose macro.
    await waitFor(() => expect(screen.getByText(/projectile/)).toBeInTheDocument());

    // It reached the REAL `move-builder` domain (not the phantom `lens.move-builder.*`).
    const domains = lensRun.mock.calls.map((c) => c[0]);
    const actions = lensRun.mock.calls.map((c) => c[1]);
    expect(domains.every((d) => d === 'move-builder')).toBe(true);
    expect(actions).toContain('catalog');
    expect(actions).toContain('list');
    expect(actions).toContain('compose');
  });

  it('mint is disabled until a name is entered, then fires move-builder.mint', async () => {
    lensRun.mockImplementation(router([]));
    render(<MoveBuilderLensPage />);

    const mintBtn = await screen.findByRole('button', { name: /mint move/i });
    expect(mintBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/move name/i), { target: { value: 'Cinder Lance' } });
    await waitFor(() => expect(mintBtn).not.toBeDisabled());

    fireEvent.click(mintBtn);
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[0] === 'move-builder' && c[1] === 'mint')).toBe(true),
    );
    expect(await screen.findByText(/Minted "Cinder Lance"/)).toBeInTheDocument();
  });
});
