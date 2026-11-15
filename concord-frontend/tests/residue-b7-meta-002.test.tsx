/**
 * RESIDUE B7 — FIX-meta-002 + FIX-settings-006 (one surface family): the
 * Meta Health tab renders GET /api/system/health. Its value path is
 * pinned against the endpoint's real nested shape (the flat-shape bug
 * that once blanked every tile was repaired in 9aeca9a4d and must not
 * regress), and under the endpoint's operator scoping a member payload
 * (status + brains only) renders the status and the brain fleet with NO
 * '—' ops tiles — the detail is stated as operator-only instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { get: (...args: unknown[]) => getMock(...args) } }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { SystemHealth } from '@/components/meta/SystemHealth';

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SystemHealth />
    </QueryClientProvider>,
  );
}

beforeEach(() => { getMock.mockReset(); });

describe('FIX-meta-002 — system vitals render what the payload carries', () => {
  it('operator payload: vitals show their real values', async () => {
    getMock.mockResolvedValue({
      data: {
        ok: true,
        health: {
          status: 'operational', uptime: 3600, dtuCount: 42, sessionCount: 2,
          memory: { rss: 10, heap: 50 * 1024 * 1024 },
          brains: { mode: 'local', onlineCount: 1, brains: {} },
          postgres: { connected: true, status: 'connected' },
          redis: { connected: false, status: 'in-memory-fallback' },
          saveFailures: 0, growth: { dtusLast24h: 1, dtusLast7d: 2 },
        },
      },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('operational')).toBeTruthy());
    expect(screen.getByText('1.0h')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Active sessions')).toBeTruthy();
  });

  it('member payload: status only, no ops tiles, scoping stated', async () => {
    getMock.mockResolvedValue({
      data: { ok: true, health: { status: 'operational', brains: { mode: 'local', onlineCount: 0, brains: {} } } },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('operational')).toBeTruthy());
    expect(screen.queryByText('Uptime')).toBeNull();
    expect(screen.queryByText('Heap')).toBeNull();
    expect(screen.queryByText('DTUs')).toBeNull();
    expect(screen.queryByText('Active sessions')).toBeNull();
    expect(screen.getByText(/operator accounts only/)).toBeTruthy();
  });
});
