// The lens toolbar's Export menu must not download an empty "[]" or
// "No data" file and call it an export. GET /api/lens/:domain returns
// { artifacts, total } — ExportMenu must read that shape.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
const urlMock = vi.fn();
// The menu exports through lens.exportList (a larger, state-backed-aware read); lens.list is kept for the row count.
vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a), exportList: (...a: unknown[]) => listMock(...a) } } }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a), downloadFromUrl: (...a: unknown[]) => urlMock(...a) }));

import { ExportMenu, EMPTY_EXPORT_NOTICE, EMPTY_EXPORT_NOTICE_STATE_BACKED, lensListExportRows } from '@/components/common/ExportMenu';

beforeEach(() => { listMock.mockReset(); downloadMock.mockReset(); urlMock.mockReset(); });

const SAMPLE_ARTIFACT = {
  id: 'a1',
  title: 'One',
  type: 'note',
  createdAt: 't',
  updatedAt: 'u',
};

describe('lensListExportRows', () => {
  it('prefers artifacts from the live lens list payload', () => {
    expect(lensListExportRows({ artifacts: [SAMPLE_ARTIFACT], total: 1 })).toEqual([SAMPLE_ARTIFACT]);
  });

  it('returns empty for an actually-empty artifacts list', () => {
    expect(lensListExportRows({ artifacts: [], total: 0 })).toEqual([]);
  });
});

describe('ExportMenu', () => {
  it.each(['Export as JSON', 'Export as CSV'])('%s with empty artifacts downloads nothing and says why', async (label) => {
    listMock.mockResolvedValue({ data: { artifacts: [], total: 0 } });
    render(<ExportMenu domain="healthcare" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText(label));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(EMPTY_EXPORT_NOTICE);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(urlMock).not.toHaveBeenCalled();
  });

  it('exports artifacts as JSON by navigating to the server attachment route (live GET /api/lens/:domain shape)', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [SAMPLE_ARTIFACT], total: 1 } });
    render(<ExportMenu domain="psyops" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));
    expect(urlMock).toHaveBeenCalledWith('/api/lens/psyops/export/download?format=json&limit=1000');
    // The file is built and named by the server (Content-Disposition), not a client blob.
    expect(downloadMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('export-menu-notice')).toBeNull();
  });

  it('exports artifacts as CSV through the same server route (CSV body is pinned in the server suite)', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [SAMPLE_ARTIFACT], total: 1 } });
    render(<ExportMenu domain="notes" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as CSV'));
    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));
    expect(urlMock).toHaveBeenCalledWith('/api/lens/notes/export/download?format=csv&limit=1000');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('an empty state-backed lens says it is state-backed (a different notice than an empty list)', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [], total: 0, stateBacked: true } });
    render(<ExportMenu domain="chem" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(EMPTY_EXPORT_NOTICE_STATE_BACKED);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(urlMock).not.toHaveBeenCalled();
  });

  it('a failed export says so and downloads nothing', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ExportMenu domain="x" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(/Export failed/);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(urlMock).not.toHaveBeenCalled();
  });
});
