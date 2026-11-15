/**
 * SLICE B7 premise exercise — FIX-defense-002.
 * The walk reported: one Delete click, hard reload, the mission remains.
 * This drives the surface exactly as a user does: the row's delete is a
 * two-step named confirm (the platform shape) — arm, then Delete — and
 * asserts the verb fires and the row leaves the plan.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { MissionPlanner } from '@/components/defense/MissionPlanner';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

interface Task { id: string; name: string; phase: string; owner: string; status: string; durationHours: number; dependsOn: string[]; startOffset: number }
let tasks: Task[];
let calls: string[];

beforeEach(() => {
  lensRun.mockReset();
  calls = [];
  tasks = [{ id: 't1', name: 'qa-zt2-defense-2026-11-12-missions', phase: 'shaping', owner: '', status: 'planned', durationHours: 24, dependsOn: [], startOffset: 0 }];
  lensRun.mockImplementation(async (_d: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push(action);
    if (action === 'mission-plan') {
      return ok({ tasks: tasks.map((t) => ({ ...t, earliestStart: 0, finish: t.durationHours })), phases: [], criticalPath: [], blocked: [], totalDurationHours: 24, completionPct: 0 });
    }
    if (action === 'mission-task-delete') {
      tasks = tasks.filter((t) => t.id !== input.id);
      return ok({ deleted: input.id });
    }
    return ok({});
  });
});

describe('FIX-defense-002 — mission delete, driven as a user drives it', () => {
  it('arm names the record; confirming fires mission-task-delete and the row leaves', async () => {
    render(<MissionPlanner />);
    // The name renders in the row and on the timeline — presence is plural.
    expect((await screen.findAllByText('qa-zt2-defense-2026-11-12-missions')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    // The arm step names the exact record before anything is destroyed.
    expect(await screen.findByText('Delete task "qa-zt2-defense-2026-11-12-missions"?')).toBeTruthy();
    expect(calls).not.toContain('mission-task-delete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toContain('mission-task-delete'));
    await waitFor(() => expect(screen.queryAllByText('qa-zt2-defense-2026-11-12-missions')).toHaveLength(0));
    expect(await screen.findByText('Deleted task — qa-zt2-defense-2026-11-12-missions')).toBeTruthy();
  });
});
