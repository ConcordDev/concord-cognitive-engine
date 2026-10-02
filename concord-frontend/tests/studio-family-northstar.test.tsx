/**
 * Studio family north stars. Each lens opens on one job.
 * Counts and rows come from the mocked macro envelope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], isLive: false, lastUpdated: null, insights: [] }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/lib/daw/engine', () => ({
  TransportEngine: class {
    currentBeat = 0;
    updateConfig() {}
    play() { this.currentBeat = 1; }
    stop() { this.currentBeat = 0; }
  },
  resumeAudioContext: async () => {},
}));

vi.mock('@/components/studio/StudioDawWorkspace', () => ({
  StudioDawWorkspace: () => <div>Concord Studio full DAW</div>,
}));
vi.mock('@/components/music/MusicWorkspace', () => ({
  MusicWorkspace: () => <div>New Releases desk</div>,
}));
vi.mock('@/components/game/GameApp', () => ({
  default: () => <div>XP streak desk</div>,
}));
vi.mock('@/components/sim/SimConsole', () => ({
  SimConsole: () => <div>Run console</div>,
}));
vi.mock('@/components/fractal/FractalRenderer', () => ({
  FractalRenderer: () => <canvas aria-label="Fractal render" />,
}));
vi.mock('@/components/fractal/FractalRepos', () => ({
  FractalRepos: () => <div>Fractal tooling</div>,
}));
vi.mock('@/components/art/CanvasPanel', () => ({
  CanvasPanel: () => <div data-testid="art-canvas" />,
}));

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
  apiHelpers: {
    simulations: { list: () => apiGet('/api/worldmodel/simulations') },
  },
}));

import { StudioNorthStar } from '@/components/studio/StudioNorthStar';
import { MusicNorthStar } from '@/components/music/MusicNorthStar';
import ArtLensPage from '@/app/lenses/art/page';
import { FractalNorthStar } from '@/components/fractal/FractalNorthStar';
import { GameNorthStar } from '@/components/game/GameNorthStar';
import { SimNorthStar } from '@/components/sim/SimNorthStar';
import ArLensPage from '@/app/lenses/ar/page-client';
import { PodcastNow } from '@/components/podcast/PodcastNow';
import WorldUnityShell from '@/components/world/WorldUnityShell';

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockResolvedValue({ data: { ok: true, result: { shows: [], count: 0, episodes: [], scenes: [], countEpisodes: 0 } } });
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    const path = String(url);
    if (path.includes('/api/game/challenges')) return Promise.resolve({ data: { challenges: [] } });
    if (path.includes('simulations')) return Promise.resolve({ data: { simulations: [] } });
    return Promise.resolve({ data: { ok: true, artifacts: [], total: 0 } });
  });
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: { ok: true, id: 'made' } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, headers: { get: () => 'application/json' } })));
});

describe('studio family north stars', () => {
  it('studio opens on an arrangement, not the DAW brochure', () => {
    renderInShell(<StudioNorthStar />);
    expect(screen.getByRole('heading', { name: 'What are we making, Ramaj' })).toBeTruthy();
    expect(screen.getByText('Drums')).toBeTruthy();
    expect(screen.getByText('Voice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByText(/Concord Studio/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Music' }).getAttribute('href')).toBe('/lenses/music');
  });

  it('music states an empty library and pulls the feed', async () => {
    renderInShell(<MusicNorthStar />);
    expect(screen.getByRole('heading', { name: 'What are we hearing, Ramaj' })).toBeTruthy();
    expect(screen.getByText('Library is empty')).toBeTruthy();
    expect(screen.getByText(/0 tracks · 0 playlists/)).toBeTruthy();
    expect(screen.queryByText(/New Releases/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pull feed' }));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[0] === 'music' && c[1] === 'feed')).toBe(true);
    });
  });

  it('art opens on the canvas', () => {
    renderInShell(<ArtLensPage />);
    expect(screen.getByRole('heading', { name: 'Make a mark, Ramaj' })).toBeTruthy();
    expect(screen.getByTestId('art-canvas')).toBeTruthy();
    expect(screen.getByText('The canvas is the desk.')).toBeTruthy();
    expect(screen.queryByText(/Procreate/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ New canvas' }));
    expect(screen.getAllByTestId('art-canvas')).toHaveLength(1);
  });

  it('visuals stays empty until Render', () => {
    renderInShell(<FractalNorthStar />);
    expect(screen.getByRole('heading', { name: 'One image, Ramaj' })).toBeTruthy();
    expect(screen.getByLabelText('Zoom')).toBeTruthy();
    expect(screen.getByLabelText('Iterations')).toBeTruthy();
    expect(screen.queryByLabelText('Fractal render')).toBeNull();
    expect(screen.queryByText(/Dimension/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Render' }));
    expect(screen.getByLabelText('Fractal render')).toBeTruthy();
  });

  it('game shows no quest until one is named', async () => {
    renderInShell(<GameNorthStar />);
    expect(screen.getByRole('heading', { name: 'What are you playing, Ramaj' })).toBeTruthy();
    expect(screen.getByText('No active quest')).toBeTruthy();
    expect(screen.queryByText(/XP streak/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a quest' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Name the quest/);
    fireEvent.change(screen.getByLabelText('Quest name'), { target: { value: 'Night watch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a quest' }));
    await waitFor(() => {
      const body = apiPost.mock.calls.at(-1)?.[1] as { title?: string } | undefined;
      expect(body?.title).toBe('Night watch');
    });
  });

  it('sim shows zero runs and does not invent a scenario', async () => {
    renderInShell(<SimNorthStar />);
    expect(screen.getByRole('heading', { name: 'Run the scenario, Ramaj' })).toBeTruthy();
    expect(screen.getByText('No scenario yet')).toBeTruthy();
    expect(await screen.findByText(/0 runs on the books/)).toBeTruthy();
    expect(screen.queryByText(/Run console/)).toBeNull();
  });

  it('ar stays on the honest preview frame', async () => {
    renderInShell(<ArLensPage />);
    expect(screen.getByRole('heading', { name: 'Place it in the room, Ramaj' })).toBeTruthy();
    expect(screen.getByText(/No XR device on this machine/)).toBeTruthy();
    expect(screen.queryByText(/Scenes authored/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    expect(await screen.findByText(/No scene to place yet/)).toBeTruthy();
  });

  it('podcast queues nothing until a show is added', async () => {
    renderInShell(<PodcastNow onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: "What's on, Ramaj" })).toBeTruthy();
    expect(screen.getByText('Nothing queued')).toBeTruthy();
    expect(await screen.findByText(/0 subscribed · 0 in progress/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add a show' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Name the show/);
  });

  it('world is the place chip over the client, with no greeting', async () => {
    renderInShell(<WorldUnityShell />);
    expect(screen.getByTestId('world-place-chip')).toHaveTextContent('Flower Law · Hub');
    expect(screen.queryByRole('heading', { name: /Ramaj/ })).toBeNull();
  });
});
