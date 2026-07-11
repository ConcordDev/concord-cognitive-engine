import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
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

// The compose tab's RecipientSearchInput hits `api.get('/api/social/users/search', ...)`
// via axios (not the raw `fetch` this file already stubs) — mock it separately
// so the recipient-search test can drive it deterministically.
const apiGetMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGetMock(...args) },
}));

// Capturing socket mock — lets a test fire the real server event name and
// assert the page's `subscribe('mail:received', ...)` handler (not a dead
// `window.addEventListener`) actually re-fetches.
vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import MailLensPage from '@/app/lenses/mail/page';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

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
    apiGetMock.mockReset();
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

  it('realtime: a real mail:received socket event refetches (was a dead window listener)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/inbox') || url.includes('/sent')) return jsonResponse({ ok: true, mail: [] });
      return jsonResponse({ ok: true });
    });
    render(<MailLensPage />);
    await waitFor(() => expect(screen.getByText(/no mail\./i)).toBeInTheDocument());

    const callsAfterMount = fetchMock.mock.calls.length;
    act(() => {
      emitSocket('mail:received', { id: 'mail_new', fromUserId: 'sender-2', subject: 'Hi' });
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount));
  });

  it('compose: recipient is picked from a real user search, not typed as a raw id', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/inbox') || url.includes('/sent')) return jsonResponse({ ok: true, mail: [] });
      return jsonResponse({ ok: true });
    });
    apiGetMock.mockResolvedValue({
      data: {
        ok: true,
        users: [{ id: 'user_real_42', username: 'zara', displayName: 'Zara' }],
      },
    });

    render(<MailLensPage />);
    await waitFor(() => expect(screen.getByRole('tab', { name: /compose/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /compose/i }));

    const recipientInput = await screen.findByPlaceholderText(/search by username or paste a userid/i);
    fireEvent.change(recipientInput, { target: { value: 'za' } });

    // Debounced (300ms) — wait for the search to resolve and render a result.
    const resultButton = await screen.findByRole('button', { name: /zara/i }, { timeout: 2000 });
    expect(apiGetMock).toHaveBeenCalledWith('/api/social/users/search', { params: { q: 'za' } });

    fireEvent.click(resultButton);

    // Selecting a result fills the recipient field with the REAL id, not free text.
    expect((recipientInput as HTMLInputElement).value).toBe('user_real_42');

    // Result list closes after selection — no leftover autocomplete row.
    expect(screen.queryByRole('button', { name: /zara/i })).not.toBeInTheDocument();
  });
});
