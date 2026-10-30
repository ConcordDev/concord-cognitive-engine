/**
 * Projects identity surface (Review 4, projects.md F5 — slice S2).
 *
 * Rename/description/dates already rode the project-update macro, and
 * Duplicate is new in this slice; what these tests pin is the wiring:
 * the Settings ▸ Project form actually calls project-update and the
 * new name reaches the switcher, and the header's Duplicate flow calls
 * project-duplicate and lands you on the copy, whose Settings show the
 * citation to its source. lensRun is faked over an in-memory store
 * honouring the real macros' contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

interface Pj {
  id: string; name: string; key: string; color: string; status: string; health: string; archived: boolean;
  description?: string | null; startDate?: string | null; targetDate?: string | null;
  duplicatedFrom?: { projectId: string; name: string; key: string; at: string } | null;
}

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
    if (name === 'project-update') {
      const p = state.projects.find((x) => x.id === params.id);
      if (!p) return { data: { ok: false, error: 'project not found' } };
      if (params.name) p.name = String(params.name);
      if (params.description !== undefined) p.description = (params.description as string) || null;
      if (params.startDate !== undefined) p.startDate = (params.startDate as string) || null;
      if (params.targetDate !== undefined) p.targetDate = (params.targetDate as string) || null;
      return ok({ project: { ...p } });
    }
    if (name === 'project-duplicate') {
      const src = state.projects.find((x) => x.id === params.id);
      if (!src) return { data: { ok: false, error: 'project not found' } };
      const copy: Pj = {
        ...src, id: 'p-copy', archived: false,
        name: (params.name as string) || `${src.name} (copy)`,
        key: (params.key as string) || 'APOL',
        duplicatedFrom: { projectId: src.id, name: src.name, key: src.key, at: '2026-10-29T00:00:00.000Z' },
      };
      state.projects.push(copy);
      return ok({ project: copy, copied: { tasks: 0, relations: 0, members: 0, sprints: 0, milestones: 0 } });
    }
    if (name === 'project-dashboard') return ok(null);
    if (name === 'label-list') return ok({ labels: [], count: 0 });
    if (name === 'custom-field-list') return ok({ fields: [], count: 0 });
    if (name === 'rule-list') return ok({ rules: [], count: 0 });
    if (name === 'template-list') return ok({ templates: [], count: 0 });
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
vi.mock('@/components/projects/PjCollabPanel', () => ({ PjCollabPanel: () => null }));
vi.mock('@/components/projects/PjPortfolioPanel', () => ({ PjPortfolioPanel: () => null }));
vi.mock('@/components/projects/ProjectsKeepMenu', () => ({ ProjectsKeepMenu: () => null }));

import { ProjectsSection } from '@/components/projects/ProjectsSection';

const apollo: Pj = { id: 'p1', name: 'Apollo', key: 'APO', color: 'indigo', status: 'started', health: 'on_track', archived: false };

beforeEach(() => {
  hoisted.state.projects = [{ ...apollo }];
  hoisted.state.calls = [];
});

const callsTo = (name: string) => hoisted.state.calls.filter((c) => c.name === name);

describe('Projects identity — Settings ▸ Project (F5)', () => {
  it('saving a new name, description and dates calls project-update and the switcher follows', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Settings'));
    const nameInput = await screen.findByLabelText('Project name');
    fireEvent.change(nameInput, { target: { value: 'Apollo Renamed' } });
    fireEvent.change(screen.getByLabelText('Project description'), { target: { value: 'The renamed one' } });
    fireEvent.change(screen.getByLabelText('Project target date'), { target: { value: '2026-12-18' } });
    fireEvent.click(screen.getByText('Save project details'));
    await waitFor(() => expect(callsTo('project-update')).toHaveLength(1));
    expect(callsTo('project-update')[0].params).toMatchObject({
      id: 'p1', name: 'Apollo Renamed', description: 'The renamed one', targetDate: '2026-12-18',
    });
    await screen.findByText(/Saved — the new name and dates apply/);
    await waitFor(() => expect(screen.getByLabelText('Close Apollo Renamed')).toBeTruthy());
  });

  it('Duplicate creates the copy, lands on it, and its Settings cite the source', async () => {
    render(<ProjectsSection />);
    await screen.findByText('APO');
    fireEvent.click(screen.getByText('Duplicate'));
    const nameInput = await screen.findByLabelText('Copy name');
    expect((nameInput as HTMLInputElement).value).toBe('Apollo (copy)');
    fireEvent.click(screen.getByText('Create copy'));
    await waitFor(() => expect(callsTo('project-duplicate')).toHaveLength(1));
    expect(callsTo('project-duplicate')[0].params).toMatchObject({ id: 'p1', name: 'Apollo (copy)' });
    await waitFor(() => expect(screen.getByLabelText('Close Apollo (copy)')).toBeTruthy());
    fireEvent.click(screen.getByText('Settings'));
    const citation = await screen.findByText(/Duplicated from/);
    expect(citation.textContent).toContain('APO');
    expect(citation.textContent).toContain('Apollo');
  });
});
