/**
 * /lenses/carpentry — real-engine composition contract for the Carpentry lens.
 *
 * 2026-07-09 rebuild: the lens used to wrap the real carpentry engine in a
 * generic artifact-CRUD shell (MODE_TABS: Job/Estimate/CodeRef/Material/
 * Client/Invoice/Inspection/Certification persisted through the
 * domain-agnostic /api/lens/carpentry artifact store) plus a
 * `<ManifestActionBar>` and a `<UniversalActions>` "analyze" button that
 * called nothing carpentry-specific. That generic scaffold has been removed;
 * the page now composes the three real, already-macro-backed panels
 * directly (JobOps, CarpentryShop, WoodSpeciesReference — each covered by
 * its own tests / the carpentry-lens-macros server test). This test pins
 * that composition and that the generic scaffold does NOT come back.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => React.createElement('span', { 'data-testid': 'depth-badge' }) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => React.createElement('div', { 'data-testid': 'recent-mine-card' }) }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => React.createElement('div', { 'data-testid': 'auto-action-strip' }) }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => React.createElement('div', { 'data-testid': 'cross-lens-recents' }) }));

// the three real, macro-backed panels — marker stubs so we can assert they mount.
vi.mock('@/components/carpentry/CarpentryShop', () => ({ CarpentryShop: () => React.createElement('div', { 'data-testid': 'carpentry-shop' }) }));
vi.mock('@/components/carpentry/JobOps', () => ({ JobOps: () => React.createElement('div', { 'data-testid': 'job-ops' }) }));
vi.mock('@/components/carpentry/WoodSpeciesReference', () => ({ WoodSpeciesReference: () => React.createElement('div', { 'data-testid': 'wood-species-reference' }) }));

import CarpentryLensPage from '@/app/lenses/carpentry/page';

describe('carpentry lens — real-engine composition (no generic scaffold)', () => {
  it('renders the page title and description', () => {
    const { getByText } = render(<CarpentryLensPage />);
    expect(getByText('Carpentry')).toBeInTheDocument();
    expect(getByText(/Cut lists, material takeoffs, crew dispatch/i)).toBeInTheDocument();
  });

  it('mounts the three real macro-backed panels: JobOps, CarpentryShop, WoodSpeciesReference', () => {
    const { getByTestId } = render(<CarpentryLensPage />);
    expect(getByTestId('job-ops')).toBeInTheDocument();
    expect(getByTestId('carpentry-shop')).toBeInTheDocument();
    expect(getByTestId('wood-species-reference')).toBeInTheDocument();
  });

  it('does NOT import the generic artifact-CRUD scaffold (use-lens-data / use-lens-artifacts / manifest action bar / universal actions)', () => {
    const src: string = readFileSync(join(__dirname, '../app/lenses/carpentry/page.tsx'), 'utf8');
    expect(src).not.toMatch(/use-lens-data/);
    expect(src).not.toMatch(/use-lens-artifacts/);
    expect(src).not.toMatch(/ManifestActionBar/);
    expect(src).not.toMatch(/UniversalActions/);
  });

  it('mounts the discovery sentinels (recent/auto-action/cross-lens) alongside real depth', () => {
    const { getByTestId } = render(<CarpentryLensPage />);
    expect(getByTestId('recent-mine-card')).toBeInTheDocument();
    expect(getByTestId('auto-action-strip')).toBeInTheDocument();
    expect(getByTestId('cross-lens-recents')).toBeInTheDocument();
  });
});
