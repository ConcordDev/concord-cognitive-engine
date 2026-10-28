/**
 * Message page northstar greeting.
 *
 * The Messages concept (docs/lens-northstar/82) opens on the serif
 * headline "Who wrote, Ramaj" above the inbox/thread split. This
 * pins the page header carrying it with the signed-in username.
 * The view panels are mocked away — the greeting lives in the
 * page's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/message/InboxPanel', () => ({ InboxPanel: () => null }));
vi.mock('@/components/message/WorkbenchPanel', () => ({ WorkbenchPanel: () => null }));
vi.mock('@/components/message/LabelManagerPanel', () => ({ LabelManagerPanel: () => null }));
vi.mock('@/components/message/ConnectPanel', () => ({ ConnectPanel: () => null }));

import MessageLensPage from '@/app/lenses/message/page';

describe('Message page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<MessageLensPage />);
    const greeting = screen.getByTestId('message-greeting');
    expect(greeting.textContent).toBe('Who wrote, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
