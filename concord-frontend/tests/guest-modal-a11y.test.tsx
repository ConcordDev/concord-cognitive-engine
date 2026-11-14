import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * GB-1536 §6g — GuestAuthModal accessibility contract: role="dialog",
 * aria-modal, labelled by the form's heading, focus moves in on open,
 * Tab is trapped inside, Esc closes (and the provider returns focus
 * to the triggering control). AuthPage is stubbed — the modal frame
 * is the unit under test; AuthPage itself has its own suites.
 */

vi.mock('@/components/auth/AuthPage', () => ({
  AuthPage: ({ initialMode }: { initialMode?: string }) => (
    <div>
      <h1 id="guest-auth-title">{initialMode === 'signup' ? 'Create your account' : 'Sign in to Concord'}</h1>
      <label>
        Email
        <input type="email" name="email" />
      </label>
      <button type="submit">Continue</button>
    </div>
  ),
}));

import { GuestAuthModal } from '@/components/auth/GuestAuthModal';

describe('GuestAuthModal (GB-1536)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders as a labelled modal dialog', () => {
    render(<GuestAuthModal mode="signup" returnTo="/lenses/chem" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('guest-auth-title');
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('moves focus into the dialog on open', () => {
    render(<GuestAuthModal mode="signin" returnTo="/hub" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Esc closes it', () => {
    const onClose = vi.fn();
    render(<GuestAuthModal mode="signup" returnTo="/hub" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close button closes it', () => {
    const onClose = vi.fn();
    render(<GuestAuthModal mode="signup" returnTo="/hub" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close sign in' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab is trapped: focus wraps from the last control back to the first', () => {
    render(<GuestAuthModal mode="signup" returnTo="/hub" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
    expect(focusables.length).toBeGreaterThan(1);
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
  });
});
