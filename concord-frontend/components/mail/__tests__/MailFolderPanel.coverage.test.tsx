// Behaviour coverage for the mail folder panel: inbox/sent lists, search + status filters, open
// (mark-read), claim with COD, remove-from-sent confirm, load error retry and realtime refresh.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ playerMail: vi.fn(), subscribeCb: { current: null as null | (() => void) } }));
const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, subject: `Subject ${id}`, body: `Body ${id}`, fromName: 'Ada', fromHandle: 'ada', toName: 'Bo', toHandle: 'bo',
  sentAt: 1_770_000_000, expiresAt: 1_780_000_000, attachment_dtu_ids: [], attachmentCc: 0, codCc: 0, ...extra,
});
const INBOX = [
  row('m1', 'unread', { attachmentCc: 25, attachment_dtu_ids: ['d1', 'd2'], codCc: 5 }),
  row('m2', 'read'),
  row('m3', 'claimed', { attachmentCc: 10, claimedAt: 1_770_100_000 }),
  row('m4', 'expired', { attachment_dtu_ids: ['d9'] }),
];
const SENT = [row('s1', 'read'), row('s2', 'unread', { attachmentCc: 3 })];

vi.mock('../playerMail', async () => {
  const actual = await vi.importActual<typeof import('../playerMail')>('../playerMail');
  return { ...actual, playerMail: (...a: unknown[]) => h.playerMail(...a) };
});
vi.mock('../MailKeepMenu', () => ({ MailKeepMenu: () => <span>keep-stub</span> }));
vi.mock('@/lib/realtime/socket', () => ({ subscribe: (_e: string, cb: () => void) => { h.subscribeCb.current = cb; return () => {}; } }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };
const mount = async (folder: 'inbox' | 'sent', onCompose = vi.fn()) => {
  const { MailFolderPanel } = await import('../MailFolderPanel');
  const v = render(<MailFolderPanel folder={folder} onCompose={onCompose} />);
  await settle();
  return v;
};
afterEach(() => cleanup());
beforeEach(() => {
  h.playerMail.mockReset();
  h.playerMail.mockImplementation(async (action: string) => {
    if (action === 'list') return { ok: true, mail: INBOX };
    if (action === 'sent') return { ok: true, mail: SENT };
    if (action === 'claim') return { ok: true, payout: { attachmentCc: 25, codCcPaid: 5 }, attachments: { transferred: ['d1'], skipped: ['d2'] } };
    return { ok: true };
  });
});

describe('MailFolderPanel inbox', () => {
  it('lists mail, opens an unread message (marks read), claims and filters', async () => {
    const view = await mount('inbox');
    expect(view.container.textContent).toMatch(/Subject m1/);
    await click(screen.getByText('Subject m1'));
    expect(h.playerMail).toHaveBeenCalledWith('read', { id: 'm1' });
    expect(view.container.textContent).toMatch(/COD due on claim/);
    await click(screen.getByText(/^Claim/));
    expect(h.playerMail).toHaveBeenCalledWith('claim', { id: 'm1' });
    expect(view.container.textContent).toMatch(/Claimed 25 CC/);
    // a claimed and an expired message render their own footers
    await click(screen.getByText('Subject m3'));
    expect(view.container.textContent).toMatch(/Claimed/);
    await click(screen.getByText('Subject m4'));
    expect(view.container.textContent).toMatch(/Expired — attachments returned/);
    await click(screen.getByLabelText('Close mail'));
    expect(view.container.textContent).toMatch(/No mail selected/);
    for (const f of ['unread', 'read', 'claimed', 'expired', 'all']) await click(screen.getByRole('button', { name: f }));
  });

  it('searches, shows no-match with clear filters, and surfaces a mark-read failure', async () => {
    h.playerMail.mockImplementation(async (action: string) => {
      if (action === 'list') return { ok: true, mail: INBOX };
      if (action === 'sent') return { ok: true, mail: SENT };
      if (action === 'read') return { ok: false, error: 'not_authorized' };
      return { ok: true };
    });
    const view = await mount('inbox');
    const search = screen.getByLabelText('Search mail');
    await act(async () => { fireEvent.change(search, { target: { value: 'zzz-nothing' } }); });
    expect(view.container.textContent).toMatch(/No matches/);
    await click(screen.getByText('Clear filters'));
    await act(async () => { fireEvent.change(search, { target: { value: 'ada' } }); });
    expect(view.container.textContent).toMatch(/Subject m2/);
    await click(screen.getByText('Subject m1'));
    expect(view.container.textContent).toMatch(/could not be marked as read/);
  });

  it('reloads on a realtime mail event and shows empty inbox copy', async () => {
    const view = await mount('inbox');
    const before = h.playerMail.mock.calls.length;
    await act(async () => { h.subscribeCb.current?.(); await new Promise((r) => setTimeout(r, 20)); });
    expect(h.playerMail.mock.calls.length).toBeGreaterThan(before);
    cleanup();
    h.playerMail.mockImplementation(async () => ({ ok: true, mail: [] }));
    const empty = await mount('inbox');
    expect(empty.container.textContent).toMatch(/No mail yet/);
  });

  it('shows an error with retry when mail cannot load', async () => {
    h.playerMail.mockImplementation(async () => ({ ok: false, error: 'down' }));
    const view = await mount('inbox');
    expect(view.container.textContent).toMatch(/Could not reach your mail/);
    h.playerMail.mockImplementation(async (a: string) => ({ ok: true, mail: a === 'list' ? INBOX : [] }));
    await click(screen.getAllByRole("button", { name: /retry|try again/i })[0]);
    expect(view.container.textContent).toMatch(/Subject m1/);
  });
});

describe('MailFolderPanel sent', () => {
  it('removes a sent copy after confirmation, with keep-it and a failure path', async () => {
    const compose = vi.fn();
    const view = await mount('sent', compose);
    await click(screen.getByText('Subject s1'));
    await click(screen.getByText('Remove from Sent'));
    await click(screen.getByText('Keep it'));
    await click(screen.getByText('Remove from Sent'));
    h.playerMail.mockImplementation(async (a: string) => a === 'delete' ? { ok: false, error: 'already_claimed' } : { ok: true, mail: a === 'sent' ? SENT : INBOX });
    await click(screen.getByRole('button', { name: 'Remove' }));
    expect(view.container.textContent).toMatch(/claimed, so it stays/);
    h.playerMail.mockImplementation(async (a: string) => a === 'delete' ? { ok: true } : { ok: true, mail: a === 'sent' ? SENT : INBOX });
    await click(screen.getByRole('button', { name: 'Remove' }));
    expect(h.playerMail).toHaveBeenCalledWith('delete', { id: 's1' });
    expect(view.container.textContent).toMatch(/No mail selected/);
  });

  it('offers compose from an empty sent folder', async () => {
    h.playerMail.mockImplementation(async () => ({ ok: true, mail: [] }));
    const compose = vi.fn();
    await mount('sent', compose);
    await click(screen.getByText('Compose mail'));
    expect(compose).toHaveBeenCalled();
  });
});
