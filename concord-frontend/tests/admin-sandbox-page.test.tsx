/**
 * /admin/sandbox — B2B sandbox tenant management.
 *
 * Regression pin: POST /api/lens/run always responds { ok: true, result:
 * PAYLOAD } where the outer `ok` is a transport flag only. Before the fix,
 * this page's local `macro()` helper returned that raw envelope and read
 * `r.tenants` / `r.tenantId` / `r.escrowCc` straight off it — always
 * undefined — so the tenant list, the provision confirmation, and the kill
 * action all silently no-oped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';

import SandboxAdminPage from '@/app/admin/sandbox/page';

function jsonOf(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

const TENANT = {
  id: 7, tenant_org: 'Acme Robotics', monthly_cc: 5000, isolation_level: 'strict',
  provisioned_at: 1700000000, expires_at: 1700000000 + 30 * 86400, status: 'provisioned', escrow_cc: 5000,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(init?: RequestInit) {
  return init?.body ? JSON.parse(String(init.body)) : {};
}

describe('/admin/sandbox — nested envelope unwrap', () => {
  it('LIST: unwraps { ok, result: { ok, tenants } } and renders a real tenant row', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'list') return jsonOf({ ok: true, result: { ok: true, tenants: [TENANT] } });
      return jsonOf({ ok: true, result: { ok: true } });
    }));
    const { getByText } = render(<SandboxAdminPage />);
    await waitFor(() => expect(getByText('Acme Robotics')).toBeInTheDocument());
    expect(getByText(/5000 CC\/mo · strict · escrow 5000 CC · provisioned/)).toBeInTheDocument();
  });

  it('EMPTY: shows "No tenants yet." when the unwrapped tenants list is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, result: { ok: true, tenants: [] } })));
    const { getByText } = render(<SandboxAdminPage />);
    await waitFor(() => expect(getByText('No tenants yet.')).toBeInTheDocument());
  });

  it('PROVISION: unwraps tenantId/escrowCc from the nested envelope into the confirmation message', async () => {
    let listCalls = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'list') { listCalls += 1; return jsonOf({ ok: true, result: { ok: true, tenants: listCalls > 1 ? [TENANT] : [] } }); }
      if (b.name === 'provision') return jsonOf({ ok: true, result: { ok: true, tenantId: 7, escrowCc: 5000 } });
      return jsonOf({ ok: true, result: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getByPlaceholderText } = render(<SandboxAdminPage />);
    await waitFor(() => expect(getByText('No tenants yet.')).toBeInTheDocument());

    fireEvent.change(getByPlaceholderText('Org name'), { target: { value: 'Acme Robotics' } });
    await act(async () => { fireEvent.click(getByText('Provision')); });

    await waitFor(() => expect(getByText(/Provisioned tenant 7, 5000 CC escrowed/)).toBeInTheDocument());
    // refresh() re-fires list after a successful provision.
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  it('PROVISION failure: surfaces the nested error/reason instead of a silent no-op', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'list') return jsonOf({ ok: true, result: { ok: true, tenants: [] } });
      if (b.name === 'provision') return jsonOf({ ok: true, result: { ok: false, reason: 'missing_inputs' } });
      return jsonOf({ ok: true, result: { ok: true } });
    }));
    const { getByText, getByPlaceholderText } = render(<SandboxAdminPage />);
    await waitFor(() => expect(getByText('No tenants yet.')).toBeInTheDocument());
    fireEvent.change(getByPlaceholderText('Org name'), { target: { value: 'Acme Robotics' } });
    await act(async () => { fireEvent.click(getByText('Provision')); });
    await waitFor(() => expect(getByText(/Failed: missing_inputs/)).toBeInTheDocument());
  });

  it('KILL: unwraps ok:true and re-lists after confirming', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let listCalls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'list') { listCalls += 1; return jsonOf({ ok: true, result: { ok: true, tenants: listCalls > 1 ? [] : [TENANT] } }); }
      if (b.name === 'kill') return jsonOf({ ok: true, result: { ok: true, terminated: true } });
      return jsonOf({ ok: true, result: { ok: true } });
    }));
    const { getByText } = render(<SandboxAdminPage />);
    await waitFor(() => expect(getByText('Acme Robotics')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Kill')); });
    await waitFor(() => expect(getByText('No tenants yet.')).toBeInTheDocument());
  });
});
