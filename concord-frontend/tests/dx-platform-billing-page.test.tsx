/**
 * /lenses/dx-platform/billing — CC balance / usage / quota dashboard.
 *
 * Regression pin: POST /api/lens/run always responds { ok: true, result:
 * PAYLOAD } where the outer `ok` is a transport flag only. Before the fix,
 * this page's local `runMacro()` helper returned that raw envelope and read
 * `b.balance` / `u.rows` / `q.quotas` straight off it — always undefined —
 * so the billing dashboard always showed a blank balance and zeroed-out
 * usage/quota tables even against a healthy backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import BillingDashboardPage from '@/app/lenses/dx-platform/billing/page';

function jsonOf(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

function bodyOf(init?: RequestInit) {
  return init?.body ? JSON.parse(String(init.body)) : {};
}

const USAGE_ROW = { ts_day: 19900, domain: 'detectors', macro_name: 'runAll', calls: 12, cost: 3.5, duration_ms_total: 4000, errors: 0 };
const QUOTA_ROW = { domain: 'detectors', macroName: 'runAll', used: 5, limit: 100, remaining: 95, windowStart: 1700000000 };

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('/lenses/dx-platform/billing — nested envelope unwrap', () => {
  it('renders the real balance/usage/quota once the nested envelope is unwrapped', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'balance') return jsonOf({ ok: true, result: { ok: true, balance: 123.45 } });
      if (b.name === 'usage') return jsonOf({ ok: true, result: { ok: true, rows: [USAGE_ROW] } });
      if (b.name === 'getCurrentQuota') return jsonOf({ ok: true, result: { ok: true, quotas: [QUOTA_ROW] } });
      return jsonOf({ ok: true, result: {} });
    }));

    const { getByText, getAllByText, container } = render(<BillingDashboardPage />);

    // CC balance panel — real balance.value from the unwrapped payload.
    await waitFor(() => expect(getByText('123.45')).toBeInTheDocument());
    // Daily spend table — real usage row, not "No macro calls in the last 7 days."
    await waitFor(() => expect(container.textContent).not.toMatch(/No macro calls in the last 7 days\./));
    expect(getAllByText('detectors.runAll').length).toBeGreaterThan(0);
    // Quota tile — real quotas.length count, not the empty-state copy.
    await waitFor(() => expect(container.textContent).not.toMatch(/No macros consumed in this minute\./));
  });

  it('shows the honest empty states when the nested payloads unwrap to empty arrays / null balance', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, result: { ok: true, balance: null, rows: [], quotas: [] } })));
    const { getByText } = render(<BillingDashboardPage />);
    await waitFor(() => expect(getByText('—')).toBeInTheDocument());
    expect(getByText('No macro calls in the last 7 days.')).toBeInTheDocument();
    expect(getByText('No macros consumed in this minute.')).toBeInTheDocument();
  });
});
