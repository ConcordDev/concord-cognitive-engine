// The lens toolbar's Export menu must not download an empty "[]" or
// "No data" file and call it an export. GET /api/lens/:domain returns
// { artifacts, total } — ExportMenu must read that shape.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a) } } }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a) }));

import { ExportMenu, EMPTY_EXPORT_NOTICE, lensListExportRows } from '@/components/common/ExportMenu';

beforeEach(() => { listMock.mockReset(); downloadMock.mockReset(); });

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
  });

  it('exports artifacts as JSON (live GET /api/lens/:domain shape)', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [SAMPLE_ARTIFACT], total: 1 } });
    render(<ExportMenu domain="psyops" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [content, filename, mime] = downloadMock.mock.calls[0];
    expect(JSON.parse(content)).toEqual([SAMPLE_ARTIFACT]);
    expect(filename).toMatch(/^psyops-export-.*\.json$/);
    expect(mime).toBe('application/json');
    expect(screen.queryByTestId('export-menu-notice')).toBeNull();
  });

  it('exports artifacts as CSV with a header row', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [SAMPLE_ARTIFACT], total: 1 } });
    render(<ExportMenu domain="notes" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as CSV'));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [content, filename, mime] = downloadMock.mock.calls[0];
    expect(content).toBe('id,title,type,createdAt,updatedAt\n"a1","One","note","t","u"');
    expect(filename).toMatch(/^notes-export-.*\.csv$/);
    expect(mime).toBe('text/csv');
  });

  it('a failed export says so and downloads nothing', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ExportMenu domain="x" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(/Export failed/);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
