/**
 * Expert Mode must render the live response shapes captured on
 * concord-os.org (2026-10-11). The lens died in LensErrorBoundary with
 * `TypeError: n.filter is not a function` because GET /api/brain/status
 * returns `brains` as a slot map, and BrainPoolStatus called `.filter`
 * on that object. The five POST /api/lens/run bodies below are the ones
 * the page actually received (all HTTP 200).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { api } from '@/lib/api/client';
import ExpertModeLens from './page';
import { BrainPoolStatus } from '@/components/expert-mode/BrainPoolStatus';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lenses/expert-mode',
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: () => {},
}));

/** Exact live POST /api/lens/run bodies from the 2026-10-11 reproduction. */
const LIVE_THREADS = { ok: true, result: { ok: true, threads: [], total: 0 } };
const LIVE_SURFACES = {
  ok: true,
  result: { ok: true, lensId: 'expert-mode', sinceDays: 7, surfaces: [] },
};
const LIVE_MODES = {
  ok: true,
  result: {
    ok: true,
    modes: [
      { id: 'all', label: 'All', web: true },
      { id: 'academic', label: 'Academic', web: true },
      { id: 'writing', label: 'Writing', web: false },
      { id: 'math', label: 'Math', web: false },
      { id: 'video', label: 'Video', web: true },
    ],
  },
};
const LIVE_SPACES = { ok: true, result: { ok: true, spaces: [], total: 0 } };
const LIVE_UPLOADS = { ok: true, result: { ok: true, uploads: [], total: 0 } };

/** Live getBrainStatus() shape: brains is a map, not an array. */
const LIVE_BRAIN_STATUS = {
  ok: true,
  mode: 'partial',
  onlineCount: 1,
  brains: {
    conscious: {
      enabled: true,
      url: 'http://ollama-conscious:11434',
      model: 'concord-conscious:latest',
      role: 'chat, deep reasoning, complex queries',
      stats: { requests: 12, totalMs: 4800, dtusGenerated: 1, errors: 2, lastCallAt: null },
      avgResponseMs: 400,
    },
    utility: {
      enabled: false,
      url: 'http://ollama-utility:11436',
      model: 'qwen2.5:3b',
      role: 'lens interactions, entity actions, quick domain tasks',
      stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null },
      avgResponseMs: 0,
    },
  },
  routing: { chatPrimary: 'ollama_conscious' },
};

/** Member projection: model names and URLs stripped, brains still a map. */
const MEMBER_BRAIN_STATUS = {
  ok: true,
  mode: 'partial',
  onlineCount: 1,
  urlsRedacted: true,
  modelsRedacted: true,
  brains: {
    conscious: { role: 'chat', enabled: true, stats: { requests: 4, errors: 0 } },
    utility: { role: 'lens interactions', enabled: false, stats: { requests: 0, errors: 1 } },
  },
};

function lensRunBody(body: { domain?: string; action?: string; name?: string }) {
  const key = `${body?.domain}.${body?.action || body?.name}`;
  switch (key) {
    case 'expert_mode.thread_list': return LIVE_THREADS;
    case 'expert_mode.focus_modes': return LIVE_MODES;
    case 'expert_mode.space_list': return LIVE_SPACES;
    case 'expert_mode.upload_list': return LIVE_UPLOADS;
    case 'dtu_surface.surfaced_from': return LIVE_SURFACES;
    default: return { ok: true, result: { ok: true } };
  }
}

function installApi(brainStatus: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (String(url).includes('/api/auth/me')) {
      return { data: { ok: true, user: { id: 'u1', username: 'tester', email: 't@example.com', role: 'member' } } } as never;
    }
    if (String(url).includes('/api/brain/status')) {
      return { data: brainStatus } as never;
    }
    return { data: {} } as never;
  });
  vi.spyOn(api, 'post').mockImplementation(async (url: string, body?: unknown) => {
    if (String(url).includes('/api/lens/run')) {
      return { data: lensRunBody((body || {}) as { domain?: string; action?: string; name?: string }) } as never;
    }
    return { data: { ok: true } } as never;
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Expert Mode live response shapes', () => {
  beforeEach(() => {
    installApi(LIVE_BRAIN_STATUS);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the lens against the captured lens/run envelopes and the brains map without throwing', async () => {
    renderWithQuery(<ExpertModeLens />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Academic' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByText(/No threads yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No spaces yet/i)).toBeInTheDocument();

    const conscious = await screen.findByTestId('brain-slot-conscious');
    expect(conscious).toHaveTextContent('concord-conscious:latest');
    expect(conscious).toHaveTextContent('Online');
    expect(conscious).toHaveTextContent('req 12');
    expect(conscious).toHaveTextContent('err 2');
    expect(screen.getByTestId('brain-slot-utility')).toHaveTextContent('Offline');
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByTestId('brain-enabled-count')).toHaveTextContent('1');
    expect(screen.getByTestId('brain-enabled-count')).toHaveTextContent('/ 2');
    expect(screen.queryByText(/inflight/i)).toBeNull();
    expect(screen.queryByText(/lens hit an error/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Academic' })).toBeInTheDocument();
  });

  it('renders a member brain-status map without inventing stripped model names or urls', async () => {
    cleanup();
    vi.restoreAllMocks();
    installApi(MEMBER_BRAIN_STATUS);

    renderWithQuery(<BrainPoolStatus />);

    const conscious = await screen.findByTestId('brain-slot-conscious');
    expect(conscious).toHaveTextContent('conscious');
    expect(conscious).toHaveTextContent('Online');
    expect(conscious).toHaveTextContent('req 4');
    expect(conscious).not.toHaveTextContent('concord-conscious');
    expect(conscious).not.toHaveTextContent('11434');
    expect(screen.getByTestId('brain-slot-utility')).toHaveTextContent('Offline');
    expect(screen.queryByText(/inflight/i)).toBeNull();
    expect(screen.queryByText(/lens hit an error/i)).toBeNull();
  });

  it('shows an honest error when brain status cannot be loaded', async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'));

    renderWithQuery(<BrainPoolStatus />);

    expect(await screen.findByRole('alert')).toHaveTextContent('/api/brain/status unreachable.');
    expect(screen.queryByText(/Online/)).toBeNull();
  });

  it('shows an honest unexpected-shape state when brains is not a map or array', async () => {
    cleanup();
    vi.restoreAllMocks();
    installApi({ ok: true, brains: 4, mode: 'partial' });

    renderWithQuery(<BrainPoolStatus />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Brain status returned an unexpected shape.');
    expect(screen.queryByTestId('brain-slot-conscious')).toBeNull();
  });
});
