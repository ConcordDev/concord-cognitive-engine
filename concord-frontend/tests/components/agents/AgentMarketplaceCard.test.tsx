/**
 * AgentMarketplaceCard render contract tests.
 *
 * Pins:
 *   - Renders with default editor + price input + license dropdown
 *   - Publish button disabled until manifest validates
 *   - License dropdown surfaces all four allowed values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the api.client so AgentSpecEditor's validate call is intercepted.
vi.mock('@/lib/api/client', () => ({
  api: {
    post: vi.fn(async (_url: string, body: unknown) => {
      const { domain, name } = (body as { domain: string; name: string });
      if (domain === 'agent' && name === 'validate') {
        return { data: { ok: true, normalized: {
          id: 'agent:x', name: 'X', version: '1.0.0', creator_id: 'u',
          license: 'MIT',
          capabilities: [{ domain: 'translation', macros: ['translate'] }],
          constraints: { max_concurrent_tasks: 1, memory_required_mb: 0, execution_timeout_s: 60 },
          parent_dtu_ids: [],
        } } };
      }
      return { data: { ok: true } };
    }),
  },
  apiHelpers: {},
}));

import { AgentMarketplaceCard } from '@/components/agents/AgentMarketplaceCard';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AgentMarketplaceCard — render', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the publish button', () => {
    const { getByTestId } = wrap(<AgentMarketplaceCard />);
    expect(getByTestId('agent-publish-button')).toBeTruthy();
  });

  it('publish button is disabled before validation succeeds', () => {
    const { getByTestId } = wrap(<AgentMarketplaceCard />);
    const btn = getByTestId('agent-publish-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('license dropdown lists all 4 allowed values', () => {
    const { getAllByRole } = wrap(<AgentMarketplaceCard />);
    const options = getAllByRole('option');
    const labels = options.map((o) => (o as HTMLOptionElement).value);
    expect(labels).toContain('MIT');
    expect(labels).toContain('CC-BY-SA-4.0');
    expect(labels).toContain('Apache-2.0');
    expect(labels).toContain('proprietary');
  });

  it('exposes the spec editor', () => {
    const { getByTestId } = wrap(<AgentMarketplaceCard />);
    expect(getByTestId('agent-spec-editor')).toBeTruthy();
  });
});
