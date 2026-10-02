/**
 * Saved, Resonance, Docs, Paper, DTU Browser, Literary, Understanding.
 * Empty copy is not an item, a reading, a page, a paper, a unit, or a passage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

const lensRunMock = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: (...args: unknown[]) => apiGet(...args) },
  apiHelpers: {
    dtus: {
      paginated: (params: unknown) => apiGet('/api/dtus/paginated', { params }),
    },
  },
}));

import { WorthKeeping } from '@/components/saved/WorthKeeping';
import { WhatResonates } from '@/components/resonance/WhatResonates';
import { TheDocument } from '@/components/docs/TheDocument';
import { ThePaper } from '@/components/paper/ThePaper';
import { OneUnit } from '@/components/dtus/OneUnit';
import { ThePassage } from '@/components/literary/ThePassage';
import { StartFromDtu } from '@/components/understanding/StartFromDtu';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
  apiGet.mockReset();
});

describe('library north stars', () => {
  it('saved stays empty until the list returns an item', async () => {
    lensRunMock.mockResolvedValue(ok({ items: [], total: 0, matched: 0 }));
    renderInShell(<WorthKeeping onOpenDesk={() => {}} />);
    expect(await screen.findByText("What's worth keeping, Ramaj")).toBeTruthy();
    expect(await screen.findByText('Nothing saved yet.')).toBeTruthy();
    expect(screen.getByText('Nothing selected.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open saved' }));
    expect(await screen.findByText('Nothing saved to open.')).toBeTruthy();
  });

  it('saved opens the item the list returned', async () => {
    lensRunMock.mockResolvedValue(ok({
      items: [{ id: 'svd_1', title: 'Concord paper', url: 'https://example.test/p', author: 'A' }],
      total: 1,
      matched: 1,
    }));
    renderInShell(<WorthKeeping onOpenDesk={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Concord paper' }));
    expect(await screen.findByTestId('saved-open')).toBeTruthy();
    expect(screen.getByText('https://example.test/p')).toBeTruthy();
  });

  it('resonance shows nothing until history returns a reading', async () => {
    apiGet.mockResolvedValue({ data: { readings: [] } });
    renderInShell(<WhatResonates onOpenDesk={() => {}} />);
    expect(await screen.findByText('What still resonates, Ramaj')).toBeTruthy();
    expect(await screen.findByText('Nothing returned yet.')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/resonance/history', { params: { limit: 12 } });
  });

  it('docs creates a page only from page-create', async () => {
    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'page-list') return Promise.resolve(ok({ pages: [], count: 0 }));
      if (name === 'page-create') return Promise.resolve(ok({ page: { id: 'pg_1', title: 'Untitled', blocks: [] } }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<TheDocument onOpenDesk={() => {}} />);
    expect(await screen.findByText('No document open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ New doc' }));
    expect(await screen.findByTestId('docs-open')).toBeTruthy();
    expect(screen.getByText('Untitled')).toBeTruthy();
    expect(screen.getByText('This page has no blocks yet.')).toBeTruthy();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'page-create')).toBe(true);
  });

  it('paper refuses to open a paper the library does not hold', async () => {
    lensRunMock.mockResolvedValue(ok({ papers: [], count: 0 }));
    renderInShell(<ThePaper onOpenDesk={() => {}} />);
    expect(await screen.findByText('No paper open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open a paper' }));
    expect(await screen.findByText('No paper to open.')).toBeTruthy();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'paper-detail')).toBe(false);
  });

  it('paper opens the stored abstract', async () => {
    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'paper-list') return Promise.resolve(ok({ papers: [{ id: 'p1', title: 'On beams' }], count: 1 }));
      if (name === 'paper-detail') return Promise.resolve(ok({ paper: { id: 'p1', title: 'On beams', abstract: 'A real abstract.', authors: ['Ada'] } }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<ThePaper onOpenDesk={() => {}} />);
    expect(await screen.findByRole('button', { name: 'On beams' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open a paper' }));
    expect(await screen.findByText('A real abstract.')).toBeTruthy();
    const detail = lensRunMock.mock.calls.find((c) => c[1] === 'paper-detail');
    expect(detail?.[2]).toEqual({ id: 'p1' });
  });

  it('dtu browse does not list units until Browse', async () => {
    apiGet.mockResolvedValue({ data: { dtus: [{ id: 'd1', title: 'A unit' }] } });
    renderInShell(<OneUnit onOpenDesk={() => {}} />);
    expect(screen.getByText('No unit selected.')).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(await screen.findByRole('button', { name: 'A unit' })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/dtus/paginated', { params: { limit: 12, offset: 0, scope: 'mine' } });
  });

  it('literary does not search until a line is present', async () => {
    renderInShell(<ThePassage onOpenDesk={() => {}} />);
    expect(screen.getByText('No text open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open a text' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Line'), { target: { value: 'a rose' } });
    lensRunMock.mockResolvedValue(ok({ results: [{ chunkId: 'c1', title: 'Sonnet', snippet: 'a rose by any' }], count: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Open a text' }));
    expect(await screen.findByText('a rose by any')).toBeTruthy();
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('literary', 'search', { query: 'a rose', limit: 5, keyword: true });
    });
  });

  it('understanding composes only from a supplied DTU id', async () => {
    renderInShell(<StartFromDtu onOpenDesk={() => {}} />);
    expect(screen.getByText('Bring one unit in when you are ready.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start from a DTU' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('DTU'), { target: { value: 'dtu_9' } });
    lensRunMock.mockResolvedValue(ok({ id: 'und_1', understanding: { id: 'und_1', text: 'A stored claim.' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Start from a DTU' }));
    expect(await screen.findByText('A stored claim.')).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('understanding', 'compose', {
      subjectKind: 'dtu',
      subjectId: 'dtu_9',
      composer: 'rules',
    });
  });
});
