// FIX-mail-014 — the recipient's Decline for COD / attachment mail.
// Behaviour coverage: a COD mail in the inbox offers Decline beside Claim;
// the two-step confirm fires mail.decline exactly once; the result is
// worded in the open (escrow returned, nothing charged); after the
// refresh the mail reads Declined and Claim is gone.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ playerMail: vi.fn(), declined: { current: false } }));
const codRow = (status: string) => ({
  id: 'm1', status, subject: 'COD package', body: 'Pay on delivery.',
  fromName: 'Ada', fromHandle: 'ada', toName: 'Bo', toHandle: 'bo',
  sentAt: 1_770_000_000, expiresAt: 1_780_000_000,
  attachment_dtu_ids: ['d1'], attachmentCc: 25, codCc: 5,
  ...(status === 'declined' ? { declinedAt: 1_770_200_000 } : {}),
});
// Stable references: the panel's open-effect re-reads on selection change,
// so a fresh row object per list call would loop read → refresh forever.
const ROW_UNREAD = codRow('unread');
const ROW_DECLINED = codRow('declined');

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
  h.declined.current = false;
  h.playerMail.mockReset();
  h.playerMail.mockImplementation(async (action: string) => {
    if (action === 'list') return { ok: true, mail: [h.declined.current ? ROW_DECLINED : ROW_UNREAD] };
    if (action === 'sent') return { ok: true, mail: [] };
    if (action === 'decline') { h.declined.current = true; return { ok: true, declined: true, refundedCc: 25 }; }
    return { ok: true };
  });
});

describe('MailFolderPanel decline (FIX-mail-014)', () => {
  it('offers Decline beside Claim, two-step confirms, and the declined mail loses Claim', async () => {
    const { MailFolderPanel } = await import('../MailFolderPanel');
    render(<MailFolderPanel folder="inbox" onCompose={vi.fn()} />);
    await settle();

    await click(screen.getByText('COD package'));
    await settle();

    // Both answers are offered for a COD mail.
    expect(screen.getByRole('button', { name: /Claim \(pay 5 CC\)/ })).toBeInTheDocument();
    const declineBtn = screen.getByRole('button', { name: /Decline mail COD package/ });
    expect(declineBtn).toBeInTheDocument();

    // First click arms the confirm; nothing has been sent yet.
    await click(declineBtn);
    expect(screen.getByText(/Decline this mail\? The gift CC and DTUs go back to the sender and you pay nothing\./)).toBeInTheDocument();
    expect(h.playerMail.mock.calls.filter((c) => c[0] === 'decline')).toHaveLength(0);

    // Confirm fires mail.decline once and the wording lands in the open.
    await click(screen.getByRole('button', { name: /Decline and return/ }));
    await settle();
    const declineCalls = h.playerMail.mock.calls.filter((c) => c[0] === 'decline');
    expect(declineCalls).toHaveLength(1);
    expect(declineCalls[0][1]).toEqual({ id: 'm1' });
    expect(screen.getAllByText(/Declined\. The 25 CC gift and any DTUs went back to the sender; you paid nothing\./).length).toBeGreaterThan(0);

    // After the refresh the selection rides onto the declined copy of the
    // row: no Claim, and the declined line states the outcome.
    await settle();
    expect(screen.queryByRole('button', { name: /Claim \(pay 5 CC\)/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Declined .*— attachments returned to the sender; nothing was charged\./)).toBeInTheDocument();
  });
});
