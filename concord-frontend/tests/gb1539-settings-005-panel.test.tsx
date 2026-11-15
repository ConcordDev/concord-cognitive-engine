// FIX-settings-005 — AccountSecurityPanel two-factor flow pins.
//
// The panel's 2FA section is the real enrol/manage surface for
// /api/auth/2fa/*: status governs what renders; setup shows the QR +
// manual secret and enforces NOTHING until a code confirms; enable
// shows the recovery codes exactly once behind a saved-them
// acknowledgement; the manage actions stay disabled until both the
// password and a current code are present.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountSecurityPanel } from '@/components/settings/AccountSecurityPanel';

const h = vi.hoisted(() => ({
  status: { ok: true, enabled: false, pending: false, confirmedAt: null, recoveryCodesRemaining: 0 },
  post: vi.fn(),
  get: vi.fn(),
  lensRun: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('qrcode', () => ({
  toDataURL: async () => 'data:image/png;base64,qr',
  default: { toDataURL: async () => 'data:image/png;base64,qr' },
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (url: string) => {
      if (url === '/api/auth/2fa/status') return Promise.resolve({ data: h.status });
      if (url === '/api/auth/me/connections') return Promise.resolve({ data: { ok: true, oauthConnections: [] } });
      return Promise.resolve({ data: { ok: true } });
    },
    post: (url: string, body: unknown) => h.post(url, body),
    delete: () => Promise.resolve({ data: { ok: true } }),
  },
  lensRun: (domain: string, action: string, input: unknown) => h.lensRun(domain, action, input),
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.status = { ok: true, enabled: false, pending: false, confirmedAt: null, recoveryCodesRemaining: 0 };
  h.lensRun.mockImplementation(async (_d: string, action: string) => {
    if (action === 'accountOverview') return { data: { ok: true, result: { lastPasswordChange: null } } };
    if (action === 'sessions') return { data: { ok: true, result: { sessions: [] } } };
    return { data: { ok: true, result: {} } };
  });
  h.post.mockImplementation(async (url: string) => {
    if (url === '/api/auth/2fa/setup') return { data: { ok: true, secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Concord%3Aalice?secret=JBSWY3DPEHPK3PXP' } };
    if (url === '/api/auth/2fa/enable') return { data: { ok: true, recoveryCodes: ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'] } };
    return { data: { ok: true } };
  });
});

describe('AccountSecurityPanel — two-factor (FIX-settings-005)', () => {
  it('enrols: setup shows QR + secret, confirm turns it on, recovery codes show once behind the acknowledgement', async () => {
    render(<AccountSecurityPanel />);
    const setupBtn = await screen.findByRole('button', { name: /set up two-factor/i });
    fireEvent.click(setupBtn);

    // The pending secret is shown for the authenticator — QR + manual entry.
    const qr = await screen.findByAltText('Two-factor setup QR code');
    expect(qr.getAttribute('src')).toContain('data:image/png');
    expect(screen.getByLabelText('Two-factor secret for manual entry').textContent).toContain('JBSWY3DPEHPK3PXP');
    expect(h.post).toHaveBeenCalledWith('/api/auth/2fa/setup', {});

    // Confirm stays disabled until a code is typed.
    const confirm = screen.getByRole('button', { name: /turn on two-factor/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Authenticator code to confirm setup'), { target: { value: '123456' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/api/auth/2fa/enable', { code: '123456' }));

    // Recovery codes: shown once, and Done waits for the saved-them ack.
    expect(await screen.findByText('AAAA-BBBB-CCCC')).toBeTruthy();
    expect(screen.getByText('DDDD-EEEE-FFFF')).toBeTruthy();
    const done = screen.getByRole('button', { name: /^done$/i });
    expect((done as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/i've saved my recovery codes/i));
    expect((done as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByText('AAAA-BBBB-CCCC')).toBeNull());
  });

  it('when on: shows the remaining recovery count and keeps both manage actions gated on password + code', async () => {
    h.status = { ok: true, enabled: true, pending: false, confirmedAt: 1762000000000, recoveryCodesRemaining: 7 };
    render(<AccountSecurityPanel />);
    expect(await screen.findByText(/7 recovery codes remaining/i)).toBeTruthy();

    const disable = screen.getByRole('button', { name: /turn off two-factor/i });
    const regen = screen.getByRole('button', { name: /new recovery codes/i });
    expect((disable as HTMLButtonElement).disabled).toBe(true);
    expect((regen as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Password to manage two-factor'), { target: { value: 'pw' } });
    expect((disable as HTMLButtonElement).disabled).toBe(true); // code still missing
    fireEvent.change(screen.getByLabelText('Current code to manage two-factor'), { target: { value: '654321' } });
    expect((disable as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(disable);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/api/auth/2fa/disable', { password: 'pw', code: '654321' }));
  });

  it('when off: the section offers setup and never claims a session factor exists', async () => {
    render(<AccountSecurityPanel />);
    expect(await screen.findByRole('button', { name: /set up two-factor/i })).toBeTruthy();
    expect(screen.queryByText(/not available yet/i)).toBeNull();
  });
});
