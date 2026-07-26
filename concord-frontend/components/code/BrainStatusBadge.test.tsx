/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrainStatusBadge } from './BrainStatusBadge';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

function okEnvelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}
function failEnvelope(error: string) {
  return { data: { ok: false, result: null, error } };
}

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic Claude', defaultModels: { conscious: 'claude-opus-4-7' } },
  { id: 'openai', name: 'OpenAI', defaultModels: { conscious: 'gpt-4o' } },
];

describe('BrainStatusBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state while the byo_keys.list fetch is in flight', async () => {
    let resolveList!: (v: unknown) => void;
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') {
        return new Promise((resolve) => { resolveList = resolve; });
      }
      return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
    });

    render(<BrainStatusBadge />);
    expect(screen.getByTestId('brain-status-badge-loading')).toBeInTheDocument();

    resolveList(okEnvelope({ overrides: [] }));
    await waitFor(() => expect(screen.queryByTestId('brain-status-badge-loading')).toBeNull());
  });

  it('renders the honest "Concord default" copy when there is no active conscious-slot override', async () => {
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') return Promise.resolve(okEnvelope({ overrides: [] }));
      if (domain === 'byo_keys' && name === 'available_providers') return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
      return Promise.resolve(failEnvelope('unknown'));
    });

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-default')).toBeInTheDocument());
    expect(screen.getByTestId('brain-status-default')).toHaveTextContent('Reasoning brain: Concord default (local)');
    expect(screen.queryByTestId('brain-status-active')).toBeNull();
  });

  it('renders the honest "Concord default" copy on a genuinely-unauthenticated/failed fetch (never an error banner)', async () => {
    lensRunMock.mockRejectedValue(new Error('network_error'));

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-default')).toBeInTheDocument());
    expect(screen.getByTestId('brain-status-default')).toHaveTextContent('Reasoning brain: Concord default (local)');
  });

  it('treats an INACTIVE conscious-slot override the same as no override — no reasoning bump is actually happening', async () => {
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') {
        return Promise.resolve(okEnvelope({
          overrides: [{ slot: 'conscious', provider: 'anthropic', model_id: null, active: 0 }],
        }));
      }
      if (domain === 'byo_keys' && name === 'available_providers') return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
      return Promise.resolve(failEnvelope('unknown'));
    });

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-default')).toBeInTheDocument());
  });

  it('treats a conscious-slot override still pointed at concord_default/ollama as no reasoning bump', async () => {
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') {
        return Promise.resolve(okEnvelope({
          overrides: [{ slot: 'conscious', provider: 'ollama', model_id: null, active: 1 }],
        }));
      }
      if (domain === 'byo_keys' && name === 'available_providers') return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
      return Promise.resolve(failEnvelope('unknown'));
    });

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-default')).toBeInTheDocument());
  });

  it('renders the provider + saved model_id and the active indicator for a real active override', async () => {
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') {
        return Promise.resolve(okEnvelope({
          overrides: [{ slot: 'conscious', provider: 'anthropic', model_id: 'claude-sonnet-4-6', active: 1 }],
        }));
      }
      if (domain === 'byo_keys' && name === 'available_providers') return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
      return Promise.resolve(failEnvelope('unknown'));
    });

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-active')).toBeInTheDocument());
    expect(screen.getByTestId('brain-status-active')).toHaveTextContent('Anthropic Claude / claude-sonnet-4-6');
  });

  it('falls back to the provider real default model (from available_providers) when no model_id was saved', async () => {
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') {
        return Promise.resolve(okEnvelope({
          overrides: [{ slot: 'conscious', provider: 'openai', model_id: null, active: 1 }],
        }));
      }
      if (domain === 'byo_keys' && name === 'available_providers') return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
      return Promise.resolve(failEnvelope('unknown'));
    });

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-active')).toBeInTheDocument());
    expect(screen.getByTestId('brain-status-active')).toHaveTextContent('OpenAI / gpt-4o');
  });

  it('the "Swap brain" link always points at /lenses/byo-keys', async () => {
    lensRunMock.mockImplementation((domain: string, name: string) => {
      if (domain === 'byo_keys' && name === 'list') return Promise.resolve(okEnvelope({ overrides: [] }));
      if (domain === 'byo_keys' && name === 'available_providers') return Promise.resolve(okEnvelope({ providers: PROVIDERS }));
      return Promise.resolve(failEnvelope('unknown'));
    });

    render(<BrainStatusBadge />);

    await waitFor(() => expect(screen.getByTestId('brain-status-swap-link')).toBeInTheDocument());
    expect(screen.getByTestId('brain-status-swap-link')).toHaveAttribute('href', '/lenses/byo-keys');
  });
});
