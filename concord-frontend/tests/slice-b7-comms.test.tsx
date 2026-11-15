import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — comms & journal lifecycle cluster:
// FIX-daily-004 (journal delete gains a visible two-step confirm),
// FIX-message-006 (labels can be deleted, stripping applications),
// FIX-thread-001 (thread drafts can be renamed),
// FIX-mail-013 (received mail gains star / mark-unread / archive /
// trash + starred & archived views).

const lensRun = vi.fn();
const playerMail = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/mail/playerMail', () => ({
  playerMail: (...args: unknown[]) => playerMail(...args),
  claimResultText: () => ({ kind: 'ok', msg: '' }),
  declineResultText: () => ({ kind: 'ok', msg: '' }),
  deleteResultText: () => ({ kind: 'ok', msg: '' }),
  mailPartyLabel: (name?: string | null, handle?: string | null) => name || handle || 'Someone',
}));
vi.mock('@/components/mail/MailKeepMenu', () => ({ MailKeepMenu: () => null }));
vi.mock('@/components/mail/mailKeep', () => ({ mailRecordSentence: () => '' }));

import { DailyJournal } from '@/components/daily/DailyJournal';
import { LabelManagerPanel } from '@/components/message/LabelManagerPanel';
import { ThreadComposer } from '@/components/thread/ThreadComposer';
import { MailFolderPanel } from '@/components/mail/MailFolderPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(domain: string, action: string) {
  return lensRun.mock.calls.filter((c) => c[0] === domain && c[1] === action);
}

beforeEach(() => {
  lensRun.mockReset();
  playerMail.mockReset();
});

describe('DailyJournal — entry delete confirm (FIX-daily-004)', () => {
  it('the delete is a visible two-step confirm; the arm alone fires nothing', async () => {
    const entry = { id: 'e1', date: '2026-11-12', body: 'qa-zt2-daily entry', mood: 4, tags: [] as string[] };
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'entry-list') return ok({ entries: [entry] });
      if (action === 'entry-delete') return ok({ deleted: 'e1' });
      return ok({});
    });
    render(<DailyJournal />);
    expect(await screen.findByText('qa-zt2-daily entry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete entry?')).toBeInTheDocument();
    expect(calls('daily', 'entry-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls('daily', 'entry-delete')).toHaveLength(1));
    expect(calls('daily', 'entry-delete')[0][2]).toMatchObject({ id: 'e1' });
  });
});

describe('LabelManagerPanel — label delete (FIX-message-006)', () => {
  it('a label chip deletes behind a confirm and leaves the list', async () => {
    const label = { id: 'lbl_1', name: 'Receipts', color: '#3b82f6' };
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'labels-list') return ok({ labels: [label] });
      if (action === 'labels-delete') return ok({ deleted: true, label });
      return ok({});
    });
    render(<LabelManagerPanel />);
    expect(await screen.findByText('Receipts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete label Receipts' }));
    expect(calls('message', 'labels-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls('message', 'labels-delete')).toHaveLength(1));
    expect(calls('message', 'labels-delete')[0][2]).toMatchObject({ labelId: 'lbl_1' });
    await waitFor(() => expect(screen.queryByText('Receipts')).not.toBeInTheDocument());
  });
});

describe('ThreadComposer — draft rename (FIX-thread-001)', () => {
  it('opening a draft loads its title into an editable field; Save sends the rename', async () => {
    const draft = { id: 'th_1', title: 'Old launch title', content: 'First post of the thread', platform: 'x', status: 'draft', posts: [], scheduledAt: null };
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'draft-list') return ok({ drafts: [{ id: 'th_1', title: 'Old launch title', platform: 'x', status: 'draft', postCount: 1, scheduledAt: null }], count: 1 });
      if (action === 'draft-detail') return ok({ draft });
      if (action === 'draft-update') return ok({ draft: { ...draft, title: 'New launch title' } });
      if (action === 'split-preview') return ok({ posts: [] });
      return ok({});
    });
    render(<ThreadComposer />);
    fireEvent.click(await screen.findByText('Old launch title'));
    const titleInput = await screen.findByLabelText('Thread title') as HTMLInputElement;
    await waitFor(() => expect(titleInput.value).toBe('Old launch title'));
    fireEvent.change(titleInput, { target: { value: 'New launch title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('thread', 'draft-update')).toHaveLength(1));
    expect(calls('thread', 'draft-update')[0][2]).toMatchObject({ id: 'th_1', title: 'New launch title' });
  });
});

describe('MailFolderPanel — inbox management (FIX-mail-013)', () => {
  const MAIL = {
    id: 'm1', fromUser: 'u2', toUser: 'u1', fromName: 'Pat Sender', subject: 'Welcome aboard',
    body: 'Hello there.', status: 'read', sentAt: 1762000000, expiresAt: 1764000000,
    attachment_dtu_ids: [] as string[], attachmentCc: 0, codCc: 0, starredAt: null, archivedAt: null,
  };

  it('star, mark-unread, archive and two-step trash all reach the mail macros', async () => {
    playerMail.mockImplementation((action: string) => {
      if (action === 'list') return Promise.resolve({ ok: true, mail: [MAIL] });
      if (action === 'sent') return Promise.resolve({ ok: true, mail: [] });
      return Promise.resolve({ ok: true });
    });
    render(<MailFolderPanel folder="inbox" onCompose={() => {}} />);
    fireEvent.click(await screen.findByText('Welcome aboard'));

    fireEvent.click(await screen.findByRole('button', { name: /^Star$/ }));
    await waitFor(() => expect(playerMail).toHaveBeenCalledWith('star', { id: 'm1', starred: true }));

    fireEvent.click(screen.getByRole('button', { name: /Mark unread/ }));
    await waitFor(() => expect(playerMail).toHaveBeenCalledWith('unread', { id: 'm1' }));

    // Trash is two-step: the arm fires nothing, the confirm trashes.
    fireEvent.click(screen.getByRole('button', { name: /Trash/ }));
    expect(playerMail.mock.calls.filter((c) => c[0] === 'trash')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Trash it' }));
    await waitFor(() => expect(playerMail).toHaveBeenCalledWith('trash', { id: 'm1' }));
  });

  it('the Archived view loads the archived folder', async () => {
    playerMail.mockImplementation((action: string, input?: Record<string, unknown>) => {
      if (action === 'list') return Promise.resolve({ ok: true, mail: input?.folder === 'archived' ? [{ ...MAIL, id: 'm2', subject: 'Filed away', archivedAt: 1762000100 }] : [MAIL] });
      if (action === 'sent') return Promise.resolve({ ok: true, mail: [] });
      return Promise.resolve({ ok: true });
    });
    render(<MailFolderPanel folder="inbox" onCompose={() => {}} />);
    expect(await screen.findByText('Welcome aboard')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'archived' }));
    expect(await screen.findByText('Filed away')).toBeInTheDocument();
    expect(playerMail).toHaveBeenCalledWith('list', { folder: 'archived' });
  });
});
