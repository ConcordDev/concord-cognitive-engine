// Behavior test for AgentRuntime's "Templates" tab — FIX-agents-013.
// Before the fix, Template Import recorded the install count and threw
// the returned agent definition away: no agent was created, there was
// no way to name it, and no undo. Pins: Import persists the definition
// through the artifact store under the name typed on the card, the
// success banner points at the Fleet roster truthfully, and Undo
// removes the created artifact and reverses the install count.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: {
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
    get: vi.fn(),
    put: vi.fn(),
  },
}));
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

const TPL = {
  id: 'tpl_research_sentinel', name: 'Research Sentinel', type: 'research',
  description: 'Monitors a topic and synthesizes findings.',
  goals: ['Track new sources'], tools: ['web_search', 'summarize'],
  model: 'claude-sonnet-4-5-20250929', temperature: 0.3, maxTokens: 4096,
  author: 'Concord', installs: 0,
};

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

function mockBackend() {
  lensRun.mockImplementation((_domain: string, action: string, input?: Record<string, unknown>) => {
    switch (action) {
      case 'runtimeOverview': return ok(EMPTY_OVERVIEW);
      case 'listRuns': return ok({ runs: [] });
      case 'listTemplates': return ok({ templates: [TPL], total: 1 });
      case 'importTemplate': {
        const name = typeof input?.name === 'string' && input.name ? input.name : TPL.name;
        return ok({
          agentDefinition: {
            name, type: TPL.type, description: TPL.description, goals: TPL.goals,
            tools: TPL.tools, model: TPL.model, temperature: TPL.temperature,
            maxTokens: TPL.maxTokens, enabled: false, status: 'dormant',
            tickCount: 0, successRate: 0, avgLatency: 0,
            createdAt: '2026-11-13T00:00:00.000Z', memory: [], logs: [],
            importedFrom: TPL.id,
          },
          template: { ...TPL, installs: 1 },
        });
      }
      case 'uninstallTemplate': return ok({ template: { ...TPL, installs: 0 } });
      default: return ok({});
    }
  });
  apiPost.mockResolvedValue({ data: { ok: true, artifact: { id: 'art-1' } } });
  apiDelete.mockResolvedValue({ data: { ok: true } });
}

async function openTemplatesTab() {
  render(<AgentRuntime agents={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: /Templates/i }));
  await waitFor(() => expect(lensRun).toHaveBeenCalledWith('agents', 'listTemplates', {}));
  await screen.findByText('Research Sentinel');
}

describe('AgentRuntime — Templates tab (FIX-agents-013)', () => {
  beforeEach(() => {
    lensRun.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    mockBackend();
  });

  it('import creates the agent in the artifact store under the typed name', async () => {
    await openTemplatesTab();
    fireEvent.change(screen.getByLabelText(/Name for the imported Research Sentinel agent/i), { target: { value: 'My Sentinel' } });
    fireEvent.click(screen.getByRole('button', { name: /^Import$/i }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(lensRun).toHaveBeenCalledWith('agents', 'importTemplate', { templateId: TPL.id, name: 'My Sentinel' });
    expect(apiPost).toHaveBeenCalledWith('/api/lens/agents', {
      type: 'agent',
      title: 'My Sentinel',
      data: expect.objectContaining({ name: 'My Sentinel', importedFrom: TPL.id, status: 'dormant' }),
    });
    expect(await screen.findByText(/now in your Fleet roster/i)).toBeInTheDocument();
  });

  it('undo removes the created agent and reverses the install count', async () => {
    await openTemplatesTab();
    fireEvent.click(screen.getByRole('button', { name: /^Import$/i }));
    await screen.findByText(/now in your Fleet roster/i);
    fireEvent.click(screen.getByRole('button', { name: /Undo import/i }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/lens/agents/art-1'));
    expect(lensRun).toHaveBeenCalledWith('agents', 'uninstallTemplate', { templateId: TPL.id });
    await waitFor(() => expect(screen.queryByText(/now in your Fleet roster/i)).not.toBeInTheDocument());
  });
});
