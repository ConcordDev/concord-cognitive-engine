/**
 * Projects lifecycle surface (Review 4, projects.md F1/F3/F14 — slice S1).
 *
 * The domain macros for the full lifecycle (project-archive in both
 * directions, project-delete) predate this surface; what was missing —
 * and what these tests pin — is the wiring: a labelled Delete with a
 * named confirmation, Archive with a confirmation, Restore/Delete for
 * archived projects in Portfolio, and a chip × that only ever
 * deselects (it previously called project-delete: closing a chip
 * silently deleted the project, Review 4's "PR4 Close Test").
 *
 * lensRun is faked over an in-memory project store that honours the
 * real macros' contract (default list excludes archived, archive is a
 * flag, delete removes). The Pj* work panels are mocked away — the
 * lifecycle lives in ProjectsSection + the real PjPortfolioPanel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

interface Pj { id: string; name: string; key: string; color: string; status: string; health: string; archived: boolean }

const hoisted = vi.hoisted(() => {
  const state = {
    projects: [] as Pj[],
    calls: [] as { name: string; params: Record<string, unknown> }[],
  };
  return { state };
});

vi.mock('@/lib/api/client', () => ({
  lensRun: async (_domain: string, name: string, params: Record<string, unknown> = {}) => {
    const { state } = hoisted;
    state.calls.push({ name, params });
    const ok = (result: unknown) => ({ data: { ok: true, result } });
    if (name === 'project-list') {
      const includeArchived = params.includeArchived === true;
      const projects = state.projects
        .filter((p) => includeArchived || !p.archived)
        .map((p) => ({ ...p, taskCount: 0, doneCount: 0, progressPct: 0 }));
      return ok({ projects, count: projects.length });
    }
    if (name === 'project-archive') {
      const p = state.projects.find((x) => x.id === params.id);
      if (!p) return { data: { ok: false, error: 'project not found' } };
      p.archived = params.archived !== false;
      return ok({ id: p.id, archived: p.archived });
    }
    if (name === 'project-delete') {
      const i = state.projects.findIndex((x) => x.id === params.id);
      if (i < 0) return { data: { ok: false, error: 'project not found' } };
      state.projects.splice(i, 1);
      return ok({ deleted: params.id });
    }
    if (name === 'project-dashboard') return ok(null);
    if (name === 'portfolio') {
      const projects = state.projects.map((p) => ({
        id: p.id, name: p.name, key: p.key, status: p.status, health: p.health,
        archived: p.archived, targetDate: null, totalTasks: 0, doneTasks: 0,
        progressPct: 0, points: 0,
      }));
      return ok({ projects, active: projects.filter((p) => !p.archived).length, byHealth: { on_track: 0, at_risk: 0, off_track: 0 } });
    }
    return ok({});
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));
vi.mock('@/components/ui', () => ({
  Skeleton: () => null,
  SkeletonTableRows: () => null,
  ErrorState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock('@/components/projects/PjBoardPanel', () => ({ PjBoardPanel: () => null }));
vi.mock('@/components/projects/PjBacklogPanel', () => ({ PjBacklogPanel: () => null }));
vi.mock('@/components/projects/PjTimelinePanel', () => ({ PjTimelinePanel: () => null }));
vi.mock('@/components/projects/PjSprintsPanel', () => ({ PjSprintsPanel: () => null }));
vi.mock('@/components/projects/PjReportsPanel', () => ({ PjReportsPanel: () => null }));
vi.mock('@/components/projects/PjPlanningPanel', () => ({ PjPlanningPanel: () => null }));
vi.mock('@/components/projects/PjTeamPanel', () => ({ PjTeamPanel: () => null }));
vi.mock('@/components/projects/PjSettingsPanel', () => ({ PjSettingsPanel: () => null }));
vi.mock('@/components/projects/PjCollabPanel', () => ({ PjCollabPanel: () => null }));
vi.mock('@/components/projects/ProjectsKeepMenu', () => ({ ProjectsKeepMenu: () => null }));

import { ProjectsSection } from '@/components/projects/ProjectsSection';

const apollo: Pj = { id: 'p1', name: 'Apollo', key: 'APO', color: 'indigo', status: 'started', health: 'on_track', archived: false };
const beta: Pj = { id: 'p2', name: 'Beta', key: 'BET', color: 'indigo', status: 'planned', health: 'on_track', archived: false };
const old: Pj = { id: 'p3', name: 'Old Relic', key: 'OLD', color: 'indigo', status: 'paused', health: 'at_risk', archived: true };

beforeEach(() => {
  hoisted.state.projects = [{ ...apollo }, { ...beta }, { ...old }];
  hoisted.state.calls = [];
});

const callsTo = (name: string) => hoisted.state.calls.filter((c) => c.name === name);

describe('Projects lifecycle — chip close is a deselect, never a delete (F3)', () => {
  it('closing a chip hides it without calling project-delete, and reopening restores it', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByLabelText('Close Apollo'));
    await waitFor(() => expect(screen.queryByLabelText('Close Apollo')).toBeNull());
    expect(callsTo('project-delete')).toHaveLength(0);
    expect(screen.getByText('Closed:')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Apollo'));
    await waitFor(() => expect(screen.getByLabelText('Close Apollo')).toBeTruthy());
  });
});

describe('Projects lifecycle — archive and delete ask first (F1/F14)', () => {
  it('Archive requires the named confirmation, and cancelling changes nothing', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Archive'));
    await screen.findByText(/leaves the switcher; you can restore it from Portfolio/);
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText(/leaves the switcher/)).toBeNull());
    expect(callsTo('project-archive')).toHaveLength(0);
    expect(screen.getByLabelText('Close Apollo')).toBeTruthy();
  });

  it('confirming Archive archives the active project and it leaves the switcher', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Archive'));
    await screen.findByText(/leaves the switcher/);
    fireEvent.click(screen.getByText('Archive project'));
    await waitFor(() => expect(callsTo('project-archive')).toHaveLength(1));
    expect(callsTo('project-archive')[0].params).toEqual({ id: 'p1', archived: true });
    await waitFor(() => expect(screen.queryByLabelText('Close Apollo')).toBeNull());
  });

  it('Delete requires the named confirmation, then deletes the project', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Delete'));
    await screen.findByText(/Delete “Apollo” for good/);
    expect(callsTo('project-delete')).toHaveLength(0);
    fireEvent.click(screen.getByText('Delete project'));
    await waitFor(() => expect(callsTo('project-delete')).toHaveLength(1));
    expect(callsTo('project-delete')[0].params).toEqual({ id: 'p1' });
    await waitFor(() => expect(screen.queryByLabelText('Close Apollo')).toBeNull());
  });
});

describe('Projects lifecycle — archived projects in Portfolio (F1)', () => {
  it('marks archived rows and restores one back to active', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Portfolio'));
    await screen.findByText('Old Relic');
    expect(screen.getByText('Archived')).toBeTruthy();
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => expect(callsTo('project-archive')).toHaveLength(1));
    expect(callsTo('project-archive')[0].params).toEqual({ id: 'p3', archived: false });
    await waitFor(() => expect(screen.queryByText('Restore')).toBeNull());
  });

  it('deletes an archived project only after the named confirmation', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Portfolio'));
    await screen.findByText('Old Relic');
    // The header carries its own Delete button; the archived row's is last.
    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await screen.findByText(/Delete “Old Relic” for good/);
    expect(callsTo('project-delete')).toHaveLength(0);
    fireEvent.click(screen.getByText('Delete project'));
    await waitFor(() => expect(callsTo('project-delete')).toHaveLength(1));
    expect(callsTo('project-delete')[0].params).toEqual({ id: 'p3' });
    await waitFor(() => expect(screen.queryByText('Old Relic')).toBeNull());
  });
});
