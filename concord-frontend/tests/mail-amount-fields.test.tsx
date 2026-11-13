// Audit fix sweep (PR #2356) — FIX-mail-017: the player-mail gift/COD
// amount fields coerced every keystroke ('-1' became '01', letters
// became 0, 999999999 sailed through to a server refusal). The fields
// now hold the typed text; an out-of-range amount is refused by name
// at Send, and a valid amount sends as typed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const playerMail = vi.fn((action: string) => {
  if (action === 'send') return Promise.resolve({ ok: true, id: 'mail_test1' });
  return Promise.resolve({ ok: false });
});
vi.mock('@/components/mail/playerMail', () => ({
  playerMail: (action: string, input?: unknown) => playerMail(action, input),
  sendFailureText: () => 'Send failed.',
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/components/message/RecipientSearchInput', () => ({
  RecipientSearchInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    React.createElement('input', {
      'aria-label': 'Recipient',
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
}));
vi.mock('@/components/dtu/DTUPickerModal', () => ({ DTUPickerModal: () => null }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  motion: new Proxy({}, { get: () => ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }),
}));

import { ComposeMailPanel } from '@/components/mail/ComposeMailPanel';

describe('player-mail amount fields — typed text kept, range refused by name', () => {
  beforeEach(() => { playerMail.mockClear(); });

  it('refuses -1 and 999999999 by name; sends 25 as typed', async () => {
    const view = render(<ComposeMailPanel onSent={() => {}} />);
    fireEvent.change(view.getByLabelText('Recipient'), { target: { value: 'user-2' } });
    fireEvent.change(view.getByLabelText(/Subject/), { target: { value: 'Hi' } });
    const gift = view.getByLabelText(/Send CC \(gift\)/) as HTMLInputElement;

    fireEvent.change(gift, { target: { value: '-1' } });
    expect(gift.value).toBe('-1'); // the keystrokes survive — no coercion
    fireEvent.click(view.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Gift amount must be a number from 0 to 1,000,000 CC.'));
    expect(playerMail.mock.calls.some((c) => c[0] === 'send')).toBe(false);

    fireEvent.change(gift, { target: { value: '999999999' } });
    fireEvent.click(view.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Gift amount must be a number'));
    expect(playerMail.mock.calls.some((c) => c[0] === 'send')).toBe(false);

    fireEvent.change(gift, { target: { value: '25' } });
    fireEvent.click(view.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(playerMail.mock.calls.some((c) => c[0] === 'send')).toBe(true));
    const sendCall = playerMail.mock.calls.find((c) => c[0] === 'send');
    expect((sendCall?.[1] as { attachmentCc: number }).attachmentCc).toBe(25);
  });
});
