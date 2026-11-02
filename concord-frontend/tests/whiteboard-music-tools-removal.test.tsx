import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Removal of Whiteboard's two music canvas tools (Section Marker + Audio Pin),
// per the founder disposition 2026-10-29 as scoped by R4's corrected re-pass
// record and the Lead's scope ruling: the object is the two canvas tools +
// their dialogs. The native Arrangement Sketch view stays; pre-existing
// 'section'/'audio' elements keep rendering (ceremonies mint section frames,
// Present walks them; boards keep their pins).

const lensRunMock = vi.fn(async (..._a: unknown[]) => ({ data: { ok: true, result: {} } }));
const createArtifactMock = vi.fn(async () => ({ id: 'art_1' }));
const getBoardMock = vi.fn();

const elements = [
  { id: 'r', type: 'rectangle', x: 10, y: 10, width: 80, height: 40, stroke: '#fff', fill: '#fff', strokeWidth: 2 },
  { id: 'au', type: 'audio', x: 10, y: 280, width: 220, height: 72, clipName: 'clip', duration: 12, playing: false, stroke: '#00d4ff', fill: 'transparent', strokeWidth: 2 },
  { id: 's', type: 'section', x: 420, y: 140, width: 120, height: 56, text: 'Intro', bars: 4, stroke: '#a855f7', fill: '#a855f718', strokeWidth: 2 },
];

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    isError: false,
    error: null,
    refetch: vi.fn(),
    items: [],
    create: (...args: unknown[]) => createArtifactMock(...args),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'ramaj' } }),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    delete: vi.fn(async () => ({ data: { ok: true } })),
    patch: vi.fn(async () => ({ data: { ok: true } })),
  },
  apiHelpers: {
    whiteboard: {
      list: () => Promise.resolve({ data: { whiteboards: [{ id: 'wb_1', title: 'Whiteboard: Plan', elementCount: elements.length }] } }),
      get: (...args: unknown[]) => getBoardMock(...args),
      create: vi.fn(() => Promise.resolve({ data: { ok: true, dtuId: 'wb_new' } })),
      update: vi.fn(async () => ({ data: { ok: true } })),
    },
    dtus: { paginated: () => Promise.resolve({ data: { dtus: [] } }) },
  },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
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
  WhiteboardCreateForm: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>Close create</button>
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
  lensRunMock.mockClear();
  createArtifactMock.mockClear();
  getBoardMock.mockReset();
  getBoardMock.mockResolvedValue({
    data: { ok: true, whiteboard: { id: 'wb_1', title: 'Plan', elements, createdAt: '2026-10-01', updatedAt: '2026-10-02' } },
  });
  HTMLCanvasElement.prototype.getContext = (() => fake2d()) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,xx';
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() { return {}; },
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

async function openBoard() {
  renderStudio();
  await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy());
}

describe('Whiteboard music canvas tools — removed', () => {
  it('the More tools expansion offers no Audio Pin and no Section Marker, and keeps its other tools', async () => {
    await openBoard();
    // The two tools are absent before expansion (they were never primary).
    expect(screen.queryByRole('button', { name: 'Audio Pin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Section Marker' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    // Positive controls: the surviving More-tools entries render.
    expect(screen.getByRole('button', { name: 'Note Card' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reference Pin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Link DTU' })).toBeTruthy();
    // The removed tools do not appear even expanded, and neither dialog exists.
    expect(screen.queryByRole('button', { name: 'Audio Pin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Section Marker' })).toBeNull();
    expect(screen.queryByText('Pin Audio Clip')).toBeNull();
    expect(screen.queryByText('Place Marker')).toBeNull();
    expect(screen.queryByText('Place Pin')).toBeNull();
  });

  it('pre-existing audio and section elements still render into the SVG export', async () => {
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { blobs.push(b); return 'blob:stub'; }) as typeof URL.createObjectURL;
    try {
      await openBoard();
      fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export SVG' }));
      await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
      const svg = await blobs[0].text();
      // The section frame's label and the audio pin's clip name both render.
      expect(svg).toContain('Intro');
      expect(svg).toContain('clip');
    } finally {
      URL.createObjectURL = origCreate;
    }
  });

  it("the board menu's native Arrangement Sketch view still opens", async () => {
    await openBoard();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Arrangement Sketch' }));
    expect(screen.getByText('Arrangement')).toBeTruthy();
  });
});
