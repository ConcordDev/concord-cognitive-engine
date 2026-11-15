// Audit fix sweep (PR #2356) — FIX-mail-010: mailing yourself was
// refused only by a red banner AFTER Send ('cannot mail self'). The
// composer now learns the signed-in id up front and explains at the
// recipient field, with Send off, before Send is ever pressed.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/mail/playerMail', () => ({
  playerMail: vi.fn(() => Promise.resolve({ ok: false })),
  sendFailureText: () => 'Send failed.',
}));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn((url: string) => url === '/api/auth/me'
      ? Promise.resolve({ data: { user: { id: 'user-2' } } })
      : Promise.resolve({ data: {} })),
    post: vi.fn(),
    delete: vi.fn(),
  },
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

describe('player-mail compose — self-recipient explained before Send', () => {
  it('notes it and disables Send when the recipient is yourself', async () => {
    const view = render(<ComposeMailPanel onSent={() => {}} />);
    fireEvent.change(view.getByLabelText(/Subject/), { target: { value: 'Note' } });

    fireEvent.change(view.getByLabelText('Recipient'), { target: { value: 'user-2' } });
    await waitFor(() => expect(view.getByRole('note').textContent).toContain('player mail can'));
    expect((view.getByRole('button', { name: /Send/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(view.getByLabelText('Recipient'), { target: { value: 'user-3' } });
    await waitFor(() => expect(view.queryByRole('note')).toBeNull());
    expect((view.getByRole('button', { name: /Send/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
