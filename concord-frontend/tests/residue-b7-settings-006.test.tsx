/**
 * RESIDUE B7 — FIX-settings-006: the Settings runtime panel showed server
 * uptime, memory and DTU counts to any member. The endpoint now scopes
 * operational detail to operator accounts (the brain-status viewer rule);
 * a member payload carries the status only, and the panel renders exactly
 * what the payload carries — no '—' tiles standing in for hidden data,
 * and a plain note saying the detail is operator-only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { get: (...args: unknown[]) => getMock(...args) } }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { SettingsHealth } from '@/components/settings/SettingsHealth';

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsHealth />
    </QueryClientProvider>,
  );
}

beforeEach(() => { getMock.mockReset(); });

describe('FIX-settings-006 — runtime detail follows the payload’s scoping', () => {
  it('member payload (status only): status renders, no ops tiles, note explains the scoping', async () => {
    getMock.mockResolvedValue({ data: { health: { status: 'operational' } } });
    renderPanel();
    await waitFor(() => expect(screen.getByText('operational')).toBeTruthy());
    expect(screen.queryByText('Uptime')).toBeNull();
    expect(screen.queryByText('Memory')).toBeNull();
    expect(screen.queryByText('DTUs')).toBeNull();
    expect(screen.getByText(/operator accounts only/)).toBeTruthy();
  });

  it('operator payload: the ops tiles render with their values', async () => {
    getMock.mockResolvedValue({
      data: {
        health: {
          status: 'operational',
          uptime: 7200,
          memory: { heap: 150 * 1024 * 1024 },
          dtuCount: 1234,
          sessionCount: 3,
        },
      },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Uptime')).toBeTruthy());
    expect(screen.getByText('2.0h')).toBeTruthy();
    expect(screen.getByText('150 MB')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.queryByText(/operator accounts only/)).toBeNull();
  });
});
