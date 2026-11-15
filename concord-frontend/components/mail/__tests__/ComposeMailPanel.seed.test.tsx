// FIX-mail-016 — the composer honours a reply seed: fields prefill, the
// reply state is stated in the open, and the send carries parentId so
// the mail threads under the original.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const sendCall = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('@/components/mail/playerMail', () => ({
  playerMail: vi.fn((action: string, input: Record<string, unknown> = {}) => {
    if (action === 'send') { sendCall.current = input; return Promise.resolve({ ok: true, id: 'mail_new' }); }
    if (action === 'draft-get') return Promise.resolve({ ok: true, draft: null });
    return Promise.resolve({ ok: true });
  }),
  sendFailureText: () => 'Send failed.',
}));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { user: { id: 'u-me' } } })),
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

describe('player-mail compose — reply seed (FIX-mail-016)', () => {
  it('prefills from the seed and sends parentId with the reply', async () => {
    const onSent = vi.fn();
    const view = render(
      <ComposeMailPanel
        onSent={onSent}
        seed={{
          toUserId: 'u-ada',
          subject: 'Re: Gate rota',
          body: '\n\n— On Nov 13, Ada wrote:\n> Who takes Friday?',
          parentId: 'm1',
        }}
      />,
    );
    await waitFor(() => expect((view.getByLabelText('Recipient') as HTMLInputElement).value).toBe('u-ada'));
    expect((view.getByLabelText(/Subject/) as HTMLInputElement).value).toBe('Re: Gate rota');
    expect(view.getByText(/This is a reply — it will thread under the original mail/)).toBeInTheDocument();

    fireEvent.click(view.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(sendCall.current).toMatchObject({ toUserId: 'u-ada', subject: 'Re: Gate rota', parentId: 'm1' });
  });
});
