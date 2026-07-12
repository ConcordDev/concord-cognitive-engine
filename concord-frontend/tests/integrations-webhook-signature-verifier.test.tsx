/**
 * WebhookSignatureVerifier — pins the previously-unsurfaced
 * `integrations.verifyWebhookSignature` macro (server/domains/integrations.js)
 * now wired in as a small inbound-signature debug widget on the Webhooks tab.
 *
 * lensRun is the one mock surface — no fabricated data; the component only
 * ever renders exactly what the macro returns:
 *   integrations.verifyWebhookSignature -> { ok:true, result: { valid, expected, provided, signatureHeader } }
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { WebhookSignatureVerifier } from '@/components/integrations/WebhookSignatureVerifier';

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('WebhookSignatureVerifier — integrations.verifyWebhookSignature', () => {
  it('renders a valid match exactly as the macro reports it', async () => {
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      expect(domain).toBe('integrations');
      expect(action).toBe('verifyWebhookSignature');
      expect(input.webhookId).toBe('wh_1');
      return Promise.resolve({
        data: {
          ok: true,
          result: { valid: true, expected: 'sha=abc123', provided: 'sha=abc123', signatureHeader: 'X-Concord-Signature' },
          error: null,
        },
      });
    });

    await act(async () => { render(<WebhookSignatureVerifier webhookId="wh_1" />); });
    fireEvent.change(screen.getByPlaceholderText('sha=...'), { target: { value: 'sha=abc123' } });
    fireEvent.click(screen.getByText('Verify'));

    await waitFor(() => expect(screen.getByTestId('webhook-signature-result')).toBeInTheDocument());
    const result = screen.getByTestId('webhook-signature-result');
    expect(result.textContent).toContain('Signature matches.');
    expect(result.textContent).not.toContain('expected:');
  });

  it('renders a mismatch and shows the real expected signature — never fakes success', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: { valid: false, expected: 'sha=real000', provided: 'sha=wrong111', signatureHeader: 'X-Concord-Signature' },
        error: null,
      },
    });

    await act(async () => { render(<WebhookSignatureVerifier webhookId="wh_1" />); });
    fireEvent.change(screen.getByPlaceholderText('sha=...'), { target: { value: 'sha=wrong111' } });
    fireEvent.click(screen.getByText('Verify'));

    await waitFor(() => expect(screen.getByTestId('webhook-signature-result')).toBeInTheDocument());
    const result = screen.getByTestId('webhook-signature-result');
    expect(result.textContent).toContain('Signature does not match.');
    expect(result.textContent).toContain('sha=real000');
  });

  it('surfaces an honest error when the macro call fails', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'webhookId required' } });

    await act(async () => { render(<WebhookSignatureVerifier webhookId="wh_1" />); });
    fireEvent.change(screen.getByPlaceholderText('sha=...'), { target: { value: 'sha=x' } });
    fireEvent.click(screen.getByText('Verify'));

    await waitFor(() => expect(screen.getByText('webhookId required')).toBeInTheDocument());
    expect(screen.queryByTestId('webhook-signature-result')).not.toBeInTheDocument();
  });

  it('disables Verify until both body and signature are present', async () => {
    await act(async () => { render(<WebhookSignatureVerifier webhookId="wh_1" />); });
    // Body has a sample default, but signature is empty — button must stay disabled.
    expect(screen.getByText('Verify').closest('button')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('sha=...'), { target: { value: 'sha=x' } });
    expect(screen.getByText('Verify').closest('button')).not.toBeDisabled();
  });
});
