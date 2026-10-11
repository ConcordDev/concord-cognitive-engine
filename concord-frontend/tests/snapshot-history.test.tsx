import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SnapshotHistory, type SnapshotRow } from '@/components/finance/SnapshotHistory';

beforeEach(() => { lensRunMock.mockReset(); });

function Harness({ initial }: { initial: SnapshotRow[] }) {
  const [rows, setRows] = useState(initial);
  return (
    <SnapshotHistory
      snapshots={rows}
      onDeleted={() => setRows((cur) => cur.filter((r) => r.date !== '2026-10-01'))}
    />
  );
}

describe('SnapshotHistory', () => {
  it('renders nothing when there are no snapshots', () => {
    const { container } = render(<SnapshotHistory snapshots={[]} onDeleted={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('deletes a date and the row is gone after the parent reloads', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { deleted: true, date: '2026-10-01' } } });
    render(<Harness initial={[{ date: '2026-10-01', total: 1200 }, { date: '2026-10-02', total: 1300 }]} />);
    expect(screen.getByText('$1,200.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2026-10-01' }));
    await waitFor(() => expect(screen.queryByText('$1,200.00')).toBeNull());
    expect(screen.getByText('$1,300.00')).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('finance', 'net-worth-snapshot-delete', { date: '2026-10-01' });
    expect(screen.getByRole('status')).toHaveTextContent('Deleted snapshot 2026-10-01.');
  });

  it('keeps the row when the server refuses', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'snapshot not found' } });
    render(<SnapshotHistory snapshots={[{ date: '2026-10-03', total: 10 }]} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2026-10-03' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('snapshot not found'));
    expect(screen.getByText('$10.00')).toBeTruthy();
  });
});
