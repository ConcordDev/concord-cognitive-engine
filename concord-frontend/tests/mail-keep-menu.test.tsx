import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: Record<string, unknown>) => input,
}));

import { MailKeepMenu } from '@/components/mail/MailKeepMenu';

const mail = { id: 'mail_abc', fromUser: 'u1', toUser: 'u2', subject: 'Hello', body: 'See you there.' };

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('MailKeepMenu', () => {
  it('saves only after read-back, then sends that DTU to a private Timeline post', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (spec.domain === 'dtu' && action === 'create') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'timeline') {
        return { data: { ok: true, result: { post: { id: 'pst_9', privacy: 'private', citedDtuId: 'dtu_9' } } } };
      }
      return { data: { ok: false, result: null, error: 'unexpected' } };
    });
    render(<MailKeepMenu mail={mail} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save this mail as DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved as private DTU dtu_9. Gmail was not used.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Timeline' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sent DTU dtu_9 to your Timeline as private post pst_9. Gmail was not sent.'));
    expect(screen.getByRole('link', { name: 'Open Timeline post pst_9' })).toHaveAttribute('href', '/lenses/timeline?tab=feed');
    const sendCall = lensRunMock.mock.calls.map((c) => c[0]).find((spec) => spec.domain === 'timeline');
    expect(sendCall.input.citedDtuId).toBe('dtu_9');
    expect(sendCall.input.privacy).toBe('private');
  });

  it('does not say saved when the DTU cannot be read back', async () => {
    lensRunMock.mockImplementation(async (spec: { name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_missing' } } } };
      return { data: { ok: false, result: null, error: 'DTU not found' } };
    });
    render(<MailKeepMenu mail={mail} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save this mail as DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not be read back/));
    expect(screen.getByRole('status').textContent).not.toMatch(/^Saved/);
    expect(screen.queryByRole('button', { name: 'Send this DTU to Timeline' })).toBeNull();
  });
});
