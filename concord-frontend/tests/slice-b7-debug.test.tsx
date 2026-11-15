/**
 * SLICE B7 pins — the debug delete-confirm trio + release edit.
 * FIX-debug-001 (issue delete) · FIX-debug-002 (alert-rule delete) ·
 * FIX-debug-006 (release delete + release edit). Each delete was a
 * single click behind a trash icon; each now stands behind the
 * platform two-step confirm, and the confirm is what fires the verb.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { IssueInbox } from '@/components/debug/IssueInbox';
import { MetricsAndAlerts } from '@/components/debug/MetricsAndAlerts';
import { ReleaseTracker } from '@/components/debug/ReleaseTracker';
import { DebugProjectProvider } from '@/components/debug/ProjectContext';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}
function norm(args: unknown[]): { action: string; input: Record<string, unknown> } {
  if (typeof args[0] === 'string') return { action: String(args[1]), input: (args[2] as Record<string, unknown>) || {} };
  const o = args[0] as { action: string; input?: Record<string, unknown> };
  return { action: o.action, input: o.input || {} };
}
let calls: Array<{ action: string; input: Record<string, unknown> }>;
function install(handler: (action: string, input: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation(async (...args: unknown[]) => {
    const { action, input } = norm(args);
    calls.push({ action, input });
    const r = handler(action, input);
    return r === undefined ? ok({}) : r;
  });
}

beforeEach(() => { lensRun.mockReset(); calls = []; });

describe('FIX-debug-001 — issue delete confirms first', () => {
  it('arming does not delete; confirming fires issue-delete', async () => {
    const issue = { id: 'i1', fingerprint: 'fp1', type: 'error', message: 'Boom', culprit: 'app.js', level: 'error', status: 'open', assignee: null, regressed: false, count: 3, releases: [], firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-02T00:00:00Z', breadcrumbs: [], stack: '' };
    install((action) => {
      if (action === 'issue-list') return ok({ issues: [issue], summary: { open: 1, resolved: 0, ignored: 0 } });
      if (action === 'release-list') return ok({ releases: [] });
      return ok({});
    });
    render(<DebugProjectProvider><IssueInbox /></DebugProjectProvider>);
    expect(await screen.findByText('Boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete' })).toBeTruthy();
    expect(calls.some((c) => c.action === 'issue-delete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'issue-delete' && c.input.id === 'i1')).toBe(true));
  });
});

describe('FIX-debug-002 — alert-rule delete confirms first', () => {
  it('arming does not delete; confirming fires alert-delete', async () => {
    const rule = { id: 'rule_1', name: 'CPU hot', metricName: 'cpu', kind: 'above', threshold: 90, enabled: true, state: 'ok', triggerCount: 0, lastValue: null, createdAt: '2026-11-01T00:00:00Z' };
    install((action) => {
      if (action === 'alert-list') return ok({ rules: [rule] });
      if (action === 'metric-list') return ok({ metrics: [] });
      return ok({});
    });
    render(<DebugProjectProvider><MetricsAndAlerts /></DebugProjectProvider>);
    expect(await screen.findByText('CPU hot')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete' })).toBeTruthy();
    expect(calls.some((c) => c.action === 'alert-delete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'alert-delete' && c.input.id === 'rule_1')).toBe(true));
  });
});

describe('FIX-debug-006 — release edit + delete confirm', () => {
  const release = { id: 'rel_1', version: 'v1.0', environment: 'production', notes: 'first', deployedBy: 'u1', deployedAt: '2026-11-01T00:00:00Z', issueCount: 0, occurrenceCount: 0, newIssues: 0, regressions: 0, openIssues: 0, crashFree: true };
  it('Edit saves through release-update; delete confirms first', async () => {
    install((action) => {
      if (action === 'release-list') return ok({ releases: [release], count: 1, projectId: 'p1' });
      return ok({});
    });
    render(<DebugProjectProvider><ReleaseTracker /></DebugProjectProvider>);
    // The version renders in the row and on the timeline — presence is plural.
    expect((await screen.findAllByText('v1.0')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Edit release v1.0' }));
    fireEvent.change(await screen.findByLabelText('Edit release version'), { target: { value: 'v1.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const upd = calls.find((c) => c.action === 'release-update');
      expect(upd).toBeTruthy();
      expect(upd!.input.id).toBe('rel_1');
      expect(upd!.input.version).toBe('v1.1');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete' })).toBeTruthy();
    expect(calls.some((c) => c.action === 'release-delete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'release-delete' && c.input.id === 'rel_1')).toBe(true));
  });
});
