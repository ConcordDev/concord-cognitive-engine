/** PodcastBrowsePanel — rating carries review text; only the contributor can remove a show, after confirming. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
let userId = 'u1';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: userId } }) }));

import { PodcastBrowsePanel } from '@/components/podcast/PodcastBrowsePanel';

const SHOW = { id: 's1', title: 'Night Science', author: 'Ana', category: 'science', description: null, episodeCount: 0, subscribed: false, rating: 0, reviewCount: 0, addedBy: 'u1' };

beforeEach(() => {
  userId = 'u1';
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    const r: Record<string, unknown> = {
      'show-list': { shows: [SHOW] }, 'episode-list': { episodes: [] }, 'show-detail': { show: SHOW, reviews: [] },
    };
    return Promise.resolve({ data: { ok: true, result: r[action] ?? {} } });
  });
});

describe('PodcastBrowsePanel', () => {
  it('submits a rating with review text', async () => {
    render(<PodcastBrowsePanel onChange={() => {}} />);
    fireEvent.click(await screen.findByText('Night Science'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rate 4 stars' }));
    fireEvent.change(screen.getByLabelText('Your review'), { target: { value: 'Great guests' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('podcast', 'show-rate', { showId: 's1', rating: 4, text: 'Great guests' }));
  });

  it('lets the contributor remove the show after confirming', async () => {
    const onChange = vi.fn();
    render(<PodcastBrowsePanel onChange={onChange} />);
    fireEvent.click(await screen.findByText('Night Science'));
    fireEvent.click(await screen.findByRole('button', { name: /remove this show/i }));
    expect(lensRunMock).not.toHaveBeenCalledWith('podcast', 'show-delete', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /remove show, episodes and reviews/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('podcast', 'show-delete', { id: 's1' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('hides removal from other listeners', async () => {
    userId = 'someone-else';
    render(<PodcastBrowsePanel onChange={() => {}} />);
    fireEvent.click(await screen.findByText('Night Science'));
    await screen.findByLabelText('Your review');
    expect(screen.queryByRole('button', { name: /remove this show/i })).toBeNull();
  });
});
