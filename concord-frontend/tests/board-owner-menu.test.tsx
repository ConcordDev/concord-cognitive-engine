import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const deleteMock = vi.fn();
const patchMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    delete: (...args: unknown[]) => deleteMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
  },
}));

import { BoardOwnerMenu } from '@/components/whiteboard/BoardOwnerMenu';
import { ownerMutationNote } from '@/components/whiteboard/boardOwner';

beforeEach(() => {
  deleteMock.mockReset();
  patchMock.mockReset();
});

describe('BoardOwnerMenu', () => {
  it('renames through the owner route and keeps the new name', async () => {
    patchMock.mockResolvedValue({ data: { ok: true, whiteboard: { title: 'Plan v2' } } });
    const onRenamed = vi.fn();
    const { rerender } = render(
      <BoardOwnerMenu boardId="wb_1" title="Plan" onRenamed={onRenamed} onDeleted={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'Plan v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Renamed to Plan v2.'));
    expect(patchMock).toHaveBeenCalledWith('/api/whiteboard/wb_1', { title: 'Plan v2' });
    expect(onRenamed).toHaveBeenCalledWith('Plan v2');
    rerender(<BoardOwnerMenu boardId="wb_1" title="Plan v2" onRenamed={onRenamed} onDeleted={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
  });

  it('deletes for the owner and tells a stranger no', async () => {
    deleteMock.mockResolvedValueOnce({ data: { ok: true, deleted: true, id: 'wb_1' } });
    const onDeleted = vi.fn();
    const { rerender } = render(
      <BoardOwnerMenu boardId="wb_1" title="Plan" onRenamed={vi.fn()} onDeleted={onDeleted} />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete board' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteMock).toHaveBeenCalledWith('/api/whiteboard/wb_1');

    deleteMock.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    rerender(<BoardOwnerMenu boardId="wb_2" title="Theirs" onRenamed={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete board' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Only the owner can change this board.'));
    expect(ownerMutationNote(404, 'x')).toBe('That board is not on the server.');
    expect(ownerMutationNote(400, 'x')).toBe('A board name is required.');
    expect(ownerMutationNote(undefined, 'nope')).toBe('nope');
  });

  it('does not rename a blank name', () => {
    render(<BoardOwnerMenu boardId="wb_1" title="Plan" onRenamed={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Board name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('status')).toHaveTextContent('A board name is required.');
    expect(patchMock).not.toHaveBeenCalled();
  });
});
