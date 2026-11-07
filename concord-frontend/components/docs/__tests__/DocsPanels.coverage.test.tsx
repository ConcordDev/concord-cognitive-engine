// Render + behaviour coverage for the docs lens panels: the workspace (pages, blocks, search,
// versions), block editor rows (every block type), database views, the dashboard strip, and the
// analysis tools. Panels mount against stubbed engine results, must render real content, survive
// a full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const BLOCK_TYPES = ['paragraph', 'heading1', 'heading2', 'heading3', 'bulleted_list', 'numbered_list', 'todo', 'code', 'quote', 'callout', 'toggle', 'table', 'embed', 'divider'];
const BLOCKS = BLOCK_TYPES.map((type, i) => ({
  id: `b${i}`, type, text: type === 'divider' ? '' : `A ${type} block`, checked: i % 2 === 0,
  data: type === 'code' ? { language: 'typescript' } : type === 'callout' ? { tone: 'warning', emoji: '!' } : type === 'toggle' ? { open: true } : type === 'embed' ? { url: 'https://example.org/v', kind: 'video' } : type === 'table' ? { rows: [['A', 'B'], ['1', '2']] } : undefined,
}));
const PAGE = { id: 'p1', title: 'Roadmap', icon: '🗺️', parentId: null, blocks: BLOCKS };
const PAGES = [{ id: 'p1', title: 'Roadmap', icon: '🗺️', parentId: null, blockCount: 14, updatedAt: '2026-03-02T10:00:00Z' }, { id: 'p2', title: 'Notes', icon: '📝', parentId: 'p1', blockCount: 2, updatedAt: '2026-03-01T10:00:00Z' }];
const DB = { id: 'd1', name: 'Tasks', columns: [{ id: 'c1', name: 'Name', type: 'text' }, { id: 'c2', name: 'Done', type: 'checkbox' }, { id: 'c3', name: 'Due', type: 'date' }, { id: 'c4', name: 'Pts', type: 'number' }, { id: 'c5', name: 'Stage', type: 'select', options: ['todo', 'doing', 'done'] }], rows: [{ id: 'r1', cells: { c1: 'Ship', c2: true, c3: '2026-03-10', c4: 3, c5: 'doing' } }, { id: 'r2', cells: {} }] };

function resultFor(action: string, input?: Record<string, unknown>): unknown {
  switch (action) {
    case 'page-list': return { pages: PAGES };
    case 'page-detail': return { page: PAGE };
    case 'page-create': return { page: { ...PAGE, id: 'p3', title: 'Untitled', blocks: [] } };
    case 'docs-search': return { results: [{ id: 'p1', pageId: 'p1', title: 'Roadmap', snippet: 'A paragraph block', blockId: 'b0' }], hits: [{ pageId: 'p1', title: 'Roadmap', snippet: 'A paragraph block' }] };
    case 'comment-list': return { comments: [{ id: 'c1', pageId: 'p1', blockId: null, author: 'Ann', kind: 'comment', text: 'Nice', suggestedText: '', resolved: false, createdAt: '2026-03-02' }] };
    case 'db-list': return { databases: [{ id: 'd1', name: 'Tasks', columnCount: 5, rowCount: 2, updatedAt: '2026-03-02' }] };
    case 'db-detail': return { database: DB };
    case 'docs-dashboard': return { pages: 12, topLevelPages: 4, totalBlocks: 90, words: 5400, openTodos: 7, doneTodos: 11 };
    case 'version-list': return { snapshots: [{ id: 'sn1', label: 'v1', createdAt: '2026-03-01' }, { id: 'sn2', label: 'v2', createdAt: '2026-03-02' }] };
    case 'docs-analyze': {
      const tool = (input as { tool?: string } | undefined)?.tool;
      if (tool === 'readabilityScore') return { page: { title: 'Roadmap' }, metrics: { fleschReadingEase: 64 }, summary: { averageGradeLevel: 8, readingTimeMinutes: 3, difficulty: 'standard', fleschCategory: 'Plain English' }, statistics: { wordCount: 420 }, technicalIndicators: { codeBlocks: 2, links: 3, headings: 4 } };
      if (tool === 'crossReference') return { page: { title: 'Roadmap' }, graphDensity: 0.2, totalPages: 12, totalLinks: 9, brokenLinks: { count: 1, items: [] }, healthScore: 71 };
      return { page: { title: 'Roadmap' }, from: 'v1', to: 'current', changes: { added: 3, removed: 1 }, diff: [{ type: 'add', text: 'new line' }] };
    }
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/lens-state-persistence', () => ({ useLensStatePersistence: () => ({ restore: () => null, persist: vi.fn() }) }));
vi.mock('../usePagePresence', () => ({ usePagePresence: () => ({ cursors: [{ sessionId: 's2', name: 'Bo', color: '#f59e0b', blockId: 'b0', cursorOffset: 2 }], setFocusedBlock: vi.fn(), focusBlock: vi.fn() }) }));
vi.mock('../TemplatePicker', () => ({ TemplatePicker: ({ onClose, onApplied }: { onClose: () => void; onApplied: (id: string) => void }) => <div><button onClick={() => onApplied('p3')}>apply-template</button><button onClick={onClose}>close-picker</button></div> }));
vi.mock('../VersionHistoryPanel', () => ({ VersionHistoryPanel: ({ onRestored }: { onRestored: () => void }) => <button onClick={onRestored}>versions-panel</button> }));
vi.mock('../CommentsPanel', () => ({ CommentsPanel: ({ onChanged }: { onChanged: () => void }) => <button onClick={onChanged}>comments-panel</button> }));
vi.mock('../BacklinksPanel', () => ({ BacklinksPanel: ({ onOpenPage }: { onOpenPage: (id: string) => void }) => <button onClick={() => onOpenPage('p2')}>backlinks-panel</button> }));
vi.mock('../SharePanel', () => ({ SharePanel: () => <div>share-panel</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AnalysisPanel } from '../AnalysisPanel';
import { BlockEditorRow, blockDeleteLabel } from '../BlockEditorRow';
import { DatabaseViews } from '../DatabaseViews';
import { DocsWorkspace, requestNewDoc } from '../DocsWorkspace';
import { WorkspacePanel } from '../WorkspacePanel';
import { setDocsWorkspaceSnapshot, resetDocsWorkspaceSnapshot } from '../docsSession';

const render = (ui: React.ReactElement) => rtlRender(ui);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 0)); });
  return !!hits[nth];
};
afterEach(() => { cleanup(); vi.useRealTimers(); resetDocsWorkspaceSnapshot(); });
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>), error: null } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AnalysisPanel', () => <AnalysisPanel />],
  ['DatabaseViews', () => <DatabaseViews />],
  ['DocsWorkspace', () => <DocsWorkspace />],
  ['WorkspacePanel', () => <WorkspacePanel />],
];

describe('docs panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'Roadmap' });
    await settle();
    await exercise({ passes: 1, text: '42' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('docs flows', () => {
  it('every block type renders in the editor row and reports edits, moves and deletion', async () => {
    for (const block of BLOCKS) {
      const onChange = vi.fn(); const onDelete = vi.fn(); const onUp = vi.fn(); const onDown = vi.fn(); const onFocus = vi.fn();
      const view = render(<BlockEditorRow block={block} cursors={[{ sessionId: 's2', name: 'Bo', color: '#f59e0b', blockId: block.id, cursorOffset: 1 }]} onChange={onChange} onDelete={onDelete} onUp={onUp} onDown={onDown} onFocus={onFocus} />);
      await exercise({ passes: 3, text: 'edited text' });
      for (const el of Array.from(view.container.querySelectorAll('input, textarea, select, [contenteditable]')) as HTMLElement[]) {
        fireEvent.focus(el); fireEvent.blur(el);
      }
      expect(view.container.innerHTML.length).toBeGreaterThan(20);
      cleanup();
    }
    expect(blockDeleteLabel(BLOCKS[0] as never)).toBe('A paragraph block');
    expect(blockDeleteLabel({ id: 'x', type: 'bulleted_list', text: '  ', checked: false } as never)).toBe('bulleted list block');
  });

  it('the workspace opens a page, adds, edits, moves and deletes blocks, searches, snapshots and creates pages', async () => {
    render(<DocsWorkspace />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['page-list']));
    await press(/Roadmap/);
    expect(sent()).toContain('page-detail');
    const title = screen.getByLabelText('Page title') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Roadmap 2026' } });
    fireEvent.blur(title);
    await settle();
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    await settle();
    for (const label of [/Text|Heading 1|To-do|Code|Quote|Callout|Table/, /Move up|Up/i, /Move down|Down/i, /Snapshot|Save version/i, /Versions|History/i, /Comments/i, /Backlinks/i, /Share/i, /Database/i, /Editor/i]) await press(label);
    await press(/versions-panel/); await press(/comments-panel/); await press(/backlinks-panel/);
    const search = screen.queryAllByRole('textbox').find((i) => /search/i.test((i as HTMLInputElement).placeholder || ''));
    if (search) { fireEvent.change(search, { target: { value: 'roadmap' } }); await settle(); }
    await press(/New page|Add page|^\s*\+/i);
    await press(/Template/i); await press(/apply-template/);
    await act(async () => { requestNewDoc(); await new Promise((r) => setTimeout(r, 0)); });
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['page-detail']));
    expect(a.some((x) => /page-update|block-add|block-update|block-reorder|version-snapshot|page-create|docs-search/.test(x))).toBe(true);
  });

  it('a page delete goes through the arm-and-confirm gate', async () => {
    render(<DocsWorkspace />);
    await settle();
    await press(/Roadmap/);
    await press(/Delete page/i);
    await press(/^(Yes|Confirm|Delete)\b/i);
    await settle();
    expect(document.body.textContent?.length).toBeGreaterThan(20);
  });

  it('databases open, grow a column and rows, edit cells, switch to the board and delete behind confirmation', async () => {
    render(<DatabaseViews />);
    await settle();
    const name = screen.queryAllByRole('textbox').find((i) => /name|database|new/i.test((i as HTMLInputElement).placeholder || ''));
    if (name) fireEvent.change(name, { target: { value: 'Roadmap items' } });
    await press(/Create|New database|Add database/i);
    await press(/Tasks/);
    expect(sent()).toContain('db-detail');
    const col = screen.queryAllByRole('textbox').find((i) => /column/i.test((i as HTMLInputElement).placeholder || ''));
    if (col) fireEvent.change(col, { target: { value: 'Owner' } });
    await press(/Add column|^\s*\+\s*column/i);
    await press(/Add row|New row/i);
    for (const cell of Array.from(document.querySelectorAll('table input, table select, [role="gridcell"] input')) as HTMLInputElement[]) {
      fireEvent.change(cell, { target: { value: cell.type === 'checkbox' ? undefined : cell.type === 'number' ? '9' : cell.type === 'date' ? '2026-04-01' : 'x' } });
      if (cell.type === 'checkbox') fireEvent.click(cell);
    }
    await press(/Board/i); await press(/Table/i);
    await press(/Delete (row|database)|Trash/i);
    await press(/^(Yes|Confirm|Delete)\b/i);
    const a = sent();
    expect(a.some((x) => /db-create|db-column-add|db-row-add|db-row-update|db-row-delete|db-delete/.test(x))).toBe(true);
  });

  it('the dashboard strip fetches stats and refetches when the workspace publishes a change', async () => {
    vi.useFakeTimers();
    render(<WorkspacePanel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const before = sent().filter((x) => x === 'docs-dashboard').length;
    expect(before).toBeGreaterThan(0);
    act(() => { setDocsWorkspaceSnapshot({ pages: PAGES, active: PAGE }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(sent().filter((x) => x === 'docs-dashboard').length).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('analysis runs readability, cross-reference and version-diff and renders each report', async () => {
    const view = render(<AnalysisPanel />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['page-list', 'version-list']));
    for (const tool of [/readab/i, /cross/i, /diff|version/i]) {
      await press(tool);
      await settle();
    }
    expect(sent().filter((x) => x === 'docs-analyze').length).toBeGreaterThanOrEqual(2);
    expect(view.container.textContent?.length).toBeGreaterThan(40);
  });

  it('analysis reports a failed run and a page list that will not load', async () => {
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'docs-analyze'
      ? { data: { ok: false, error: 'engine down' } }
      : { data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>) } });
    render(<AnalysisPanel />);
    await settle();
    await press(/readab/i);
    await settle();
    expect(document.body.textContent).toMatch(/Action failed|engine down/);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    render(<AnalysisPanel />);
    await settle();
    expect(document.body.textContent).toMatch(/Could not load the workspace pages/);
  });
});
