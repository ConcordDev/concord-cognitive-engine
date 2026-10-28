/**
 * Frontier page northstar greeting.
 *
 * The Frontier concept (docs/lens-northstar/78) opens on the serif
 * headline "The beam, Ramaj" — one case, compute when you mean it.
 * The page's h1 previously carried the active engine's name; that
 * name moves to the eyebrow ("Frontier · {engine}") and the h1
 * carries the concept headline with the signed-in username. This
 * pins both. Panel harness mirrors app/lenses/frontier/page.test.tsx.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
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

import FrontierPage from '@/app/lenses/frontier/page';

describe('Frontier page greeting', () => {
  it('opens on the concept headline, engine name in the eyebrow', () => {
    render(<FrontierPage />);
    const greeting = screen.getByTestId('frontier-greeting');
    expect(greeting.textContent).toBe('The beam, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
