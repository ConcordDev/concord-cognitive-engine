/**
 * Audit sweep CB-0475 (theme 5 remainder — absent lifecycle exits), FE pins 2:
 *   insurance-012  AmsWorkbench E-Sign tab: Void (in-flight) + Delete (voided)
 *   inheritance-008 WillsPanel: Delete on a non-active will version
 *   fishing-004    CatchLog: Add note → annotate callback; Delete → callback
 *   society-002    AgentBuilder: Edit → agents.updateSchedule; Delete → deleteSchedule
 *   legacy-002     CodebaseScanner: Rename → updateCodebase; Rescan → rescanCodebase
 *   housing-001    MineHousesPanel: Rename → housing.rename; Release → housing.unclaim
 *   history-005    TimelineBuilder: Rename timeline → history.timeline-update
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
}));

// WillsPanel reads a wide estate context; only the will fields drive its
// render, the rest are inert stubs (empty lists render empty states).
const deleteWill = vi.fn(() => Promise.resolve());
vi.mock('@/components/inheritance/EstateContext', () => ({
  useEstate: () => new Proxy({
    wills: [
      { version: 2, title: 'Will two', body: 'body two', kind: 'will', status: 'active', authoredAt: 1700000000000 },
      { version: 1, title: 'Will one', body: 'body one', kind: 'will', status: 'superseded', authoredAt: 1690000000000 },
    ],
    activeWill: null,
    wTitle: '', wBody: '', wKind: 'will',
    inp: 'inp', btn: 'btn',
    authorWill: () => {}, viewWill: () => {}, restoreWill: () => {},
    deleteWill,
    loadAll: () => {}, loadAllRef: { current: null },
  }, {
    get: (t: Record<string, unknown>, k: string) => {
      if (k in t) return t[k];
      if (k.startsWith('set')) return () => {};
      if (k.endsWith('s')) return [];
      return '';
    },
  }),
}));

// TimelineBuilder's sibling views are heavy; the picker + rename row are
// the surface under test.
vi.mock('@/components/history/VisualTimeline', () => ({ VisualTimeline: () => null }));
vi.mock('@/components/history/EventMap', () => ({ EventMap: () => null }));
vi.mock('@/components/history/TimelineCompare', () => ({ TimelineCompare: () => null }));
vi.mock('@/components/history/TimelinePublish', () => ({ TimelinePublish: () => null }));
vi.mock('@/components/history/WikiTimelineImport', () => ({ WikiTimelineImport: () => null }));
vi.mock('@/components/history/EventMediaManager', () => ({ EventMediaManager: () => null }));

import AmsWorkbench from '@/components/insurance/AmsWorkbench';
import { WillsPanel } from '@/components/inheritance/WillsPanel';
import { CatchLog } from '@/components/fishing/CatchLog';
import AgentBuilder from '@/components/world-lens/AgentBuilder';
import { CodebaseScanner } from '@/components/legacy/CodebaseScanner';
import { MineHousesPanel } from '@/components/housing/MineHousesPanel';
import { TimelineBuilder } from '@/components/history/TimelineBuilder';

function reply(result: unknown, ok = true) {
  return Promise.resolve({ data: { ok, result, error: ok ? null : 'nope' } });
}
function callsFor(domain: string, action: string) {
  return lensRun.mock.calls.filter((c) => c[0] === domain && c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); deleteWill.mockClear(); vi.unstubAllGlobals(); });

describe('insurance-012 — envelope void + delete', () => {
  it('an in-flight envelope voids via the sticky confirm; a voided one deletes', async () => {
    const env = {
      id: 'env1', title: 'Application', docType: 'application', status: 'awaiting_signatures',
      signers: [{ name: 'Ann', role: 'applicant', signed: false }], binderIssued: false,
    };
    let current = env;
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'policy-list') return reply({ policies: [] });
      if (action === 'esign-list') return reply({ envelopes: [current] });
      if (action === 'esign-void') { current = { ...env, status: 'voided' }; return reply({ envelopeId: 'env1', status: 'voided' }); }
      if (action === 'esign-delete') return reply({ deleted: 'env1' });
      return reply({});
    });
    render(<AmsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /E-Sign & Binder/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Void envelope Application' }));
    expect(callsFor('insurance', 'esign-void')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm void envelope Application' }));
    await waitFor(() => expect(callsFor('insurance', 'esign-void')).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete envelope Application' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete envelope Application' }));
    await waitFor(() => expect(callsFor('insurance', 'esign-delete')).toHaveLength(1));
  });
});

describe('inheritance-008 — delete a superseded will version', () => {
  it('non-active rows carry Delete; the confirm calls deleteWill(version)', async () => {
    render(<WillsPanel />);
    const arm = await screen.findByRole('button', { name: 'Delete will version 1' });
    fireEvent.click(arm);
    expect(deleteWill).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete will version 1' }));
    expect(deleteWill).toHaveBeenCalledWith(1);
    // The ACTIVE version carries no delete control.
    expect(screen.queryByRole('button', { name: 'Delete will version 2' })).toBeNull();
  });
});

describe('fishing-004 — catch annotate + delete', () => {
  const catches = [{
    id: 'catch1', world_id: 'concordia-hub', item_id: 'raw_fish:trout', item_name: 'Rainbow Trout',
    quantity: 1, acquired_at: 1700000000, meta_json: '{}',
  }];
  it('Add note saves through the annotate callback; Delete arms then fires', async () => {
    const onAnnotateCatch = vi.fn();
    const onDeleteCatch = vi.fn();
    render(
      <CatchLog
        catches={catches} loading={false} reason={null} onRetry={() => {}}
        justCaughtId={null} density="comfortable"
        onDeleteCatch={onDeleteCatch} onAnnotateCatch={onAnnotateCatch}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add note' }));
    fireEvent.change(screen.getByLabelText('Note for Rainbow Trout'), { target: { value: 'personal best' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(onAnnotateCatch).toHaveBeenCalledWith('catch1', 'personal best');

    fireEvent.click(screen.getByRole('button', { name: 'Delete catch Rainbow Trout' }));
    expect(onDeleteCatch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete catch Rainbow Trout' }));
    expect(onDeleteCatch).toHaveBeenCalledWith('catch1');
  });
});

describe('society-002 — agent edit + delete', () => {
  const schedule = {
    id: 'sched1', agentId: 'agent-1', agentName: 'Watcher', kind: 'interval', spec: '60000',
    goal: 'Watch the feed', enabled: true, createdAt: '2026-11-01T00:00:00Z', lastFiredAt: null, fireCount: 0,
  };
  it('Edit saves through updateSchedule; Delete confirms through deleteSchedule', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'listSchedules') return reply({ schedules: [schedule] });
      if (action === 'updateSchedule') return reply({ schedule: { ...schedule, goal: 'New goal' } });
      if (action === 'deleteSchedule') return reply({ deleted: true });
      return reply({});
    });
    render(<AgentBuilder />);
    await screen.findByText('Watcher');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const goal = screen.getByLabelText('Agent goal') as HTMLInputElement;
    expect(goal.value).toBe('Watch the feed');
    fireEvent.change(goal, { target: { value: 'New goal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(callsFor('agents', 'updateSchedule')).toHaveLength(1));
    expect(callsFor('agents', 'updateSchedule')[0][2]).toMatchObject({ id: 'sched1', goal: 'New goal', spec: '60000' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete agent Watcher' }));
    expect(callsFor('agents', 'deleteSchedule')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete agent Watcher' }));
    await waitFor(() => expect(callsFor('agents', 'deleteSchedule')).toHaveLength(1));
  });
});

describe('legacy-002 — codebase rename + rescan in place', () => {
  const cb = {
    id: 'cb1', name: 'old-name', scannedAt: '2026-11-01',
    languages: [{ language: 'COBOL', linesOfCode: 10, pctOfCodebase: 100, legacy: true }],
    summary: { fileCount: 1, totalLinesOfCode: 10, productionFiles: 1, testFiles: 0, testToCodeRatio: 0, avgComplexity: 1, totalTodos: 0, legacyLanguageFiles: 1, avgCommentRatio: 0 },
    files: [],
  };
  it('Rename fires updateCodebase; Rescan fires rescanCodebase with the same id', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'listCodebases') return reply({ codebases: [cb], count: 1 });
      if (action === 'updateCodebase') return reply({ codebase: { ...cb, name: 'renamed' } });
      if (action === 'rescanCodebase') return reply({ codebase: { ...cb, name: 'renamed' }, files: [] });
      return reply({});
    });
    render(<CodebaseScanner />);
    const nameInput = await screen.findByLabelText('Codebase name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(callsFor('legacy', 'updateCodebase')).toHaveLength(1));
    expect(callsFor('legacy', 'updateCodebase')[0][2]).toEqual({ id: 'cb1', name: 'renamed' });

    fireEvent.change(screen.getByLabelText('Rescan source'), { target: { value: '=== a.cob ===\nIDENTIFICATION DIVISION.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rescan in place' }));
    await waitFor(() => expect(callsFor('legacy', 'rescanCodebase')).toHaveLength(1));
    expect(callsFor('legacy', 'rescanCodebase')[0][2]).toMatchObject({ id: 'cb1' });
  });
});

describe('housing-001 — house rename + release', () => {
  it('Rename fires housing.rename; Release confirms into housing.unclaim', async () => {
    const house = {
      id: 'ph1', name: 'Home', world_id: 'tunya', land_claim_id: 'lc1', building_id: 'wb1',
      visibility: 'private', allow_live_visits: 0, rooms: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (url.includes('/api/housing/mine') ? { ok: true, houses: [house] } : { ok: true, house }),
    })));
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'list_for_user') return reply({ claims: [] });
      if (action === 'rename') return reply({ houseId: 'ph1', name: 'Lake House' });
      if (action === 'unclaim') return reply({ houseId: 'ph1', unclaimed: true });
      return reply({});
    });
    render(<MineHousesPanel flash={null} onFlash={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Home/ }));
    const nameInput = await screen.findByLabelText('Name for Home') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Lake House' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(callsFor('housing', 'rename')).toHaveLength(1));
    expect(callsFor('housing', 'rename')[0][2]).toEqual({ houseId: 'ph1', name: 'Lake House' });

    fireEvent.click(screen.getByRole('button', { name: 'Release house Home' }));
    expect(callsFor('housing', 'unclaim')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm release house Home' }));
    await waitFor(() => expect(callsFor('housing', 'unclaim')).toHaveLength(1));
  });
});

describe('history-005 — timeline rename', () => {
  it('the open timeline renames through timeline-update', async () => {
    const tl = { id: 'tl1', title: 'Imported: Rome', description: '', events: [], eras: [] };
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'timeline-list') return reply({ timelines: [{ id: 'tl1', title: 'Imported: Rome', eventCount: 0 }] });
      if (action === 'timeline-detail') return reply({ timeline: tl });
      if (action === 'timeline-update') return reply({ timeline: { ...tl, title: 'Rome, annotated' } });
      return reply({});
    });
    render(<TimelineBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Imported: Rome/ }));
    const input = await screen.findByLabelText('Timeline title') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Imported: Rome'));
    fireEvent.change(input, { target: { value: 'Rome, annotated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename timeline' }));
    await waitFor(() => expect(callsFor('history', 'timeline-update')).toHaveLength(1));
    expect(callsFor('history', 'timeline-update')[0][2]).toEqual({ id: 'tl1', title: 'Rome, annotated' });
  });
});
