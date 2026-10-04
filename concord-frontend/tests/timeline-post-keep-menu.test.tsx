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
  it('saves a private DTU only after a read-back, then sends that DTU to Thread', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (spec.domain === 'dtu' && action === 'create') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'thread') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_9' } } } };
      }
      return { data: { ok: false, result: null, error: 'unexpected' } };
    });
    render(<PostKeepMenu post={post} viewerId="user_a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as private DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved as private DTU dtu_9.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Thread' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sent DTU dtu_9 to Thread as draft th_9. Not posted.'));
    expect(screen.getByRole('link', { name: 'Open Thread draft th_9' })).toHaveAttribute('href', '/lenses/thread');
    const sendCall = lensRunMock.mock.calls.map((c) => c[0]).find((spec) => spec.domain === 'thread');
    expect(sendCall.input.citedDtuId).toBe('dtu_9');
  });

  it('does not say saved when the DTU cannot be read back', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_missing' } } } };
      return { data: { ok: false, result: null, error: 'DTU not found' } };
    });
    render(<PostKeepMenu post={post} viewerId="user_a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as private DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not be read back/));
    expect(screen.getByRole('status').textContent).not.toMatch(/^Saved/);
    expect(screen.queryByRole('button', { name: 'Send this DTU to Thread' })).toBeNull();
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
