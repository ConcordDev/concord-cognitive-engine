// CriViewSwitch.test.tsx
//
// FIX-cri-005 premise check: from Quality loop, clicking the top-level
// Distribution tab highlighted Distribution but left the Quality loop
// pane on screen. This pin drives the real cri page shell with marker
// panels and asserts every top-level view actually swaps the pane.
// (At branch state the single-view-union shell swaps correctly — the
// walk-era failure does not reproduce; the pin guards the contract.)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], alerts: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/cri/ScoresPanel', () => ({
  ScoresPanel: () => React.createElement('div', null, 'SCORES PANE'),
  DistributionPanel: () => React.createElement('div', null, 'DISTRIBUTION PANE'),
}));
vi.mock('@/components/cri/QualityLoopPanel', () => ({
  QualityLoopPanel: () => React.createElement('div', null, 'QUALITY LOOP PANE'),
}));
vi.mock('@/components/cri/CrisisActionPanel', () => ({
  CrisisActionPanel: () => React.createElement('div', null, 'CRISIS PANE'),
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({ children, ...p }: Record<string, unknown>) => React.createElement('div', p, children as React.ReactNode),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import CRILensPage from '@/app/lenses/cri/page';

describe('cri top-level view switching (FIX-cri-005 premise)', () => {
  afterEach(() => cleanup());

  it('Quality loop → Distribution swaps the pane (the audit path)', () => {
    render(React.createElement(CRILensPage));
    expect(screen.getByText('SCORES PANE')).toBeTruthy();

    fireEvent.click(screen.getByText('Quality loop'));
    expect(screen.getByText('QUALITY LOOP PANE')).toBeTruthy();
    expect(screen.queryByText('SCORES PANE')).toBeNull();

    fireEvent.click(screen.getByText('Distribution'));
    expect(screen.getByText('DISTRIBUTION PANE')).toBeTruthy();
    expect(screen.queryByText('QUALITY LOOP PANE')).toBeNull();

    fireEvent.click(screen.getByText('Scores'));
    expect(screen.getByText('SCORES PANE')).toBeTruthy();
    expect(screen.queryByText('DISTRIBUTION PANE')).toBeNull();
  });
});
