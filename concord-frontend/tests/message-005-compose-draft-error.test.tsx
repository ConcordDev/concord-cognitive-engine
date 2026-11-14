// FIX-message-005 — the Gmail composer's draft save printed the raw
// connector reason ("Draft not saved: no token") with no next step.
// domains/gmail.js mirrors the reason precisely so the UI can switch on
// it, and every other mail surface renders failures through
// gmailErrorText; ComposeSheet interpolated the reason itself. This pin
// drives the real sheet with saveDraft refusing 'no_token' and asserts
// the human wording renders, the raw reason never does, and the typed
// body is still in the composer afterwards.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/mail/client/gmail', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/mail/client/gmail')>();
  return {
    ...orig,
    gmail: {
      ...orig.gmail,
      saveDraft: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
      attachment: vi.fn(() => Promise.resolve({ ok: false, error: 'no_token' })),
    },
  };
});

import { ComposeSheet } from '@/components/mail/client/ComposeSheet';

describe('compose draft save failure wording (FIX-message-005)', () => {
  it('shows the human connect guidance, never the raw reason, and keeps the text', async () => {
    render(
      <ComposeSheet
        init={{
          key: 'k1', mode: 'new',
          draft: { to: '', cc: '', bcc: '', subject: '', body: 'hello body', attachments: [] } as never,
        }}
        onClose={() => {}}
        onSend={() => {}}
        onDraftSaved={() => {}}
      />,
    );
    const body = await screen.findByDisplayValue('hello body');
    expect(body).toBeTruthy();
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(() => {
      expect(screen.queryByText(/Draft not saved/)).toBeTruthy();
    });
    const errText = screen.getByText(/Draft not saved/).textContent || '';
    expect(errText).toMatch(/isn.t connected yet/i);
    expect(errText).not.toMatch(/no token/i);
    expect(errText).toMatch(/stays in this composer/i);
    expect((screen.getByDisplayValue('hello body') as HTMLTextAreaElement).value).toBe('hello body');
  });
});
