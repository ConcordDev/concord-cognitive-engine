// Audit fix sweep (PR #2356) — FIX-mail-003: with Gmail simply not
// connected, loading the mail lens fired five failing /api/lens/run
// calls (list + profile + labels, then profile + labels AGAIN when the
// not-connected answer flipped `connected` to false), and every folder
// click added another. Once the not-connected state is known, the load
// effects stop firing behind the connect wall: exactly one probe round.
import { describe, it, expect, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';

const calls = vi.hoisted(() => ({ threads: 0, drafts: 0, profile: 0, labels: 0 }));
vi.mock('@/components/mail/client/gmail', () => ({
  NOT_CONNECTED: new Set(['no_token', 'connector_not_configured', 'gmail_disabled', 'no_user']),
  SYSTEM_FOLDERS: [{ id: 'INBOX', label: 'Inbox' }, { id: 'SENT', label: 'Sent' }],
  fmtListDate: () => '',
  forwardDraft: () => ({}),
  replyDraft: () => ({}),
  senderName: () => '',
  gmailErrorText: (e: string) => e,
  gmail: {
    threads: vi.fn(() => { calls.threads += 1; return Promise.resolve({ ok: false, error: 'no_token' }); }),
    drafts: vi.fn(() => { calls.drafts += 1; return Promise.resolve({ ok: false, error: 'no_token' }); }),
    profile: vi.fn(() => { calls.profile += 1; return Promise.resolve({ ok: false, error: 'no_token' }); }),
    labels: vi.fn(() => { calls.labels += 1; return Promise.resolve({ ok: false, error: 'no_token' }); }),
    connect: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
  },
}));
vi.mock('@/components/mail/client/ComposeSheet', () => ({ ComposeSheet: () => null }));
vi.mock('@/components/mail/client/ThreadView', () => ({ ThreadView: () => null }));
vi.mock('@/components/mail/MailFolderPanel', () => ({ MailFolderPanel: () => null }));
vi.mock('@/components/mail/ComposeMailPanel', () => ({ ComposeMailPanel: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => null, persist: () => {} }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => ({}), { getState: () => ({ addToast: () => {} }) }),
}));

import { MailClient } from '@/components/mail/client/MailClient';

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); };

describe('mail load with Gmail not connected — one quiet probe round (FIX-mail-003)', () => {
  it('probes once, shows the connect wall, and folder clicks fire nothing more', async () => {
    const view = render(<MailClient composeSignal={0} />);
    await settle();
    await settle();
    expect(view.getByText('Bring your inbox here')).toBeTruthy();
    expect(calls.threads).toBe(1);
    expect(calls.profile).toBe(1);
    expect(calls.labels).toBe(1);

    // The Gmail folder button, not the player-mail "Sent" tab (same label).
    const sent = view.getAllByRole('button', { name: 'Sent' }).find((b) => b.getAttribute('role') !== 'tab')!;
    await act(async () => { fireEvent.click(sent); });
    await settle();
    expect(calls.threads).toBe(1);
    expect(calls.profile).toBe(1);
    expect(calls.labels).toBe(1);
  });
});
