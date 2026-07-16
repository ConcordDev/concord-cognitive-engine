/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GmailSyncPanel } from './GmailSyncPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

describe('GmailSyncPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement navigation; the connect button assigns
    // window.location.href, which jsdom otherwise throws on.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '', pathname: '/lenses/travel' },
      writable: true,
    });
  });

  it('renders idle with the Sync from Gmail button and calls travel.inbox-sync on click', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { scanned: 2, imported: 1, skippedCount: 1, skipped: [] }, error: null },
    });
    const onImported = vi.fn();
    render(<GmailSyncPanel tripId="trip_1" onImported={onImported} />);

    expect(screen.getByTestId('gmail-sync-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('gmail-sync-result')).toBeNull();

    fireEvent.click(screen.getByTestId('gmail-sync-btn'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('travel', 'inbox-sync', { tripId: 'trip_1' }));
    await waitFor(() => expect(screen.getByTestId('gmail-sync-result')).toBeInTheDocument());
    expect(screen.getByTestId('gmail-sync-result')).toHaveTextContent('Imported 1 booking from 2 scanned messages.');
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('does not call onImported when the sync finds nothing to import (honest zero, not a fake success banner)', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { scanned: 3, imported: 0, skippedCount: 3, skipped: [] }, error: null },
    });
    const onImported = vi.fn();
    render(<GmailSyncPanel tripId="trip_1" onImported={onImported} />);
    fireEvent.click(screen.getByTestId('gmail-sync-btn'));

    await waitFor(() => expect(screen.getByTestId('gmail-sync-result')).toBeInTheDocument());
    expect(screen.getByTestId('gmail-sync-result')).toHaveTextContent('Scanned 3 messages — no new bookings found.');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('shows the honest Connect-Gmail CTA (not a silent empty result) when Gmail is not connected', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: false, result: null, error: 'no_token' },
    });
    render(<GmailSyncPanel tripId="trip_1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gmail-sync-btn'));

    await waitFor(() => expect(screen.getByTestId('gmail-sync-not-connected')).toBeInTheDocument());
    expect(screen.queryByTestId('gmail-sync-result')).toBeNull();
    expect(screen.queryByTestId('gmail-sync-error')).toBeNull();
  });

  it('treats connector_not_configured and gmail_disabled as the same not-connected state', async () => {
    for (const reason of ['connector_not_configured', 'gmail_disabled']) {
      lensRunMock.mockClear();
      lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: reason } });
      const { unmount } = render(<GmailSyncPanel tripId="trip_1" onImported={vi.fn()} />);
      fireEvent.click(screen.getByTestId('gmail-sync-btn'));
      await waitFor(() => expect(screen.getByTestId('gmail-sync-not-connected')).toBeInTheDocument());
      unmount();
    }
  });

  it('clicking Connect Gmail requests gmail.connect and redirects to the returned authorize URL', async () => {
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'no_token' } });
    render(<GmailSyncPanel tripId="trip_1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gmail-sync-btn'));
    await waitFor(() => expect(screen.getByTestId('gmail-sync-connect-btn')).toBeInTheDocument());

    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { provider: 'google', authorizeUrl: '/api/oauth/google/authorize?token_key=google_gmail', scopes: [] }, error: null },
    });
    fireEvent.click(screen.getByTestId('gmail-sync-connect-btn'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('gmail', 'connect', { redirect: '/lenses/travel' }));
    await waitFor(() => expect(window.location.href).toBe('/api/oauth/google/authorize?token_key=google_gmail'));
  });

  it('surfaces a genuine (non-connection) failure as an error, not a fabricated result', async () => {
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'handler_error' } });
    render(<GmailSyncPanel tripId="trip_1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gmail-sync-btn'));

    await waitFor(() => expect(screen.getByTestId('gmail-sync-error')).toBeInTheDocument());
    expect(screen.getByTestId('gmail-sync-error')).toHaveTextContent('handler_error');
    expect(screen.queryByTestId('gmail-sync-not-connected')).toBeNull();
    expect(screen.queryByTestId('gmail-sync-result')).toBeNull();
  });

  it('disables the sync button while busy', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    lensRunMock.mockReturnValueOnce(new Promise((resolve) => { resolveFn = resolve; }));
    render(<GmailSyncPanel tripId="trip_1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gmail-sync-btn'));
    await waitFor(() => expect(screen.getByTestId('gmail-sync-btn')).toBeDisabled());
    resolveFn({ data: { ok: true, result: { scanned: 0, imported: 0, skippedCount: 0, skipped: [] }, error: null } });
    await waitFor(() => expect(screen.getByTestId('gmail-sync-btn')).not.toBeDisabled());
  });
});
