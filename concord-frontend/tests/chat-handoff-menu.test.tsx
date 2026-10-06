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

  it('saves a DTU only after a read-back, then sends that DTU to Timeline', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (spec.domain === 'dtu' && action === 'create') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'timeline') {
        return { data: { ok: true, result: { post: { id: 'pst_9', privacy: 'private', citedDtuId: 'dtu_9' } } } };
      }
      return { data: { ok: false, result: null, error: 'unexpected' } };
    });
    const onNote = vi.fn();
    render(<ChatHandoffMenu messages={messages} sessionId="sess-1" title="Tides" onNote={onNote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript as DTU' }));
    await waitFor(() => expect(onNote).toHaveBeenCalledWith('Saved as DTU dtu_9.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Timeline' }));
    await waitFor(() => expect(onNote).toHaveBeenCalledWith('Sent DTU dtu_9 to your Timeline as private post pst_9.'));
    expect(screen.getByRole('link', { name: 'Open Timeline post pst_9' })).toHaveAttribute('href', '/lenses/timeline?tab=feed');
    const sendCall = lensRunMock.mock.calls.map((c) => c[0]).find((spec) => spec.domain === 'timeline');
    expect(sendCall.input.citedDtuId).toBe('dtu_9');
    expect(sendCall.input.privacy).toBe('private');
  });

  it('does not say saved when the DTU cannot be read back', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; action?: string; name?: string }) => {
      const action = spec.action || spec.name;
      if (action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_missing' } } } };
      return { data: { ok: false, result: null, error: 'DTU not found' } };
    });
    const onNote = vi.fn();
    render(<ChatHandoffMenu messages={messages} sessionId="sess-1" title="Tides" onNote={onNote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript as DTU' }));
    await waitFor(() => expect(onNote).toHaveBeenCalled());
    expect(onNote.mock.calls[0][0]).toMatch(/could not be read back/);
    expect(onNote.mock.calls[0][0]).not.toMatch(/^Saved/);
    expect(screen.queryByRole('button', { name: 'Send this DTU to Timeline' })).toBeNull();
  });

  it('leaves the buttons disabled when there is nothing to send', () => {
    render(<ChatHandoffMenu messages={[{ role: 'user', content: ' ' }]} sessionId={null} title="Empty" />);
    expect(screen.getByRole('button', { name: 'Save transcript as DTU' })).toBeDisabled();
  });
});
