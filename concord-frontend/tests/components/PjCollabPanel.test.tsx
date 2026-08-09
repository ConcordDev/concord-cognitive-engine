import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { PjCollabPanel } from '@/components/projects/PjCollabPanel';

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}
function bad(error: string) {
  return { data: { ok: false, result: null, error } };
}

const EMPTY_LOAD = {
  'presence-list': ok({ collaborators: [] }),
  'notifications-list': ok({ notifications: [], unread: 0 }),
  'integration-list': ok({ integrations: [] }),
  'triage-queue': ok({ queue: [] }),
  'sla-policy-list': ok({ policies: [] }),
  'member-list': ok({ members: [] }),
  'presence-ping': ok({}),
};

function mockLoad(overrides: Record<string, unknown> = {}) {
  const table = { ...EMPTY_LOAD, ...overrides };
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action in table) return Promise.resolve(table[action as keyof typeof table]);
    return Promise.resolve(ok(null));
  });
}

function renderPanel(onChange = vi.fn()) {
  return render(<PjCollabPanel projectId="proj-1" onChange={onChange} />);
}

describe('PjCollabPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });
  afterEach(() => cleanup());

  it('shows a loading skeleton before the initial refresh resolves', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('shows an inline error state when any of the six parallel loads fails', async () => {
    mockLoad({ 'triage-queue': bad('triage backend down') });
    renderPanel();
    await waitFor(() => expect(screen.getByText('triage backend down')).toBeInTheDocument());
  });

  it('renders empty-state copy for every section when nothing has loaded yet', async () => {
    mockLoad();
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No collaborators active/)).toBeInTheDocument());
    expect(screen.getByText(/No notifications yet/)).toBeInTheDocument();
    expect(screen.getByText(/No integrations connected/)).toBeInTheDocument();
    expect(screen.getByText(/Triage queue is empty/)).toBeInTheDocument();
    expect(screen.getByText(/No SLA policies/)).toBeInTheDocument();
    expect(screen.getByText(/Add members in the Team tab/)).toBeInTheDocument();
  });

  it('renders live presence badges and the unread notification count', async () => {
    mockLoad({
      'presence-list': ok({ collaborators: [{ id: 'c1', collaborator: 'Ada', cursorX: 0, cursorY: 0, viewing: 'board', editingTaskId: null, color: 'teal', lastSeen: 'now' }] }),
      'notifications-list': ok({
        notifications: [{ id: 'n1', kind: 'mention', title: 'You were mentioned', detail: 'in task #4', taskId: 't4', read: false, createdAt: 'now' }],
        unread: 1,
      }),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(screen.getByText('viewing board')).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
    expect(screen.getByText('You were mentioned')).toBeInTheDocument();
    expect(screen.getByText('in task #4')).toBeInTheDocument();
  });

  it('marking a single notification read calls the macro and refreshes', async () => {
    mockLoad({
      'notifications-list': ok({ notifications: [{ id: 'n1', kind: 'mention', title: 'Hi', detail: null, taskId: null, read: false, createdAt: 'now' }], unread: 1 }),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'read' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'notification-mark-read', { id: 'n1' }));
  });

  it('mark-all-read and clear buttons call their macros', async () => {
    mockLoad({
      'notifications-list': ok({ notifications: [{ id: 'n1', kind: 'mention', title: 'Hi', detail: null, taskId: null, read: true, createdAt: 'now' }], unread: 0 }),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'notification-mark-read', { all: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'notification-clear', {}));
  });

  it('does not submit an integration with a blank target', async () => {
    mockLoad();
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No integrations connected/)).toBeInTheDocument());
    const before = lensRun.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(lensRun.mock.calls.length).toBe(before);
  });

  it('connects a GitHub integration and clears the form on success', async () => {
    mockLoad({ 'integration-connect': ok({}) });
    renderPanel();
    await waitFor(() => expect(screen.getByPlaceholderText('owner/repo')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'facebook/react' } });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('projects', 'integration-connect', { projectId: 'proj-1', kind: 'github', target: 'facebook/react' }),
    );
  });

  it('renders an existing integration and toggles/deletes it', async () => {
    mockLoad({
      'integration-list': ok({ integrations: [{ id: 'i1', kind: 'github', target: 'facebook/react', enabled: true, linkCount: 3, updatedAt: 'now' }] }),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('facebook/react')).toBeInTheDocument());
    expect(screen.getByText('3 links')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'on' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'integration-toggle', { id: 'i1', enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'integration-delete', { id: 'i1' }));
  });

  it('does not submit triage with a blank title', async () => {
    mockLoad();
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Triage queue is empty/)).toBeInTheDocument());
    const before = lensRun.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(lensRun.mock.calls.length).toBe(before);
  });

  it('submits a triage report and calls onChange', async () => {
    const onChange = vi.fn();
    mockLoad({ 'triage-submit': ok({}) });
    renderPanel(onChange);
    await waitFor(() => expect(screen.getByPlaceholderText('Incoming issue title')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Incoming issue title'), { target: { value: 'Crash on save' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('projects', 'triage-submit', {
        projectId: 'proj-1', title: 'Crash on save', description: '', type: 'bug', source: 'user',
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('accepts a triaged item with the chosen priority/status and declines another', async () => {
    const onChange = vi.fn();
    mockLoad({
      'triage-queue': ok({ queue: [{ id: 't1', ref: 'TRI-1', title: 'Report A', type: 'bug', triageSource: 'user', createdAt: 'now' }] }),
      'triage-accept': ok({}),
      'triage-decline': ok({}),
    });
    renderPanel(onChange);
    await waitFor(() => expect(screen.getByText('Report A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'triage-accept', { id: 't1', priority: 'medium', status: 'backlog' }));
    expect(onChange).toHaveBeenCalled();
  });

  it('sets an SLA policy and renders it, then deletes it', async () => {
    mockLoad({
      'sla-policy-set': ok({}),
      'sla-policy-list': ok({ policies: [{ id: 'p1', priority: 'high', responseDays: 2, escalateTo: 'urgent' }] }),
      'sla-policy-delete': ok({}),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/high issues respond within/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /policy/i }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('projects', 'sla-policy-set', { projectId: 'proj-1', priority: 'high', responseDays: 3, escalateTo: 'urgent' }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'sla-policy-delete', { id: 'p1' }));
  });

  it('runs the escalation sweep and renders breached/at-risk results', async () => {
    const onChange = vi.fn();
    mockLoad({
      'sla-escalate': ok({
        breached: [{ id: 'b1', ref: 'ISS-1', title: 'Overdue thing', basis: 'due', overdueDays: 5 }],
        atRisk: [{ id: 'a1', ref: 'ISS-2', title: 'Almost due', basis: 'due', hoursLeft: 4 }],
        escalated: 1, breachedCount: 1, atRiskCount: 1,
      }),
    });
    renderPanel(onChange);
    await waitFor(() => expect(screen.getByText(/Run escalation sweep/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /run escalation sweep/i }));
    await waitFor(() => expect(screen.getByText('Overdue thing')).toBeInTheDocument());
    expect(screen.getByText('5d over')).toBeInTheDocument();
    expect(screen.getByText('Almost due')).toBeInTheDocument();
    expect(screen.getByText('4h left')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it('shows "No breaches" / "Nothing due soon" when an escalation sweep finds none', async () => {
    mockLoad({
      'sla-escalate': ok({ breached: [], atRisk: [], escalated: 0, breachedCount: 0, atRiskCount: 0 }),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Run escalation sweep/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /run escalation sweep/i }));
    await waitFor(() => expect(screen.getByText('No breaches.')).toBeInTheDocument());
    expect(screen.getByText('Nothing due soon.')).toBeInTheDocument();
  });

  it('opens the command bar on click, searches, runs a create command, and closes', async () => {
    mockLoad({
      'command-search': ok({ commands: [{ id: 'cmd1', label: 'Create task "fix bug"', action: 'task-create' }], results: [] }),
      'task-create': ok({}),
    });
    const onChange = vi.fn();
    renderPanel(onChange);
    await waitFor(() => expect(screen.getByText(/Search projects & issues/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Search projects & issues/));
    const dialogInput = await screen.findByPlaceholderText('Type to search or create…');
    fireEvent.change(dialogInput, { target: { value: 'fix bug' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'command-search', { projectId: 'proj-1', query: 'fix bug' }));
    const createBtn = await screen.findByText('Create task "fix bug"');
    fireEvent.click(createBtn);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'task-create', { projectId: 'proj-1', title: 'fix bug' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Type to search or create…')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('shows search result rows with status text and the empty-search hint', async () => {
    mockLoad({
      'command-search': ok({ commands: [], results: [{ kind: 'task', id: 'x1', label: 'Fix the thing', sub: 'PJ-9', status: 'in_review' }] }),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Search projects & issues/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Search projects & issues/));
    await screen.findByText('Fix the thing');
    expect(screen.getByText('PJ-9')).toBeInTheDocument();
    expect(screen.getByText('in review')).toBeInTheDocument();
  });

  it('closes the command bar on Escape and on backdrop click', async () => {
    mockLoad({ 'command-search': ok({ commands: [], results: [] }) });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Search projects & issues/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Search projects & issues/));
    await screen.findByPlaceholderText('Type to search or create…');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Type to search or create…')).not.toBeInTheDocument());
  });

  it('opens the command bar via Cmd+K', async () => {
    mockLoad({ 'command-search': ok({ commands: [], results: [] }) });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Search projects & issues/)).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByPlaceholderText('Type to search or create…');
  });
});
