// Behavior test for CookieConsent (issue #4 — real tests on load-bearing,
// high-churn, previously-untested files). 18 commits, user-facing, gates the
// consent localStorage key — worth a real test, not just import-smoke.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CookieConsent } from '@/components/common/CookieConsent';

const KEY = 'concord_cookie_consent';

describe('CookieConsent', () => {
  it('shows the notice + both choices when no consent is stored', async () => {
    render(<CookieConsent />);
    expect(await screen.findByText('Cookie Notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('stays hidden when consent was already recorded', () => {
    window.localStorage.setItem(KEY, 'accepted');
    render(<CookieConsent />);
    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
  });

  it('Accept persists acceptance and dismisses the banner', async () => {
    render(<CookieConsent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument());
    expect(window.localStorage.getItem(KEY)).toBe('accepted');
  });

  it('Reject persists rejection and dismisses the banner', async () => {
    render(<CookieConsent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument());
    expect(window.localStorage.getItem(KEY)).toBe('rejected');
  });
});
