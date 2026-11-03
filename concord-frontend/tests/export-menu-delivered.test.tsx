// CB-0076 (Branch A, Crafting): a delivered export had no visible response —
// the menu closed silently on success, so a browser that drops the
// programmatic download looked identical to a dead button. The menu now
// leaves a persistent "Download started: N items as <file>" status (outside the
// dropdown, so it survives the menu closing) with a real "save it again"
// link as a user-gesture fallback.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
const urlMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a), exportList: (...a: unknown[]) => listMock(...a) } },
  lensRun: vi.fn(),
}));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a), downloadFromUrl: (...a: unknown[]) => urlMock(...a) }));

import { ExportMenu } from '@/components/common/ExportMenu';

const ROWS = [
  { id: 'a1', title: 'Iron sword', type: 'craft', createdAt: 't', updatedAt: 'u' },
  { id: 'a2', title: 'Oak bow', type: 'craft', createdAt: 't', updatedAt: 'u' },
];

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  listMock.mockReset(); downloadMock.mockReset(); urlMock.mockReset();
  createSpy = vi.fn(() => 'blob:fallback-1');
  revokeSpy = vi.fn();
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
});

async function exportCrafting(label = 'Export as JSON') {
  listMock.mockResolvedValue({ data: { artifacts: ROWS, total: 2 } });
  render(<ExportMenu domain="crafting" />);
  fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
  fireEvent.click(screen.getByText(label));
  return screen.findByTestId('export-menu-delivered');
}

describe('ExportMenu — server-attachment delivery + visible status', () => {
  it('navigates to the server attachment route and says the download STARTED (never claims it landed)', async () => {
    const status = await exportCrafting();
    expect(urlMock).toHaveBeenCalledTimes(1);
    expect(urlMock).toHaveBeenCalledWith('/api/lens/crafting/export/download?format=json&limit=1000');
    expect(downloadMock).not.toHaveBeenCalled(); // no client-built blob on this path
    expect(createSpy).not.toHaveBeenCalled();
    expect(status).toHaveTextContent('Download started: 2 items');
    expect(status).toHaveTextContent(/crafting-export-.*\.json/);
    expect(status).not.toHaveTextContent(/^Exported/);
    await waitFor(() => expect(screen.queryByText('Export as CSV')).toBeNull());
  });

  it('the fallback link is the same real server URL (an HTTP attachment), not a blob', async () => {
    await exportCrafting('Export as CSV');
    const link = await screen.findByTestId('export-menu-save-again');
    expect(link).toHaveAttribute('href', '/api/lens/crafting/export/download?format=csv&limit=1000');
    expect(link.getAttribute('download')).toMatch(/^crafting-export-.*\.csv$/);
  });

  it('dismiss clears the status (nothing client-built to revoke)', async () => {
    await exportCrafting();
    fireEvent.click(screen.getByLabelText('Dismiss export message'));
    expect(screen.queryByTestId('export-menu-delivered')).toBeNull();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('the next export attempt replaces the previous status', async () => {
    await exportCrafting();
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as CSV'));
    await waitFor(() => expect(screen.getByTestId('export-menu-save-again')).toHaveAttribute('href', expect.stringContaining('format=csv')));
    expect(urlMock).toHaveBeenCalledTimes(2);
  });

  it('an empty export still shows the in-menu notice and NO delivered status or navigation', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [], total: 0 } });
    render(<ExportMenu domain="crafting" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('export-menu-delivered')).toBeNull();
    expect(urlMock).not.toHaveBeenCalled();
  });

  it('a failed read keeps the failure notice and starts no download', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    render(<ExportMenu domain="crafting" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent('Export failed');
    expect(screen.queryByTestId('export-menu-delivered')).toBeNull();
    expect(urlMock).not.toHaveBeenCalled();
  });
});
