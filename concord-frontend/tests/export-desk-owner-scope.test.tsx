import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
const lensRunMock = vi.fn();

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ExportDeskPanel } from '@/components/export/ExportDeskPanel';

const MINE = { id: 'dtu-mine', title: 'My note', tier: 'regular', tags: ['note'], summary: 'hello', createdAt: '2026-10-10' };

let blobs: string[];

function renderDesk() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExportDeskPanel />
    </QueryClientProvider>,
  );
}

function page(items: Array<Record<string, unknown>>, total = items.length) {
  return { data: { ok: true, items, pagination: { total, hasNext: items.length < total, pageSize: 100 } } };
}

beforeEach(() => {
  blobs = [];
  apiGet.mockReset();
  apiPost.mockReset();
  lensRunMock.mockReset();
  apiGet.mockImplementation(async (url: string, opts?: { params?: { scope?: string; offset?: number; limit?: number } }) => {
    if (url !== '/api/dtus/paginated') throw new Error(`unexpected ${url}`);
    const scope = opts?.params?.scope;
    if (scope === 'all') {
      return page([MINE, { id: 'dtu-system', title: 'System feed', tier: 'regular', tags: [], summary: 'sys' }]);
    }
    return page([MINE]);
  });
  apiPost.mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
  lensRunMock.mockImplementation(async (_domain: string, name: string) => {
    if (name === 'history-list') return { data: { ok: true, result: { runs: [] } } };
    if (name === 'validateExport') {
      return { data: { ok: true, result: { totalItems: 1, valid: 1, invalid: 0, exportReady: true, errors: [] } } };
    }
    if (name === 'generatePackage') {
      return { data: { ok: true, result: { format: 'json', itemCount: 1, status: 'ready', mimeType: 'application/json', extension: '.json' } } };
    }
    if (name === 'record-run') return { data: { ok: true, result: {} } };
    return { data: { ok: true, result: {} } };
  });
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      const index = blobs.push('') - 1;
      void blob.text().then((text) => { blobs[index] = text; });
      return 'blob:mock';
    },
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExportDeskPanel owner scope', () => {
  it('loads and exports only the caller vault unless the shared library is included', async () => {
    renderDesk();
    expect(await screen.findByText('1 DTU in your vault.')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/dtus/paginated', {
      params: { scope: 'mine', limit: 100, offset: 0 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export my DTUs' }));
    await waitFor(() => expect(blobs.some((b) => b.includes('dtu-mine') && !b.includes('dtu-system'))).toBe(true));
    const mineCalls = apiGet.mock.calls.filter((c) => c[1]?.params?.scope === 'mine');
    expect(mineCalls.length).toBeGreaterThanOrEqual(2);
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'record-run')).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /Include the shared library/ }));
    expect(await screen.findByText('2 DTUs in the shared library.')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/dtus/paginated', {
      params: { scope: 'all', limit: 100, offset: 0 },
    });

    blobs.length = 0;
    const format = screen.getByRole('group', { name: 'Export format' });
    fireEvent.click(within(format).getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export my DTUs' }));
    await waitFor(() => expect(blobs.some((b) => b.includes('My note') && b.includes('System feed'))).toBe(true));

    fireEvent.click(within(format).getByRole('button', { name: 'Markdown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export my DTUs' }));
    await waitFor(() => expect(blobs.some((b) => b.includes('# Concord Export'))).toBe(true));

    fireEvent.click(within(format).getByRole('button', { name: 'Plain text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export my DTUs' }));
    await waitFor(() => expect(blobs.some((b) => b.includes('Tags: note'))).toBe(true));

    fireEvent.click(within(format).getByRole('button', { name: '.dtu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export my DTUs' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/api/lens/export/export-dtu',
      expect.objectContaining({ title: 'My Concord DTUs' }),
      { responseType: 'blob' },
    ));
  });

  it('keeps package, validate, diff and single-DTU export behind the secondary tools', async () => {
    renderDesk();
    expect(await screen.findByText('1 DTU in your vault.')).toBeTruthy();

    fireEvent.click(screen.getByText('Check this export'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate export' }));
    expect(await screen.findByText(/1 valid, 0 invalid/)).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('export', 'validateExport', expect.objectContaining({
      items: [expect.objectContaining({ id: 'dtu-mine' })],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Preview package' }));
    expect(await screen.findByText(/1 items · json/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Diff last export' }));
    expect(await screen.findByText(/No previous JSON export/)).toBeTruthy();

    fireEvent.click(screen.getByText('Export one DTU'));
    fireEvent.click(screen.getByRole('button', { name: 'Export this DTU' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/api/export/universal',
      expect.objectContaining({ dtuId: 'dtu-mine', targetFormat: 'json' }),
      { responseType: 'blob' },
    ));
  });

  it('pages past a full vault page', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: `p-${i}`, title: `T${i}`, tags: i === 0 ? ['a'] : [] }));
    apiGet.mockImplementation(async (_url: string, opts?: { params?: { offset?: number } }) => {
      const offset = opts?.params?.offset ?? 0;
      if (offset === 0) return page(first, 101);
      return page([{ id: 'p-last', title: 'Last page', tags: ['tail'], summary: 'end' }], 101);
    });
    renderDesk();
    expect(await screen.findByText('101 DTUs in your vault.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export my DTUs' }));
    await waitFor(() => expect(blobs.some((b) => b.includes('p-last') && b.includes('p-0'))).toBe(true));
    expect(apiGet.mock.calls.some((c) => c[1]?.params?.offset === 100 && c[1]?.params?.scope === 'mine')).toBe(true);
  });

  it('says the vault is empty and does not export', async () => {
    apiGet.mockResolvedValue(page([]));
    renderDesk();
    expect(await screen.findByText('Nothing in your vault yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export my DTUs' })).toBeDisabled();
  });

  it('shows a vault load failure', async () => {
    apiGet.mockRejectedValue(new Error('vault down'));
    renderDesk();
    expect(await screen.findByText('vault down')).toBeTruthy();
  });

  it('diffs against a retained JSON payload', async () => {
    lensRunMock.mockImplementation(async (_domain: string, name: string) => {
      if (name === 'history-list') {
        return { data: { ok: true, result: { runs: [{ id: 'run-1', format: 'json', hasPayload: true }] } } };
      }
      if (name === 'history-download') {
        return { data: { ok: true, result: { payload: JSON.stringify({ dtus: [{ id: 'old' }] }) } } };
      }
      if (name === 'diffExport') {
        return { data: { ok: true, result: { added: 1, removed: 0, modified: 2 } } };
      }
      return { data: { ok: true, result: {} } };
    });
    renderDesk();
    await screen.findByText('1 DTU in your vault.');
    fireEvent.click(screen.getByText('Check this export'));
    fireEvent.click(screen.getByRole('button', { name: 'Diff last export' }));
    expect(await screen.findByText(/Added 1, removed 0, modified 2/)).toBeTruthy();
  });
});
