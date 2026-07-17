/**
 * OrgCollabPanel — role-based collaboration (planner / buyer / analyst).
 *
 * Pins the frontend surface for the additive `supplychain.org*` macros
 * (server/domains/supplychain.js) that reuse the real org substrate in
 * server/lib/world-organizations.js. Every assertion here is driven by a
 * mocked `lensRun` standing in for the real backend in the exact envelope
 * shape it returns — no fabricated data, honest empty states pinned
 * explicitly (no-org state, no-shared-shipments state, no-shared-work-order
 * state), and role gating (planner/buyer/analyst) pinned by what each role
 * is and isn't allowed to see/do in the UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

type LensRunImpl = (domain: string, action: string, input?: unknown) => Promise<{ data: { ok: boolean; result?: unknown; error?: string } }>;
const lensRunMock = vi.fn<Parameters<LensRunImpl>, ReturnType<LensRunImpl>>();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: Parameters<LensRunImpl>) => lensRunMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', email: 'me@x', role: 'user' }, isLoading: false, isAuthenticated: true }),
}));

import { OrgCollabPanel } from '@/components/supplychain/OrgCollabPanel';

function mockByAction(handlers: Record<string, unknown | ((input: unknown) => unknown)>) {
  lensRunMock.mockImplementation((_domain, action, input) => {
    if (!(action in handlers)) return Promise.resolve({ data: { ok: true, result: null } });
    const h = handlers[action];
    const result = typeof h === 'function' ? (h as (i: unknown) => unknown)(input) : h;
    return Promise.resolve({ data: { ok: true, result } });
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
});

const EMPTY_SHIPMENTS = { shipments: [], inTransit: 0, delivered: 0, delayed: 0 };
const EMPTY_WORK_ORDERS = { workOrders: [], openValue: 0, overdueCount: 0 };

describe('OrgCollabPanel — no-org honest empty state', () => {
  it('shows the create/join surface (not a blank page) when orgMine returns no orgs', async () => {
    mockByAction({ orgMine: { organizations: [] } });
    render(<OrgCollabPanel />);
    await waitFor(() => expect(screen.getByText(/not part of a supply-chain team yet/i)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Meridian Logistics/i)).toBeInTheDocument();
  });

  it('orgCreate: submitting the create form calls the real macro with name + type', async () => {
    mockByAction({ orgMine: { organizations: [] }, orgCreate: { organization: { id: 'org_1', name: 'Acme', type: 'firm' }, role: 'planner', orgRole: 'leader' } });
    render(<OrgCollabPanel />);
    await waitFor(() => screen.getByPlaceholderText(/Meridian Logistics/i));
    fireEvent.change(screen.getByPlaceholderText(/Meridian Logistics/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByText(/^Create$/));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'orgCreate');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({ name: 'Acme', type: 'firm' });
    });
  });

  it('orgJoin: never lets a joiner self-select a privileged role from this form (always requests member/apprentice)', async () => {
    mockByAction({ orgMine: { organizations: [] }, orgJoin: { role: 'member', scRole: 'buyer' } });
    render(<OrgCollabPanel />);
    await waitFor(() => screen.getByPlaceholderText(/Meridian Logistics/i));
    fireEvent.click(screen.getByText(/Join by ID/i));
    fireEvent.change(screen.getByPlaceholderText(/ask your planner/i), { target: { value: 'org_9' } });
    fireEvent.click(screen.getByText(/Join as buyer/i));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'orgJoin');
      expect(call).toBeTruthy();
      expect((call?.[2] as Record<string, unknown>).role).toBeUndefined();
    });
  });
});

describe('OrgCollabPanel — planner workspace (full read+write)', () => {
  const ORG = { id: 'org_planner', name: 'Meridian Logistics', type: 'firm', leaderId: 'me', memberCount: 2, myRole: 'leader', myScRole: 'planner' };
  const MEMBERS = {
    organization: ORG,
    members: [
      { userId: 'me', role: 'leader', scRole: 'planner' },
      { userId: 'teammate_1', role: 'member', scRole: 'buyer' },
    ],
    myRole: 'planner',
    myOrgRole: 'leader',
  };

  function setup(shipments = EMPTY_SHIPMENTS, workOrders = EMPTY_WORK_ORDERS) {
    mockByAction({
      orgMine: { organizations: [ORG] },
      orgMembers: MEMBERS,
      shipmentList: shipments,
      workOrderList: workOrders,
    });
    return render(<OrgCollabPanel />);
  }

  it('renders the roster with real member IDs, roles, and the "(you)" tag on the current user', async () => {
    setup();
    // Wait for the roster itself (not just "Meridian Logistics", which also
    // appears in the org-switcher <option> and the interim loading text).
    await waitFor(() => expect(screen.getByText('teammate_1')).toBeInTheDocument());
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
    // both role badges present: Planner (leader/me) + Buyer (teammate) — each
    // also appears in the org-switcher option text, so multi-match is expected.
    expect(screen.getAllByText('Planner').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Buyer').length).toBeGreaterThan(0);
  });

  it('honest empty state: zero shared shipments/work orders render explicit empty text, not fabricated rows', async () => {
    setup();
    await waitFor(() => expect(screen.getByText(/No shared shipments yet/i)).toBeInTheDocument());
    expect(screen.getByText(/No shared work orders yet/i)).toBeInTheDocument();
  });

  it('planner can raise a team work order (planner-only write) via a real workOrderCreate call', async () => {
    setup();
    await waitFor(() => screen.getByPlaceholderText(/New PO item/i));
    fireEvent.change(screen.getByPlaceholderText(/New PO item/i), { target: { value: 'Steel Coil' } });
    fireEvent.click(screen.getByText(/Raise PO/i));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'workOrderCreate');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({ orgId: 'org_planner', item: 'Steel Coil' });
    });
  });

  it('planner sees a role-change control for a non-leader teammate and can promote/demote via orgSetRole', async () => {
    mockByAction({
      orgMine: { organizations: [ORG] },
      orgMembers: MEMBERS,
      shipmentList: EMPTY_SHIPMENTS,
      workOrderList: EMPTY_WORK_ORDERS,
      orgSetRole: { role: 'apprentice', scRole: 'analyst' },
    });
    render(<OrgCollabPanel />);
    await waitFor(() => screen.getByText('teammate_1'));
    const select = screen.getByDisplayValue('Buyer');
    fireEvent.change(select, { target: { value: 'analyst' } });
    const applyButtons = screen.getAllByLabelText(/Set teammate_1 role/i);
    fireEvent.click(applyButtons[0]);
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'orgSetRole');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({ orgId: 'org_planner', targetUserId: 'teammate_1', role: 'analyst' });
    });
  });
});

describe('OrgCollabPanel — analyst workspace (read-only)', () => {
  const ORG = { id: 'org_analyst', name: 'Meridian Logistics', type: 'firm', leaderId: 'boss', memberCount: 2, myRole: 'apprentice', myScRole: 'analyst' };
  const MEMBERS = {
    organization: ORG,
    members: [
      { userId: 'boss', role: 'leader', scRole: 'planner' },
      { userId: 'me', role: 'apprentice', scRole: 'analyst' },
    ],
    myRole: 'analyst',
    myOrgRole: 'apprentice',
  };

  it('an analyst sees the read-only banner and no shipment/work-order write controls', async () => {
    mockByAction({
      orgMine: { organizations: [ORG] },
      orgMembers: MEMBERS,
      shipmentList: { shipments: [{ id: 's1', reference: 'SHP-1' }], inTransit: 1, delivered: 0, delayed: 0 },
      workOrderList: EMPTY_WORK_ORDERS,
    });
    render(<OrgCollabPanel />);
    await waitFor(() => expect(screen.getByText(/Viewing as/i)).toBeInTheDocument());
    // "Analyst" also appears in the org-switcher <option> text alongside the
    // role badge, so this is an intentionally multi-match query.
    expect(screen.getAllByText(/Analyst/i).length).toBeGreaterThan(0);
    // real shared shipment data still renders (read access)
    expect(screen.getByText('SHP-1')).toBeInTheDocument();
    // but no write affordances for an analyst
    expect(screen.queryByPlaceholderText(/New shipment reference/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/New PO item/i)).toBeNull();
    // and no role-editing control (analyst can't manage the roster)
    expect(screen.queryByLabelText(/Set boss role/i)).toBeNull();
  });
});

describe('OrgCollabPanel — buyer workspace (shipments write, not work orders)', () => {
  const ORG = { id: 'org_buyer', name: 'Meridian Logistics', type: 'firm', leaderId: 'boss', memberCount: 2, myRole: 'member', myScRole: 'buyer' };
  const MEMBERS = {
    organization: ORG,
    members: [
      { userId: 'boss', role: 'leader', scRole: 'planner' },
      { userId: 'me', role: 'member', scRole: 'buyer' },
    ],
    myRole: 'buyer',
    myOrgRole: 'member',
  };

  it('a buyer can add a shipment but has no work-order write control', async () => {
    mockByAction({
      orgMine: { organizations: [ORG] },
      orgMembers: MEMBERS,
      shipmentList: EMPTY_SHIPMENTS,
      workOrderList: EMPTY_WORK_ORDERS,
    });
    render(<OrgCollabPanel />);
    await waitFor(() => screen.getByPlaceholderText(/New shipment reference/i));
    expect(screen.queryByPlaceholderText(/New PO item/i)).toBeNull();
    expect(screen.getByText(/work orders are planner-only/i)).toBeInTheDocument();
  });
});
