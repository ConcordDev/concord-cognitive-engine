// PaperViewSwitch.test.tsx
//
// FIX-paper-004 (investigated): the walk reported the Paper tab
// highlight and the panel content syncing late after switching
// views (Library / Manuscript / Workbench / Discover). At branch
// state the page is a single-view union: ONE `active` state drives
// both the nav's aria-current and the rendered panel in the same
// commit — they cannot diverge in this code. This pin proves the
// swap is synchronous; the only interval is the shell's designed
// 0.16s exit transition under AnimatePresence mode="wait" (mocked
// out here, as in the cri-005 pin). Desk live re-walk decides.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  const names = ['BookMarked', 'FileText', 'Highlighter', 'Plus', 'Search'];
  return Object.fromEntries(names.map((n) => [n, createIcon(n)]));
});
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !['initial', 'animate', 'exit', 'transition'].includes(k))), children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null, adaptToLiveFeedArticles: () => [] }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/paper/LibraryPanel', () => ({ LibraryPanel: () => React.createElement('div', null, 'LIBRARY PANEL') }));
vi.mock('@/components/paper/EditorPanel', () => ({ EditorPanel: () => React.createElement('div', null, 'EDITOR PANEL') }));
vi.mock('@/components/paper/WorkbenchPanel', () => ({ WorkbenchPanel: () => React.createElement('div', null, 'WORKBENCH PANEL') }));
vi.mock('@/components/paper/DiscoverPanel', () => ({ DiscoverPanel: () => React.createElement('div', null, 'DISCOVER PANEL') }));
vi.mock('@/components/paper/PaperLibrary', () => ({ requestAddPaper: () => {} }));

import PaperLensPage from '@/app/lenses/paper/page';

describe('Paper view switching (FIX-paper-004)', () => {
  afterEach(() => cleanup());

  it('highlight and panel swap in the same commit', () => {
    render(React.createElement(PaperLensPage));
    expect(screen.getByText('LIBRARY PANEL')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Library/ }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: /Manuscript/ }));
    expect(screen.getByText('EDITOR PANEL')).toBeTruthy();
    expect(screen.queryByText('LIBRARY PANEL')).toBeNull();
    expect(screen.getByRole('button', { name: /Manuscript/ }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: /Discover/ }));
    expect(screen.getByText('DISCOVER PANEL')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Discover/ }).getAttribute('aria-current')).toBe('page');
  });
});
