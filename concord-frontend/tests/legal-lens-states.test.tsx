/**
 * /lenses/legal — workbench-switcher contract for the Legal Practice lens.
 *
 * The lens was rebuilt (2026-07) to remove a parallel generic-CRUD tab
 * system (Cases/Documents/TimeBilling/Calendar/Contacts/Contracts/
 * Compliance backed by useLensData('legal','artifact')) that duplicated,
 * and was strictly inferior to, the real Clio-parity backend already
 * wired through ClioSection. The page is now five bespoke workbenches
 * (Practice/Analyzer/Docket/Q&A/Case Law), each a real independently-
 * wired component — see docs/lens-specs/legal-capability-map.md.
 *
 * This test pins: (1) the default workbench is Practice (ClioSection
 * mounts), (2) each workbench button switches to its own real component
 * and unmounts the others (no two workbenches render at once), (3) the
 * always-on surfaces (disclaimer, LegalActionPanel, live feed) render
 * regardless of workbench, (4) no leftover generic-scaffold components
 * (UniversalActions / LensFeaturePanel / RecentMineCard / AutoActionStrip)
 * are imported by the page.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));

// ── headless chrome: render-only stubs ──────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({
  LensFeedPanel: () => React.createElement('div', { 'data-testid': 'lens-feed-panel' }),
}));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

// ── the five real workbench components — identifiable stand-ins so we can
//    assert exactly one mounts at a time, driven by real button clicks ────
vi.mock('@/components/legal/ClioSection', () => ({
  ClioSection: () => React.createElement('div', { 'data-testid': 'wb-practice' }, 'ClioSection'),
}));
vi.mock('@/components/legal/ContractAnalyzer', () => ({
  default: () => React.createElement('div', { 'data-testid': 'wb-analyzer' }, 'ContractAnalyzer'),
}));
vi.mock('@/components/legal/CaseTracker', () => ({
  default: () => React.createElement('div', { 'data-testid': 'wb-docket' }, 'CaseTracker'),
}));
vi.mock('@/components/legal/LegalQA', () => ({
  default: () => React.createElement('div', { 'data-testid': 'wb-qa' }, 'LegalQA'),
}));
vi.mock('@/components/legal/LegalCaseSearch', () => ({
  LegalCaseSearch: () => React.createElement('div', { 'data-testid': 'wb-caselaw' }, 'LegalCaseSearch'),
}));
vi.mock('@/components/legal/LegalActionPanel', () => ({
  LegalActionPanel: () => React.createElement('div', { 'data-testid': 'legal-action-panel' }, 'LegalActionPanel'),
}));

import LegalLens from '@/app/lenses/legal/page';

const WORKBENCHES = [
  { testId: 'wb-practice', buttonText: 'Practice' },
  { testId: 'wb-analyzer', buttonText: 'Analyzer' },
  { testId: 'wb-docket', buttonText: 'Docket' },
  { testId: 'wb-qa', buttonText: 'Q&A' },
  { testId: 'wb-caselaw', buttonText: 'Case Law' },
];

describe('legal lens — workbench switcher', () => {
  it('defaults to the Practice workbench (real ClioSection, not a generic CRUD tab)', () => {
    const { getByTestId, queryByTestId } = render(<LegalLens />);
    expect(getByTestId('wb-practice')).toBeInTheDocument();
    for (const wb of WORKBENCHES.slice(1)) {
      expect(queryByTestId(wb.testId)).toBeNull();
    }
  });

  it.each(WORKBENCHES)('switching to $buttonText mounts exactly its own real component', ({ testId, buttonText }) => {
    const { getByText, getByTestId, queryByTestId } = render(<LegalLens />);
    fireEvent.click(getByText(buttonText));
    expect(getByTestId(testId)).toBeInTheDocument();
    for (const other of WORKBENCHES) {
      if (other.testId !== testId) expect(queryByTestId(other.testId)).toBeNull();
    }
  });

  it('shows the not-legal-advice disclaimer regardless of workbench', () => {
    const { getByText } = render(<LegalLens />);
    expect(getByText(/does not constitute legal advice/i)).toBeInTheDocument();
  });

  it('always mounts the legal workbench action panel (deadlines/renewals/conflicts/audit)', () => {
    const { getByTestId } = render(<LegalLens />);
    expect(getByTestId('legal-action-panel')).toBeInTheDocument();
  });

  it('always mounts the live web feed panel', () => {
    const { getByTestId } = render(<LegalLens />);
    expect(getByTestId('lens-feed-panel')).toBeInTheDocument();
  });
});

describe('legal lens — no leftover generic-scaffold imports', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'lenses', 'legal', 'page.tsx'),
    'utf8'
  );

  it('does not import the generic action-array components', () => {
    expect(source).not.toMatch(/UniversalActions/);
    expect(source).not.toMatch(/LensFeaturePanel/);
  });

  it('does not import the GENERIC_TRIO scaffold components', () => {
    expect(source).not.toMatch(/RecentMineCard/);
    expect(source).not.toMatch(/AutoActionStrip/);
    expect(source).not.toMatch(/ManifestActionBar/);
  });

  it('does not depend on the generic per-lens artifact CRUD store', () => {
    expect(source).not.toMatch(/use-lens-data/);
    expect(source).not.toMatch(/use-lens-artifacts/);
  });
});
