/**
 * FIX-art-003 — the Art editor's canvas Save posted the PNG as a base64
 * `data` field through the JSON /api/media/upload route. The server's
 * global sanitizer cuts every JSON string at 10,000 chars (~7,500
 * bytes), so any real drawing arrived truncated and the endpoint
 * refused it 413 upload_truncated; the artist saw only a generic toast.
 * The save now rides POST /api/media/upload-raw (the music/photography
 * transport): the PNG blob is the request body, metadata on the query.
 * Mock setup mirrors tests/art-featured-empty.test.tsx.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { postSpy } = vi.hoisted(() => ({ postSpy: vi.fn(() => Promise.resolve({ data: { ok: true } })) }));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { ok: false } })),
    post: postSpy,
    delete: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
  apiHelpers: {
    artistry: {
      assets: {
        list: () => Promise.resolve({ data: { assets: [] } }),
        create: vi.fn(),
      },
      marketplace: {
        art: { list: () => Promise.resolve({ data: { artworks: [] } }), create: vi.fn() },
        purchase: vi.fn(),
      },
    },
    lens: { runDomain: vi.fn() },
    durableArtifacts: { download: vi.fn() },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({
    latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null, isConnected: false,
  }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u', username: 'ramaj', email: 'r@concord.test', role: 'member' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    contextDTUs: [],
    hyperDTUs: [],
    megaDTUs: [],
    regularDTUs: [],
    publishToMarketplace: vi.fn(),
    refetch: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/PullToSubstrate', () => ({ PullToSubstrate: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/art/ArtGenerateFromText', () => ({
  ArtGenerateFromText: () => null,
  pickGeneratedArt: () => ({ url: null }),
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode),
  }),
}));

import { ArtMarketDesk } from '@/components/art/ArtMarketDesk';

beforeAll(() => {
  // jsdom canvases produce nothing; stand in a deterministic PNG blob
  // (larger than the sanitizer's 7,500-byte survival size, on purpose).
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array(9000)], { type: 'image/png' }));
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

describe('Art canvas save transport (FIX-art-003)', () => {
  it('posts the PNG blob to /api/media/upload-raw, never base64 through the JSON route', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = render(
      <QueryClientProvider client={client}>
        <ArtMarketDesk mode="canvas" />
      </QueryClientProvider>,
    );
    const saveBtn = await utils.findByRole('button', { name: /^save$/i });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [url, body, config] = postSpy.mock.calls[0] as unknown as [string, unknown, { headers?: Record<string, string> }];
    expect(url.startsWith('/api/media/upload-raw?')).toBe(true);
    expect(url).toContain('mediaType=image');
    expect(url).toContain('tags=art%2Ccanvas');
    expect(body).toBeInstanceOf(Blob);
    expect((body as Blob).size).toBe(9000);
    expect(config?.headers?.['Content-Type']).toBe('image/png');
    for (const call of postSpy.mock.calls) {
      const u = call[0] as string;
      expect(u === '/api/media/upload').toBe(false);
    }
  });
});
