// Behavior test for AgentRuntime's "Task Definitions" tab — the Wave 4 fix
// closing docs/WAVE4_INVENTORY.md line 87 / agents-capability-map.md
// ("routeTask's requiredSkills input has no UI to author a task definition
// — ranking ignores skill filters"). Pins: empty state, listing a saved
// definition's skills/priority, name-required validation, the real
// create → reload round trip (chip-entered skills reach
// createTaskDefinition's params), a backend rejection surfacing instead of
// silently clearing the form, and the delete → reload round trip.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
// AgentRuntime pulls in tree/timeline/chart viz components used by other
// tabs (Run Loop / Budgets) — stub them so this file doesn't drag in
// canvas/layout rendering jsdom can't provide. Not exercised by the Task
// Definitions tab itself.
vi.mock('@/components/viz', () => ({
  TreeDiagram: () => null,
  TimelineView: () => null,
  ChartKit: () => null,
}));

import { AgentRuntime } from '@/components/agents/AgentRuntime';

const EMPTY_OVERVIEW = {
  totalRuns: 0, completed: 0, halted: 0, totalTokensSpent: 0,
  activeSchedules: 0, totalSchedules: 0, graphCount: 0,
  budgetedAgents: 0, threadCount: 0, recentRuns: [],
};

type TaskDef = { id: string; name: string; requiredSkills: string[]; priority: string; description: string; createdAt: string };
type Override = (input?: Record<string, unknown>) => Promise<{ data: { ok: boolean; result: unknown; error?: string } }>;

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

/**
 * Arms the mocked lensRun. Every action AgentRuntime's default ('runs') tab
 * plus the header's runtime-overview call rely on gets a safe default
 * (EMPTY_OVERVIEW / empty runs), so tests that only care about the Task
 * Definitions tab don't have to restate them — and reassigning `overrides`
 * mid-test (e.g. after a create/delete) can't accidentally starve the
 * overview call of a valid shape and crash the header's `.toLocaleString()`.
 */
function mockLensRun(overrides: Record<string, Override> = {}, taskDefs: TaskDef[] = []) {
  lensRun.mockImplementation((_domain: string, action: string, input?: Record<string, unknown>) => {
    if (overrides[action]) return overrides[action](input);
    switch (action) {
      case 'runtimeOverview': return ok(EMPTY_OVERVIEW);
      case 'listRuns': return ok({ runs: [] });
      case 'listTaskDefinitions': return ok({ taskDefinitions: taskDefs, total: taskDefs.length });
      default: return ok({});
    }
  });
}

async function openTaskDefinitionsTab() {
  render(<AgentRuntime agents={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: /Task Definitions/i }));
  // Wait for the tab's own listTaskDefinitions call to settle before acting.
  await waitFor(() => expect(lensRun).toHaveBeenCalledWith('agents', 'listTaskDefinitions', {}));
}

describe('AgentRuntime — Task Definitions tab', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the empty state when there are no saved task definitions', async () => {
    mockLensRun();
    await openTaskDefinitionsTab();
    expect(await screen.findByText(/No task definitions yet/i)).toBeInTheDocument();
  });

  it('lists a saved task definition with its skills, priority and description', async () => {
    mockLensRun({}, [
      { id: 'td1', name: 'Parse logs', requiredSkills: ['python', 'regex'], priority: 'high', description: 'Nightly log sweep', createdAt: '2026-01-01' },
    ]);
    await openTaskDefinitionsTab();
    const nameEl = await screen.findByText('Parse logs');
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByText('regex')).toBeInTheDocument();
    expect(screen.getByText('Nightly log sweep')).toBeInTheDocument();
    // "high" also appears as a <select> option in the create form on the
    // same screen — scope to this definition's card so the assertion is
    // unambiguous about which "high" it means.
    const card = nameEl.closest('div')?.parentElement as HTMLElement;
    expect(within(card).getByText('high')).toBeInTheDocument();
  });

  it('a definition with no required skills renders the "no skill requirement" hint, not an empty chip row', async () => {
    mockLensRun({}, [
      { id: 'td2', name: 'Freeform task', requiredSkills: [], priority: 'normal', description: '', createdAt: '2026-01-01' },
    ]);
    await openTaskDefinitionsTab();
    expect(await screen.findByText('Freeform task')).toBeInTheDocument();
    expect(screen.getByText(/no skill requirement/i)).toBeInTheDocument();
  });

  it('rejects creating a task definition with no name and never calls the backend', async () => {
    mockLensRun();
    await openTaskDefinitionsTab();
    const callsBefore = lensRun.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Save task definition/i }));
    expect(await screen.findByText(/Task name required/i)).toBeInTheDocument();
    // No new lensRun call was made for the rejected submit.
    expect(lensRun.mock.calls.length).toBe(callsBefore);
  });

  it('creates a task definition with a name and chip-entered skills, then the list reflects it', async () => {
    mockLensRun();
    await openTaskDefinitionsTab();

    fireEvent.change(screen.getByPlaceholderText(/Task name/i), { target: { value: 'Train a model' } });
    const skillInput = screen.getByPlaceholderText(/Add a skill, press Enter/i);
    fireEvent.change(skillInput, { target: { value: 'python' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    fireEvent.change(skillInput, { target: { value: 'ml' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });

    // Both skill chips are staged in the form before saving.
    expect(await screen.findByText('python')).toBeInTheDocument();
    expect(screen.getByText('ml')).toBeInTheDocument();

    // Arm the mock for the save: createTaskDefinition succeeds, and the
    // panel's post-save reload (listTaskDefinitions) now returns the new
    // definition — proving the round trip, not just that a call happened.
    mockLensRun({
      createTaskDefinition: (input) => ok({ taskDefinition: { id: 'td-new', createdAt: '2026-01-01', ...input } }),
    }, [{ id: 'td-new', name: 'Train a model', requiredSkills: ['python', 'ml'], priority: 'normal', description: '', createdAt: '2026-01-01' }]);

    fireEvent.click(screen.getByRole('button', { name: /Save task definition/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'agents',
      'createTaskDefinition',
      expect.objectContaining({ name: 'Train a model', requiredSkills: ['python', 'ml'], priority: 'normal' }),
    ));

    // The saved-definitions list re-renders with the round-tripped result.
    expect(await screen.findByText('Train a model')).toBeInTheDocument();
  });

  it('surfaces a backend rejection instead of silently clearing the form', async () => {
    mockLensRun();
    await openTaskDefinitionsTab();
    fireEvent.change(screen.getByPlaceholderText(/Task name/i), { target: { value: 'Will fail' } });

    mockLensRun({
      createTaskDefinition: () => Promise.resolve({ data: { ok: false, result: null, error: 'name required' } }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Save task definition/i }));
    expect(await screen.findByText(/name required/i)).toBeInTheDocument();
    // The name the user typed is still there — the form was not cleared on failure.
    expect(screen.getByDisplayValue('Will fail')).toBeInTheDocument();
  });

  it('deletes a task definition and the list no longer shows it', async () => {
    mockLensRun({}, [
      { id: 'td1', name: 'Doomed task', requiredSkills: [], priority: 'normal', description: '', createdAt: '2026-01-01' },
    ]);
    await openTaskDefinitionsTab();
    expect(await screen.findByText('Doomed task')).toBeInTheDocument();

    mockLensRun({
      deleteTaskDefinition: (input) => { expect(input).toEqual({ id: 'td1' }); return ok({ deleted: true }); },
    }, []);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('agents', 'deleteTaskDefinition', { id: 'td1' }));
    expect(await screen.findByText(/No task definitions yet/i)).toBeInTheDocument();
  });
});
