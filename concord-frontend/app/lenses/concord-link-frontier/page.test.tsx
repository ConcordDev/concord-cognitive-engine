/// <reference types="@testing-library/jest-dom/vitest" />
// Vitest for the Concord Link Frontier lens page — pins the real
// `/api/cross-world/feed` + `/api/cross-world/royalty-flow` shapes and the
// honest empty states for a quiet window (never a fabricated ticker row or
// placeholder royalty flow, per this repo's zero-demo-content invariant).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import ConcordLinkFrontierPage from './page';

function feedResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    events: [],
    worlds: 0,
    generatedAt: Date.now(),
    ...over,
  };
}

function royaltyFlowResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    flows: [],
    totalRoyaltyCC: 0,
    generatedAt: Date.now(),
    ...over,
  };
}

/** Wires window.fetch so the two REST calls this page makes directly
 *  (no lensRun — there is no macro domain, per the real backend shape)
 *  return the given feed/royalty-flow payloads. */
function mockFetch(feed: unknown, royaltyFlow: unknown) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/cross-world/feed')) {
      return { status: 200, json: async () => feed } as unknown as Response;
    }
    if (url.startsWith('/api/cross-world/royalty-flow')) {
      return { status: 200, json: async () => royaltyFlow } as unknown as Response;
    }
    return { status: 404, json: async () => ({ ok: false }) } as unknown as Response;
  });
}

describe('Concord Link Frontier lens page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the real cross-world feed + royalty-flow shape when data exists', async () => {
    global.fetch = mockFetch(
      feedResponse({
        worlds: 2,
        events: [
          {
            kind: 'faction-war:started',
            worldId: 'tunya',
            ts: Math.floor(Date.now() / 1000),
            summary: 'faction_alpha declared war faction_beta',
            notability: 4.0,
          },
        ],
      }),
      royaltyFlowResponse({
        totalRoyaltyCC: 125,
        flows: [
          {
            citationId: 'cite_1',
            parentDtuId: 'dtu_parent',
            parentTitle: 'Fantasy Wizard Recipe',
            parentWorldId: 'fantasy',
            parentCreator: 'user_a',
            childDtuId: 'dtu_child',
            childTitle: 'Cyber Hacker Toolkit',
            childWorldId: 'cyber',
            childCreator: 'user_b',
            amountCC: 125,
            payoutTs: Math.floor(Date.now() / 1000),
            createdAt: Math.floor(Date.now() / 1000),
          },
        ],
      }),
    ) as unknown as typeof fetch;

    render(<ConcordLinkFrontierPage />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Real feed event renders
    expect(await screen.findByText('faction_alpha declared war faction_beta')).toBeInTheDocument();
    // formatKind() turns every ':'/'_'/'-' delimiter into a space, so
    // "faction-war:started" renders as "faction war started" (the hyphen
    // inside "faction-war" is not preserved — same treatment as the colon).
    expect(screen.getByText(/faction war started/)).toBeInTheDocument();
    expect(screen.getByText('tunya', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('2 worlds active in the feed window')).toBeInTheDocument();

    // Real royalty flow row renders
    expect(screen.getByText('Fantasy Wizard Recipe')).toBeInTheDocument();
    expect(screen.getByText('Cyber Hacker Toolkit')).toBeInTheDocument();
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.getByText('125 CC in cross-world royalties (24h)')).toBeInTheDocument();

    // Never a fabricated empty-state message alongside real data
    expect(screen.queryByText('No cross-world activity yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No cross-world royalty flow yet.')).not.toBeInTheDocument();
  });

  it('shows an honest "no cross-world activity yet" empty state when the API returns zero events', async () => {
    global.fetch = mockFetch(feedResponse(), royaltyFlowResponse()) as unknown as typeof fetch;

    render(<ConcordLinkFrontierPage />);

    expect(await screen.findByText('No cross-world activity yet.')).toBeInTheDocument();
    expect(screen.getByText('No cross-world royalty flow yet.')).toBeInTheDocument();

    // Honest zero counts, not omitted or fabricated
    expect(screen.getByText('0 worlds active in the feed window')).toBeInTheDocument();
    expect(screen.getByText('0 CC in cross-world royalties (24h)')).toBeInTheDocument();
  });

  it('surfaces an honest error state instead of a blank or fabricated feed on fetch failure', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    render(<ConcordLinkFrontierPage />);

    // Both the feed error box and the royalty-flow error box legitimately
    // show the same underlying message (the whole Promise.all rejected) —
    // two real, distinct honest-error surfaces, not a duplicate render.
    await waitFor(() => expect(screen.getAllByText('network unreachable').length).toBe(2));
    expect(screen.queryByText('No cross-world activity yet.')).not.toBeInTheDocument();
  });

  it('refreshes both feed and royalty-flow on manual refresh', async () => {
    global.fetch = mockFetch(feedResponse(), royaltyFlowResponse()) as unknown as typeof fetch;

    render(<ConcordLinkFrontierPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    screen.getByLabelText('Refresh the cross-world feed').click();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
  });
});
