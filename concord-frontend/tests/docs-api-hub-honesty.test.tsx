/**
 * /lenses/docs — API Hub honesty (S2; Review 2 finding F4, the
 * `silent wrong answers` class).
 *
 * The real /api/v1/docs payload carries endpoints as a domain-keyed
 * OBJECT ({ version, domains, totalActions, endpoints: { <domain>:
 * [{ endpoint: "POST /api/v1/lens/<domain>/<action>", … }] } }). The
 * old panel read `endpoints.length` / `domainCount` — undefined on
 * that shape — so it always rendered hardcoded figures (47 / 12)
 * over a hardcoded 8-row sample, plus source-less claims (98%
 * coverage, "Released 3 days ago", a v2.4.1 timeline contradicting
 * the payload's own v1).
 *
 * Pinned here: every figure derives from the payload fetched —
 * the headline count IS the number of listed endpoints (grouped by
 * domain, counts summing to the headline), the version/auth/rate
 * strings are the payload's own, fabricated claims render nowhere,
 * and an endpoint-less payload yields an honest empty state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const queryState = vi.hoisted(() => ({
  current: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => queryState.current,
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
  lensRun: vi.fn(),
}));

import { ApiHubPanel, summarizeApiDocs } from '@/components/docs/ApiHubPanel';

/** The payload exactly as server.js's GET /api/v1/docs shapes it. */
const REAL_PAYLOAD = {
  version: 'v1',
  authentication: 'Bearer token in Authorization header',
  rateLimit: '60 requests per minute per key',
  domains: 2,
  totalActions: 3,
  endpoints: {
    docs: [
      { endpoint: 'POST /api/v1/lens/docs/page-list', description: 'List pages', brain: 'docs', producesFile: false, fileType: null },
      { endpoint: 'POST /api/v1/lens/docs/page-delete', description: 'Delete a page', brain: 'docs', producesFile: false, fileType: null },
    ],
    chat: [
      { endpoint: 'POST /api/v1/lens/chat/ask', description: 'Ask a question', brain: 'chat', producesFile: false, fileType: null },
    ],
  },
};

beforeEach(() => {
  queryState.current = { data: REAL_PAYLOAD, isLoading: false, isError: false };
});

describe('summarizeApiDocs — figures derive from the listed endpoints', () => {
  it('counts the listed endpoints and groups them by domain', () => {
    const s = summarizeApiDocs(REAL_PAYLOAD);
    expect(s.totalEndpoints).toBe(3);
    expect(s.domainCount).toBe(2);
    expect(s.version).toBe('v1');
    expect(s.groups.map((g) => [g.domain, g.endpoints.length])).toEqual([
      ['chat', 1],
      ['docs', 2],
    ]);
    // The group counts sum to the headline by construction.
    expect(s.groups.reduce((n, g) => n + g.endpoints.length, 0)).toBe(s.totalEndpoints);
    expect(s.groups[1].endpoints[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/lens/docs/page-list',
      description: 'List pages',
    });
  });

  it('never trusts a summary field over the list itself', () => {
    const lying = { ...REAL_PAYLOAD, totalActions: 999, domains: 449 };
    const s = summarizeApiDocs(lying);
    expect(s.totalEndpoints).toBe(3);
    expect(s.domainCount).toBe(2);
  });

  it('an empty or malformed payload yields zeroes, not fallbacks', () => {
    for (const bad of [undefined, null, {}, { endpoints: {} }, { endpoints: { docs: 'nope' } }]) {
      const s = summarizeApiDocs(bad);
      expect(s.totalEndpoints).toBe(0);
      expect(s.domainCount).toBe(0);
      expect(s.groups).toEqual([]);
    }
  });
});

describe('ApiHubPanel — the view reconciles with its own contents', () => {
  it('headline count equals the listed endpoints; version is the payload’s own', () => {
    render(<ApiHubPanel />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(/Across 2 domains/)).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    // The listed source itself is on screen.
    expect(screen.getByText('/api/v1/lens/docs/page-list')).toBeTruthy();
    expect(screen.getByText('/api/v1/lens/docs/page-delete')).toBeTruthy();
    expect(screen.getByText('/api/v1/lens/chat/ask')).toBeTruthy();
    expect(screen.getByText(/Bearer token in Authorization header/)).toBeTruthy();
    expect(screen.getByText(/60 requests per minute per key/)).toBeTruthy();
  });

  it('none of the fabricated claims render', () => {
    render(<ApiHubPanel />);
    expect(screen.queryByText('47')).toBeNull();
    expect(screen.queryByText(/98%/)).toBeNull();
    expect(screen.queryByText(/Released 3 days ago/)).toBeNull();
    expect(screen.queryByText(/deprecations pending/)).toBeNull();
    expect(screen.queryByText(/Synced from source/)).toBeNull();
    expect(screen.queryByText(/OpenAPI 3\.1/)).toBeNull();
    expect(screen.queryByText(/v2\.4\.1/)).toBeNull();
    // The old hardcoded sample rows are gone.
    expect(screen.queryByText('/api/dtus')).toBeNull();
    expect(screen.queryByText('/api/forge/auto')).toBeNull();
  });

  it('an endpoint-less payload renders the honest empty state, still with no invented figures', () => {
    queryState.current = { data: { version: 'v1', endpoints: {} }, isLoading: false, isError: false };
    render(<ApiHubPanel />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText(/The docs source returned no endpoints/)).toBeTruthy();
    expect(screen.queryByText('47')).toBeNull();
    expect(screen.queryByText(/98%/)).toBeNull();
  });
});
