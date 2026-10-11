import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const deleteMock = vi.fn();
const patchMock = vi.fn();
const updateMock = vi.fn();

const elements = [
  { id: 'r', type: 'rectangle', x: 10, y: 10, width: 80, height: 40, stroke: '#fff', fill: '#fff', strokeWidth: 2 },
  { id: 'e', type: 'ellipse', x: 100, y: 10, width: 80, height: 40, stroke: '#fff', fill: 'transparent', strokeWidth: 2 },
  { id: 'l', type: 'line', x: 10, y: 80, width: 70, height: 20, stroke: '#fff', fill: 'transparent', strokeWidth: 2 },
  { id: 'a', type: 'arrow', x: 100, y: 80, width: 70, height: 20, stroke: '#fff', fill: 'transparent', strokeWidth: 2 },
  { id: 'f', type: 'freehand', x: 0, y: 0, points: [{ x: 1, y: 1 }, { x: 8, y: 8 }, { x: 12, y: 4 }], stroke: '#fff', fill: 'transparent', strokeWidth: 2 },
  { id: 't', type: 'text', x: 10, y: 140, width: 80, height: 24, text: 'hello', stroke: '#fff', fill: 'transparent', strokeWidth: 2 },
  { id: 'd', type: 'dtu', x: 10, y: 180, width: 200, height: 80, dtuId: 'dtu_abcdefghijkl', dtuTitle: 'Note', stroke: '#a855f7', fill: 'transparent', strokeWidth: 2 },
  { id: 'au', type: 'audio', x: 10, y: 280, width: 220, height: 72, clipName: 'clip', duration: 12, playing: false, stroke: '#00d4ff', fill: 'transparent', strokeWidth: 2 },
  { id: 'au2', type: 'audio', x: 240, y: 280, width: 220, height: 72, clipName: 'live', duration: 4, playing: true, stroke: '#00d4ff', fill: 'transparent', strokeWidth: 2 },
  { id: 'im', type: 'image', x: 240, y: 10, width: 160, height: 160, imageLabel: 'shot', stroke: '#f59e0b', fill: 'transparent', strokeWidth: 2 },
  { id: 'n', type: 'notecard', x: 420, y: 10, width: 180, height: 100, text: 'a few words that wrap the card please now', cardColor: '#fbbf24', stroke: '#fbbf24', fill: 'transparent', strokeWidth: 2 },
  { id: 's', type: 'section', x: 420, y: 140, width: 120, height: 56, text: 'Intro', bars: 4, stroke: '#a855f7', fill: '#a855f718', strokeWidth: 2 },
];

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    isError: false,
    error: null,
    refetch: vi.fn(),
    items: [],
    create: vi.fn(async () => ({ id: 'art_1' })),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'ramaj' } }),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    delete: (...args: unknown[]) => deleteMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
  },
  apiHelpers: {
    whiteboard: {
      list: () => Promise.resolve({ data: { whiteboards: [{ id: 'wb_1', title: 'Whiteboard: Plan', elementCount: elements.length }] } }),
      get: () => Promise.resolve({
        data: { ok: true, whiteboard: { id: 'wb_1', title: 'Plan', elements, createdAt: '2026-10-01', updatedAt: '2026-10-02' } },
      }),
      create: () => Promise.resolve({ data: { ok: true, dtuId: 'wb_new' } }),
      update: (...args: unknown[]) => updateMock(...args),
    },
    dtus: { paginated: () => Promise.resolve({ data: { dtus: [{ id: 'dtu_1', title: 'Linked', tier: 'regular', tags: ['note'] }] } }) },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

vi.mock('@/components/whiteboard/WhiteboardWorkbench', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>Workbench open</div> : null),
}));
vi.mock('@/components/whiteboard/WhiteboardInspector', () => ({
  WhiteboardInspector: () => <div>Inspector</div>,
}));
vi.mock('@/components/whiteboard/WhiteboardMoodboardPanel', () => ({
  WhiteboardMoodboardPanel: () => <div>Moodboard</div>,
}));
vi.mock('@/components/whiteboard/WhiteboardArrangementPanel', () => ({
  WhiteboardArrangementPanel: () => <div>Arrangement</div>,
}));
vi.mock('@/components/whiteboard/WhiteboardCreateForm', () => ({
  WhiteboardCreateForm: ({ onCreate, onClose }: { onCreate: (d: { title: string; linkedDtus: string[] }) => void; onClose: () => void }) => (
    <div>
      <button type="button" onClick={() => onCreate({ title: 'Fresh', linkedDtus: [] })}>Create board</button>
      <button type="button" onClick={onClose}>Close create</button>
    </div>
  ),
}));
vi.mock('@/components/whiteboard/WhiteboardKeepMenu', () => ({
  WhiteboardKeepMenu: () => <div>Keep</div>,
}));
vi.mock('@/components/dtu/DTUDetailView', () => ({
  DTUDetailView: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>Close DTU</button>,
}));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (props: { value?: string; onChange?: (v: string) => void }) => (
    <textarea aria-label="draft" value={props.value || ''} onChange={(e) => props.onChange?.(e.target.value)} />
  ),
}));

import { WhiteboardStudio } from '@/components/whiteboard/WhiteboardStudio';

function fake2d() {
  const grad = { addColorStop() {} };
  const fn = () => {};
  return new Proxy({
    createLinearGradient: () => grad,
    measureText: () => ({ width: 40 }),
  }, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return fn;
    },
    set() { return true; },
  });
}

beforeEach(() => {
  deleteMock.mockReset();
  patchMock.mockReset();
  updateMock.mockReset();
  updateMock.mockResolvedValue({ data: { ok: true } });
  deleteMock.mockResolvedValue({ data: { ok: true, deleted: true } });
  patchMock.mockResolvedValue({ data: { ok: true } });
  HTMLCanvasElement.prototype.getContext = (() => fake2d()) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,xx';
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() { return {}; },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
  if (typeof ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  }
});

function renderStudio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WhiteboardStudio workbenchOpen={false} onWorkbenchOpen={vi.fn()} onWorkbenchClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('WhiteboardStudio owner actions', () => {
  it('opens a saved board, renames it, and deletes it', async () => {
    renderStudio();
    await waitFor(() => expect(screen.getByRole('button', { name: /Plan/ })).toBeTruthy());
    expect(screen.getByText(/Sketch it, Ramaj/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'Plan v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Renamed to Plan v2.'));
    expect(patchMock).toHaveBeenCalledWith('/api/whiteboard/wb_1', { title: 'Plan v2' });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete board' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/api/whiteboard/wb_1'));
    await waitFor(() => expect(screen.getByText(/Start a board and sketch/)).toBeTruthy());
  });

  it('draws, switches tools, and exports the board that was read back', async () => {
    renderStudio();
    await waitFor(() => {
      expect(document.querySelector('canvas')).toBeTruthy();
    });
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    fireEvent.mouseDown(canvas, { clientX: 30, clientY: 30, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 90, clientY: 80, button: 0 });
    fireEvent.mouseUp(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    fireEvent.mouseDown(canvas, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 55, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 70, clientY: 60, button: 0 });
    fireEvent.mouseUp(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 20, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseUp(canvas);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.keyDown(window, { key: 'v' });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stroke width 4' }));
    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export PNG' }));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export SVG' }));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy JSON' }));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show grid' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show analyze & collab' }));
    expect(screen.getByText('Inspector')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Moodboard' }));
    expect(screen.getAllByText('Moodboard').length).toBeGreaterThan(0);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Arrangement Sketch' }));
    expect(screen.getByText('Arrangement')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close create' }));
    fireEvent.doubleClick(canvas, { clientX: 40, clientY: 200 });
  });
});
