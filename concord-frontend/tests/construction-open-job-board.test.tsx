// Audit fix sweep (PR #2356) — FIX-construction-010: 'Open job board'
// only called setActive('jobs'), and the job board is the default view —
// from the board itself (the reported case) the click changed nothing.
// The CTA now always lands the user on the board: it switches the view
// if needed and scrolls the board region into view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';

let capturedCta: { onClick: () => void } | null = null;

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children, cta }: { children?: React.ReactNode; cta?: { onClick: () => void } }) => {
    capturedCta = cta ?? null;
    return <div>{children}</div>;
  },
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/components/construction/OshaIncidentSearch', () => ({ OshaIncidentSearch: () => null }));
vi.mock('@/components/construction/ProcorePanel', () => ({ ProcorePanel: () => null }));
vi.mock('@/components/construction/ConstructionActionPanel', () => ({ ConstructionActionPanel: () => null }));
vi.mock('@/components/construction/FieldManagementPanel', () => ({ FieldManagementPanel: () => null }));
vi.mock('@/components/construction/ProjectRegistryPanel', () => ({ ProjectRegistryPanel: () => <div data-testid="registry" /> }));
vi.mock('@/components/construction/bench-store', () => ({
  BenchStoreProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>,
  }),
  useReducedMotion: () => true,
}));

import ConstructionLensPage from '@/app/lenses/construction/page';

const scrollSpy = vi.fn();

beforeEach(() => {
  capturedCta = null;
  scrollSpy.mockClear();
  Element.prototype.scrollIntoView = scrollSpy;
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("construction 'Open job board' — the click always lands on the board", () => {
  it('scrolls the board into view even when the board is already the active view', async () => {
    render(<ConstructionLensPage />);
    expect(document.getElementById('construction-main')).not.toBeNull();
    expect(capturedCta).not.toBeNull();

    // Default active view IS 'jobs' — the reported no-op case.
    await act(async () => { capturedCta!.onClick(); });
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(scrollSpy).toHaveBeenCalled();
  });
});
