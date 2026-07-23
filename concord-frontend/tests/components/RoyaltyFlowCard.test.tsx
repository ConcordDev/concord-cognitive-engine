// RoyaltyFlowCard (EC2) — renders the REAL royalty ledger flow card.
// Mocks fetch to return exactly the shape /api/creator/royalty-flow
// (server.js -> computeRoyaltyFlow, server/lib/creator-dashboard.js) really
// produces, per server/tests/depth/royalty-flow-behavior.test.js. No
// fabricated data is asserted here beyond what that real response shape
// contains — this test pins the render, not the backend math.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { RoyaltyFlowCard } from '@/components/creator/RoyaltyFlowCard';

function makeFetchMock(response: unknown) {
  return vi.fn((url: unknown) => {
    const u = String(url);
    if (u.startsWith('/api/creator/royalty-flow')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
}

describe('RoyaltyFlowCard', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders real hops with their exact generation, rate, and CC amount — no fabrication', async () => {
    const realResponse = {
      ok: true,
      userId: 'creator-1',
      dtuId: null,
      totalCC: 31.5,
      hopCount: 2,
      byGeneration: { '1': 21, '2': 10.5 },
      hops: [
        {
          ledgerId: 'rf-pay-2', contentId: 'dtu_a', contentTitle: 'Royalty Flow Probe — Ancestor Work',
          generation: 2, royaltyRate: 0.105, royaltyPercent: '10.50%', amount: 10.5,
          fromUserId: 'buyer2', toUserId: 'creator-1', sourceTxId: 'tx-2', crossWorldHop: false,
          createdAt: '2026-07-03 00:00:00',
        },
        {
          ledgerId: 'rf-pay-1', contentId: 'dtu_a', contentTitle: 'Royalty Flow Probe — Ancestor Work',
          generation: 1, royaltyRate: 0.21, royaltyPercent: '21.00%', amount: 21,
          fromUserId: 'buyer1', toUserId: 'creator-1', sourceTxId: 'tx-1', crossWorldHop: false,
          createdAt: '2026-07-02 00:00:00',
        },
      ],
      lineage: [],
    };
    vi.stubGlobal('fetch', makeFetchMock(realResponse));

    render(<RoyaltyFlowCard />);

    // Real total + payout count.
    await waitFor(() => {
      expect(screen.getByText(/31\.50 CC/)).toBeInTheDocument();
    });
    expect(screen.getByText((_content, el) => el?.textContent === '2 payouts')).toBeInTheDocument();

    // Real per-hop data — both generations, both rates, both amounts,
    // the real DTU title (not a placeholder).
    expect(screen.getAllByText('Royalty Flow Probe — Ancestor Work')).toHaveLength(2);
    expect(screen.getByText('21.00%')).toBeInTheDocument();
    expect(screen.getByText('10.50%')).toBeInTheDocument();
    expect(screen.getByText('+21.00 CC')).toBeInTheDocument();
    expect(screen.getByText('+10.50 CC')).toBeInTheDocument();

    // byGeneration bars (gen 1 / gen 2 each appear twice: once in the
    // aggregate bar chart, once in the per-hop list below it).
    expect(screen.getAllByText('gen 1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('gen 2').length).toBeGreaterThanOrEqual(1);
  });

  it('honest empty state: renders "no real royalty payouts yet", not a fabricated zero card', async () => {
    const emptyResponse = {
      ok: true, userId: 'nobody', dtuId: null,
      totalCC: 0, hopCount: 0, byGeneration: {}, hops: [], lineage: [],
    };
    vi.stubGlobal('fetch', makeFetchMock(emptyResponse));

    render(<RoyaltyFlowCard />);

    await waitFor(() => {
      expect(screen.getByText(/No real royalty payouts yet/)).toBeInTheDocument();
    });
    // Never renders a fabricated total when there's genuinely nothing.
    expect(screen.queryByText(/CC real earned/)).not.toBeInTheDocument();
  });

  it('renders a real ancestor-chain-only state (lineage exists, no sales yet) honestly', async () => {
    const lineageOnlyResponse = {
      ok: true, userId: null, dtuId: 'dtu_b',
      totalCC: 0, hopCount: 0, byGeneration: {}, hops: [],
      lineage: [
        {
          contentId: 'dtu_a', contentTitle: 'Royalty Flow Probe — Ancestor Work',
          generation: 1, royaltyRate: 0.105, royaltyPercent: '10.50%',
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetchMock(lineageOnlyResponse));

    render(<RoyaltyFlowCard topCited={[{ id: 'dtu_b', title: 'Unsold Derivative', domain: 'general', citationsReceived: 1 }]} />);

    await waitFor(() => {
      expect(screen.getByText('Real ancestor chain')).toBeInTheDocument();
    });
    expect(screen.getByText('— no sales of this DTU yet')).toBeInTheDocument();
    expect(screen.getByText('Royalty Flow Probe — Ancestor Work')).toBeInTheDocument();
    expect(screen.getByText('10.50%')).toBeInTheDocument();
    // No hop rows render — nothing was sold.
    expect(screen.queryByText(/payouts, newest first/)).not.toBeInTheDocument();
  });

  it('scoping to a DTU calls the dtuId-qualified endpoint', async () => {
    const fetchMock = makeFetchMock({
      ok: true, userId: null, dtuId: 'dtu_a', totalCC: 0, hopCount: 0, byGeneration: {}, hops: [], lineage: [],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RoyaltyFlowCard topCited={[{ id: 'dtu_a', title: 'Ancestor Work', domain: 'general', citationsReceived: 3 }]} />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/creator/royalty-flow')).toBe(true);
    });

    // Selecting the DTU triggers a re-fetch scoped by dtuId.
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'dtu_a' } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('dtuId=dtu_a'))).toBe(true);
    });
  });
});
