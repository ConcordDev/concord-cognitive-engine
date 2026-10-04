import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PostKeepMenu } from '@/components/timeline/PostKeepMenu';

const post = {
  id: 'pst_1',
  authorId: 'user_a',
  content: 'Harbor lights at dusk.',
  privacy: 'public' as const,
  sharedFrom: null,
  media: [],
};

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('PostKeepMenu', () => {
  it('saves a private DTU only after the server returns an id', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'dtu_9' } } } });
    render(<PostKeepMenu post={post} viewerId="user_a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as private DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved as private DTU dtu_9.'));
    expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'dtu',
      name: 'create',
      input: expect.objectContaining({ source: 'timeline-lens:post' }),
    }));
  });

  it('does not say saved when the server refuses', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<PostKeepMenu post={post} viewerId="user_a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as Thread draft' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not saved. STATE unavailable'));
    expect(screen.getByRole('status').textContent).not.toMatch(/Not posted\.$/);
  });

  it('does not open a forum topic from someone else\'s friends-only post', () => {
    render(<PostKeepMenu post={{ ...post, authorId: 'user_b', privacy: 'friends' }} viewerId="user_a" />);
    const forum = screen.getByRole('button', { name: 'Open a Forum topic' });
    expect(forum).toBeDisabled();
    fireEvent.click(forum);
    expect(lensRunMock).not.toHaveBeenCalled();
    expect(screen.getByText(/stay on Timeline/)).toBeTruthy();
  });
});
