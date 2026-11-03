// CB-0076 (Branch A, Crafting): a delivered export had no visible response —
// the menu closed silently on success, so a browser that drops the
// programmatic download looked identical to a dead button. The menu now
// leaves a persistent "Exported N items as <file>" status (outside the
// dropdown, so it survives the menu closing) with a real "save it again"
// link as a user-gesture fallback.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a), exportList: (...a: unknown[]) => listMock(...a) } },
  lensRun: vi.fn(),
}));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a) }));

import { ExportMenu } from '@/components/common/ExportMenu';

const ROWS = [
  { id: 'a1', title: 'Iron sword', type: 'craft', createdAt: 't', updatedAt: 'u' },
  { id: 'a2', title: 'Oak bow', type: 'craft', createdAt: 't', updatedAt: 'u' },
];

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  listMock.mockReset(); downloadMock.mockReset();
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

describe('ExportMenu — visible delivery status', () => {
  it('after a successful export the menu closes but a persistent status names the file and count', async () => {
    const status = await exportCrafting();
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const filename = downloadMock.mock.calls[0][1] as string;
    expect(filename).toMatch(/^crafting-export-.*\.json$/);
    expect(status).toHaveTextContent('Exported 2 items');
    expect(status).toHaveTextContent(filename);
    // The dropdown is closed; the status is not tied to it.
    await waitFor(() => expect(screen.queryByText('Export as CSV')).toBeNull());
  });

  it('offers a real save-again link (blob URL + download name) as a user-gesture fallback', async () => {
    await exportCrafting('Export as CSV');
    const link = await screen.findByTestId('export-menu-save-again');
    expect(link).toHaveAttribute('href', 'blob:fallback-1');
    expect(link.getAttribute('download')).toMatch(/^crafting-export-.*\.csv$/);
  });

  it('dismiss clears the status and releases the fallback blob URL', async () => {
    await exportCrafting();
    fireEvent.click(screen.getByLabelText('Dismiss export message'));
    expect(screen.queryByTestId('export-menu-delivered')).toBeNull();
    expect(revokeSpy).toHaveBeenCalledWith('blob:fallback-1');
  });

  it('the next export attempt replaces the previous status', async () => {
    await exportCrafting();
    createSpy.mockReturnValue('blob:fallback-2');
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as CSV'));
    await waitFor(() => expect(screen.getByTestId('export-menu-save-again')).toHaveAttribute('href', 'blob:fallback-2'));
    expect(revokeSpy).toHaveBeenCalledWith('blob:fallback-1');
  });

  it('an empty export still shows the in-menu notice and NO delivered status', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [], total: 0 } });
    render(<ExportMenu domain="crafting" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('export-menu-delivered')).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('a failed read keeps the failure notice and shows no delivered status', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    render(<ExportMenu domain="crafting" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent('Export failed');
    expect(screen.queryByTestId('export-menu-delivered')).toBeNull();
  });
});
