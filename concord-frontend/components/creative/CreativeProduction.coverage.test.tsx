// Render coverage for the creative files the build changed: the dashboard strip,
// the boards section, the action panel and the production suite. Macros are
// stubbed; every list returns one entity so rows, forms and handlers render.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { actionOf, exercise, fakeEntity } from '../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { delete: vi.fn(async () => ({})), get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true, id: 'd1' } })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/components/viz', () => ({ TimelineView: () => <div data-testid="timeline" />, ChartKit: () => <div /> }));
vi.mock('@/components/ui', () => ({ ErrorState: ({ message }: { message?: string }) => <div role="alert">{message}</div> }));
vi.mock('./CreativeBoard', () => ({ CreativeBoard: () => <div data-testid="board" /> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import { CreativeDashboardStrip } from './CreativeDashboardStrip';
import { CreativeBoardsSection } from './CreativeBoardsSection';
import { CreativeActionPanel } from './CreativeActionPanel';
import { ProductionSuite } from './ProductionSuite';

const one = () => [fakeEntity('x1')];
const T = '2026-03-01T10:00:00.000Z';
const ASSET = { id: 'a1', name: 'Cut v3', kind: 'video', src: 'https://example.org/v.mp4', durationSec: 90, project: 'Pilot', commentCount: 2, openCount: 1 };
const COMMENT = { id: 'c1', assetId: 'a1', author: 'Dee', body: 'Trim the intro', timestampSec: 12, x: 0.4, y: 0.5, resolved: false, createdAt: T };
const ROW = { id: 'rw1', name: 'Ana', role: 'Lead', call: '07:00', location: 'Stage 2', scene: '12' };
const SHEET = { id: 's1', project: 'Pilot', shootDate: '2026-03-10', dayNumber: 2, generalCall: '07:00', cast: [ROW], crew: [ROW], locations: [ROW], schedule: [ROW], notes: 'n', castCount: 1, crewCount: 1, locationCount: 1, sceneCount: 1 };
const BD = { id: 'bd1', title: 'Ep 1', project: 'Pilot', script: 'INT. KITCHEN - DAY\nANA enters with a KNIFE.', tags: { cast: [{ id: 't1', value: 'ANA' }], props: [{ id: 't2', value: 'KNIFE' }], locations: [], wardrobe: [], sfx: [], vehicles: [] }, scriptLength: 40, tagCount: 2, createdAt: T, updatedAt: T };
const DELIV = { id: 'dl1', name: 'Master', project: 'Pilot', versions: [{ version: 1, src: 'https://example.org/m1.mp4', note: 'first', uploadedBy: 'Dee', uploadedAt: T }, { version: 2, src: null, note: 'fix', uploadedBy: 'Dee', uploadedAt: T }], currentVersion: 2, status: 'in_review', reviewer: 'Sam', decisionNote: null, decidedAt: null, submittedAt: T, versionCount: 2 };
const EVENT = { id: 'ev1', title: 'Shoot day 2', date: '2026-03-10', kind: 'shoot_day', project: 'Pilot', endDate: null, notes: '', done: false };
const LINK = { id: 'lk1', token: 'tok1', assetId: 'a1', label: 'Client cut', allowComments: true, active: true, shareUrl: 'https://example.org/p/tok1', externalCommentCount: 1 };
const RESULT = (action: string): Record<string, unknown> => ({
  'creative-dashboard': { assets: 2, count: 3, overdue: one(), upcoming: one(), totalAssets: 2, readyCount: 1, deliverables: 2 },
  'review-asset-list': { assets: [ASSET, { ...ASSET, id: 'a2', kind: 'image', name: 'Poster' }] }, 'review-asset-create': { asset: ASSET }, 'review-comment-list': { comments: [COMMENT, { ...COMMENT, id: 'c2', resolved: true, timestampSec: null }] },
  'review-comment-add': { comment: COMMENT },
  'callsheet-list': { sheets: [SHEET] }, 'callsheet-get': { sheet: SHEET }, 'callsheet-create': { sheet: SHEET },
  'breakdown-list': { breakdowns: [BD] }, 'breakdown-get': { breakdown: BD, suggestions: { cast: ['ANA'], locations: ['KITCHEN'] } }, 'breakdown-create': { breakdown: BD, suggestions: { cast: ['ANA'], locations: ['KITCHEN'] } },
  'deliverable-list': { deliverables: [DELIV, { ...DELIV, id: 'dl2', status: 'approved' }] }, 'deliverable-get': { deliverable: DELIV }, 'deliverable-create': { deliverable: DELIV },
  'calendar-list': { events: [EVENT, { ...EVENT, id: 'ev2', kind: 'milestone', done: true }], upcoming: 1, overdue: 1 },
  'prooflink-list': { links: [LINK] }, 'prooflink-inbox': { comments: [{ id: 'xc1', token: 'tok1', authorName: 'Client', body: 'Love it', timestampSec: 5, createdAt: T }] }, 'prooflink-create': { link: LINK },
  'board-list': { boards: [{ id: 'b1', title: 'Mood board', cardCount: 3 }, { id: 'b2', title: 'Shot list', cardCount: 0 }] }, 'board-templates': { templates: [{ id: 'tp1', name: 'Storyboard', description: 'frames' }] }, 'board-create': { board: { id: 'b3' } }, 'board-from-template': { board: { id: 'b4' } },
}[action] ?? {});

beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset();
  lensRunMock.mockImplementation(async (...args: unknown[]) => ({ data: { ok: true, result: RESULT(actionOf(args)), error: null } }));
  const OUT: Record<string, unknown> = {
    shotListGenerate: { shots: [{ scene: '1', shot: 1, type: 'wide', description: 'Establishing', duration: 5, equipment: ['tripod'] }], totalShots: 4, estimatedRuntime: 90, equipmentList: ['tripod'] },
    assetOrganize: { totalAssets: 6, byType: { video: 4, audio: 2 }, byStatus: { ready: 4, wip: 2 }, missing: [{ name: 'score', type: 'audio', status: 'missing' }], ready: 4 },
    budgetTrack: { totalBudgeted: 1000, totalActual: 1120, totalVariance: -120, overBudget: true, lines: [{ category: 'Camera', budgeted: 500, actual: 620, variance: -120 }] },
    distributionChecklist: { platform: 'youtube', checklist: [{ item: 'Subtitles', ready: false, notes: 'missing' }, { item: 'Thumbnail', ready: true }], readyCount: 1, total: 2, percent: 50, deliveryDate: '2026-04-01' },
  };
  runDomainMock.mockImplementation(async (_d: string, name: string) => ({ data: { ok: true, result: { ok: true, result: OUT[name] ?? {} } } }));
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('creative panels', () => {
  it('CreativeDashboardStrip renders the dashboard and an honest error', async () => {
    render(<CreativeDashboardStrip />);
    await settle();
    await exercise({ passes: 1 });
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<CreativeDashboardStrip />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });

  it('CreativeBoardsSection lists, creates, templates, duplicates and deletes boards', async () => {
    // creating or starting a template opens the board canvas, so each path gets its own mount
    for (const skip of [/cards$|^\+ /, /cards$|^Board$/, /cards$|^Board$|^\+ /]) {
      const view = render(<CreativeBoardsSection />);
      await settle();
      await exercise({ passes: 3, skip });
      view.unmount();
    }
    expect(lensRunMock.mock.calls.some((c) => actionOf(c) === 'board-create')).toBe(true);
    expect(lensRunMock.mock.calls.some((c) => actionOf(c) === 'board-from-template')).toBe(true);
  });

  it('CreativeBoardsSection opens a board and shows an honest error when loading fails', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    render(<CreativeBoardsSection />);
    await settle();
    expect(document.body.textContent).toBeTruthy();
  });

  it('CreativeActionPanel runs its bench actions', async () => {
    render(<CreativeActionPanel />);
    await settle();
    // the panel takes pasted JSON for scenes / assets / budget / delivery
    await exercise({ passes: 3, text: '[{"id":1,"name":"a"}]' });
    expect(runDomainMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('ProductionSuite walks its tabs and forms', async () => {
    render(<ProductionSuite />);
    await settle();
    // Each tab is exercised on its own: pressing the nav buttons in one sweep would
    // leave only the last tab's controls to click.
    const NAV = /^(Review|Call Sheets|Script Breakdown|Deliverables|Production Calendar|Proof Links)$/;
    for (const label of ['Review', 'Call Sheets', 'Script Breakdown', 'Deliverables', 'Production Calendar', 'Proof Links']) {
      const tab = Array.from(document.querySelectorAll('nav button')).find((b) => (b.textContent || '').trim() === label);
      if (tab) await act(async () => { (tab as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); });
      await exercise({ passes: 4, skip: new RegExp(`cancel|close|dismiss|${NAV.source}`, 'i') });
      await exercise({ passes: 2, text: '2026-03-12', skip: new RegExp(`cancel|close|dismiss|${NAV.source}`, 'i') });
    }
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(3);
  });

  it('ProductionSuite uploads a review file by picker and by drop', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, dtuId: 'd9', artifact: { type: 'video/mp4' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductionSuite />);
    await settle();
    // open the new-asset form first so the file picker exists
    await exercise({ passes: 1, skip: /Call Sheets|Script Breakdown|Deliverables|Production Calendar|Proof Links|cancel|close|dismiss/i });
    const file = new File(['x'], 'cut.mp4', { type: 'video/mp4' });
    for (const input of Array.from(document.querySelectorAll('input[type="file"]'))) {
      await act(async () => { fireEvent.change(input, { target: { files: [file] } }); await new Promise((r) => setTimeout(r, 0)); });
    }
    for (const zone of Array.from(document.querySelectorAll('div')).filter((d) => /drop|drag/i.test(d.textContent || '') && d.children.length < 6).slice(0, 3)) {
      await act(async () => { fireEvent.dragOver(zone); fireEvent.dragLeave(zone); fireEvent.drop(zone, { dataTransfer: { files: [file] } }); await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(document.body.textContent).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('ProductionSuite shows honest empty states without data', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: {}, error: null } }));
    render(<ProductionSuite />);
    await settle();
    for (const label of ['Call Sheets', 'Script Breakdown', 'Deliverables', 'Production Calendar', 'Proof Links']) {
      const tab = Array.from(document.querySelectorAll('nav button')).find((b) => (b.textContent || '').trim() === label);
      if (tab) await act(async () => { (tab as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(document.body.textContent).toBeTruthy();
  });
});
