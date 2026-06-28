import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';

// The page imports LensShell + ManifestActionBar, which pull in the UI store,
// keyboard provider, and accessibility hooks. Stub them to passthrough/no-op so
// the test exercises the mail page's own data + state logic in isolation.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

import MailLensPage from '@/app/lenses/mail/page';

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

const SAMPLE_MAIL = {
  id: 'mail_abc',
  fromUser: 'sender-1',
  toUser: 'me',
  worldId: null,
  subject: 'Welcome to Concord',
  body: 'Here is a gift.',
  status: 'unread',
  sentAt: 1_700_000_000,
  expiresAt: 1_800_000_000,
  attachment_dtu_ids: ['dtu_1'],
  attachmentCc: 100,
  codCc: 0,
};

describe('Mail lens page — four UX states', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // jsdom has no window.location.search params to prefill; default is fine.
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('LOADING: renders a busy/loading status before data resolves', async () => {
    // Never-resolving fetch keeps the page in the loading state.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<MailLensPage />);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/loading mail/i);
  });

  it('EMPTY: renders an honest empty state when the inbox is empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/inbox') || url.includes('/sent')) return jsonResponse({ ok: true, mail: [] });
      return jsonResponse({ ok: true });
    });
    render(<MailLensPage />);
    await waitFor(() => {
      expect(screen.getByText(/no mail\./i)).toBeInTheDocument();
    });
    // Not stuck in loading, no error alert.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ERROR: shows an honest error + retry that re-fetches', async () => {
    // First load: inbox errors. After retry: succeeds with one mail.
    let call = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/inbox')) {
        call += 1;
        return call === 1
          ? jsonResponse({ ok: false, error: 'mail service down' })
          : jsonResponse({ ok: true, mail: [SAMPLE_MAIL] });
      }
      return jsonResponse({ ok: true, mail: [] });
    });
    render(<MailLensPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/mail service down/i);
    const retry = within(alert).getByRole('button', { name: /retry/i });

    fireEvent.click(retry);

    // Retry path resolves to populated data → error clears, mail appears.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Welcome to Concord')).toBeInTheDocument();
    });
  });

  it('POPULATED: renders inbox rows with attachment chips + a11y tablist', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/inbox')) return jsonResponse({ ok: true, mail: [SAMPLE_MAIL] });
      if (url.includes('/sent')) return jsonResponse({ ok: true, mail: [] });
      return jsonResponse({ ok: true });
    });
    render(<MailLensPage />);

    await waitFor(() => {
      expect(screen.getByText('Welcome to Concord')).toBeInTheDocument();
    });
    // Attachment CC chip is shown.
    expect(screen.getByText('100')).toBeInTheDocument();
    // a11y: folder tabs are a tablist with the inbox tab selected.
    const tablist = screen.getByRole('tablist', { name: /mail folders/i });
    const inboxTab = within(tablist).getByRole('tab', { name: /inbox/i });
    expect(inboxTab).toHaveAttribute('aria-selected', 'true');
  });
});
