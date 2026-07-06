/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the runMacro() helper's envelope-unwrap fix in BYOKeyDrawer.
// /api/lens/run always responds { ok: true, result: PAYLOAD }; the helper
// must return PAYLOAD (byo_keys.list -> { ok, overrides }, byo_keys.
// available_providers -> { ok, providers }), not the raw transport
// envelope, or `list.overrides` / `p.providers` are permanently undefined
// and the drawer always renders empty.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import BYOKeyDrawer from '@/components/chat/BYOKeyDrawer';

function mockLensRunFetch() {
  global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.domain === 'byo_keys' && body.name === 'list') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            ok: true,
            overrides: [
              { slot: 'conscious', provider: 'anthropic', model_id: null, active: 1, key_preview: 'sk-…abcd', created_at: 0 },
            ],
          },
        }),
      };
    }
    if (body.domain === 'byo_keys' && body.name === 'available_providers') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            ok: true,
            providers: [{ id: 'anthropic', label: 'Anthropic Claude', models: ['claude-sonnet'] }],
          },
        }),
      };
    }
    return { ok: false, json: async () => ({ ok: false }) };
  }) as unknown as typeof fetch;
}

describe('BYOKeyDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the existing override list read from the nested .result envelope', async () => {
    mockLensRunFetch();
    render(<BYOKeyDrawer open onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('conscious')).toBeInTheDocument();
    });
    expect(screen.getByText(/anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/sk-…abcd/)).toBeInTheDocument();
  });

  it('populates the provider picker from the nested .result envelope', async () => {
    mockLensRunFetch();
    render(<BYOKeyDrawer open onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Anthropic Claude')).toBeInTheDocument();
    });
  });

  it('shows the empty-overrides message when there are none', async () => {
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.name === 'list') {
        return { ok: true, json: async () => ({ ok: true, result: { ok: true, overrides: [] } }) };
      }
      if (body.name === 'available_providers') {
        return { ok: true, json: async () => ({ ok: true, result: { ok: true, providers: [] } }) };
      }
      return { ok: false, json: async () => ({ ok: false }) };
    }) as unknown as typeof fetch;

    render(<BYOKeyDrawer open onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/No overrides yet/)).toBeInTheDocument();
    });
  });
});
