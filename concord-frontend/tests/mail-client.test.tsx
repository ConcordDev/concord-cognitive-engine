/**
 * MailClient — the Gmail-class client: honest connect state, conversation
 * list, thread reader, threaded reply, undo-able send, bulk actions, search.
 * Every lensRun is mocked with the shapes server/domains/gmail.js returns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a), api: { get: vi.fn() } }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
const addToast = vi.fn();
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast }) } }));
vi.mock('@/components/mail/MailFolderPanel', () => ({ MailFolderPanel: () => <div>player inbox</div> }));
vi.mock('@/components/mail/ComposeMailPanel', () => ({ ComposeMailPanel: () => <div>player compose</div> }));

import { MailClient } from '@/components/mail/client/MailClient';
import { replyDraft } from '@/components/mail/client/gmail';

const THREAD = {
  id: 't1', subject: 'Q3 plan', snippet: 'Looks good to me', participants: ['Ana', 'Ben'], from: 'Ben <ben@x.com>',
  messageCount: 2, lastDate: '', lastInternalDate: Date.now(), unread: true, starred: false, labelIds: ['INBOX', 'UNREAD'],
};
const MSG = {
  id: 'm2', threadId: 't1', snippet: 'Looks good to me', labelIds: ['INBOX'], unread: false, starred: false,
  from: 'Ben <ben@x.com>', to: 'me@x.com, ana@x.com', cc: 'cy@x.com', subject: 'Re: Q3 plan', date: '', internalDate: Date.now(),
  messageIdHeader: '<m2@x>', references: '<m1@x>', replyTo: '', text: 'Looks good to me', html: '', attachments: [],
};

function ok(result: unknown) { return Promise.resolve({ data: { ok: true, result, error: null } }); }
function fail(error: string) { return Promise.resolve({ data: { ok: false, result: null, error } }); }

beforeEach(() => {
  lensRunMock.mockReset(); addToast.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    switch (action) {
      case 'threads': return ok({ threads: [THREAD], nextPageToken: null, resultSizeEstimate: 1 });
      case 'thread': return ok({ thread: { id: 't1', messages: [MSG] } });
      case 'profile': return ok({ profile: { emailAddress: 'me@x.com' } });
      case 'labels': return ok({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'L1', name: 'Work', type: 'user' }] });
      default: return ok({});
    }
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('MailClient', () => {
  it('shows the honest connect state when Gmail is not linked', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => (action === 'threads' ? fail('no_token') : fail('no_token')));
    render(<MailClient />);
    expect(await screen.findByRole('button', { name: /connect gmail/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /player mail/i }).length).toBeGreaterThan(0);
  });

  it('lists conversations and opens one, marking it read', async () => {
    render(<MailClient />);
    fireEvent.click(await screen.findByText('Q3 plan'));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('gmail', 'thread-modify', { threadId: 't1', action: 'read' }));
    await screen.findByRole('heading', { name: 'Re: Q3 plan' });
    expect(screen.getByText('Work')).toBeTruthy();
  });

  it('reply-all is threaded and leaves out my own address', () => {
    const d = replyDraft(MSG, 'me@x.com', true);
    expect(d.to).toBe('Ben <ben@x.com>');
    expect(d.cc).toBe('ana@x.com, cy@x.com');
    expect(d.subject).toBe('Re: Q3 plan');
    expect(d.threadId).toBe('t1');
    expect(d.inReplyTo).toBe('<m2@x>');
    expect(d.references).toBe('<m1@x> <m2@x>');
  });

  it('sends a reply after the undo window, and Undo cancels it', async () => {
    render(<MailClient />);
    fireEvent.click(await screen.findByText('Q3 plan'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(screen.getByText('Sending…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(lensRunMock).not.toHaveBeenCalledWith('gmail', 'send', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(lensRunMock).toHaveBeenCalledWith('gmail', 'send', expect.objectContaining({ to: 'Ben <ben@x.com>', threadId: 't1', inReplyTo: '<m2@x>' }));
  });

  it('archives selected conversations in bulk', async () => {
    render(<MailClient />);
    fireEvent.click(await screen.findByLabelText('Select Q3 plan'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('gmail', 'thread-modify', { threadId: 't1', action: 'archive' }));
    expect(screen.queryByText('Q3 plan')).toBeNull();
    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('opens Concord compose from the header signal without sending Gmail', async () => {
    const { rerender } = render(<MailClient composeSignal={0} />);
    await screen.findByText('Q3 plan');
    fireEvent.click(screen.getAllByRole('button', { name: /player mail/i })[0]);
    expect(await screen.findByText('player inbox')).toBeTruthy();
    rerender(<MailClient composeSignal={1} />);
    expect(await screen.findByText('player compose')).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalledWith('gmail', 'send', expect.anything());
  });

  it('passes Gmail search syntax through to the server', async () => {
    render(<MailClient />);
    await screen.findByText('Q3 plan');
    fireEvent.change(screen.getByLabelText('Search mail'), { target: { value: 'from:ana has:attachment' } });
    fireEvent.submit(screen.getByLabelText('Search mail').closest('form')!);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('gmail', 'threads', expect.objectContaining({ q: 'from:ana has:attachment', label: 'INBOX' })));
  });
});
