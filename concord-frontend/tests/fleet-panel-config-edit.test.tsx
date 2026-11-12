// FIX-agents-009 — the agent detail Configuration tab was read-only.
// It now has an Edit configuration flow that saves name / description /
// model / temperature / maxTokens through the lens-artifact update
// path (the same one Start/Stop use).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const updateMock = vi.fn(async () => ({}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [{
      id: 'agent_1', title: 'Scout',
      data: {
        name: 'Scout', type: 'general', description: 'Watches feeds', goals: [], tools: [],
        model: 'model-a', temperature: 0.3, maxTokens: 4096, enabled: false, status: 'dormant',
        tickCount: 2, successRate: 50, avgLatency: 1, createdAt: '2026-11-01T00:00:00.000Z', memory: [], logs: [],
      },
    }],
    isLoading: false, isError: false, error: null, isSeeding: false,
    refetch: vi.fn(), create: vi.fn(async () => ({})), update: updateMock, remove: vi.fn(async () => ({})),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })) }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { taskDefinitions: [] } } })),
}));
vi.mock('@/components/agents/AgentRuntime', () => ({ AgentRuntime: () => null }));
vi.mock('@/components/agents/AgentSelfPanel', () => ({ AgentSelfPanel: () => null }));
vi.mock('framer-motion', () => {
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  const anyMotion = new Proxy({}, {
    get: (_t, tag: string) => {
      if (!cache.has(tag)) {
        cache.set(tag, (p: Record<string, unknown>) => {
          const { initial, animate, exit, transition, ...rest } = p as Record<string, unknown>;
          void initial; void animate; void exit; void transition;
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...(rest as Record<string, unknown>)} />;
        });
      }
      return cache.get(tag);
    },
  });
  return { motion: anyMotion, AnimatePresence: (p: { children?: React.ReactNode }) => <>{p.children}</> };
});

import { FleetPanel } from '@/components/agents/FleetPanel';

beforeEach(() => updateMock.mockClear());
afterEach(() => cleanup());

describe('fleet panel configuration edit', () => {
  it('selects an agent, edits its configuration, and saves via update', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FleetPanel />
      </QueryClientProvider>,
    );
    // Select the agent from the roster.
    const card = await screen.findByText('Scout');
    await act(async () => { fireEvent.click(card); });
    // Go to the Configuration tab.
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Configuration/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit configuration' })); });
    const modelInput = screen.getByLabelText('Model');
    expect((modelInput as HTMLInputElement).value).toBe('model-a');
    await act(async () => { fireEvent.change(modelInput, { target: { value: 'model-b' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const [id, patch] = updateMock.mock.calls[0] as unknown as [string, { data: Record<string, unknown> }];
    expect(id).toBe('agent_1');
    expect(patch.data.model).toBe('model-b');
    expect(patch.data.name).toBe('Scout');
  });
});
