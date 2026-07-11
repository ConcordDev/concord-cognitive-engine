// Wave 4 gap-closure: `integration-link` (server/domains/projects.js
// registerLensAction "integration-link" — attach an external tracker item,
// e.g. a GitHub PR/issue or CI run, to a task) had no caller anywhere,
// distinct from integration-connect/list/toggle/delete which were already
// wired in PjCollabPanel. Pins that PjTaskDetail's new "Link integration"
// control (in the Attachments section, per the existing hint text "Link a
// PR, CI run or Slack thread to any issue from its detail view") calls the
// real macro with the right payload, and renders the CI status the macro
// returns.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { PjTaskDetail } from '@/components/projects/PjTaskDetail';

const baseTask = {
  id: 't1', ref: 'PRJ-1', title: 'Fix the thing', description: '', type: 'bug',
  status: 'in_review', priority: 'high', assigneeId: null, sprintId: null,
  milestoneId: null, parentId: null, labels: [], customFields: {}, points: 0,
  startDate: null, dueDate: null,
};

const baseDetail = {
  task: baseTask, parent: null, subtasks: [], subtaskProgress: null, relations: [],
  attachments: [] as unknown[], comments: [], activity: [],
};

const ciIntegration = { id: 'itg_1', kind: 'ci', target: 'main-pipeline', enabled: true, linkCount: 0, updatedAt: '' };

function mockDefault(detail = baseDetail) {
  lensRun.mockImplementation((domain: string, action: string) => {
    if (domain !== 'projects') return Promise.resolve({ data: { ok: true, result: null } });
    if (action === 'task-detail') return Promise.resolve({ data: { ok: true, result: detail } });
    if (action === 'integration-list') return Promise.resolve({ data: { ok: true, result: { integrations: [ciIntegration], count: 1 } } });
    if (action === 'integration-link') {
      return Promise.resolve({ data: { ok: true, result: {
        link: { id: 'att_1', taskId: 't1', kind: 'integration', integrationKind: 'ci', name: 'build #42', url: 'https://ci.example/42', ciStatus: 'passed', createdAt: '' },
        autoAdvanced: true,
      } } });
    }
    return Promise.resolve({ data: { ok: true, result: null } });
  });
}

describe('PjTaskDetail — integration-link', () => {
  beforeEach(() => lensRun.mockReset());

  it('fetches connected integrations for the project on mount', async () => {
    mockDefault();
    render(<PjTaskDetail taskId="t1" projectId="proj_1" members={[]} sprints={[]} milestones={[]}
      labels={[]} customFields={[]} allTasks={[]} onClose={() => {}} onChange={() => {}} />);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'integration-list', { projectId: 'proj_1' }));
  });

  it('picking a CI integration + entering a URL + Link calls integration-link with the right payload', async () => {
    mockDefault();
    render(<PjTaskDetail taskId="t1" projectId="proj_1" members={[]} sprints={[]} milestones={[]}
      labels={[]} customFields={[]} allTasks={[]} onClose={() => {}} onChange={() => {}} />);

    const select = await screen.findByDisplayValue(/Link integration/i);
    fireEvent.change(select, { target: { value: 'itg_1' } });

    const urlInput = screen.getByPlaceholderText(/PR \/ run \/ thread/i);
    fireEvent.change(urlInput, { target: { value: 'https://ci.example/42' } });
    const labelInput = screen.getByPlaceholderText('Label (optional)');
    fireEvent.change(labelInput, { target: { value: 'build #42' } });

    // CI kind selected → the ciStatus selector should appear, defaulted to "passed".
    expect(screen.getByDisplayValue('passed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Attach$/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'integration-link', {
      taskId: 't1', integrationId: 'itg_1', url: 'https://ci.example/42',
      label: 'build #42', ciStatus: 'passed',
    }));
  });

  it('renders an existing integration attachment with its CI status badge', async () => {
    mockDefault({
      ...baseDetail,
      attachments: [{
        id: 'att_1', name: 'build #42', url: 'https://ci.example/42', kind: 'integration',
        integrationKind: 'ci', ciStatus: 'passed',
      }],
    });
    render(<PjTaskDetail taskId="t1" projectId="proj_1" members={[]} sprints={[]} milestones={[]}
      labels={[]} customFields={[]} allTasks={[]} onClose={() => {}} onChange={() => {}} />);

    expect(await screen.findByText('build #42')).toBeInTheDocument();
    expect(await screen.findByText('passed')).toBeInTheDocument();
  });

  it('the link form is hidden when the project has no connected integrations', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain !== 'projects') return Promise.resolve({ data: { ok: true, result: null } });
      if (action === 'task-detail') return Promise.resolve({ data: { ok: true, result: baseDetail } });
      if (action === 'integration-list') return Promise.resolve({ data: { ok: true, result: { integrations: [], count: 0 } } });
      return Promise.resolve({ data: { ok: true, result: null } });
    });
    render(<PjTaskDetail taskId="t1" projectId="proj_1" members={[]} sprints={[]} milestones={[]}
      labels={[]} customFields={[]} allTasks={[]} onClose={() => {}} onChange={() => {}} />);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'integration-list', { projectId: 'proj_1' }));
    expect(screen.queryByPlaceholderText(/PR \/ run \/ thread/i)).not.toBeInTheDocument();
  });
});
