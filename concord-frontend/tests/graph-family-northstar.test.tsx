/**
 * Graph-absorbed north stars. Rows and counts come from the mocked macros.
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
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { SchemaNorthStar } from '@/components/schema/SchemaNorthStar';
import { EntityNorthStar } from '@/components/entity/EntityNorthStar';
import { TemporalNorthStar } from '@/components/temporal/TemporalNorthStar';
import { EcoNorthStar } from '@/components/eco/EcoNorthStar';
import { MetaNorthStar } from '@/components/meta/MetaNorthStar';

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  lensRunMock.mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_ok: unknown, err: (e: Error) => void) => err(new Error('denied')),
    },
  });
});

describe('graph family north stars', () => {
  it('schema opens empty and refuses an unnamed schema', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { schemas: [], count: 0 } } });
    renderWith(<SchemaNorthStar onOpenDesk={() => {}} />);
    expect(await screen.findByRole('heading', { name: /The shape of the data, Ramaj/ })).toBeTruthy();
    expect(await screen.findByText('No schemas yet.')).toBeTruthy();
    expect(screen.queryByText('Validate')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ New schema' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name the schema.');
    expect(lensRunMock).not.toHaveBeenCalledWith('schema', 'registryCreate', expect.anything());
  });

  it('entities lists graph nodes and requires a name to spawn', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { nodes: [{ id: 'n1', name: 'Knowledge Lattice', entityType: 'graph' }] } },
    });
    renderWith(<EntityNorthStar onOpenDesk={() => {}} />);
    expect(await screen.findByRole('heading', { name: /Who is in the graph, Ramaj/ })).toBeTruthy();
    expect(await screen.findByText('Knowledge Lattice')).toBeTruthy();
    expect(screen.getByText('graph')).toBeTruthy();
    expect(screen.queryByText('Wikidata')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Spawn entity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save entity' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name the entity.');
  });

  it('temporal stays empty until a series exists', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { datasets: [], total: 0 } } });
    renderWith(<TemporalNorthStar onOpenDesk={() => {}} />);
    expect(await screen.findByRole('heading', { name: /What the series says, Ramaj/ })).toBeTruthy();
    expect(await screen.findByText('No series yet.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /forecast/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Import series' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste the series.');
  });

  it('eco does not invent an air reading without a coordinate', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { locations: [], count: 0 } } });
    renderWith(<EcoNorthStar onOpenDesk={() => {}} />);
    expect(await screen.findByRole('heading', { name: /The air around you, Ramaj/ })).toBeTruthy();
    expect(await screen.findByText(/No coordinate on this machine/)).toBeTruthy();
    expect(screen.queryByText('56')).toBeNull();
    expect(lensRunMock).not.toHaveBeenCalledWith('eco', 'aqi-current', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: '+ Log a sighting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save sighting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name what you saw.');
  });

  it('meta shows inventory facts and refreshes', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/inventory') {
        return Promise.resolve({ data: { ok: true, totalLenses: 4, orphanedCount: 0, scanTimestamp: '2026-10-02T12:00:00.000Z' } });
      }
      return Promise.resolve({
        data: {
          lenses: {
            graph: { components: ['a'], serverRoutes: [] },
            schema: { components: [], serverRoutes: [] },
          },
        },
      });
    });
    apiPost.mockResolvedValue({ data: { ok: true } });
    renderWith(<MetaNorthStar onOpenDesk={() => {}} />);
    expect(await screen.findByRole('heading', { name: /What the system is, Ramaj/ })).toBeTruthy();
    expect(await screen.findByText('1 of 4')).toBeTruthy();
    expect(screen.getByText('none')).toBeTruthy();
    expect(screen.queryByText('262 of 266')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/inventory/refresh'));
  });
});
