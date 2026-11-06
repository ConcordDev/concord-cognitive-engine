/**
 * message-full-build.test.tsx — B6 F-B build(message) FE pins.
 *
 * (S2/F1) sending stamps the account's own name (senderName) so the author
 * line is the account, never its raw id.
 * (S4/F6) a leading /command executes via message.command-run and its
 * result renders in the stream; an unknown command is refused in words and
 * never posts as literal text.
 * (S3/F2) Delete is two-step (arm → Confirm?) with refusals in words.
 * (S5/F8) reactions live on the message: the picker calls react with the
 * message's own id and the tally renders as a chip.
 * (S1) the depth badge carries the scoped caption for this lens.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

const sendInputs: Array<Record<string, unknown>> = [];
const deleteInputs: Array<Record<string, unknown>> = [];
const commandTexts: string[] = [];
const reactCalls: Array<{ messageId: string; emoji: string }> = [];
let deleteResult: { ok: boolean; error?: string } = { ok: true };
let deleted = false;
let reacted = false;
let withBold = false;

const MSG = {
  id: 'msg-1', number: 'M-000001', channelId: 'ch-1', senderId: 'u1',
  senderName: 'Tester', body: 'hello channel', ts: '2026-10-31T10:00:00.000Z',
  edited: false, threadCount: 0,
};

const MSG_BOLD = {
  id: 'msg-bold', number: 'M-000002', channelId: 'ch-1', senderId: 'u1',
  senderName: 'Tester', body: '**PR4 bold check** and hi @Mira', ts: '2026-10-31T10:02:00.000Z',
  edited: false, threadCount: 0,
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Tester' } }) }));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));
vi.mock('@/components/message/SlackShell', () => ({ ChannelIcon: () => null }));
vi.mock('@/components/message/ChannelExtrasBar', () => ({ ChannelExtrasBar: () => null }));
vi.mock('@/components/message/RichComposer', () => ({
  RichComposer: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) =>
    React.createElement('textarea', {
      'aria-label': 'composer', value, placeholder,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));
vi.mock('@/lib/voice/mediarecorder-stt', () => ({ mediaRecorderSupported: () => false }));

vi.mock('@/lib/api/client', () => ({
  lensRun: async (spec: { domain: string; action: string; input?: Record<string, unknown> }) => {
    const input = spec.input || {};
    switch (spec.action) {
      case 'messages-list':
        return { data: { ok: true, result: { messages: deleted ? [] : withBold ? [MSG, MSG_BOLD] : [MSG] } } };
      case 'app-messages-list':
        return { data: { ok: true, result: { appMessages: commandTexts.length > 0
          ? [{ id: 'app-1', appName: 'Concord Bot', body: 'whatever ¯\\_(ツ)_/¯', ephemeral: false, ts: '2026-10-31T10:01:00.000Z', command: '/shrug' }]
          : [] } } };
      case 'ai-smart-reply':
        return { data: { ok: true, result: { suggestions: [] } } };
      case 'voice-list':
        return { data: { ok: true, result: { voices: [] } } };
      case 'messages-send':
        sendInputs.push(input);
        return { data: { ok: true, result: { message: { ...MSG, id: 'msg-2', body: String(input.body || '') } } } };
      case 'command-run': {
        const text = String(input.text || '');
        if (text.startsWith('/bogus')) return { data: { ok: false, error: 'unknown command /bogus' } };
        commandTexts.push(text);
        return { data: { ok: true, result: { appMessage: { id: 'app-1' } } } };
      }
      case 'messages-delete':
        deleteInputs.push(input);
        if (!deleteResult.ok) return { data: { ok: false, error: deleteResult.error } };
        deleted = true;
        return { data: { ok: true, result: { deleted: true } } };
      case 'reactions-for':
        return { data: { ok: true, result: { reactions: reacted ? { '👍': 1 } : {} } } };
      case 'react':
        reactCalls.push({ messageId: String(input.messageId), emoji: String(input.emoji) });
        reacted = true;
        return { data: { ok: true, result: { count: 1 } } };
      case 'messages-mark-read':
      case 'channel-live-state':
        return { data: { ok: true, result: {} } };
      default:
        return { data: { ok: true, result: {} } };
    }
  },
}));

import { MessageStream } from '@/components/message/MessageStream';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const channel = { id: 'ch-1', name: 'general', kind: 'channel' as const };

beforeEach(() => {
  sendInputs.length = 0; deleteInputs.length = 0; commandTexts.length = 0; reactCalls.length = 0;
  deleteResult = { ok: true }; deleted = false; reacted = false; withBold = false;
});

async function renderStream() {
  render(<MessageStream channel={channel} onOpenThread={() => {}} />);
  await waitFor(() => expect(screen.getByText('hello channel')).toBeTruthy());
}

describe('build(message) — stream', () => {
  it('S2: a send stamps the account name as senderName', async () => {
    await renderStream();
    fireEvent.change(screen.getByLabelText('composer'), { target: { value: 'a real post' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(sendInputs.length).toBe(1));
    expect(sendInputs[0].senderName).toBe('Tester');
    expect(sendInputs[0].body).toBe('a real post');
  });

  it('S4: /shrug executes via command-run and its result renders; it never posts as text', async () => {
    await renderStream();
    fireEvent.change(screen.getByLabelText('composer'), { target: { value: '/shrug whatever' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(commandTexts).toEqual(['/shrug whatever']));
    expect(sendInputs.length).toBe(0);
    // The shrug renders through the shared markdown renderer: its \_ escape
    // resolves to a literal underscore, so the visible text is ¯_(ツ)_/¯.
    await waitFor(() => expect(screen.getByText(/¯_\(ツ\)_\/¯/)).toBeTruthy());
  });

  it('S4: an unknown command is refused in words and never posts', async () => {
    await renderStream();
    fireEvent.change(screen.getByLabelText('composer'), { target: { value: '/boguscmd x' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText(/unknown command \/bogus/)).toBeTruthy());
    expect(sendInputs.length).toBe(0);
  });

  it('S3: delete arms first (Confirm?), then deletes on the second click', async () => {
    await renderStream();
    fireEvent.click(screen.getByTitle('Delete'));
    expect(screen.getByText('Confirm?')).toBeTruthy();
    expect(deleteInputs.length).toBe(0);
    fireEvent.click(screen.getByTitle('Click again to delete'));
    await waitFor(() => expect(deleteInputs.length).toBe(1));
    await waitFor(() => expect(screen.queryByText('hello channel')).toBeNull());
  });

  it('S3: a delete refusal surfaces in words under the message', async () => {
    deleteResult = { ok: false, error: 'only sender can delete' };
    await renderStream();
    fireEvent.click(screen.getByTitle('Delete'));
    fireEvent.click(screen.getByTitle('Click again to delete'));
    await waitFor(() => expect(screen.getByText('only sender can delete')).toBeTruthy());
    expect(screen.getByText('hello channel')).toBeTruthy();
  });

  it('S5: reacting from the message calls react with its id and renders the chip', async () => {
    await renderStream();
    fireEvent.click(screen.getByTitle('React'));
    fireEvent.click(screen.getByTitle('React 👍'));
    await waitFor(() => expect(reactCalls).toEqual([{ messageId: 'msg-1', emoji: '👍' }]));
    await waitFor(() => expect(screen.getByTitle(/click to remove your reaction/)).toBeTruthy());
  });
});

describe('build(message) — markdown bodies (S6, shared renderer)', () => {
  it('**bold** renders as <strong> through the shared renderer, and @mentions still chip', async () => {
    withBold = true;
    await renderStream();
    await waitFor(() => expect(screen.getByText('PR4 bold check')).toBeTruthy());
    const strong = screen.getByText('PR4 bold check');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*PR4 bold check\*\*/)).toBeNull();
    expect(screen.getByText('@Mira')).toBeTruthy();
  });
});

describe('build(message) — badge caption (S1)', () => {
  it('the message lens carries the scoped caption', () => {
    const { result } = renderHook(() => useDepthBadge('message'));
    expect(result.current?.caption).toMatch(/Your own messaging workspace/);
    expect(result.current?.label).toBe('Live');
  });
});
