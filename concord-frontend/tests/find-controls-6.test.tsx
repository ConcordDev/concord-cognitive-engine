/**
 * Audit sweep CB-0490 (missing find controls, third leg), FE pins 2:
 *   mental-health-010   MhReflectPanel entry search
 *   parenting-011       ParentingSection roster search
 *   mesh-012            MeshChannels / MeshQueue / MeshTopology / MeshMessaging searches
 *   projects-006        PjBoardPanel board card search
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRun = vi.fn();
const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    put: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    patch: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MhReflectPanel } from '@/components/mental-health/MhReflectPanel';
import { ParentingSection } from '@/components/parenting/ParentingSection';
import { MeshChannels } from '@/components/mesh/MeshChannels';
import { MeshQueue } from '@/components/mesh/MeshQueue';
import { MeshTopology } from '@/components/mesh/MeshTopology';
import { MeshMessaging } from '@/components/mesh/MeshMessaging';
import { PjBoardPanel } from '@/components/projects/PjBoardPanel';

function reply(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
function routeLens(map: Record<string, unknown>) {
  lensRun.mockImplementation((...args: unknown[]) => {
    const action = args[1] as string;
    return reply(action in map ? map[action] : {});
  });
}
function routeDomain(map: Record<string, unknown>) {
  runDomain.mockImplementation((...args: unknown[]) => {
    const action = args[1] as string;
    return reply(action in map ? map[action] : {});
  });
}

beforeEach(() => { lensRun.mockReset(); runDomain.mockReset(); });

describe('mental-health-010 — entry search', () => {
  it('filters gratitude entries by their text', async () => {
    const entries = [
      { id: 'g1', date: '2026-11-10', items: ['Warm coffee at dawn'] },
      { id: 'g2', date: '2026-11-11', items: ['A quiet train ride'] },
    ];
    routeLens({
      'gratitude-list': { entries },
      'goal-status': { dailyMinutes: 10, todayMinutes: 0, pct: 0, met: false, isDefault: true },
    });
    wrap(<MhReflectPanel onChange={() => {}} />);
    await screen.findByText('Warm coffee at dawn');
    fireEvent.change(screen.getByLabelText('Search entries'), { target: { value: 'train' } });
    expect(screen.queryByText('Warm coffee at dawn')).toBeNull();
    expect(screen.getByText('A quiet train ride')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search entries'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No entries match/)).toBeTruthy();
  });
});

describe('parenting-011 — roster search', () => {
  it('filters the child roster by name', async () => {
    const children = [
      { id: 'c1', name: 'Nora', birthDate: '2024-01-05', sex: 'girl', ageDisplay: '22 mo', ageMonths: 22 },
      { id: 'c2', name: 'Ezra', birthDate: '2023-06-11', sex: 'boy', ageDisplay: '2 y 5 mo', ageMonths: 29 },
    ];
    routeLens({ 'child-list': { children, count: 2 } });
    wrap(<ParentingSection />);
    await screen.findByText(/Nora · 22 mo/);
    fireEvent.change(screen.getByLabelText('Search children'), { target: { value: 'ezra' } });
    expect(screen.queryByText(/Nora · 22 mo/)).toBeNull();
    expect(screen.getByText(/Ezra · 2 y 5 mo/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search children'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No children match/)).toBeTruthy();
  });
});

describe('mesh-012 — channel search', () => {
  it('filters channels by name', async () => {
    const channels = [
      { id: 'ch1', name: 'relay-ops', encrypted: false, keyStrength: 'open', memberCount: 3 },
      { id: 'ch2', name: 'harbor-watch', encrypted: true, keyStrength: 'strong', memberCount: 2 },
    ];
    routeDomain({ listChannels: { channels, total: 2, encrypted: 1 } });
    wrap(<MeshChannels />);
    await screen.findByText('# relay-ops');
    fireEvent.change(screen.getByLabelText('Search channels'), { target: { value: 'harbor' } });
    expect(screen.queryByText('# relay-ops')).toBeNull();
    expect(screen.getByText('# harbor-watch')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search channels'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No channels match/)).toBeTruthy();
  });
});

describe('mesh-012 — queue search', () => {
  it('filters queued frames by destination/priority/state', async () => {
    const frames = [
      { id: 'f1', messageId: 'm1', to: 'n2', toName: 'Harbor node', sizeBytes: 10, priority: 'general', attempts: 0, state: 'queued', queuedAt: '2026-11-12' },
      { id: 'f2', messageId: 'm2', to: 'n3', toName: 'Summit node', sizeBytes: 12, priority: 'threat', attempts: 1, state: 'queued', queuedAt: '2026-11-12' },
    ];
    routeDomain({ queueList: { frames, total: 2, pending: 2, totalBytes: 22 } });
    wrap(<MeshQueue />);
    await screen.findByText('→ Harbor node');
    fireEvent.change(screen.getByLabelText('Search queued frames'), { target: { value: 'summit' } });
    expect(screen.queryByText('→ Harbor node')).toBeNull();
    expect(screen.getByText('→ Summit node')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search queued frames'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No frames match/)).toBeTruthy();
  });
});

describe('mesh-012 — node search', () => {
  it('filters the topology node list by name', async () => {
    const nodes = [
      { id: 'self', name: 'Base station', kind: 'self', online: true, transports: ['wifi'], hops: 0 },
      { id: 'n2', name: 'Harbor peer', kind: 'peer', online: true, transports: ['lora'], hops: 1 },
      { id: 'n3', name: 'Summit peer', kind: 'peer', online: false, transports: ['wifi'], hops: 2 },
    ];
    routeDomain({ meshMap: { nodes, edges: [], nodeCount: 3, edgeCount: 0, onlineCount: 2 } });
    wrap(<MeshTopology />);
    await screen.findByRole('button', { name: 'Ping Harbor peer' });
    fireEvent.change(screen.getByLabelText('Search nodes'), { target: { value: 'summit' } });
    expect(screen.queryByRole('button', { name: 'Ping Harbor peer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ping Summit peer' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search nodes'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No nodes match/)).toBeTruthy();
  });
});

describe('mesh-012 — message search', () => {
  it('filters the open conversation by message text', async () => {
    const messages = [
      { id: 'mm1', body: 'Harbor relay is up', direction: 'in', sentAt: '2026-11-12T10:00:00Z', encrypted: false, kind: 'text' },
      { id: 'mm2', body: 'Summit check at noon', direction: 'out', sentAt: '2026-11-12T11:00:00Z', encrypted: false, kind: 'text' },
    ];
    routeDomain({
      conversation: { messages, total: 2, unread: 0 },
      listNodes: { nodes: [] },
      listChannels: { channels: [], total: 0, encrypted: 0 },
    });
    wrap(<MeshMessaging />);
    await screen.findByText('Harbor relay is up');
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'summit' } });
    expect(screen.queryByText('Harbor relay is up')).toBeNull();
    expect(screen.getByText('Summit check at noon')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No messages match/)).toBeTruthy();
  });
});

describe('projects-006 — board search', () => {
  it('filters board cards by title across columns', async () => {
    const task = (id: string, ref: string, title: string, status: string) => ({
      id, ref, title, status, priority: 'high', type: 'task', points: 3, assigneeId: null, assigneeName: null, labels: [], parentId: null,
    });
    routeLens({
      board: {
        columns: [
          { status: 'todo', tasks: [task('t1', 'PRJ-1', 'Wire the export', 'todo'), task('t2', 'PRJ-2', 'Draft the memo', 'todo')] },
          { status: 'backlog', tasks: [task('t3', 'PRJ-3', 'Plan the offsite', 'backlog')] },
        ],
      },
      'wip-list': { limits: [] },
      'project-get': { members: [], sprints: [], milestones: [], labels: [], customFields: [] },
      'task-list': { tasks: [] },
    });
    wrap(<PjBoardPanel projectId="proj-1" />);
    await screen.findByText('Wire the export');
    fireEvent.change(screen.getByLabelText('Search board'), { target: { value: 'memo' } });
    expect(screen.queryByText('Wire the export')).toBeNull();
    expect(screen.queryByText('Plan the offsite')).toBeNull();
    expect(screen.getByText('Draft the memo')).toBeTruthy();
  });
});
