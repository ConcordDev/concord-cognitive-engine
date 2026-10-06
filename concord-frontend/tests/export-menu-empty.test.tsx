// The lens toolbar's Export menu must not download an empty "[]" or
// "No data" file and call it an export.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a) } } }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a) }));

import { ExportMenu, EMPTY_EXPORT_NOTICE } from '@/components/common/ExportMenu';

beforeEach(() => { listMock.mockReset(); downloadMock.mockReset(); });

describe('ExportMenu', () => {
  it.each(['Export as JSON', 'Export as CSV'])('%s with no items downloads nothing and says why', async (label) => {
    listMock.mockResolvedValue({ data: { items: [] } });
    render(<ExportMenu domain="healthcare" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText(label));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(EMPTY_EXPORT_NOTICE);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('downloads real items as CSV with a header row', async () => {
    listMock.mockResolvedValue({ data: { items: [{ id: 'a1', title: 'One', type: 'note', createdAt: 't', updatedAt: 'u' }] } });
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
