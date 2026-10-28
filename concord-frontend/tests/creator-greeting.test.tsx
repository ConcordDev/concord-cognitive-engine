/**
 * Creator page northstar greeting.
 *
 * The Creator concept (docs/lens-northstar/70) opens on the serif
 * headline "What you made, Ramaj" — royalty math shows up on the
 * piece itself. This pins the page chrome header carrying it with
 * the signed-in username. The provider/work pane are mocked away —
 * the greeting lives in the page chrome's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/creator/KnowledgeEntrepreneurBadge', () => ({ default: () => null }));
vi.mock('@/components/creator/CreatorNav', () => ({
  CreatorNav: () => null,
  CREATOR_COMMANDS: [],
}));
vi.mock('@/components/creator/CreatorProvider', () => ({
  CreatorProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useCreator: () => ({ view: 'home', setView: vi.fn(), me: null, refreshAll: vi.fn() }),
}));
vi.mock('@/components/creator/CreatorWorkPane', () => ({ CreatorWorkPane: () => null }));

import CreatorDashboardPage from '@/app/lenses/creator/page';

describe('Creator page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<CreatorDashboardPage />);
    const greeting = screen.getByTestId('creator-greeting');
    expect(greeting.textContent).toBe('What you made, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
