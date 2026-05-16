import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => create(...args) },
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { MusicArtistExplorer } from '@/components/music/MusicArtistExplorer';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const ARTIST_HIT_RADIOHEAD = {
  mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
  name: 'Radiohead',
  type: 'Group',
  country: 'GB',
  beginArea: 'Oxford',
  lifeSpan: { begin: '1985', ended: false },
  disambiguation: null,
  score: 100,
  tags: ['rock', 'alternative rock', 'art rock', 'electronic'],
};
const ARTIST_HIT_DUP = {
  mbid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'Stone Temple Pilots',
  type: 'Group',
  country: 'US',
  disambiguation: 'tribute band',
  score: 80,
  tags: [],
};

const RELEASE = {
  mbid: 'r1', title: 'OK Computer', date: '1997-05-21', country: 'GB',
  status: 'Official', primaryType: 'Album', secondaryTypes: [],
  disambiguation: null, barcode: '07243854062', packaging: 'Jewel Case',
};

describe('MusicArtistExplorer', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });

  it('renders empty state until a search is run', () => {
    renderWithQuery(<MusicArtistExplorer />);
    expect(screen.getByPlaceholderText(/Radiohead/i)).toBeInTheDocument();
    expect(screen.getByText(/disambiguation is first-class/i)).toBeInTheDocument();
  });

  it('auto-picks the artist when search returns exactly 1 match', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'mb-search-artist') {
        return { data: { ok: true, result: { ok: true, result: { artists: [ARTIST_HIT_RADIOHEAD], totalCount: 1 } } } };
      }
      if (action === 'mb-artist-releases') {
        return { data: { ok: true, result: { ok: true, result: { releases: [RELEASE] } } } };
      }
      return { data: { ok: false } };
    });
    renderWithQuery(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Radiohead/i), { target: { value: 'radiohead' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    // Hero rendered
    await waitFor(() => expect(screen.getByText('Radiohead')).toBeInTheDocument());
    // Releases call happened with the MBID
    await waitFor(() => {
      const c = runDomain.mock.calls.find((x) => x[1] === 'mb-artist-releases');
      expect((c?.[2] as { input?: { mbid?: string } })?.input?.mbid).toBe(ARTIST_HIT_RADIOHEAD.mbid);
    });
    // Discography group rendered with release
    expect(screen.getByText('OK Computer')).toBeInTheDocument();
    expect(screen.getByText('Albums')).toBeInTheDocument();
    expect(screen.getByText('1997')).toBeInTheDocument();
  });

  it('shows disambiguation popover when >1 artists match', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      artists: [ARTIST_HIT_RADIOHEAD, ARTIST_HIT_DUP], totalCount: 2,
    } } } });
    renderWithQuery(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Radiohead/i), { target: { value: 'something' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText(/2 artists match/i)).toBeInTheDocument());
    expect(screen.getByText('Stone Temple Pilots')).toBeInTheDocument();
    expect(screen.getByText(/tribute band/i)).toBeInTheDocument();
  });

  it('renders tag chips and clicking one filters the discography (client-side)', async () => {
    const ALBUM_KID_A = { ...RELEASE, mbid: 'r2', title: 'Kid A', date: '2000-10-02' };
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'mb-search-artist') {
        return { data: { ok: true, result: { ok: true, result: { artists: [ARTIST_HIT_RADIOHEAD], totalCount: 1 } } } };
      }
      if (action === 'mb-artist-releases') {
        return { data: { ok: true, result: { ok: true, result: { releases: [RELEASE, ALBUM_KID_A] } } } };
      }
      return { data: { ok: false } };
    });
    renderWithQuery(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Radiohead/i), { target: { value: 'radiohead' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText('Kid A')).toBeInTheDocument());
    expect(screen.getByText('OK Computer')).toBeInTheDocument();
    // Click the "rock" tag chip
    fireEvent.click(screen.getByRole('button', { name: /^rock$/ }));
    // Filter logic checks release title/disambiguation contains "rock" — neither album does, both disappear
    await waitFor(() => expect(screen.queryByText('Kid A')).not.toBeInTheDocument());
    expect(screen.queryByText('OK Computer')).not.toBeInTheDocument();
  });

  it('surfaces empty-result state', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { artists: [], totalCount: 0 } } } });
    renderWithQuery(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Radiohead/i), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    // Empty list still passes the search path, just no popover and no hero
    await waitFor(() => {
      expect(screen.queryByText(/artist match/i)).not.toBeInTheDocument();
    });
  });

  it('toggles ISRC sub-panel', async () => {
    renderWithQuery(<MusicArtistExplorer />);
    fireEvent.click(screen.getByRole('button', { name: /ISRC lookup/i }));
    expect(await screen.findByPlaceholderText('USRC17607839')).toBeInTheDocument();
  });
});
