// The Export menu's notice must survive closing and reopening the menu:
// a slow empty or failed read whose notice is wiped by the toggle reads as
// silent nothing. The notice clears when the next export attempt starts —
// not when the menu is toggled.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a), exportList: (...a: unknown[]) => listMock(...a) } },
  lensRun: vi.fn(),
}));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a) }));

import { ExportMenu, EMPTY_EXPORT_NOTICE } from '@/components/common/ExportMenu';

beforeEach(() => { listMock.mockReset(); downloadMock.mockReset(); });

describe('ExportMenu notice persistence', () => {
  it('keeps the empty-export notice across a close and reopen, and clears it on the next attempt', async () => {
    listMock.mockResolvedValue({ data: { artifacts: [], total: 0 } });
    render(<ExportMenu domain="crafting" />);
    const toggle = screen.getByTitle('Export (Ctrl+E)');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(EMPTY_EXPORT_NOTICE);

    // Close and reopen: the notice must still be there.
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(await screen.findByTestId('export-menu-notice')).toHaveTextContent(EMPTY_EXPORT_NOTICE);

    // The next attempt clears it: a successful export downloads and no
    // stale notice greets the following open.
    listMock.mockResolvedValue({
      data: { artifacts: [{ id: 'a1', title: 'One', type: 'note', createdAt: 't', updatedAt: 'u' }], total: 1 },
    });
    fireEvent.click(screen.getByText('Export as JSON'));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    fireEvent.click(toggle);
    expect(screen.queryByTestId('export-menu-notice')).toBeNull();
  });
});
