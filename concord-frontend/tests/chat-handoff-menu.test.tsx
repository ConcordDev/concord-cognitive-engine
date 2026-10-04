import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ChatHandoffMenu } from '@/components/chat/ChatHandoffMenu';

const messages = [
  { role: 'user', content: 'How do tides work?' },
  { role: 'assistant', content: 'The moon pulls the oceans.' },
];

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ChatHandoffMenu', () => {
  it('posts privately only after Timeline accepts the post', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { post: { id: 'pst_1', privacy: 'private' } } } });
    const onNote = vi.fn();
    render(<ChatHandoffMenu messages={messages} sessionId="sess-1" title="Tides" onNote={onNote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Post privately on Timeline' }));
    await waitFor(() => expect(onNote).toHaveBeenCalledWith('Posted privately to your Timeline (pst_1).'));
    expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'timeline',
      name: 'post-create',
      input: expect.objectContaining({ privacy: 'private' }),
    }));
    expect(onNote.mock.calls[0][0]).not.toMatch(/publicly/);
  });

  it('does not say posted when Timeline refuses', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'Post needs content or media.' } });
    const onNote = vi.fn();
    render(<ChatHandoffMenu messages={messages} sessionId="sess-1" title="Tides" onNote={onNote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Post publicly on Timeline' }));
    await waitFor(() => expect(onNote).toHaveBeenCalled());
    expect(onNote.mock.calls[0][0]).toMatch(/Not saved/);
    expect(onNote.mock.calls[0][0]).not.toMatch(/^Posted/);
  });

  it('saves a thread draft without calling it posted', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { draft: { id: 'th_4', status: 'draft' } } } });
    const onNote = vi.fn();
    render(<ChatHandoffMenu messages={messages} sessionId={null} title="Tides" onNote={onNote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as Thread draft' }));
    await waitFor(() => expect(onNote).toHaveBeenCalledWith('Saved Thread draft th_4. Not posted.'));
    expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'thread',
      name: 'thread-draft',
    }));
  });

  it('leaves the buttons disabled when there is nothing to send', () => {
    render(<ChatHandoffMenu messages={[{ role: 'user', content: ' ' }]} sessionId={null} title="Empty" />);
    expect(screen.getByRole('button', { name: 'Save transcript as DTU' })).toBeDisabled();
  });
});
