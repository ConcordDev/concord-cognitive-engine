// FIX-docs-002 — one click on "New page" + Enter created TWO pages: focus
// stayed on the New page button, so Enter re-clicked it. A freshly created
// page now takes focus in its title field (the standard create flow), so
// Enter commits the title instead. Pins: one create per click, focus in
// the title, and Enter on the title creates nothing.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const PAGE = { id: 'p1', title: 'Roadmap', icon: '🗺️', parentId: null, blocks: [] };
const PAGES = [{ id: 'p1', title: 'Roadmap', icon: '🗺️', parentId: null, blockCount: 0, updatedAt: '2026-03-02T10:00:00Z' }];

function resultFor(action: string, input?: Record<string, unknown>): unknown {
  switch (action) {
    case 'page-list': return { pages: PAGES };
    case 'page-detail': {
      const id = String(input?.id || 'p1');
      return { page: id === 'p3' ? { ...PAGE, id: 'p3', title: 'Untitled' } : PAGE };
    }
    case 'page-create': return { page: { ...PAGE, id: 'p3', title: 'Untitled' } };
    case 'comment-list': return { comments: [], count: 0 };
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
vi.mock('../usePagePresence', () => ({ usePagePresence: () => ({ cursors: [], setFocusedBlock: vi.fn(), focusBlock: vi.fn() }) }));
vi.mock('../TemplatePicker', () => ({ TemplatePicker: () => <div>template-stub</div> }));
vi.mock('../VersionHistoryPanel', () => ({ VersionHistoryPanel: () => <div>versions-stub</div> }));
vi.mock('../CommentsPanel', () => ({ CommentsPanel: () => <div>comments-stub</div> }));
vi.mock('../BacklinksPanel', () => ({ BacklinksPanel: () => <div>backlinks-stub</div> }));
vi.mock('../SharePanel', () => ({ SharePanel: () => <div>share-stub</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DocsWorkspace } from '../DocsWorkspace';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const creates = () => lensRunMock.mock.calls.filter((c) => actionOf(c) === 'page-create').length;

afterEach(() => { cleanup(); });
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>), error: null } }));
});

describe('DocsWorkspace create focus (FIX-docs-002)', () => {
  it('one New page click creates one page and puts focus in its title; Enter there creates nothing', async () => {
    render(<DocsWorkspace />);
    await settle();
    const newBtn = screen.getByTitle('New page');
    await act(async () => { fireEvent.click(newBtn); await new Promise((r) => setTimeout(r, 0)); });
    await settle();
    expect(creates()).toBe(1);
    const title = screen.getByLabelText('Page title') as HTMLInputElement;
    expect(title.value).toBe('Untitled');
    expect(document.activeElement).toBe(title);
    // The walker's second step: pressing Enter now lands on the title
    // field, which blurs/commits — it cannot re-fire the create button.
    await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); await new Promise((r) => setTimeout(r, 0)); });
    await settle();
    expect(creates()).toBe(1);
  });
});
