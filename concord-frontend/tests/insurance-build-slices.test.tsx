// concord-frontend/tests/insurance-build-slices.test.tsx
//
// Behaviour pins for the insurance full-lens build (GB-1089 replacement
// pair; R5 first pass 2026-11-01 + the Lead compilation's repair order).
// The lensRun fake mirrors the server contracts of record (client-list
// enriches per-client counts at call time; claim-file stamps the policy
// link) so the pins isolate the SURFACE behaviour each slice changed:
//   S1 (F2) — after a linked policy is saved in another tab, the Clients
//             card shows the fresh aggregate without a reload, and prints
//             the captured referral/notes fields.
//   S2 (F4) — the File claim form links a policy, and the card prints the
//             policy number + claimant.
//   S3 (F3) — the workbench's seeded sample book runs unedited (loss ratio
//             266.67%, commission $144); a shapeless book is refused.
//   S4 (F6) — deletes are two-step (client + claim legs).
//   S5 (F5) — pact dates render from the store's seconds, not as 1970.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

interface FakeClient { id: string; name: string; referralSource?: string | null; notes?: string | null; riskProfile?: string }
interface FakePolicy { id: string; carrier: string; policyNumber: string; kind: string; annualPremium: number; deductible: number; renewalDate: string; status: string; clientId?: string | null; insuredName?: string | null }
interface FakeClaim { id: string; carrier: string; description: string; kind: string; status: string; claimAmount: number; submittedDate: string; policyId: string; policyNumber: string | null; clientId: string | null; claimantName: string | null }

const store = {
  clients: [] as FakeClient[],
  policies: [] as FakePolicy[],
  claims: [] as FakeClaim[],
  calls: [] as string[],
  lastBook: null as null | { policies: { premium: number; commissionRate?: number }[]; claims: { status: string; amount: number }[] },
};
let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;

function enrichedClients() {
  return store.clients.map((c) => {
    const ps = store.policies.filter((p) => p.clientId === c.id);
    const cs = store.claims.filter((cl) => cl.clientId === c.id);
    return {
      ...c, phone: null, email: null, address: null,
      policyCount: ps.length,
      activePolicyCount: ps.filter((p) => p.status === 'active').length,
      claimCount: cs.length,
      totalAnnualPremium: ps.filter((p) => p.status === 'active').reduce((s, p) => s + p.annualPremium, 0),
    };
  });
}

function fakeRun(verb: string, params: Record<string, unknown>) {
  store.calls.push(verb);
  switch (verb) {
    case 'insurance-dashboard':
      return { data: { ok: true, result: { activePolicies: 0, totalPolicies: 0, openClaims: 0, annualPremium: 0, renewalsDue: 0, openReminders: 0, coveredAssetValue: 0 } } };
    case 'client-list':
      return { data: { ok: true, result: { clients: enrichedClients(), count: store.clients.length } } };
    case 'client-add': {
      const c: FakeClient = { id: nid('cli'), name: String(params.name), referralSource: (params.referralSource as string) || null, notes: (params.notes as string) || null, riskProfile: 'standard' };
      store.clients.push(c);
      return { data: { ok: true, result: { client: c } } };
    }
    case 'client-delete': {
      const i = store.clients.findIndex((c) => c.id === params.id);
      if (i < 0) return { data: { ok: false, error: 'client_not_found' } };
      store.clients.splice(i, 1);
      return { data: { ok: true, result: { deleted: params.id } } };
    }
    case 'policy-list':
      return { data: { ok: true, result: { policies: store.policies } } };
    case 'policy-add': {
      const client = store.clients.find((c) => c.id === params.clientId);
      const p: FakePolicy = {
        id: nid('pol'), carrier: String(params.carrier), policyNumber: String(params.policyNumber),
        kind: String(params.kind || 'auto'), annualPremium: Number(params.annualPremium) || 0,
        deductible: 0, renewalDate: '2027-11-04', status: 'active',
        clientId: (params.clientId as string) || null, insuredName: client ? client.name : null,
      };
      store.policies.push(p);
      return { data: { ok: true, result: { policy: p } } };
    }
    case 'policy-detail':
      return { data: { ok: true, result: { documents: [], payments: [] } } };
    case 'id-card':
      return { data: { ok: false, error: 'none' } };
    case 'beneficiary-list':
      return { data: { ok: true, result: { beneficiaries: [] } } };
    case 'claim-list':
      return { data: { ok: true, result: { claims: [...store.claims].reverse() } } };
    case 'claim-file': {
      const policy = store.policies.find((p) => p.id === params.policyId) || null;
      if (params.policyId && !policy) return { data: { ok: false, error: 'policy_not_found' } };
      const client = store.clients.find((c) => c.id === (params.clientId || policy?.clientId));
      const claim: FakeClaim = {
        id: nid('clm'), carrier: policy ? policy.carrier : String(params.carrier),
        description: String(params.description), kind: String(params.kind || 'other'), status: 'submitted',
        claimAmount: Number(params.claimAmount) || 0, submittedDate: '2026-11-04',
        policyId: policy ? policy.id : '', policyNumber: policy ? policy.policyNumber : null,
        clientId: client ? client.id : null, claimantName: client ? client.name : null,
      };
      store.claims.push(claim);
      return { data: { ok: true, result: { claim } } };
    }
    case 'claim-delete': {
      const i = store.claims.findIndex((c) => c.id === params.id);
      if (i >= 0) store.claims.splice(i, 1);
      return { data: { ok: true, result: { deleted: params.id } } };
    }
    case 'claim-update':
      return { data: { ok: true, result: {} } };
    case 'pact-list':
      return { data: { ok: true, result: { written: [{ id: 'pact_1', insuredUserId: 'u-ins-1', beneficiaries: [{ userId: 'u-ben', sharePct: 100 }], payoutSparks: 100, premiumSparks: 10, premiumFrequency: 'upfront', status: 'active', expiresAt: 1798761600 }], beneficiaryOf: [] } } };
    case 'pact-payout-history':
      return { data: { ok: true, result: { paidOut: [], received: [] } } };
    default:
      return { data: { ok: true, result: {} } };
  }
}

vi.mock('@/lib/api/client', () => ({
  lensRun: (domain: string, verb: string, params: Record<string, unknown>) => Promise.resolve(fakeRun(verb, params || {})),
  api: { post: async () => ({ data: {} }), delete: async () => ({ data: {} }) },
  apiHelpers: {
    lens: {
      runDomain: async (_domain: string, action: string, payload: { input: { artifact: { data: { policies: { premium: number; commissionRate?: number }[]; claims: { status: string; amount: number }[] } } } }) => {
        const book = payload.input.artifact.data;
        store.lastBook = book;
        if (action === 'lossRatioReport') {
          const premiums = book.policies.reduce((s, p) => s + (p.premium || 0), 0);
          const paid = book.claims.filter((c) => c.status === 'paid' || c.status === 'closed').reduce((s, c) => s + (c.amount || 0), 0);
          const lossRatio = premiums > 0 ? Math.round((paid / premiums) * 10000) / 100 : 0;
          return { data: { ok: true, result: { lossRatio, premiumsCollected: premiums, claimsPaid: paid, assessment: lossRatio > 100 ? 'unprofitable' : 'profitable', claimFrequency: 1, averageSeverity: paid } } };
        }
        if (action === 'commissionSummary') {
          const totalPremium = book.policies.reduce((s, p) => s + (p.premium || 0), 0);
          const totalCommission = book.policies.reduce((s, p) => s + (p.premium || 0) * ((p.commissionRate || 0) / 100), 0);
          return { data: { ok: true, result: { totalPolicies: book.policies.length, totalPremium, totalCommission, effectiveRate: 12, byTier: [] } } };
        }
        return { data: { ok: true, result: {} } };
      },
    },
  },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: () => {} }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

import { InsuranceWalletSection } from '@/components/insurance/InsuranceWalletSection';
import { InsuranceClientsPanel } from '@/components/insurance/InsuranceClientsPanel';
import { InsuranceClaimsPanel } from '@/components/insurance/InsuranceClaimsPanel';
import { InsuranceActionPanel } from '@/components/insurance/InsuranceActionPanel';
import { MutualAidPactsPanel } from '@/components/insurance/MutualAidPactsPanel';

beforeEach(() => {
  store.clients = []; store.policies = []; store.claims = []; store.calls = []; store.lastBook = null; seq = 0;
});

describe('insurance build — S1 (F2) the client card reads the live book', () => {
  it('a policy saved in the Policies tab moves the Clients card without a reload, and the card prints the captured fields', async () => {
    render(<InsuranceWalletSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Clients/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add client/ }));
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Dana Whitfield' } });
    fireEvent.change(screen.getByPlaceholderText('Referral source'), { target: { value: 'Agent referral' } });
    fireEvent.change(screen.getByPlaceholderText('Notes'), { target: { value: 'Prefers email' } });
    fireEvent.click(screen.getByRole('button', { name: /Save client/ }));
    expect(await screen.findByText('Dana Whitfield')).toBeTruthy();
    expect(screen.getByText(/0 policies/)).toBeTruthy();
    expect(screen.getByText(/via Agent referral/)).toBeTruthy();
    expect(screen.getByText(/Prefers email/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Policies/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Add policy/ }));
    fireEvent.change(screen.getByPlaceholderText('Carrier'), { target: { value: 'Acme Mutual' } });
    fireEvent.change(screen.getByPlaceholderText('Policy number'), { target: { value: 'POL-100' } });
    const insured = screen.getByPlaceholderText('Insured (optional)');
    fireEvent.change(insured, { target: { value: 'Dana' } });
    fireEvent.click(await screen.findByRole('option', { name: /Dana Whitfield/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save policy/ }));
    expect(await screen.findByText(/POL-100/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Clients/ }));
    expect(await screen.findByText(/1 policy \(1 active\)/)).toBeTruthy();
  });
});

describe('insurance build — S2 (F4) + S4 (F6) claims', () => {
  it('files a claim against a policy and prints the link; delete is two-step', async () => {
    store.clients = [{ id: 'cli_1', name: 'Dana Whitfield', riskProfile: 'standard' }];
    store.policies = [{ id: 'pol_1', carrier: 'Acme Mutual', policyNumber: 'POL-100', kind: 'auto', annualPremium: 1200, deductible: 0, renewalDate: '2027-11-04', status: 'active', clientId: 'cli_1', insuredName: 'Dana Whitfield' }];
    render(<InsuranceClaimsPanel onChange={() => {}} clients={store.clients as never} />);
    fireEvent.click(await screen.findByRole('button', { name: /File claim/ }));
    fireEvent.change(screen.getByLabelText('Policy (optional)'), { target: { value: 'pol_1' } });
    expect((screen.getByPlaceholderText('Carrier') as HTMLInputElement).value).toBe('Acme Mutual');
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Rear-end collision' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit claim/ }));
    expect(await screen.findByText(/Policy POL-100/)).toBeTruthy();
    expect(screen.getByText(/Claimant Dana Whitfield/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: 'Delete claim?' })).toBeTruthy();
    expect(screen.getByText('Rear-end collision')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete claim?' }));
    expect(await screen.findByText(/No claims filed/)).toBeTruthy();
  });
});

describe('insurance build — S4 (F6) the client exit', () => {
  it('deletes a client only on the second step', async () => {
    function Harness() {
      const [clients, setClients] = useState(enrichedClients());
      return <InsuranceClientsPanel clients={clients as never} loading={false} query="" onQueryChange={() => {}} onRefresh={() => setClients(enrichedClients())} />;
    }
    store.clients = [{ id: 'cli_1', name: 'Dana Whitfield', referralSource: 'Agent referral', notes: null, riskProfile: 'standard' }];
    render(<Harness />);
    expect(screen.getByText('Dana Whitfield')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dana Whitfield' }));
    expect(await screen.findByRole('button', { name: 'Delete client?' })).toBeTruthy();
    expect(screen.getByText('Dana Whitfield')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete client?' }));
    expect(await screen.findByText(/No clients yet/)).toBeTruthy();
  });
});

describe('insurance build — S3 (F3) the book tools read their own sample', () => {
  it('runs the seeded sample unedited: loss 266.67%, commission $144; a shapeless book is refused', async () => {
    render(<InsuranceActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Tools/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Loss ratio/ }));
    expect(await screen.findByText(/Loss ratio: 266.67%/)).toBeTruthy();
    expect(store.lastBook?.policies[0].premium).toBe(1200);

    fireEvent.click(screen.getByRole('button', { name: /Tools/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Commission/ }));
    expect(await screen.findByText(/Commission \$144/)).toBeTruthy();

    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{"foo":1}' } });
    fireEvent.click(screen.getByRole('button', { name: /Tools/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Loss ratio/ }));
    expect(await screen.findByText(/Invalid book JSON\./)).toBeTruthy();
  });
});

describe('insurance build — S5 (F5) pact dates render in the store’s units', () => {
  it('prints a real expiry year, not 1970', async () => {
    render(<MutualAidPactsPanel />);
    const expected = new Date(1798761600 * 1000).toLocaleDateString();
    expect(await screen.findByText(new RegExp(`expires ${expected.replace(/\//g, '\\/')}`))).toBeTruthy();
    expect(screen.queryByText(/1970/)).toBeNull();
  });
});
