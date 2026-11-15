/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * CB-0459 — theme 7 Lighthouse bundle remainder (B3 CB-0436's "later claim").
 *
 * Pins the lens-local legs of seven bundle tickets at branch state:
 *  - FIX-tournaments-005: list card titles are h2 (page h1 → card h2, no skip).
 *  - FIX-kingdoms-004: list card names h2; Dynasty & Realm view titles h2 with
 *    no h4 left under them; the ticket's list-markup leg does not reproduce
 *    from code (every rendered ul's element children are li) — regression pin.
 *  - FIX-wellness-008: the trend + entry-filter selects carry accessible
 *    names and floor-height targets; the five view-level panel titles are h2.
 *  - FIX-world-observatory-005: the world grid is role="group" (not
 *    role="list" over button children); small print renders in slate-400;
 *    export buttons carry the 40px floor class.
 *  - FIX-dx-platform-009: the workbench tab pattern is complete — every tab
 *    has aria-controls, the active panel is a tabpanel labelled by its tab;
 *    tab buttons carry the 40px floor class.
 *  - FIX-cognition-008: question-log small print renders in zinc-400 (AA on
 *    the near-black surface) and the trace action buttons carry the 40px
 *    floor class.
 *  - FIX-database-007: LiveDbClient "Connections" is h2 with a floor-size
 *    new-connection button; AnalysisPanel + ProjectsPanel titles are h2;
 *    DatabaseTable kanban group headers are h3 under the table-name h2.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const { lensRunMock } = vi.hoisted(() => ({ lensRunMock: vi.fn() }));

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    post: async () => ({ ok: true, result: { kingdoms: [], realm: null } }),
    get: async () => ({ ok: true, result: {} }),
    delete: async () => ({ ok: true }),
  },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: ({ title }: { title: string }) => (
    <button type="button">{`Save as DTU: ${title}`}</button>
  ),
}));
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => null }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: () => {} }),
  useRecallableAction: () => ({ run: async (fn: () => unknown) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('recharts', () => ({
  AreaChart: () => null, Area: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, ResponsiveContainer: (p: { children?: React.ReactNode }) => <>{p.children}</>,
  CartesianGrid: () => null,
}));

import { TournamentListPanel } from '@/components/tournaments/TournamentListPanel';
import { KingdomListPanel } from '@/components/kingdoms/KingdomListPanel';
import { DynastyRealmManager } from '@/components/kingdoms/DynastyRealmManager';
import { RealmActionPanel } from '@/components/kingdoms/RealmActionPanel';
import { WellnessSection } from '@/components/wellness/WellnessSection';
import { DailyRecommendationPanel } from '@/components/wellness/DailyRecommendationPanel';
import { SelfFieldsPanel } from '@/components/wellness/SelfFieldsPanel';
import { CBTPanel } from '@/components/wellness/CBTPanel';
import { SessionsPanel } from '@/components/wellness/SessionsPanel';
import { WearableImportPanel } from '@/components/wellness/WearableImportPanel';
import WorldObservatoryPage from '@/app/lenses/world-observatory/page';
import { DxWorkbench } from '@/components/dx-platform/DxWorkbench';
import CognitionPage from '@/app/lenses/cognition/page';
import { LiveDbClient } from '@/components/database/LiveDbClient';
import { AnalysisPanel } from '@/components/database/AnalysisPanel';
import { ProjectsPanel } from '@/components/database/ProjectsPanel';
import { DatabaseTable } from '@/components/database/DatabaseTable';

function envelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function actionOf(args: unknown[]): string {
  const [a, b] = args;
  if (typeof b === 'string') return b;
  if (a && typeof a === 'object' && 'action' in (a as Record<string, unknown>)) {
    return String((a as Record<string, unknown>).action);
  }
  return '';
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(() => Promise.resolve(envelope({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── FIX-tournaments-005 ─────────────────────────────────────────────────────

describe('FIX-tournaments-005 — list heading order', () => {
  it('tournament card titles render as h2 under the page h1', () => {
    render(
      <TournamentListPanel
        tournaments={[{
          id: 't1', title: 'Autumn Brawl', game: 'Valorant', format: 'single_elimination',
          mode: 'solo', teamSize: 1, status: 'upcoming', prizePoolCc: 250,
          entrants: [{}], maxEntrants: 16,
        } as never]}
        counts={{}}
        statusFilter="all"
        onFilter={() => {}}
        onPick={() => {}}
      />,
    );
    const title = screen.getByRole('heading', { name: 'Autumn Brawl' });
    expect(title.tagName).toBe('H2');
  });
});

// ── FIX-kingdoms-004 ────────────────────────────────────────────────────────

const KINGDOM = {
  id: 'k1', name: 'Avalon', world_id: 'tunya', ruler_display_name: 'Queen Mab',
  ruler_faction_id: null, region_polygon: [[0, 0], [1, 1]], claim_strength: 42,
};

describe('FIX-kingdoms-004 — heading order + list markup', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation(() => Promise.resolve(envelope({
      characters: [], marriages: [], ruler: null, kingdoms: [], treaties: [],
      claims: [], wars: [], schemes: [], laws: [], seats: [], members: [],
      events: [], decrees: [],
    })));
  });

  it('kingdom card names render as h2, and every list contains only li children', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, kingdoms: [KINGDOM] }),
    })));
    const { container } = render(<KingdomListPanel onPick={() => {}} />);
    const name = await screen.findByRole('heading', { name: 'Avalon' });
    expect(name.tagName).toBe('H2');
    // List-markup regression pin (the ticket's list leg does not reproduce
    // from code at branch state): no ul/ol may have a non-li element child.
    for (const list of Array.from(container.querySelectorAll('ul, ol'))) {
      for (const child of Array.from(list.children)) {
        expect(child.tagName).toBe('LI');
      }
    }
  });

  it('Dynasty & Realm title is h2 and no h4 remains under it', async () => {
    const { container } = render(<DynastyRealmManager />);
    const title = await screen.findByRole('heading', { name: /Dynasty & Realm/ });
    expect(title.tagName).toBe('H2');
    expect(container.querySelectorAll('h4')).toHaveLength(0);
  });

  it('Realm command title is h2', async () => {
    render(<RealmActionPanel />);
    const title = await screen.findByRole('heading', { name: 'Realm command' });
    expect(title.tagName).toBe('H2');
  });
});

// ── FIX-wellness-008 ────────────────────────────────────────────────────────

function wellnessHandler(...args: unknown[]) {
  const action = actionOf(args);
  switch (action) {
    case 'metrics-list':
      return Promise.resolve(envelope({ metrics: [{ id: 'm_1', type: 'steps', value: 5000, date: '2026-11-10', at: '2026-11-10T00:00:00.000Z', note: '' }] }));
    case 'metrics-trend':
      return Promise.resolve(envelope({ type: 'steps', days: 30, series: [], average: 0, latest: null, min: null, max: null, trend: 'flat' }));
    case 'habits-list': return Promise.resolve(envelope({ habits: [] }));
    case 'mood-list': return Promise.resolve(envelope({ moods: [] }));
    case 'mood-correlate': return Promise.resolve(envelope({ correlations: [] }));
    case 'goals-list': return Promise.resolve(envelope({ goals: [] }));
    case 'workouts-list': return Promise.resolve(envelope({ workouts: [], totalMin: 0, count: 0 }));
    case 'recovery-score': return Promise.resolve(envelope({ score: 0, band: 'red' }));
    case 'wellness-dashboard-summary':
      return Promise.resolve(envelope({ habitCount: 0, habitsDoneToday: 0, workoutsThisWeek: 0, workoutMinThisWeek: 0, avgMoodThisWeek: null, activeGoals: 0, metricEntryCount: 1 }));
    case 'cbt-prompts':
      return Promise.resolve(envelope({ kinds: [{ fieldKind: 'binary_thinking', label: 'Binary thinking', distortion: 'All-or-nothing' }] }));
    case 'cbt-record-list':
      return Promise.resolve(envelope({ total: 0, completed: 0, avgRelief: 0, records: [] }));
    case 'wearable-sync-history':
      return Promise.resolve(envelope({ syncs: [] }));
    case 'daily-recommendation':
      return Promise.resolve(envelope({
        recommendations: [],
        signals: { sleepHours: null, hrvMs: null, restingHr: null, strainMin: 0, mindfulnessSessionsToday: 0, openThoughtRecords: 0 },
      }));
    case 'session-history':
      return Promise.resolve(envelope({ sessions: [] }));
    case 'session-catalogue':
      return Promise.resolve(envelope({ sessions: [], catalogue: [] }));
    default:
      return Promise.resolve(envelope({}));
  }
}

describe('FIX-wellness-008 — select names + panel heading order', () => {
  beforeEach(() => { lensRunMock.mockImplementation(wellnessHandler); });

  it('the trend and entry-filter selects carry accessible names and floor-height targets', async () => {
    render(<WellnessSection />);
    const trend = await screen.findByLabelText('Trend metric');
    expect(trend.tagName).toBe('SELECT');
    expect(trend.className).toContain('min-h-[40px]');
    const filter = screen.getByLabelText('Filter entries by type');
    expect(filter.tagName).toBe('SELECT');
    expect(filter.className).toContain('min-h-[40px]');
  });

  it('view-level panel titles are h2', async () => {
    const panels: Array<[React.ComponentType, string]> = [
      [DailyRecommendationPanel, "Today's recommendation"],
      [SelfFieldsPanel, 'Self-composed fields'],
      [CBTPanel, 'Guided CBT thought records'],
      [SessionsPanel, 'Meditation & breathing'],
      [WearableImportPanel, 'Wearable data import'],
    ];
    for (const [Panel, name] of panels) {
      const { unmount } = render(<Panel />);
      const title = await screen.findByRole('heading', { name });
      expect(title.tagName).toBe('H2');
      unmount();
    }
  });
});

// ── FIX-world-observatory-005 ───────────────────────────────────────────────

describe('FIX-world-observatory-005 — grid role, contrast, targets', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation((_d: unknown, action: unknown) => {
      if (action === 'overview') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              ok: true,
              worlds: [{
                worldId: 'tunya', name: 'Tunya', activeUsers: 12, factionCount: 2,
                realmCount: 1, districtCount: 1, stuckFactionSchedulers: 0, isTestWorld: false,
              }],
            },
            error: null,
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: { ok: true }, error: null } });
    });
  });

  it('the world summary grid is a labelled group of buttons, not a list', async () => {
    render(<WorldObservatoryPage />);
    const grid = await screen.findByRole('group', { name: 'World summary grid' });
    expect(grid).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'World summary grid' })).toBeNull();
    const card = screen.getByRole('button', { name: /Drill into Tunya/ });
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  it('small print renders at AA contrast and export buttons meet the floor', async () => {
    render(<WorldObservatoryPage />);
    const worldId = await screen.findByText('tunya', { selector: 'p' });
    expect(worldId.className).toContain('text-slate-400');
    expect(worldId.className).not.toContain('text-slate-500');
    expect(screen.getByRole('button', { name: 'Export JSON' }).className).toContain('min-h-[40px]');
    expect(screen.getByRole('button', { name: 'Export CSV' }).className).toContain('min-h-[40px]');
  });
});

// ── FIX-dx-platform-009 ─────────────────────────────────────────────────────

describe('FIX-dx-platform-009 — completed tab pattern + tab targets', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'listCodebases') return Promise.resolve(envelope({ codebases: [], count: 0 }));
      return Promise.resolve(envelope({}));
    });
  });

  it('every tab controls a tabpanel labelled by that tab', async () => {
    render(<DxWorkbench />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.length).toBe(7);
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-controls')).toBeTruthy();
      expect(tab.className).toContain('min-h-[40px]');
    }
    const panel = screen.getByRole('tabpanel');
    const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toBeTruthy();
    expect(panel.id).toBe(selected!.getAttribute('aria-controls'));
    expect(panel.getAttribute('aria-labelledby')).toBe(selected!.id);
  });

  it('switching tabs swaps the labelled tabpanel', async () => {
    render(<DxWorkbench />);
    const reviewTab = await screen.findByRole('tab', { name: /PR Review/ });
    fireEvent.click(reviewTab);
    const panel = await screen.findByRole('tabpanel');
    expect(panel.id).toBe('dx-panel-review');
    expect(panel.getAttribute('aria-labelledby')).toBe('dx-tab-review');
  });
});

// ── FIX-cognition-008 ───────────────────────────────────────────────────────

describe('FIX-cognition-008 — contrast + action targets on the question log', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      const action = actionOf(args);
      if (action === 'listExports') {
        return Promise.resolve(envelope({ exports: [{ id: 'e1', title: 'Why is the pod down?' }], count: 1 }));
      }
      if (action === 'getExport') {
        return Promise.resolve(envelope({ export: { id: 'e1', trace: { input: { question: 'Why is the pod down?' } } } }));
      }
      return Promise.resolve(envelope({}));
    });
  });

  it('an open trace renders AA small print and floor-height action buttons', async () => {
    render(<CognitionPage />);
    const stillOpen = await screen.findByText('Still open.');
    expect(stillOpen.className).toContain('text-zinc-400');
    expect(stillOpen.className).not.toContain('text-zinc-500');
    for (const label of ['Edit', 'Mark answered', 'Delete']) {
      expect(screen.getByRole('button', { name: label }).className).toContain('min-h-[40px]');
    }
    const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((h) => Number(h.tagName[1]));
    expect(levels).toEqual([1, 2]);
  });
});

// ── FIX-database-007 ────────────────────────────────────────────────────────

describe('FIX-database-007 — heading order + targets', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      const action = actionOf(args);
      if (action === 'connection-list') return Promise.resolve(envelope({ connections: [] }));
      if (action === 'schema-dashboard') return Promise.resolve(envelope({ schemas: 0, totalTables: 0, totalRelations: 0 }));
      if (action === 'query-history') return Promise.resolve(envelope({ entries: [] }));
      return Promise.resolve(envelope({}));
    });
  });

  it('LiveDbClient: Connections is h2 and the new-connection button meets the floor', async () => {
    render(<LiveDbClient />);
    const title = await screen.findByRole('heading', { name: /Connections/ });
    expect(title.tagName).toBe('H2');
    expect(screen.getByRole('button', { name: 'New connection' }).className).toContain('min-h-[40px]');
  });

  it('AnalysisPanel: Workspace Dashboard is h2', async () => {
    render(<AnalysisPanel />);
    const title = await screen.findByRole('heading', { name: /Workspace Dashboard/ });
    expect(title.tagName).toBe('H2');
  });

  it('ProjectsPanel: Your Projects is h2', async () => {
    render(<ProjectsPanel />);
    const title = await screen.findByRole('heading', { name: /Your Projects/ });
    expect(title.tagName).toBe('H2');
  });

  it('DatabaseTable: kanban group headers are h3 under the table-name h2', async () => {
    const { container } = render(
      <DatabaseTable
        name="Tasks"
        schema={[
          { id: 'title', name: 'Title', type: 'text' },
          { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
        ] as never}
        rows={[{ id: 'r1', data: { title: 'Alpha', status: 'Todo' } }] as never}
        onAddRow={() => {}}
        onUpdateRow={() => {}}
        onDeleteRow={() => {}}
        onAddColumn={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: /Tasks/ }).tagName).toBe('H2');
    const kanbanBtn = container.querySelector('button[title="Kanban"]');
    expect(kanbanBtn).toBeTruthy();
    fireEvent.click(kanbanBtn!);
    const group = await screen.findByRole('heading', { name: /Todo/ });
    expect(group.tagName).toBe('H3');
  });
});
