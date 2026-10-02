/// <reference types="@testing-library/jest-dom/vitest" />
// Frontier destination page — tab-switching behavior.
//
// Pins the real routing logic in app/lenses/frontier/page.tsx: the
// default engine's panel mounts on load, clicking a tab for another
// BUILT engine swaps in that engine's real panel, and clicking a tab for
// a NOT-YET-BUILT engine renders the honest UnbuiltEnginePanel state —
// never a built panel for an engine the registry doesn't mark
// `built:true`. The three real panel components are mocked here (each
// replaced with a marker rendering `engine.id`) so this file tests the
// PAGE's own selection/routing logic in isolation from each panel's own
// network behavior, which is covered separately in
// components/frontier/panels/MaterialsDegradationPanel.test.tsx.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

function markerPanel(prefix: string) {
  return { default: ({ engine }: { engine: FrontierEngineDef }) => <div data-testid="active-panel">{prefix}:{engine.id}</div> };
}
vi.mock('@/components/frontier/panels/MaterialsDegradationPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/FsiPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/SafetyEnvelopePanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/QecDecoderPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/ModelCheckerPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/ConsensusPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/MarketEquilibriumPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/ConstantTimePanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/PaillierPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/SpikingNetworkPanel', () => markerPanel('built'));
vi.mock('@/components/frontier/panels/UnbuiltEnginePanel', () => markerPanel('unbuilt'));

// All ten real engines now ship a panel, so the registry no longer contains
// a `built:false` entry to exercise the unbuilt-routing rule against. Rather
// than delete that guarantee (the rule is what stops a future engine being
// registered with no panel behind it), append ONE synthetic unbuilt engine to
// the registry the page reads. It is test-only and never reaches the app.
vi.mock('@/lib/frontier-engines', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/frontier-engines')>();
  const synthetic = { ...actual.FRONTIER_ENGINES[0], id: 'synthetic-unbuilt', name: 'Synthetic Unbuilt', shortName: 'SyntheticUnbuilt', built: false };
  return { ...actual, FRONTIER_ENGINES: [...actual.FRONTIER_ENGINES, synthetic] };
});

import FrontierPage from './page';
import { FRONTIER_ENGINES, DEFAULT_FRONTIER_ENGINE_ID } from '@/lib/frontier-engines';

describe('Frontier destination page', () => {
  it('renders every engine as a tab and mounts the default (first) engine\'s panel on load', () => {
    render(<FrontierPage />);
    expect(screen.getByTestId('active-panel')).toHaveTextContent(`built:${DEFAULT_FRONTIER_ENGINE_ID}`);
    for (const engine of FRONTIER_ENGINES) {
      expect(screen.getByRole('button', { name: new RegExp(escapeRe(engine.shortName)) })).toBeInTheDocument();
    }
  });

  it('switches to another BUILT engine\'s real panel on tab click', () => {
    render(<FrontierPage />);
    fireEvent.click(screen.getByRole('button', { name: /Safety Envelope/ }));
    expect(screen.getByTestId('active-panel')).toHaveTextContent('built:safety-envelope');

    fireEvent.click(screen.getByRole('button', { name: /^FSI$/ }));
    expect(screen.getByTestId('active-panel')).toHaveTextContent('built:non-newtonian-fsi');
  });

  it('renders the honest unbuilt state — never a built panel — for an engine not yet shipped', () => {
    render(<FrontierPage />);
    const unbuilt = FRONTIER_ENGINES.find((e) => e.id === 'synthetic-unbuilt')!;
    expect(unbuilt.built).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(escapeRe(unbuilt.shortName)) }));
    expect(screen.getByTestId('active-panel')).toHaveTextContent('unbuilt:synthetic-unbuilt');
  });

  it('every engine currently built:true in the registry has a real panel mounted (no orphaned flip)', () => {
    render(<FrontierPage />);
    for (const engine of FRONTIER_ENGINES.filter((e) => e.built)) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(escapeRe(engine.shortName)) }));
      expect(screen.getByTestId('active-panel')).toHaveTextContent(`built:${engine.id}`);
    }
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
