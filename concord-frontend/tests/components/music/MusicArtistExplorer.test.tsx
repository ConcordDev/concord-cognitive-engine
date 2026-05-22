import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLElement>) =>
      React.createElement('div', { ...props, ref }, children)),
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: ({ title }: { title: string }) =>
    React.createElement('button', { 'data-testid': 'save-dtu' }, `save:${title}`),
}));

import { MusicArtistExplorer } from '@/components/music/MusicArtistExplorer';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ARTISTS = [
  { mbid: 'mb1', name: 'Radiohead', type: 'Group', country: 'GB', score: 100, tags: ['rock', 'alt'], lifeSpan: { begin: '1985', ended: false } },
  { mbid: 'mb2', name: 'Radiohead Tribute', disambiguation: 'cover band', score: 60 },
];
const RELEASES = [
  { mbid: 'r1', title: 'OK Computer', date: '1997-05-21', country: 'GB', primaryType: 'Album', status: 'Official' },
  { mbid: 'r2', title: 'Creep', date: '1992-09-21', primaryType: 'Single' },
];

describe('MusicArtistExplorer', () => {
  beforeEach(() => { runDomain.mockReset(); });

  it('renders the search header and an empty hint initially', () => {
    wrap(<MusicArtistExplorer />);
    expect(screen.getByText('Artist & Discography Explorer')).toBeInTheDocument();
    expect(screen.getByText(/Search the MusicBrainz database/)).toBeInTheDocument();
  });

  it('search with multiple matches shows the disambiguation list', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: ARTISTS, totalCount: 2 } } };
      return { data: { ok: true, result: { releases: [] } } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/2 artists match/)).toBeInTheDocument());
    expect(screen.getByText('Radiohead Tribute')).toBeInTheDocument();
  });

  it('search with a single match auto-selects and loads the discography', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: [ARTISTS[0]], totalCount: 1 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: RELEASES } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('OK Computer')).toBeInTheDocument());
    expect(screen.getByText('Creep')).toBeInTheDocument();
    expect(screen.getByText('Albums')).toBeInTheDocument();
  });

  it('search failure shows the error message', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'No artists matched' } });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'zzzz' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('No artists matched')).toBeInTheDocument());
  });

  it('picking an artist from the disambiguation list shows the hero', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: ARTISTS, totalCount: 2 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: RELEASES } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/2 artists match/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Radiohead'));
    await waitFor(() => expect(screen.getByText('New search')).toBeInTheDocument());
  });

  it('tag chips filter the discography and clear-filter resets it', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: [ARTISTS[0]], totalCount: 1 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: RELEASES } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('OK Computer')).toBeInTheDocument());
    // tag 'rock' is not in any release title -> filters out everything
    fireEvent.click(screen.getByText('rock'));
    await waitFor(() => expect(screen.getByText(/clear filter/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/clear filter/));
    await waitFor(() => expect(screen.getByText('OK Computer')).toBeInTheDocument());
  });

  it('empty discography shows the no-releases message', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: [ARTISTS[0]], totalCount: 1 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: [] } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/No releases indexed/)).toBeInTheDocument());
  });

  it('toggles the ISRC lookup panel and looks up a code', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-lookup-by-isrc') {
        return { data: { ok: true, result: { isrc: 'USRC17607839', recordings: [{ mbid: 'rec1', title: 'Karma Police', lengthMs: 261000, artistCredit: 'Radiohead', releases: [{ mbid: 'rl1', title: 'OK Computer', date: '1997' }] }] } } };
      }
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.click(screen.getByText('ISRC lookup'));
    const isrcInput = screen.getByPlaceholderText('USRC17607839');
    // onChange uppercases the value before storing it in state.
    fireEvent.change(isrcInput, { target: { value: 'usrc17607839' } });
    fireEvent.click(screen.getByText('Lookup'));
    await waitFor(() => expect(screen.getByText(/Karma Police/)).toBeInTheDocument());
    // the macro is called with the uppercased trimmed code
    expect(runDomain).toHaveBeenCalledWith('music', 'mb-lookup-by-isrc', { input: { isrc: 'USRC17607839' } });
  });

  it('ISRC lookup failure shows the error', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'No recordings' } });
    wrap(<MusicArtistExplorer />);
    fireEvent.click(screen.getByText('ISRC lookup'));
    fireEvent.change(screen.getByPlaceholderText('USRC17607839'), { target: { value: 'BADCODE12345' } });
    fireEvent.click(screen.getByText('Lookup'));
    await waitFor(() => expect(screen.getByText('No recordings')).toBeInTheDocument());
  });

  it('does not search when the query is shorter than 2 chars', () => {
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'a' } });
    fireEvent.click(screen.getByText('Search'));
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('renders rich release rows with secondary types, packaging and barcode', async () => {
    const richReleases = [
      {
        mbid: 'rr1', title: 'Live At Glastonbury', date: '2003-07-01', country: 'GB',
        primaryType: 'Album', secondaryTypes: ['Live'], status: 'Official',
        packaging: 'Jewel Case', barcode: '0123456789012', disambiguation: 'deluxe',
      },
      { mbid: 'rr2', title: '', date: null, primaryType: 'WeirdType' },
    ];
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: [ARTISTS[0]], totalCount: 1 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: richReleases } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('Live At Glastonbury')).toBeInTheDocument());
    expect(screen.getByText(/UPC 0123456789012/)).toBeInTheDocument();
    expect(screen.getByText('Jewel Case')).toBeInTheDocument();
    expect(screen.getByText('(untitled)')).toBeInTheDocument();
    // 'WeirdType' falls into the "Other" group
    expect(screen.getByText('Others')).toBeInTheDocument();
  });

  it('collapsing a release group hides its rows', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: [ARTISTS[0]], totalCount: 1 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: RELEASES } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('OK Computer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Albums'));
    expect(screen.queryByText('OK Computer')).not.toBeInTheDocument();
  });

  it('ISRC recordings with no releases show the no-recordings message when empty', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { isrc: 'X', recordings: [] } } });
    wrap(<MusicArtistExplorer />);
    fireEvent.click(screen.getByText('ISRC lookup'));
    fireEvent.change(screen.getByPlaceholderText('USRC17607839'), { target: { value: 'AAAA00000000' } });
    fireEvent.click(screen.getByText('Lookup'));
    await waitFor(() => expect(screen.getByText(/No recordings indexed/)).toBeInTheDocument());
  });

  it('reset via "New search" clears the selected artist', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mb-search-artist') return { data: { ok: true, result: { artists: [ARTISTS[0]], totalCount: 1 } } };
      if (action === 'mb-artist-releases') return { data: { ok: true, result: { releases: RELEASES } } };
      return { data: { ok: true, result: {} } };
    });
    wrap(<MusicArtistExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Artist name/), { target: { value: 'Radiohead' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('New search')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New search'));
    await waitFor(() => expect(screen.getByText(/Search the MusicBrainz database/)).toBeInTheDocument());
  });
});
