/// <reference types="@testing-library/jest-dom/vitest" />
// Vitest for the Plugin Gallery lens — the real frontend surface for
// `/api/plugins/gallery/*` (server/lib/plugin-gallery.js), hardened this
// session. Pins: real entries render with honest trust/capability text, an
// honest empty state when the gallery is genuinely empty, the install
// consent modal enumerating real declaredCapabilities BEFORE confirming,
// and a failed install rendering the real API error text verbatim (never a
// fabricated success or generic message).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import PluginsPage from './page';
import type { GalleryPlugin } from '@/components/plugins/types';

function plugin(over: Partial<GalleryPlugin> = {}): GalleryPlugin {
  return {
    pluginId: 'gallery.example-plugin',
    authorId: 'author-1',
    name: 'Example Plugin',
    description: 'Does something useful with DTUs.',
    version: '1.2.0',
    signature: 'sig-abc',
    hash: 'hash-abc',
    trusted: true,
    declaredMacros: ['dtu.read', 'dtu.create'],
    publishedAt: '2026-07-20T00:00:00.000Z',
    installs: 4,
    rating: { up: 3, down: 1 },
    loadedPluginId: null,
    delistedAt: null,
    delistedReason: null,
    delistedBy: null,
    declaredCapabilities: ['dtu.read', 'dtu.create'],
    trustDescription: 'Self-attested: signed with a key this author registered for themselves. Not independently reviewed.',
    loaded: false,
    ...over,
  };
}

/** Builds a `fetch` mock dispatching on URL + method for the gallery routes. */
function galleryFetchMock({
  plugins = [plugin()],
  listOk = true,
  listError = 'boom',
  installResponse,
}: {
  plugins?: GalleryPlugin[];
  listOk?: boolean;
  listError?: string;
  installResponse?: { status: number; body: unknown };
} = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();

    if (url.startsWith('/api/plugins/gallery/') && url.endsWith('/install') && method === 'POST') {
      const r = installResponse ?? { status: 200, body: { ok: true, loaded: true, freshLoad: true, pluginId: 'internal.example-plugin' } };
      return { status: r.status, json: async () => r.body } as unknown as Response;
    }
    if (url.startsWith('/api/plugins/gallery/') && url.endsWith('/rate') && method === 'POST') {
      return { status: 200, json: async () => ({ ok: true, rating: { up: 4, down: 1 } }) } as unknown as Response;
    }
    if (url.startsWith('/api/plugins/gallery')) {
      if (!listOk) {
        return { status: 200, json: async () => ({ ok: false, error: listError }) } as unknown as Response;
      }
      return { status: 200, json: async () => ({ ok: true, plugins }) } as unknown as Response;
    }
    return { status: 404, json: async () => ({ ok: false, error: 'unknown_route' }) } as unknown as Response;
  });
}

describe('Plugin Gallery lens page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders real gallery entries with honest capability + trust text, wired to the real ?q= param', async () => {
    const fetchMock = galleryFetchMock({ plugins: [plugin()] });
    vi.stubGlobal('fetch', fetchMock);

    render(<PluginsPage />);

    const list = await screen.findByTestId('plugin-gallery-list');
    expect(within(list).getByText('Example Plugin')).toBeInTheDocument();
    expect(within(list).getByText('Does something useful with DTUs.')).toBeInTheDocument();
    expect(within(list).getByText('v1.2.0')).toBeInTheDocument();
    expect(within(list).getByText(/4 installs/)).toBeInTheDocument();
    expect(
      within(list).getByText('Self-attested: signed with a key this author registered for themselves. Not independently reviewed.'),
    ).toBeInTheDocument();
    expect(within(list).getByText('dtu.read')).toBeInTheDocument();
    expect(within(list).getByText('dtu.create')).toBeInTheDocument();

    // Search box wires to the real ?q= query param.
    const searchBox = screen.getByLabelText('Search plugin gallery');
    fireEvent.change(searchBox, { target: { value: 'example' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.startsWith('/api/plugins/gallery?') && u.includes('q=example'))).toBe(true);
    });
  });

  it('shows an honest empty state when the gallery has zero entries — never a fabricated row', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({ plugins: [] }));

    render(<PluginsPage />);

    await waitFor(() =>
      expect(screen.getByText('No plugins have been published to the gallery yet.')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('plugin-gallery-list')).not.toBeInTheDocument();
  });

  it('shows an honest error state when the gallery fetch fails — never a silent blank list', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({ listOk: false, listError: 'db_unavailable' }));

    render(<PluginsPage />);

    await waitFor(() => expect(screen.getByText('db_unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('plugin-gallery-list')).not.toBeInTheDocument();
  });

  it('install consent modal enumerates the real declaredCapabilities BEFORE confirming install', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({ plugins: [plugin()] }));

    render(<PluginsPage />);
    await screen.findByTestId('plugin-gallery-list');

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    const dialog = await screen.findByRole('dialog', { name: /install example plugin/i });
    // The capability list is shown BEFORE any install call is made.
    expect(within(dialog).getByText('dtu.read')).toBeInTheDocument();
    expect(within(dialog).getByText('dtu.create')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Self-attested: signed with a key this author registered for themselves. Not independently reviewed.'),
    ).toBeInTheDocument();
    // Not yet installed — confirm button present, no success toast yet.
    expect(within(dialog).getByRole('button', { name: /grant & install/i })).toBeInTheDocument();
    expect(screen.queryByText(/installed/i)).not.toBeInTheDocument();
  });

  it('confirms install and reflects the real success response', async () => {
    vi.stubGlobal(
      'fetch',
      galleryFetchMock({
        plugins: [plugin()],
        installResponse: { status: 200, body: { ok: true, loaded: true, freshLoad: true, pluginId: 'internal.example-plugin' } },
      }),
    );

    render(<PluginsPage />);
    await screen.findByTestId('plugin-gallery-list');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    const dialog = await screen.findByRole('dialog', { name: /install example plugin/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /grant & install/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/example plugin installed/i)).toBeInTheDocument();
  });

  it('surfaces a real 400 install failure verbatim — never a fabricated success', async () => {
    vi.stubGlobal(
      'fetch',
      galleryFetchMock({
        plugins: [plugin()],
        installResponse: {
          status: 400,
          body: { ok: false, error: 'install_failed', reason: 'validation_failed', validation: { errors: ['forbidden_domain:fs'] } },
        },
      }),
    );

    render(<PluginsPage />);
    await screen.findByTestId('plugin-gallery-list');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    const dialog = await screen.findByRole('dialog', { name: /install example plugin/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /grant & install/i }));

    expect(await within(dialog).findByText(/install_failed — validation_failed/)).toBeInTheDocument();
    expect(within(dialog).getByText('forbidden_domain:fs')).toBeInTheDocument();
    // Dialog stays open — a failure never reads as a fabricated success.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/example plugin installed/i)).not.toBeInTheDocument();
  });

  it('surfaces a real 410 delisted install failure verbatim', async () => {
    vi.stubGlobal(
      'fetch',
      galleryFetchMock({
        plugins: [plugin()],
        installResponse: { status: 410, body: { ok: false, error: 'plugin_delisted', reason: 'security review' } },
      }),
    );

    render(<PluginsPage />);
    await screen.findByTestId('plugin-gallery-list');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    const dialog = await screen.findByRole('dialog', { name: /install example plugin/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /grant & install/i }));

    expect(await within(dialog).findByText(/plugin_delisted — security review/)).toBeInTheDocument();
  });
});
