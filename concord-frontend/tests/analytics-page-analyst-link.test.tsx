/**
 * /lenses/analytics — the floating "Ask the analyst" control (Review 4, F13).
 *
 * The button used to open the in-lens actions bench while wearing the
 * analyst's name; the real analyst is the Chat surface at
 * /lenses/chat?context=analytics (the same destination the Lens tools menu's
 * "Ask about Analytics" already uses). These tests pin the fixed routing:
 * the control is a link to that destination, and the actions bench remains
 * reachable via its own tab.
 *
 * Heavy children (shell, desk panels) are mocked to null/passthrough — the
 * behaviour under test is the page shell's own routing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => null,
}));
vi.mock('@/components/lens/LiveIndicator', () => ({
  LiveIndicator: () => null,
}));
vi.mock('@/components/analytics/AnalyticsDeskPanel', () => ({
  AnalyticsDeskPanel: () => null,
}));
vi.mock('@/components/analytics/PlatformGrowth', () => ({
  PlatformGrowth: () => null,
}));
vi.mock('@/components/analytics/EventAnalytics', () => ({
  EventAnalytics: () => null,
}));
vi.mock('@/components/analytics/AdvancedAnalytics', () => ({
  AdvancedAnalytics: () => null,
}));
vi.mock('@/components/analytics/FunnelsPanel', () => ({
  FunnelsPanel: () => null,
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => undefined }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => undefined }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => undefined }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ isLive: true, lastUpdated: null }),
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) =>
      React.createElement('div', props, props.children as React.ReactNode),
  }),
}));

import AnalyticsPage from '@/app/lenses/analytics/page';

describe('analytics page — Ask the analyst routing (F13)', () => {
  it('the analyst control links to Chat with the analytics context', () => {
    render(<AnalyticsPage />);
    const link = screen.getByRole('link', { name: /Ask the analyst/ });
    expect(link.getAttribute('href')).toBe('/lenses/chat?context=analytics');
  });

  it('the actions bench remains reachable via its own tab', () => {
    render(<AnalyticsPage />);
    expect(screen.getByRole('button', { name: /Actions/ })).toBeTruthy();
  });
});
