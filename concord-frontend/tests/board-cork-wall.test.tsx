// The Cork Wall: the board list shows yours and the ones shared with you;
// a board opens with its columns and cards; a viewer gets no edit controls;
// adding a card sends board.card-create; a move shows at once and is rolled
// back if refused; a live change from someone else reloads the board and
// says who did what; sharing is by username; My tasks offers the old tasks.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a), api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/board/BoardKeepMenu', () => ({ BoardKeepMenu: () => <div data-testid="keep" /> }));
const handlers = new Map<string, (p: unknown) => void>();
vi.mock('@/lib/realtime/socket', () => ({ subscribe: (ev: string, cb: (p: unknown) => void) => { handlers.set(ev, cb); return () => handlers.delete(ev); } }));

import CorkWall from '@/components/board/wall/CorkWall';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const calls = (a: string) => lensRun.mock.calls.filter((c) => c[1] === a).map((c) => c[2]);
const BOARD = (role = 'owner') => ({
  board: {
    id: 'b1', name: 'Launch', ownerId: 'u-ada', createdAt: '2026-11-01',
    columns: [{ id: 'c1', name: 'To Do' }, { id: 'c2', name: 'Doing' }, { id: 'c3', name: 'Done' }],
    cards: [{ id: 'k1', columnId: 'c1', title: 'Write the brief', description: '', labels: ['copy'], dueDate: null, assignee: 'u-ben', checklist: [{ id: 'i', text: 'x', done: true }], position: 0, createdAt: '2026-11-01' }],
    labelDefs: [{ id: 'l', name: 'copy', color: 'blue' }], automations: [], templates: [],
  },
  role, me: role === 'owner' ? 'u-ada' : 'u-cy',
  members: [{ userId: 'u-ada', name: 'ada', role: 'owner' }, { userId: 'u-ben', name: 'ben', role: 'editor' }, { userId: 'u-cy', name: 'cy', role: 'viewer' }],
});
function server(role = 'owner', extra: (a: string, i: Record<string, unknown>) => unknown = () => undefined) {
  lensRun.mockImplementation((_d: string, a: string, i: Record<string, unknown>) => {
    const x = extra(a, i); if (x) return x;
    if (a === 'board-list') return ok({ boards: [{ id: 'b1', name: 'Launch', columnCount: 3, cardCount: 1, createdAt: '', role, owner: { id: 'u-ada', name: 'ada' }, shared: true }] });
    if (a === 'board-detail') return ok(BOARD(role));
    if (a === 'board-presence') return ok({ here: [{ userId: 'u-ben', name: 'ben', you: false }] });
    return ok({});
  });
}
beforeEach(() => { lensRun.mockReset(); handlers.clear(); });

describe('the wall', () => {
  it('opens the first board with its columns, cards and who is here', async () => {
    server();
    render(<CorkWall />);
    expect(await screen.findAllByTestId('cw-column')).toHaveLength(3);
    expect(screen.getByTestId('cw-card')).toHaveAccessibleName(/Write the brief, for ben/);
    expect(await screen.findByTestId('cw-here')).toHaveTextContent('ben here now');
  });
  it('adding a card sends card-create to that column', async () => {
    server();
    render(<CorkWall />);
    fireEvent.click((await screen.findAllByTestId('cw-add-card'))[1]);
    fireEvent.change(screen.getByTestId('cw-new-card'), { target: { value: 'Book the venue' } });
    fireEvent.keyDown(screen.getByTestId('cw-new-card'), { key: 'Enter' });
    await waitFor(() => expect(calls('card-create')[0]).toEqual({ boardId: 'b1', columnId: 'c2', title: 'Book the venue' }));
  });
  it('a move shows at once and goes back, visibly, if the server refuses', async () => {
    server('owner', (a) => (a === 'card-move' ? Promise.resolve({ data: { ok: false, error: 'you can look at this board, but not change it' } }) : undefined));
    render(<CorkWall />);
    const card = await screen.findByTestId('cw-card');
    fireEvent.keyDown(card, { key: ']' });
    await waitFor(() => expect(calls('card-move')[0]).toEqual({ boardId: 'b1', cardId: 'k1', toColumnId: 'c2', position: 0 }));
    expect(await screen.findByTestId('cw-toast')).toHaveTextContent('Moved back: you can look at this board, but not change it');
    const cols = screen.getAllByTestId('cw-column');
    expect(cols[0]).toHaveTextContent('Write the brief');
  });
  it('a viewer gets no edit controls', async () => {
    server('viewer');
    render(<CorkWall />);
    await screen.findByTestId('cw-card');
    expect(screen.queryByTestId('cw-add-card')).toBeNull();
    expect(screen.getByText(/You can look and comment on this board/)).toBeTruthy();
  });
  it('a live change from someone else reloads the board and says who did what', async () => {
    server();
    render(<CorkWall />);
    await screen.findByTestId('cw-card');
    const before = calls('board-detail').length;
    act(() => { handlers.get('board:changed')!({ boardId: 'b1', by: { id: 'u-ben', name: 'ben' }, words: 'moved', cardTitle: 'Write the brief', toColumn: 'Done' }); });
    expect(await screen.findByTestId('cw-toast')).toHaveTextContent('ben moved "Write the brief" to Done');
    await waitFor(() => expect(calls('board-detail').length).toBe(before + 1));
  });
});

describe('sharing and my tasks', () => {
  it('shares by username with a role', async () => {
    server();
    render(<CorkWall />);
    fireEvent.click(await screen.findByTestId('cw-open-share'));
    fireEvent.change(screen.getByTestId('cw-share-username'), { target: { value: 'dee' } });
    fireEvent.change(screen.getByLabelText('Their role'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByTestId('cw-share-go'));
    await waitFor(() => expect(calls('collaborator-add')[0]).toEqual({ boardId: 'b1', username: 'dee', role: 'viewer' }));
    expect(screen.getByTestId('cw-members')).toHaveTextContent('cy');
  });
  it('My tasks groups your cards and offers to bring in the old ones', async () => {
    lensRun.mockImplementation((_d: string, a: string) => {
      if (a === 'board-list') return ok({ boards: [] });
      if (a === 'my-tasks') return ok({ tasks: [{ boardId: 'b1', boardName: 'Launch', cardId: 'k1', title: 'Write the brief', columnName: 'To Do', dueDate: '2020-01-01', labels: [], assignedToMe: true, done: false, bucket: 'overdue', checklist: { done: 0, total: 0 } }], counts: {}, legacyTasks: 3 });
      if (a === 'import-tasks') return ok({ boardId: 'b9', imported: 3 });
      return ok({});
    });
    render(<CorkWall />);
    expect(await screen.findByTestId('cw-mytask')).toHaveTextContent('Write the brief');
    expect(screen.getByText(/Overdue · 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bring them in' }));
    await waitFor(() => expect(calls('import-tasks')).toHaveLength(1));
    expect(await screen.findByTestId('cw-toast')).toHaveTextContent('Brought in 3 tasks');
  });
});
