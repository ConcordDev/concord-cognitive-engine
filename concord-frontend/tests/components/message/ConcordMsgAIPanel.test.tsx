/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConcordMsgAIPanel } from '@/components/message/ConcordMsgAIPanel';

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn() },
}));

import { api } from '@/lib/api/client';

const mkRes = (body: unknown) => Promise.resolve({ data: body });

beforeEach(() => {
  vi.mocked(api.post).mockReset();
});

describe('ConcordMsgAIPanel — Sprint A integration', () => {
  it('Inbox tab calls messaging.convo_list and renders DMs + channels', async () => {
    vi.mocked(api.post).mockImplementation(((_u: string, body: unknown) => {
      const b = body as { domain?: string; name?: string };
      if (b.name === 'convo_list') {
        return mkRes({
          ok: true,
          conversations: [
            { id: 'channel:gen', kind: 'channel', title: 'general', unreadCount: 3, created_at: 1, updated_at: 1 },
            { id: 'dm:u_alice:u_bob', kind: 'dm', title: null, unreadCount: 0, created_at: 1, updated_at: 1 },
          ],
        });
      }
      return mkRes({ ok: false });
    }) as typeof api.post);

    render(<ConcordMsgAIPanel activeConversationId={null} onSelectConversation={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText('general')).toBeTruthy();
      expect(screen.getByText('u_alice:u_bob')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy(); // unread badge
    });
  });

  it('Create channel dispatches messaging.channel_create', async () => {
    const calls: Array<{ name?: string; input?: Record<string, unknown> }> = [];
    vi.mocked(api.post).mockImplementation(((_u: string, body: unknown) => {
      const b = body as { name?: string; input?: Record<string, unknown> };
      calls.push({ name: b.name, input: b.input });
      if (b.name === 'convo_list') return mkRes({ ok: true, conversations: [] });
      if (b.name === 'channel_create') return mkRes({ ok: true, id: 'channel:new123' });
      return mkRes({ ok: false });
    }) as typeof api.post);

    let chosen: string | null = null;
    render(<ConcordMsgAIPanel activeConversationId={null} onSelectConversation={(id) => { chosen = id; }} />);
    // Wait for initial inbox load
    await waitFor(() => expect(calls.some((c) => c.name === 'convo_list')).toBe(true));
    fireEvent.click(screen.getByTitle('New conversation'));
    const input = screen.getByPlaceholderText(/channel name/i);
    fireEvent.change(input, { target: { value: 'launch-2026' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(chosen).toBe('channel:new123'));
    const createCall = calls.find((c) => c.name === 'channel_create');
    expect(createCall?.input?.name).toBe('launch-2026');
  });

  it('Create DM requires exactly one other user id', async () => {
    vi.mocked(api.post).mockImplementation(((_u: string, body: unknown) => {
      const b = body as { name?: string };
      if (b.name === 'convo_list') return mkRes({ ok: true, conversations: [] });
      return mkRes({ ok: false });
    }) as typeof api.post);

    render(<ConcordMsgAIPanel activeConversationId={null} onSelectConversation={() => undefined} />);
    fireEvent.click(screen.getByTitle('New conversation'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dm' } });
    // Wait for the participants input to appear (DM-only field)
    const partsInput = await screen.findByPlaceholderText(/other user id/i);
    expect(partsInput).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByText(/DM needs exactly one other user/i)).toBeTruthy());
  });

  it('Browse tab calls channel_browse with query', async () => {
    const calls: Array<{ name?: string; input?: Record<string, unknown> }> = [];
    vi.mocked(api.post).mockImplementation(((_u: string, body: unknown) => {
      const b = body as { name?: string; input?: Record<string, unknown> };
      calls.push({ name: b.name, input: b.input });
      if (b.name === 'channel_browse') return mkRes({
        ok: true, channels: [
          { id: 'channel:public', kind: 'channel', title: 'public', topic: 'open to all', memberCount: 7, joined: false, created_at: 1, updated_at: 1 },
        ],
      });
      if (b.name === 'convo_list') return mkRes({ ok: true, conversations: [] });
      return mkRes({ ok: false });
    }) as typeof api.post);

    render(<ConcordMsgAIPanel activeConversationId={null} onSelectConversation={() => undefined} />);
    // Tab buttons render their name in lowercase via uppercase CSS; use case-insensitive regex.
    fireEvent.click(screen.getByRole('button', { name: /^browse$/i }));
    await waitFor(() => expect(screen.getByText('public')).toBeTruthy());
    expect(screen.getByText('open to all')).toBeTruthy();
    expect(screen.getByText('Join')).toBeTruthy();
  });
});
