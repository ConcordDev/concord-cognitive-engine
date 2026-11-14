/**
 * Experience Directory stability + owner naming (FIX-experience-005).
 *
 * Three observations from the walk, two of them branch defects:
 *  (a) the Directory tab flashed "(2)" during load, then settled to
 *      "(1)" — while /api/auth/me was still resolving, user.id was
 *      unknown, so the peer filter (ownerId !== user?.id || '')
 *      counted the viewer's OWN portfolio as a peer. The count now
 *      waits for auth + fetch to settle.
 *  (b) the one directory entry was headed 'My Portfolio' — every
 *      portfolio was created with that constant first-person title,
 *      which names nobody and reads as the viewer's own on a peer's
 *      screen. New portfolios are titled for their owner at creation;
 *      a legacy generic title renders as "A peer's portfolio".
 *  (c) the walker's own PRIVATE skill never appearing in Directory is
 *      the documented visibility contract (peers see published
 *      portfolios only) — not pinned here, dispositioned in the slice
 *      record.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useLensDataMock = vi.fn();
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (...args: unknown[]) => useLensDataMock(...args),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn() }),
}));
const authMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authMock() }));

import { CareerPortfolio } from '@/components/experience/CareerPortfolio';

const EMPTY_DATA = { skills: [], experience: [], education: [], endorsements: [], snapshots: [] };
const mine = {
  id: 'p_mine', ownerId: 'me', title: "tester's Portfolio",
  data: { ...EMPTY_DATA, skills: [{ id: 'mixing', name: 'Mixing', category: 'technical', level: 'advanced', yearsExperience: 4, evidence: [] }] },
  meta: { tags: [], status: 'draft', visibility: 'published' },
  createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1,
};
const legacyPeer = {
  id: 'p_probe', ownerId: 'probe-acct', title: 'My Portfolio',
  data: { ...EMPTY_DATA, skills: [{ id: 'probe', name: 'PR2EXP-PROBE-SKILL-1110', category: 'technical', level: 'expert', yearsExperience: 1, evidence: [] }] },
  meta: { tags: [], status: 'draft', visibility: 'published' },
  createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1,
};

const createMock = vi.fn().mockResolvedValue({ ok: true });
function route(mineItems: unknown[], directoryItems: unknown[]) {
  let call = 0;
  useLensDataMock.mockImplementation(() => {
    call += 1;
    const items = call % 2 === 1 ? mineItems : directoryItems;
    return { items, isLoading: false, create: createMock, update: vi.fn(), remove: vi.fn() };
  });
}

beforeEach(() => {
  useLensDataMock.mockReset();
  createMock.mockClear();
  authMock.mockReset();
});

describe('experience directory (FIX-experience-005)', () => {
  it('no count is shown while auth is still resolving (the (2) flash)', () => {
    authMock.mockReturnValue({ user: null, isLoading: true, isAuthenticated: false });
    route([mine], [mine, legacyPeer]);
    render(<CareerPortfolio />);
    const tab = screen.getByRole('tab', { name: /directory/i });
    expect(tab.textContent).not.toMatch(/\(\d+\)/);
  });

  it('once settled, the count is the peer count only (1, never 2)', async () => {
    authMock.mockReturnValue({ user: { id: 'me', username: 'tester', email: '', role: 'user' }, isLoading: false, isAuthenticated: true });
    route([mine], [mine, legacyPeer]);
    render(<CareerPortfolio />);
    expect(await screen.findByRole('tab', { name: /directory \(1\)/i })).toBeInTheDocument();
  });

  it("a legacy 'My Portfolio'-titled peer entry is headed as a peer's, not the viewer's own", async () => {
    authMock.mockReturnValue({ user: { id: 'me', username: 'tester', email: '', role: 'user' }, isLoading: false, isAuthenticated: true });
    route([mine], [mine, legacyPeer]);
    render(<CareerPortfolio />);
    fireEvent.click(await screen.findByRole('tab', { name: /directory \(1\)/i }));
    expect(await screen.findByText("A peer's portfolio")).toBeInTheDocument();
    expect(screen.getByText(/PR2EXP-PROBE-SKILL-1110/)).toBeInTheDocument();
  });

  it("a newly created portfolio is titled for its owner", async () => {
    authMock.mockReturnValue({ user: { id: 'me', username: 'tester', email: '', role: 'user' }, isLoading: false, isAuthenticated: true });
    route([], []);
    render(<CareerPortfolio />);
    const btn = await screen.findByRole('button', { name: /create|build|start/i }).catch(() => null);
    // The empty-state create affordance: fall back to any button that creates.
    const target = btn ?? screen.getAllByRole('button').find((b) => /portfolio/i.test(b.textContent || ''));
    expect(target).toBeTruthy();
    fireEvent.click(target as HTMLElement);
    await vi.waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0].title).toBe("tester's Portfolio");
  });
});
