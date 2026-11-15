// FIX-settings-005 — sign-in surface pins.
//
// (1) The login page: a twoFactorRequired response does NOT complete
// sign-in — it hands off to /login/2fa carrying the challenge and the
// validated destination. (2) The challenge page: posts the code to
// /login/verify-2fa, surfaces refusals honestly, offers the recovery
// mode, and without a challenge explains itself instead of rendering
// a dead form.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';
import TwoFactorPage from '@/app/login/2fa/page';

const h = vi.hoisted(() => ({
  params: new URLSearchParams(''),
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.params,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/realtime/socket', () => ({ connectSocket: vi.fn() }));

vi.mock('@/lib/api/client', () => ({
  api: {
    post: (url: string, body: unknown) => h.post(url, body),
    get: (url: string) => h.get(url),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

const realLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  h.params = new URLSearchParams('');
  h.get.mockResolvedValue({ data: { ok: true } });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'http://localhost/login', pathname: '/login', search: '' },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('login page — two-factor handoff (FIX-settings-005)', () => {
  it('a twoFactorRequired response navigates to the challenge step, not into the app', async () => {
    h.params = new URLSearchParams('from=/lenses/music');
    h.post.mockResolvedValue({ data: { ok: true, twoFactorRequired: true, challengeId: 'ch_42' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByTestId('login-form'));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/api/auth/login', { username: 'alice', password: 'pw' }));
    await waitFor(() => {
      expect(window.location.href).toBe('/login/2fa?challenge=ch_42&from=%2Flenses%2Fmusic');
    });
    // No "entered" marker: sign-in has NOT completed.
    expect(localStorage.getItem('concord_entered')).toBeNull();
  });
});

describe('two-factor challenge page (FIX-settings-005)', () => {
  it('posts the code with the challenge id and lands on the destination on success', async () => {
    h.params = new URLSearchParams('challenge=ch_7&from=/hub');
    h.post.mockResolvedValue({ data: { ok: true, user: { id: 'u1' } } });
    render(<TwoFactorPage />);
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByTestId('two-factor-form'));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/api/auth/login/verify-2fa', { challengeId: 'ch_7', code: '123456' }));
    await waitFor(() => expect(window.location.href).toBe('/hub'));
    expect(localStorage.getItem('concord_entered')).toBe('true');
  });

  it('surfaces a refusal honestly and offers the recovery mode', async () => {
    h.params = new URLSearchParams('challenge=ch_7');
    h.post.mockRejectedValue({ response: { data: { error: "That code didn't match. Check your authenticator app, or use a recovery code." } } });
    render(<TwoFactorPage />);
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000000' } });
    fireEvent.submit(screen.getByTestId('two-factor-form'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/that code didn't match/i);

    fireEvent.click(screen.getByRole('button', { name: /use a recovery code instead/i }));
    expect(screen.getByLabelText('Recovery code')).toBeTruthy();
    expect(screen.getByPlaceholderText('XXXX-XXXX-XXXX')).toBeTruthy();
  });

  it('without a challenge it explains itself and links back to sign-in', async () => {
    h.params = new URLSearchParams('');
    render(<TwoFactorPage />);
    expect(await screen.findByText(/missing its challenge/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to sign in/i }).getAttribute('href')).toBe('/login');
    expect(screen.queryByTestId('two-factor-form')).toBeNull();
  });
});
