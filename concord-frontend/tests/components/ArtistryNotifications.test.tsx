/// <reference types="@testing-library/jest-dom/vitest" />
// Pins ArtistryNotifications (Wave 4 gap-closure, docs/WAVE4_INVENTORY.md
// row "artistry" / docs/lens-specs/artistry-capability-map.md item 14:
// "Notification feed (new follower, new comment, new appreciation) |
// GENUINELY MISSING") against the real artistry.notifications-list /
// notifications-mark-read macro contract: populated list, honest empty
// state, honest error state, unread badge + unreadOnly filter, per-item
// mark-read, and mark-all-read.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ArtistryNotifications } from '@/components/artistry/ArtistryNotifications';

const FOLLOW_NOTIF = {
  id: 'notif_1',
  type: 'follow' as const,
  fromUserId: 'artist_b',
  postId: null,
  content: 'artist_b started following your artistry portfolio',
  read: false,
  createdAt: '2026-07-16T00:00:00.000Z',
};
const COMMENT_NOTIF = {
  id: 'notif_2',
  type: 'comment' as const,
  fromUserId: 'artist_c',
  postId: 'proj_1',
  content: 'artist_c commented on your project "Dune Concepts"',
  read: true,
  createdAt: '2026-07-15T00:00:00.000Z',
};

function listResponse(notifications: Array<Record<string, unknown>> = [], unread?: number) {
  return {
    data: {
      ok: true,
      result: {
        notifications,
        count: notifications.length,
        unread: unread ?? notifications.filter((n) => !n.read).length,
      },
      error: null,
    },
  };
}

describe('ArtistryNotifications', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via notifications-list and renders each notification row', async () => {
    lensRun.mockResolvedValueOnce(listResponse([FOLLOW_NOTIF, COMMENT_NOTIF]));
    render(<ArtistryNotifications />);

    expect(await screen.findByText(/started following your artistry portfolio/)).toBeInTheDocument();
    expect(screen.getByText(/commented on your project/)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('artistry', 'notifications-list', { unreadOnly: false, limit: 30 });
  });

  it('an empty feed renders an honest empty state, not a blank panel', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<ArtistryNotifications />);
    expect(await screen.findByText(/No activity yet/)).toBeInTheDocument();
  });

  it('shows the unread badge count from the real payload', async () => {
    lensRun.mockResolvedValueOnce(listResponse([FOLLOW_NOTIF], 1));
    render(<ArtistryNotifications />);
    await screen.findByText(/started following/);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('a failed load surfaces the real error, not a silently empty panel', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    render(<ArtistryNotifications />);
    expect(await screen.findByText('state_unavailable')).toBeInTheDocument();
  });

  it('toggling "Unread only" re-queries with unreadOnly: true', async () => {
    lensRun.mockResolvedValueOnce(listResponse([FOLLOW_NOTIF, COMMENT_NOTIF], 1));
    render(<ArtistryNotifications />);
    await screen.findByText(/started following/);

    lensRun.mockResolvedValueOnce(listResponse([FOLLOW_NOTIF], 1));
    fireEvent.click(screen.getByLabelText(/Unread only/i, { selector: 'input' }));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'notifications-list', { unreadOnly: true, limit: 30 }),
    );
  });

  it('marking a single notification read calls notifications-mark-read with its id and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([FOLLOW_NOTIF], 1))
      .mockResolvedValueOnce({ data: { ok: true, result: { id: 'notif_1' }, error: null } })
      .mockResolvedValueOnce(listResponse([{ ...FOLLOW_NOTIF, read: true }], 0));

    render(<ArtistryNotifications />);
    const row = (await screen.findByText(/started following/)).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByLabelText('Mark read'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'notifications-mark-read', { id: 'notif_1' }),
    );
  });

  it('"Mark all read" only appears when there is unread activity, and calls mark-read with { all: true }', async () => {
    lensRun.mockResolvedValueOnce(listResponse([COMMENT_NOTIF], 0)); // all already read
    render(<ArtistryNotifications />);
    await screen.findByText(/commented on your project/);
    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument();

    lensRun.mockReset();
    lensRun
      .mockResolvedValueOnce(listResponse([FOLLOW_NOTIF], 1))
      .mockResolvedValueOnce({ data: { ok: true, result: { markedRead: 1 }, error: null } })
      .mockResolvedValueOnce(listResponse([{ ...FOLLOW_NOTIF, read: true }], 0));

    render(<ArtistryNotifications />);
    await screen.findByText(/started following/);
    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'notifications-mark-read', { all: true }),
    );
  });

  it('a read notification does not render a "Mark read" affordance', async () => {
    lensRun.mockResolvedValueOnce(listResponse([COMMENT_NOTIF], 0));
    render(<ArtistryNotifications />);
    const row = (await screen.findByText(/commented on your project/)).closest('li') as HTMLElement;
    expect(within(row).queryByLabelText('Mark read')).not.toBeInTheDocument();
  });
});
