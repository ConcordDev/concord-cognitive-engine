// INC-64: nonprofit thank-yous and pledge payments must not claim a send
// or a card charge that did not happen.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { commSendFeedback, commStatusLabel, thankYouSweepLines } from '@/components/nonprofit/nonprofitMail';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let respond: (action: string, input: Record<string, unknown>) => unknown = () => ({ ok: true, result: {} });

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((domain: string, action?: string, input?: Record<string, unknown>) => {
    const spec = typeof domain === 'string' && action
      ? { action, input: input || {} }
      : { action: '', input: {} };
    calls.push({ action: spec.action, input: spec.input });
    return Promise.resolve({ data: respond(spec.action, spec.input) });
  }),
}));

vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { NonprofitWorkbench } from '@/components/nonprofit/NonprofitWorkbench';

const workbenchSrc = readFileSync(join(__dirname, '../components/nonprofit/NonprofitWorkbench.tsx'), 'utf8');

const donor = {
  id: 'd1', name: 'Ada Lovelace', email: 'ada@x.org', phone: '', address: '', type: 'Individual', notes: '',
  gifts: [{ id: 'g1', amount: 40, at: '2026-10-01', fund: 'General', campaign: '', method: 'check', receiptIssued: false, ackSent: false }],
  comms: [], pledges: [], totalGiven: 40, giftCount: 1, avgGift: 40, lastGiftAt: '2026-10-01', firstGiftAt: '2026-10-01', pledgeBalance: 0, commCount: 0,
};

describe('INC-64 nonprofit honesty', () => {
  beforeEach(() => { calls.length = 0; respond = () => ({ ok: true, result: {} }); });

  it('copy says Sent only for status sent, and Not sent: connect Gmail otherwise', () => {
    const linked = commSendFeedback('thank_you', { ok: true, result: { donor: 'Ada Lovelace', status: 'not_sent', reason: 'no_gmail_linked' } });
    expect(linked).toBe('Not sent: connect Gmail');
    expect(linked).not.toMatch(/^Sent /);
    const missing = commSendFeedback('appeal', { ok: true, result: { donor: 'Ada Lovelace', status: 'not_sent', reason: 'no_email' } });
    expect(missing).toBe('Not sent: Ada Lovelace has no email.');
    expect(missing).not.toMatch(/^Sent /);
    const delivered = commSendFeedback('thank_you', { ok: true, result: { donor: 'Ada Lovelace', status: 'sent', reason: null } });
    expect(delivered).toBe('Sent thank you to Ada Lovelace.');
    expect(commStatusLabel({ status: 'not_sent', reason: 'no_gmail_linked' })).toBe('Not sent: connect Gmail');
    expect(commStatusLabel({ status: 'sent' })).toBe('Sent');
    const sweep = thankYouSweepLines({ sent: 0, notSent: 1, reasons: [{ donor: 'Ada Lovelace', gifts: 1, reason: 'no_gmail_linked' }] });
    expect(sweep).toEqual(['Not sent: connect Gmail']);
    expect(sweep.join(' ')).not.toMatch(/Queued/);
    expect(thankYouSweepLines({ sent: 1, notSent: 0, reasons: [] })).toEqual(['Sent 1 thank-you message.']);
  });

  it('the communications tab does not say Sent when Gmail did not accept the message', async () => {
    respond = (action) => {
      if (action === 'donor-list') return { ok: true, result: { donors: [donor] } };
      if (action === 'comm-send') return { ok: true, result: { donor: 'Ada Lovelace', status: 'not_sent', reason: 'no_gmail_linked', comm: { status: 'not_sent', reason: 'no_gmail_linked' } } };
      return { ok: true, result: {} };
    };
    render(<NonprofitWorkbench tab="comms" />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toBeTruthy());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not sent: connect Gmail'));
    expect(screen.queryByText(/^Sent /)).toBeNull();
    expect(workbenchSrc).not.toMatch(/Sent \$\{kind/);
    expect(workbenchSrc).not.toMatch(/Queued \$\{/);
  });

  it('the thank-you sweep reports not sent instead of a queue', async () => {
    respond = (action) => {
      if (action === 'donor-list') return { ok: true, result: { donors: [donor] } };
      if (action === 'thankyou-run') return { ok: true, result: { sent: 0, notSent: 1, reasons: [{ donor: 'Ada Lovelace', gifts: 1, reason: 'no_gmail_linked', status: 'not_sent' }] } };
      return { ok: true, result: {} };
    };
    render(<NonprofitWorkbench tab="comms" />);
    fireEvent.click(screen.getByRole('button', { name: /Run thank-you sweep/ }));
    await waitFor(() => expect(screen.getByText('Not sent: connect Gmail')).toBeTruthy());
    expect(screen.queryByText(/Queued/)).toBeNull();
    expect(screen.queryByText(/^Sent /)).toBeNull();
  });

  it('pledge payments are recorded manually and the button does not say Charge', async () => {
    respond = (action) => {
      if (action === 'donor-list') return { ok: true, result: { donors: [donor] } };
      if (action === 'pledge-list') return {
        ok: true,
        result: {
          pledges: [{ id: 'p1', donorId: 'd1', donorName: 'Ada Lovelace', amount: 25, frequency: 'monthly', status: 'active', paid: 0, payments: 0, nextDue: '2026-11-01T00:00:00.000Z', fund: 'General' }],
          count: 1, active: 1, monthlyValue: 25,
        },
      };
      if (action === 'pledge-charge') return { ok: true, result: { recordedManually: true, paymentLabel: 'recorded manually', gift: { method: 'check' } } };
      return { ok: true, result: {} };
    };
    render(<NonprofitWorkbench tab="recurring" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Record payment/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Charge$/ })).toBeNull();
    expect(screen.queryByTitle('Process scheduled payment')).toBeNull();
    expect(workbenchSrc).not.toMatch(/Process scheduled payment/);
    expect(workbenchSrc).toMatch(/Record a payment you already received/);
    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Recorded manually/));
    const charge = calls.find((c) => c.action === 'pledge-charge');
    expect(charge?.input).toMatchObject({ donorId: 'd1', pledgeId: 'p1', method: 'check' });
    expect(charge?.input.method).not.toBe('card');
  });
});
