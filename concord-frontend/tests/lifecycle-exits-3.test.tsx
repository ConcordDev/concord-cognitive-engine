/**
 * CB-0521 FE pins — lifecycle exits third leg + find controls.
 * FIX-security-010 (SOC rule edit) · FIX-debug-004 (IssueInbox sort) ·
 * FIX-fork-011 (RepoWatchlist feed history) · FIX-logistics-009
 * (Shipments search/filter) · FIX-security-006 (Advisories search/sort) ·
 * FIX-self-016 (reading history filter/search/sort).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { SOCConsole } from '@/components/security/SOCConsole';
import { IssueInbox } from '@/components/debug/IssueInbox';
import { DebugProjectProvider } from '@/components/debug/ProjectContext';
import { RepoWatchlist } from '@/components/fork/RepoWatchlist';
import { ShipmentsPanel } from '@/components/logistics/ShipmentsPanel';
import { SecurityAdvisories } from '@/components/security/SecurityAdvisories';
import { LogMetricForm } from '@/components/self/LogMetricForm';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}
// lensRun arrives in both call styles; normalize to (domain, action, input).
function norm(args: unknown[]): { domain: string; action: string; input: Record<string, unknown> } {
  if (typeof args[0] === 'string') {
    return { domain: args[0], action: String(args[1]), input: (args[2] as Record<string, unknown>) || {} };
  }
  const o = args[0] as { domain: string; action: string; input?: Record<string, unknown> };
  return { domain: o.domain, action: o.action, input: o.input || {} };
}
function install(handler: (domain: string, action: string, input: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation(async (...args: unknown[]) => {
    const { domain, action, input } = norm(args);
    const r = handler(domain, action, input);
    return r === undefined ? ok({}) : r;
  });
}

beforeEach(() => { lensRun.mockReset(); });

describe('FIX-security-010 — SOC detection rules are editable', () => {
  it('Edit loads the rule into the form and Save sends rule-update', async () => {
    const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
    const rule = { id: 'rule_1', name: 'Brute force', pattern: 'failed login', field: 'message', minSeverity: 'error', threshold: 3, windowMin: 60, incidentSeverity: 'P2', enabled: true, lastFiredAt: null, fireCount: 0 };
    install((_d, action, input) => {
      calls.push({ action, input });
      if (action === 'rule-list') return ok({ rules: [rule] });
      if (action === 'rule-update') return ok({ rule: { ...rule, ...input } });
      if (action === 'event-list') return ok({ events: [] });
      if (action === 'incident-list') return ok({ incidents: [] });
      return ok({});
    });
    render(<SOCConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /alert rules/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rule Brute force' }));
    const nameInput = await screen.findByDisplayValue('Brute force');
    fireEvent.change(nameInput, { target: { value: 'Brute force SSH' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      const upd = calls.find((c) => c.action === 'rule-update');
      expect(upd).toBeTruthy();
      expect(upd!.input.id).toBe('rule_1');
      expect(upd!.input.name).toBe('Brute force SSH');
      expect(upd!.input.pattern).toBe('failed login');
    });
  });
});

describe('FIX-debug-004 — IssueInbox exposes the server sort', () => {
  it('changing the sort select re-lists with the chosen sort', async () => {
    const sorts: unknown[] = [];
    install((_d, action, input) => {
      if (action === 'issue-list') {
        sorts.push(input.sort);
        return ok({ issues: [], summary: { open: 0, resolved: 0, ignored: 0 } });
      }
      if (action === 'release-list') return ok({ releases: [] });
      return ok({});
    });
    render(<DebugProjectProvider><IssueInbox /></DebugProjectProvider>);
    const select = await screen.findByLabelText('Sort issues');
    expect(sorts[0]).toBe('last');
    fireEvent.change(select, { target: { value: 'count' } });
    await waitFor(() => expect(sorts).toContain('count'));
  });
});

describe('FIX-fork-011 — RepoWatchlist shows what the feed ingested', () => {
  it('renders the feed-list items with their repo and actor', async () => {
    install((_d, action) => {
      if (action === 'watch-list') return ok({ repos: [] });
      if (action === 'watch-dashboard') return ok({ repos: 0, totalStars: 0, refreshed: 0, byReason: {} });
      if (action === 'feed-list') return ok({ items: [
        { id: 'd2', title: 'Issues on nodejs/node by hubot', repo: 'nodejs/node', type: 'IssuesEvent', actor: 'hubot', publishedAt: '2026-11-12T00:00:00Z' },
      ], count: 1 });
      return ok({});
    });
    render(<RepoWatchlist />);
    expect(await screen.findByText('Issues on nodejs/node by hubot')).toBeTruthy();
    expect(screen.getByText(/Ingested from the feed/)).toBeTruthy();
  });
});

describe('FIX-logistics-009 — Shipments list is searchable and filterable', () => {
  const shipments = [
    { id: 's1', trackingNumber: 'TRK1', reference: 'SHP-1', origin: 'Albany', destination: 'Boston', carrierId: 'c1', mode: 'parcel', weightLbs: 5, serviceLevel: 'std', poNumber: 'PO-1', consignee: 'Acme', status: 'in_transit', estimatedDelivery: '2026-11-20', actualDelivery: null },
    { id: 's2', trackingNumber: 'TRK2', reference: 'SHP-2', origin: 'Denver', destination: 'Miami', carrierId: 'c1', mode: 'ltl', weightLbs: 50, serviceLevel: 'std', poNumber: 'PO-2', consignee: 'Globex', status: 'delivered', estimatedDelivery: '2026-11-10', actualDelivery: null },
  ];
  it('search narrows the rows and the status filter composes', async () => {
    install((_d, action) => {
      if (action === 'shipments-list') return ok({ shipments });
      return ok({});
    });
    render(<ShipmentsPanel />);
    expect(await screen.findByText('SHP-1')).toBeTruthy();
    expect(screen.getByText('SHP-2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search shipments'), { target: { value: 'globex' } });
    await waitFor(() => expect(screen.queryByText('SHP-1')).toBeNull());
    expect(screen.getByText('SHP-2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search shipments'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter shipments by status'), { target: { value: 'in_transit' } });
    await waitFor(() => expect(screen.queryByText('SHP-2')).toBeNull());
    expect(screen.getByText('SHP-1')).toBeTruthy();
  });
});

describe('FIX-security-006 — Advisories list is searchable and sortable', () => {
  const items = [
    { ghsa_id: 'GHSA-aaaa', cve_id: 'CVE-2026-001', summary: 'Buffer overflow in parser', severity: 'critical', html_url: 'https://example.com/a', published_at: '2026-11-01', cvss: { score: 9.8 } },
    { ghsa_id: 'GHSA-bbbb', cve_id: 'CVE-2026-002', summary: 'XSS in template helper', severity: 'high', html_url: 'https://example.com/b', published_at: '2026-11-05', cvss: { score: 7.5 } },
  ];
  it('search filters by summary text', async () => {
    install((_d, action) => {
      if (action === 'github-advisories') return ok({ items, stale: false, fetchedAt: null });
      return ok({});
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><SecurityAdvisories /></QueryClientProvider>);
    expect(await screen.findByText(/Buffer overflow in parser/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search advisories'), { target: { value: 'xss' } });
    await waitFor(() => expect(screen.queryByText(/Buffer overflow in parser/)).toBeNull());
    expect(screen.getByText(/XSS in template helper/)).toBeTruthy();
  });
});

describe('FIX-self-016 — reading history can be filtered, searched and sorted', () => {
  const readings = [
    { id: 'r1', metric: 'steps', value: 8000, at: '2026-11-10T08:00:00Z', note: 'morning walk' },
    { id: 'r2', metric: 'mood', value: 4, at: '2026-11-11T08:00:00Z', note: '' },
    { id: 'r3', metric: 'steps', value: 3000, at: '2026-11-12T08:00:00Z', note: 'rainy day' },
  ];
  it('the metric filter narrows, search matches notes, rows show dates', async () => {
    install((_d, action) => {
      if (action === 'readings') return ok({ readings, count: readings.length, metrics: {} });
      return ok({});
    });
    render(<LogMetricForm onLogged={() => {}} />);
    expect(await screen.findByText(/morning walk/)).toBeTruthy();
    expect(screen.getByText('2026-11-12')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter history by metric'), { target: { value: 'mood' } });
    await waitFor(() => expect(screen.queryByText(/morning walk/)).toBeNull());
    fireEvent.change(screen.getByLabelText('Filter history by metric'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search reading history'), { target: { value: 'rainy' } });
    await waitFor(() => expect(screen.queryByText(/morning walk/)).toBeNull());
    expect(screen.getByText(/rainy day/)).toBeTruthy();
  });
});
