/**
 * Concord-Link-Frontier feed mount (B6, founder's ruling 2026-11-06).
 *
 * The lens mounts the real cross-world feed + royalty flow over the
 * standing REST surface (the source /explore consumes). Every state
 * reads as itself: events render with kind/world/time, an empty window
 * says so, a failed read says so with a Retry, and a signed-out royalty
 * read names its gate instead of failing silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CrossWorldFeed } from '@/components/concord-link-frontier/CrossWorldFeed';

const NOW_S = Math.floor(Date.now() / 1000);

function jsonRes(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let feedBody: unknown;
let royaltyBody: unknown;
let royaltyStatus = 200;
let feedFails = false;

beforeEach(() => {
  feedFails = false;
  royaltyStatus = 200;
  feedBody = {
    ok: true, worlds: 2, generatedAt: Date.now(),
    events: [
      { kind: 'faction-war:started', worldId: 'concordia-hub', ts: NOW_S - 600, summary: 'House Vane declare war on House Corvidae', notability: 4 },
      { kind: 'dtu:promoted', worldId: 'ember-reach', ts: NOW_S - 7200, summary: 'DTU "Tide Tables of the Reach" was promoted to mega', notability: 3 },
    ],
  };
  royaltyBody = {
    ok: true, totalRoyaltyCC: 12.5, generatedAt: Date.now(),
    flows: [
      { citationId: 'cit_1', parentDtuId: 'dtu_p', parentTitle: 'A Wizard\'s Primer', parentWorldId: 'concordia-hub', childDtuId: 'dtu_c', childTitle: 'Kernel Panic Cantata', childWorldId: 'neon-drift', amountCC: 12.5 },
    ],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/cross-world/feed')) {
      if (feedFails) throw new Error('network down');
      return jsonRes(feedBody);
    }
    if (url.startsWith('/api/cross-world/royalty-flow')) return jsonRes(royaltyBody, royaltyStatus);
    throw new Error(`unexpected fetch ${url}`);
  }));
});

describe('CrossWorldFeed — the mounted federation layer', () => {
  it('renders feed events with kind, world and time, and the royalty flow with its total', async () => {
    render(<CrossWorldFeed />);
    expect(await screen.findByText(/House Vane declare war/)).toBeInTheDocument();
    expect(screen.getByText(/2 worlds · last 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/faction war · started/)).toBeInTheDocument();
    expect(screen.getByText(/Tide Tables of the Reach/)).toBeInTheDocument();
    expect(await screen.findByText(/Kernel Panic Cantata/)).toBeInTheDocument();
    expect(screen.getByText(/12.5 CC across 1 cross-world citation/)).toBeInTheDocument();
    expect(screen.getByText(/12.5 CC moved/)).toBeInTheDocument();
  });

  it('an empty window says so on both panels', async () => {
    feedBody = { ok: true, worlds: 0, generatedAt: Date.now(), events: [] };
    royaltyBody = { ok: true, totalRoyaltyCC: 0, generatedAt: Date.now(), flows: [] };
    render(<CrossWorldFeed />);
    expect(await screen.findByText('No cross-world events in the last 24 hours.')).toBeInTheDocument();
    expect(await screen.findByText('No cross-world royalty flow in the last 24 hours.')).toBeInTheDocument();
  });

  it('a failed feed read states itself with a Retry; the royalty panel is unaffected', async () => {
    feedFails = true;
    render(<CrossWorldFeed />);
    expect(await screen.findByText(/The cross-world feed did not answer \(network down\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry the feed' })).toBeInTheDocument();
    expect(await screen.findByText(/Kernel Panic Cantata/)).toBeInTheDocument();
  });

  it('a signed-out royalty read names its gate', async () => {
    royaltyStatus = 401;
    royaltyBody = { ok: false, error: 'unauthorized' };
    render(<CrossWorldFeed />);
    expect(await screen.findByText('Royalty flow is visible to signed-in accounts.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/House Vane declare war/)).toBeInTheDocument());
  });
});
