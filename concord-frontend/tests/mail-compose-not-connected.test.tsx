// Audit fix sweep (PR #2356) — FIX-mail-004: the floating Compose
// button did nothing useful when Gmail wasn't connected (a Gmail
// composer opened onto the connect wall, unable to send — on the
// reported build, no visible effect). Compose now routes to the
// player-mail composer when Gmail is not connected.
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/mail/client/gmail', () => ({
  NOT_CONNECTED: new Set(['no_token', 'connector_not_configured']),
  SYSTEM_FOLDERS: [{ id: 'INBOX', label: 'Inbox' }],
  fmtListDate: () => '',
  forwardDraft: () => ({}),
  replyDraft: () => ({}),
  senderName: () => '',
  gmailErrorText: (e: string) => e,
  gmail: {
    threads: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
    drafts: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
    profile: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
    labels: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
    connect: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
  },
}));
vi.mock('@/components/mail/client/ComposeSheet', () => ({
  ComposeSheet: () => React.createElement('div', { role: 'dialog', 'aria-label': 'probe-composer' }),
}));
vi.mock('@/components/mail/client/ThreadView', () => ({ ThreadView: () => null }));
vi.mock('@/components/mail/MailFolderPanel', () => ({ MailFolderPanel: () => null }));
vi.mock('@/components/mail/ComposeMailPanel', () => ({
  ComposeMailPanel: () => React.createElement('div', { 'data-testid': 'player-compose' }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => null, persist: () => {} }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => ({}), { getState: () => ({ addToast: () => {} }) }),
}));

import { MailClient } from '@/components/mail/client/MailClient';

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); };

describe('mail Compose with Gmail not connected — routes to player mail', () => {
  it('opens the player-mail composer, not a Gmail composer', async () => {
    const view = render(<MailClient composeSignal={0} />);
    await settle();
    expect(view.getByText('Bring your inbox here')).toBeTruthy();
    expect(view.queryByTestId('player-compose')).toBeNull();

    view.rerender(<MailClient composeSignal={1} />);
    await settle();
    expect(view.queryByRole('dialog', { name: 'probe-composer' })).toBeNull();
    expect(view.getByTestId('player-compose')).toBeTruthy();
  });
});
