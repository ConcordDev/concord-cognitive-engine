// FIX-mail-016 — player-mail threading in the folder panel.
// Behaviour coverage: a reply renders directly under the mail it answers
// (not as a separate top-level mail sorted by its own date), the opened
// original shows its thread, Reply hands the composer a seed carrying
// the thread parent, and Forward offers a quote with no thread link.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ playerMail: vi.fn() }));
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: 'read', subject: `Subject ${id}`, body: `Body ${id}`,
  fromUser: 'u-ada', toUser: 'u-me', fromName: 'Ada', fromHandle: 'ada', toName: 'Me', toHandle: 'me',
  sentAt: 1_770_000_000, expiresAt: 1_780_000_000, attachment_dtu_ids: [], attachmentCc: 0, codCc: 0,
  parentId: null, ...extra,
});
// Server order is newest first: the reply (3000) would top the list if it
// were not threaded under the original (1000).
const REPLY = row('m2', { subject: 'Re: Gate rota', body: 'I will take Friday.', fromUser: 'u-bo', fromName: 'Bo', fromHandle: 'bo', parentId: 'm1', sentAt: 1_770_003_000 });
const OTHER = row('m3', { subject: 'Harbour fees', body: 'Fees are due.', sentAt: 1_770_002_000 });
const ORIGINAL = row('m1', { subject: 'Gate rota', body: 'Who takes Friday?', sentAt: 1_770_001_000 });
const INBOX = [REPLY, OTHER, ORIGINAL];

vi.mock('../playerMail', async () => {
  const actual = await vi.importActual<typeof import('../playerMail')>('../playerMail');
  return { ...actual, playerMail: (...a: unknown[]) => h.playerMail(...a) };
});
vi.mock('../MailKeepMenu', () => ({ MailKeepMenu: () => <span>keep-stub</span> }));
vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };

afterEach(() => cleanup());
beforeEach(() => {
  h.playerMail.mockReset();
  h.playerMail.mockImplementation(async (action: string) => {
    if (action === 'list') return { ok: true, mail: INBOX };
    if (action === 'sent') return { ok: true, mail: [] };
    return { ok: true };
  });
});

describe('MailFolderPanel threading (FIX-mail-016)', () => {
  it('nests the reply under its original and offers threaded Reply + Forward seeds', async () => {
    const onCompose = vi.fn();
    const { MailFolderPanel } = await import('../MailFolderPanel');
    const view = render(<MailFolderPanel folder="inbox" onCompose={onCompose} />);
    await settle();

    // List order: the unrelated root keeps its place, the original
    // follows, and the reply renders directly under the original with
    // the thread marker — not at the top by its own newer date.
    const listButtons = [...view.container.querySelectorAll('ul button')].map((b) => b.textContent || '');
    const idx = (s: string) => listButtons.findIndex((t) => t.includes(s));
    expect(idx('Harbour fees')).toBeGreaterThanOrEqual(0);
    expect(idx('Gate rota')).toBeGreaterThan(idx('Harbour fees'));
    expect(idx('Re: Gate rota')).toBeGreaterThan(idx('Gate rota'));
    expect(listButtons[idx('Re: Gate rota')]).toContain('↳');

    // Open the original: the thread block names the reply.
    await click(screen.getAllByText('Gate rota')[0]);
    await settle();
    expect(screen.getByText('Thread')).toBeInTheDocument();
    // The reply now appears twice by design: nested in the list and in
    // the opened original's thread block.
    expect(screen.getAllByText(/Re: Gate rota/).length).toBeGreaterThanOrEqual(2);

    // Reply seeds the composer with the recipient, the Re: subject, the
    // quoted original, and the thread parent.
    await click(screen.getByRole('button', { name: 'Reply' }));
    expect(onCompose).toHaveBeenCalledTimes(1);
    const replySeed = onCompose.mock.calls[0][0];
    expect(replySeed.parentId).toBe('m1');
    expect(replySeed.toUserId).toBe('u-ada');
    expect(replySeed.subject).toBe('Re: Gate rota');
    expect(replySeed.body).toContain('> Who takes Friday?');

    // Forward quotes without a thread link or a preset recipient.
    await click(screen.getByRole('button', { name: 'Forward' }));
    expect(onCompose).toHaveBeenCalledTimes(2);
    const fwdSeed = onCompose.mock.calls[1][0];
    expect(fwdSeed.subject).toBe('Fwd: Gate rota');
    expect(fwdSeed.parentId).toBeUndefined();
    expect(fwdSeed.toUserId).toBeUndefined();
    expect(fwdSeed.body).toContain('> Who takes Friday?');
  });

  it('a reply opened directly names the mail it answers', async () => {
    const { MailFolderPanel } = await import('../MailFolderPanel');
    render(<MailFolderPanel folder="inbox" onCompose={vi.fn()} />);
    await settle();
    await click(screen.getAllByText('Re: Gate rota')[0]);
    await settle();
    expect(screen.getByText(/In reply to/)).toBeInTheDocument();
  });
});
