/**
 * FIX-forum-005 — the forum page hand-rolls its floating 'Start a discussion'
 * button (the page renders in LensShell, not NorthStarFrame) and kept the
 * pre-fix wide labelled pill at every width, so at 390px it covered the last
 * card and the bottom nav. Pin the frame's ruled shape: icon-only below sm,
 * accessible name intact, 44px target, HelpButton-line clearance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/forum/ForumSection', () => ({ ForumSection: () => null }));
vi.mock('@/components/forum/FmTopicsPanel', () => ({ requestForumCompose: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], isLive: false, lastUpdated: null }),
}));

import ForumLensPage from '@/app/lenses/forum/page';

describe('FIX-forum-005 — forum FAB mobile shape', () => {
  it('collapses to icon-only below sm with the accessible name intact', () => {
    render(<ForumLensPage />);
    const btn = screen.getByRole('button', { name: 'Start a discussion' });
    expect(btn.className).toMatch(/min-h-\[44px\]/);
    expect(btn.className).toMatch(/px-4/);
    expect(btn.className).toMatch(/sm:px-6/);
    expect(btn.className).toMatch(/bottom-\[calc\(4rem\+env\(safe-area-inset-bottom/);
    expect(btn.className).toMatch(/right-\[4\.75rem\]/);
    const label = Array.from(btn.querySelectorAll('span')).find((s) => s.textContent === 'Start a discussion');
    expect(label, 'label span').toBeTruthy();
    expect(label!.className).toMatch(/hidden/);
    expect(label!.className).toMatch(/sm:inline/);
  });
});
