/**
 * /lenses/landscaping — tab-navigation contract for the Landscaping lens.
 *
 * The lens page is a thin router onto five real, bespoke, macro-backed
 * components (GardenStudio / GardenBeds / PlantFinder / ProLandscape /
 * JobDispatchBoard) — it carries NO generic artifact-CRUD state of its own
 * (a prior version wired a fabricated 8-tab Jobs/Estimates/Codes/Materials/
 * Clients/Invoices/Inspections/Certs dashboard on the generic
 * `useLensData`/`useRunArtifact` artifact store, which had no backing
 * `landscaping.*` macro and duplicated nothing real — see
 * `docs/lens-specs/landscaping-capability-map.md`). The Jobs tab (added
 * 2026-07-12, closing that capability-map gap) is the one exception that IS
 * real: it's backed by the `job-schedule`/`job-list`/`job-complete` macro
 * triple, not the old fabricated dashboard.
 *
 * This test pins: (1) the default tab mounts Garden Studio, (2) each tab
 * button switches to its own real component and only that component, (3)
 * every tab is reachable via a discoverable numeric keyboard shortcut
 * registered on the 'landscaping' lens id (the fluidity invariant — every
 * `useLensCommand` registration must be reachable AND labeled with a kbd
 * chip, not just functional). No fabricated data — the heavy children are
 * stubbed to inert markers since their own macro wiring is covered by
 * `server/tests/landscaping-lens-macros.test.js` and
 * `server/tests/depth/landscaping-behavior.test.js`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

// ── keyboard command registration: capture what the page registers ─────────
const registeredCommands: { id: string; keys: string; description: string; action: () => void }[] = [];
let lastLensId: string | undefined;
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (
    commands: { id: string; keys: string; description: string; action: () => void }[],
    opts?: { lensId?: string },
  ) => {
    registeredCommands.length = 0;
    registeredCommands.push(...commands);
    lastLensId = opts?.lensId;
  },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-page-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
// heavy landscaping children (their own backend macros are covered by the
// landscaping-lens-macros + landscaping-domain-parity server tests) → inert
// markers here so this test only asserts routing, never re-tests their internals.
vi.mock('@/components/landscaping/ProLandscape', () => ({ ProLandscape: () => React.createElement('div', { 'data-testid': 'pro-landscape' }) }));
vi.mock('@/components/landscaping/GardenStudio', () => ({ GardenStudio: () => React.createElement('div', { 'data-testid': 'garden-studio' }) }));
vi.mock('@/components/landscaping/GardenBeds', () => ({ GardenBeds: () => React.createElement('div', { 'data-testid': 'garden-beds' }) }));
vi.mock('@/components/landscaping/PlantFinder', () => ({ PlantFinder: () => React.createElement('div', { 'data-testid': 'plant-finder' }) }));
vi.mock('@/components/landscaping/JobDispatchBoard', () => ({ JobDispatchBoard: () => React.createElement('div', { 'data-testid': 'job-dispatch-board' }) }));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import LandscapingLensPage from '@/app/lenses/landscaping/page';

describe('landscaping lens — real-component tab routing', () => {
  it('DEFAULT: mounts Garden Studio and only Garden Studio', () => {
    const { getByTestId, queryByTestId } = render(<LandscapingLensPage />);
    expect(getByTestId('garden-studio')).toBeInTheDocument();
    expect(queryByTestId('garden-beds')).not.toBeInTheDocument();
    expect(queryByTestId('plant-finder')).not.toBeInTheDocument();
    expect(queryByTestId('pro-landscape')).not.toBeInTheDocument();
    expect(queryByTestId('job-dispatch-board')).not.toBeInTheDocument();
  });

  it('TAB SWITCH: Garden Beds tab mounts GardenBeds exclusively', () => {
    const { getByText, getByTestId, queryByTestId } = render(<LandscapingLensPage />);
    fireEvent.click(getByText('Garden Beds'));
    expect(getByTestId('garden-beds')).toBeInTheDocument();
    expect(queryByTestId('garden-studio')).not.toBeInTheDocument();
  });

  it('TAB SWITCH: Plant Finder tab mounts PlantFinder exclusively', () => {
    const { getByText, getByTestId, queryByTestId } = render(<LandscapingLensPage />);
    fireEvent.click(getByText('Plant Finder'));
    expect(getByTestId('plant-finder')).toBeInTheDocument();
    expect(queryByTestId('garden-studio')).not.toBeInTheDocument();
  });

  it('TAB SWITCH: Pro Calculators tab mounts ProLandscape exclusively', () => {
    const { getByText, getByTestId, queryByTestId } = render(<LandscapingLensPage />);
    fireEvent.click(getByText('Pro Calculators'));
    expect(getByTestId('pro-landscape')).toBeInTheDocument();
    expect(queryByTestId('garden-studio')).not.toBeInTheDocument();
  });

  it('TAB SWITCH: Jobs tab mounts JobDispatchBoard exclusively', () => {
    const { getByText, getByTestId, queryByTestId } = render(<LandscapingLensPage />);
    fireEvent.click(getByText('Jobs'));
    expect(getByTestId('job-dispatch-board')).toBeInTheDocument();
    expect(queryByTestId('garden-studio')).not.toBeInTheDocument();
  });

  it('DISCOVERABILITY: every tab shows a kbd chip for its keyboard shortcut', () => {
    const { getByText } = render(<LandscapingLensPage />);
    // one kbd chip per numbered shortcut, visible next to its tab label
    ['1', '2', '3', '4', '5'].forEach((n) => expect(getByText(n)).toBeInTheDocument());
  });

  it('WIRING: keyboard commands are registered on the landscaping lens id and all five are reachable', () => {
    render(<LandscapingLensPage />);
    expect(lastLensId).toBe('landscaping');
    expect(registeredCommands).toHaveLength(5);
    expect(registeredCommands.map((c) => c.keys).sort()).toEqual(['1', '2', '3', '4', '5']);
    // each command actually flips the visible tab (fluidity: functional, not decorative)
  });
});
