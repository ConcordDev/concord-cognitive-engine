import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';

// ── Socket mock: capture registered handlers so tests can drive events ───────
type Handler = (data: unknown) => void;
const handlers = new Map<string, Handler[]>();
const on = vi.fn((evt: string, cb: Handler) => {
  handlers.set(evt, [...(handlers.get(evt) || []), cb]);
});
const off = vi.fn((evt: string, cb?: Handler) => {
  if (!cb) handlers.delete(evt);
  else handlers.set(evt, (handlers.get(evt) || []).filter((h) => h !== cb));
});
function emit(evt: string, data: unknown) {
  for (const h of handlers.get(evt) || []) h(data);
}
vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ on, off }),
}));

const showToast = vi.fn();
vi.mock('@/components/common/Toasts', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

const addToast = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast }) },
}));

const sharedSessionDetails = vi.fn();
const sharedSessionChat = vi.fn();
const saveSharedArtifact = vi.fn();
const endSharedSession = vi.fn();
const shareSessionDTU = vi.fn();
const sharedSessionRunAction = vi.fn();
vi.mock('@/lib/api/client', () => ({
  sharedSessionDetails: (...a: unknown[]) => sharedSessionDetails(...a),
  sharedSessionChat: (...a: unknown[]) => sharedSessionChat(...a),
  saveSharedArtifact: (...a: unknown[]) => saveSharedArtifact(...a),
  endSharedSession: (...a: unknown[]) => endSharedSession(...a),
  shareSessionDTU: (...a: unknown[]) => shareSessionDTU(...a),
  sharedSessionRunAction: (...a: unknown[]) => sharedSessionRunAction(...a),
}));

import { SharedSessionChat } from '@/components/social/SharedSessionChat';

const SESSION = {
  ok: true,
  session: {
    status: 'active' as const,
    participants: [
      { userId: 'me', name: 'Me', sharingDomains: [], sharingLevel: 'full' as const, joinedAt: '' },
      { userId: 'other', name: 'Other', sharingDomains: [], sharingLevel: 'query' as const, joinedAt: '' },
    ],
  },
  messages: [
    { userId: 'me', content: 'old mine', ts: '2026-05-01', contextSources: [] },
    { userId: 'ai', content: 'old ai', ts: '2026-05-02', contextSources: [{ source: 'health' }] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  Element.prototype.scrollIntoView = vi.fn();
  sharedSessionDetails.mockResolvedValue(SESSION);
  sharedSessionChat.mockResolvedValue({ ok: true });
  saveSharedArtifact.mockResolvedValue({ ok: true });
  endSharedSession.mockResolvedValue({ ok: true });
  shareSessionDTU.mockResolvedValue({ ok: true });
  sharedSessionRunAction.mockResolvedValue({ ok: true });
});
afterEach(() => cleanup());

describe('SharedSessionChat', () => {
  it('loads session details, participants and existing messages', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    expect(await screen.findByText('Me (you)')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('old mine')).toBeInTheDocument();
    expect(screen.getByText('old ai')).toBeInTheDocument();
    expect(screen.getByText(/Drawing from: health/)).toBeInTheDocument();
  });

  it('shows an error toast when loading messages fails', async () => {
    sharedSessionDetails.mockRejectedValue(new Error('down'));
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('error', 'Failed to load messages'),
    );
  });

  it('sends a message optimistically and calls the API', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    const input = screen.getByPlaceholderText('Message the group...');
    fireEvent.change(input, { target: { value: 'hello group' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(await screen.findByText('hello group')).toBeInTheDocument();
    await waitFor(() =>
      expect(sharedSessionChat).toHaveBeenCalledWith('s1', 'hello group'),
    );
  });

  it('sends a message on Enter key', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    const input = screen.getByPlaceholderText('Message the group...');
    fireEvent.change(input, { target: { value: 'enter msg' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(sharedSessionChat).toHaveBeenCalledWith('s1', 'enter msg'),
    );
  });

  it('does not send an empty message', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    fireEvent.click(screen.getByLabelText('Send'));
    expect(sharedSessionChat).not.toHaveBeenCalled();
  });

  it('toasts on send failure', async () => {
    sharedSessionChat.mockRejectedValue(new Error('boom'));
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    const input = screen.getByPlaceholderText('Message the group...');
    fireEvent.change(input, { target: { value: 'fail msg' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'Failed to send message' }),
    );
  });

  it('appends incoming socket message / ai-response / system events', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    act(() =>
      emit('shared-session:message', {
        sessionId: 's1',
        message: { id: 'm1', userId: 'other', content: 'incoming', ts: '2026-05-03' },
        userName: 'Other',
      }),
    );
    expect(await screen.findByText('incoming')).toBeInTheDocument();
    act(() =>
      emit('shared-session:ai-response', {
        sessionId: 's1',
        response: 'ai says hi',
        contextSources: ['food'],
      }),
    );
    expect(await screen.findByText('ai says hi')).toBeInTheDocument();
    act(() =>
      emit('shared-session:joined', {
        sessionId: 's1',
        userId: 'x',
        userName: 'Newbie',
        participantCount: 3,
      }),
    );
    expect(await screen.findByText('Newbie joined the session')).toBeInTheDocument();
  });

  it('ignores socket events for a different session', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    act(() =>
      emit('shared-session:message', {
        sessionId: 'OTHER',
        message: { id: 'm', userId: 'x', content: 'wrong session', ts: '' },
        userName: 'X',
      }),
    );
    expect(screen.queryByText('wrong session')).toBeNull();
  });

  it('renders artifact + dtu_shared messages and saves an artifact', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    act(() =>
      emit('shared-session:artifact-produced', {
        sessionId: 's1',
        dtuId: 'd1',
        title: 'Cool Artifact',
        domain: 'science',
      }),
    );
    expect(await screen.findByText('Cool Artifact')).toBeInTheDocument();
    act(() =>
      emit('shared-session:dtu-shared', {
        sessionId: 's1',
        userName: 'Other',
        dtuTitle: 'A DTU',
        dtuDomain: 'music',
      }),
    );
    expect(await screen.findByText(/shared/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(saveSharedArtifact).toHaveBeenCalledWith('s1', 'd1'),
    );
    expect(
      await screen.findByText('Artifact saved to your substrate.'),
    ).toBeInTheDocument();
  });

  it('shares a DTU through the inline form', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    fireEvent.click(screen.getByTitle('Share DTU'));
    const dtuInput = screen.getByPlaceholderText('Enter DTU ID to share...');
    fireEvent.change(dtuInput, { target: { value: 'dtu-99' } });
    fireEvent.click(screen.getByText('Share'));
    await waitFor(() =>
      expect(shareSessionDTU).toHaveBeenCalledWith('s1', 'dtu-99'),
    );
  });

  it('runs a lens action through the inline form', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    fireEvent.click(screen.getByTitle('Run Action'));
    fireEvent.change(screen.getByPlaceholderText('Lens (e.g. health)'), {
      target: { value: 'health' },
    });
    fireEvent.change(screen.getByPlaceholderText('Action name'), {
      target: { value: 'summary' },
    });
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() =>
      expect(sharedSessionRunAction).toHaveBeenCalledWith('s1', 'health', 'summary', undefined),
    );
  });

  it('ends the session and calls onEnd', async () => {
    const onEnd = vi.fn();
    render(<SharedSessionChat sessionId="s1" currentUserId="me" onEnd={onEnd} />);
    await screen.findByText('Me (you)');
    fireEvent.click(screen.getByText('End Session'));
    await waitFor(() => expect(endSharedSession).toHaveBeenCalledWith('s1'));
    expect(onEnd).toHaveBeenCalled();
  });

  it('switches to the ended view when an ended socket event arrives', async () => {
    render(<SharedSessionChat sessionId="s1" currentUserId="me" />);
    await screen.findByText('Me (you)');
    act(() => emit('shared-session:ended', { sessionId: 's1' }));
    // Both the system message and the input-area footer render the text.
    await waitFor(() =>
      expect(
        screen.getAllByText('Session ended. Shared context dissolved.').length,
      ).toBe(2),
    );
    // End Session button gone — session no longer active.
    expect(screen.queryByText('End Session')).toBeNull();
  });
});
