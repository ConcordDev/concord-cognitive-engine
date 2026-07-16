/// <reference types="@testing-library/jest-dom/vitest" />
// Behavior test for FashionSocialPanel — the real community outfit feed
// (fashion.social-* macros). Pins two closed gaps from
// docs/lens-specs/fashion-capability-map.md checklist #16 ("Social feed is
// global, not friends-scoped; no clone item action"): the friends-only feed
// toggle (fashion.social-feed's `friendsOnly` param) and the per-item
// "Clone to my closet" action (fashion.social-clone-item). Mocks lensRun —
// no real backend — and asserts the component calls the real macros with
// the right params rather than filtering/faking anything client-side.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { FashionSocialPanel } from './FashionSocialPanel';

interface CommunityPost {
  id: string; ownerLabel: string; caption: string; occasion: string; season: string;
  itemNames: string[]; itemIds: string[]; likes: number; saves: number; likedByMe: boolean;
  savedByMe: boolean; mine: boolean; createdAt: string;
}

const FRIEND_POST: CommunityPost = {
  id: 'fp_1', ownerLabel: 'Stylist a1b2', caption: 'Friday fit', occasion: 'casual', season: 'all',
  itemNames: ['Silk shirt'], itemIds: ['itm_shirt'], likes: 0, saves: 0, likedByMe: false,
  savedByMe: false, mine: false, createdAt: '2026-01-01T00:00:00.000Z',
};

const MY_POST: CommunityPost = {
  id: 'fp_2', ownerLabel: 'You', caption: 'My own fit', occasion: 'casual', season: 'all',
  itemNames: ['My shirt'], itemIds: ['itm_mine'], likes: 0, saves: 0, likedByMe: false,
  savedByMe: false, mine: true, createdAt: '2026-01-02T00:00:00.000Z',
};

function mockSocialMacros(opts: {
  globalPosts: CommunityPost[];
  friendsPosts: CommunityPost[];
  onClone?: (input: Record<string, unknown>) => { ok: boolean; error?: string; item?: Record<string, unknown> };
}) {
  lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'fashion') return { data: { ok: true, result: {}, error: null } };
    if (action === 'social-feed') {
      const friendsOnly = input?.friendsOnly === true;
      const posts = friendsOnly ? opts.friendsPosts : opts.globalPosts;
      return { data: { ok: true, result: { posts, count: posts.length, friendsOnly }, error: null } };
    }
    if (action === 'outfit-list') {
      return { data: { ok: true, result: { outfits: [], count: 0 }, error: null } };
    }
    if (action === 'social-clone-item') {
      const r = opts.onClone ? opts.onClone(input) : { ok: true, item: { id: 'itm_clone_new' } };
      return { data: { ok: r.ok, result: r, error: r.error ?? null } };
    }
    return { data: { ok: true, result: {}, error: null } };
  });
}

describe('FashionSocialPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the global feed by default (friendsOnly not sent)', async () => {
    mockSocialMacros({ globalPosts: [FRIEND_POST], friendsPosts: [] });
    render(<FashionSocialPanel />);

    await waitFor(() => expect(screen.getByText('Friday fit')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('fashion', 'social-feed', expect.not.objectContaining({ friendsOnly: true }));
  });

  it('toggling "Friends only" calls social-feed with friendsOnly:true and re-renders the scoped result', async () => {
    mockSocialMacros({ globalPosts: [FRIEND_POST, MY_POST], friendsPosts: [MY_POST] });
    render(<FashionSocialPanel />);
    await waitFor(() => expect(screen.getByText('Friday fit')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /friends only/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('fashion', 'social-feed', expect.objectContaining({ friendsOnly: true })));
    await waitFor(() => expect(screen.getByText('My own fit')).toBeInTheDocument());
    expect(screen.queryByText('Friday fit')).not.toBeInTheDocument();
  });

  it('shows an honest empty state for a friends-only feed with zero results — never a silent fallback to the global feed', async () => {
    mockSocialMacros({ globalPosts: [FRIEND_POST], friendsPosts: [] });
    render(<FashionSocialPanel />);
    await waitFor(() => expect(screen.getByText('Friday fit')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /friends only/i }));

    await waitFor(() => expect(screen.getByText(/No looks from friends yet/i)).toBeInTheDocument());
    // The global post must NOT reappear as a fallback.
    expect(screen.queryByText('Friday fit')).not.toBeInTheDocument();
  });

  it('shows a "clone to my closet" button on another stylist\'s item, not on my own post', async () => {
    mockSocialMacros({ globalPosts: [FRIEND_POST, MY_POST], friendsPosts: [] });
    render(<FashionSocialPanel />);
    await waitFor(() => expect(screen.getByText('Friday fit')).toBeInTheDocument());

    expect(screen.getByLabelText('Clone Silk shirt to my closet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Clone My shirt to my closet')).not.toBeInTheDocument();
  });

  it('clicking clone calls fashion.social-clone-item with the real postId + itemId and shows a done state', async () => {
    const onClone = vi.fn(() => ({ ok: true, item: { id: 'itm_clone_new' } }));
    mockSocialMacros({ globalPosts: [FRIEND_POST], friendsPosts: [], onClone });
    render(<FashionSocialPanel />);
    await waitFor(() => expect(screen.getByText('Friday fit')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Clone Silk shirt to my closet'));

    await waitFor(() => expect(onClone).toHaveBeenCalledWith({ postId: 'fp_1', itemId: 'itm_shirt' }));
    await waitFor(() => expect(screen.getByLabelText('Clone Silk shirt to my closet')).toBeDisabled());
  });

  it('surfaces an honest backend error instead of silently succeeding on clone', async () => {
    mockSocialMacros({
      globalPosts: [FRIEND_POST], friendsPosts: [],
      onClone: () => ({ ok: false, error: 'item no longer exists in that closet' }),
    });
    render(<FashionSocialPanel />);
    await waitFor(() => expect(screen.getByText('Friday fit')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Clone Silk shirt to my closet'));

    await waitFor(() => expect(screen.getByText('item no longer exists in that closet')).toBeInTheDocument());
    // A failed clone must not be marked done.
    expect(screen.getByLabelText('Clone Silk shirt to my closet')).not.toBeDisabled();
  });
});
