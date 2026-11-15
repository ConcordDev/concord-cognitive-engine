import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Slice B7 — FIX-mesh-003: a mesh message can be deleted from the
// caller's own log behind a two-step confirm, and an unbroken
// long body wraps inside its bubble instead of pushing the page
// sideways ([overflow-wrap:anywhere] + min-w-0 on the bubble).

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
}));

import { MeshMessaging } from '@/components/mesh/MeshMessaging';

const LONG = 'x'.repeat(600);
const MSG = {
  id: 'msg_1', to: 'broadcast', kind: 'broadcast', body: LONG, encrypted: false,
  direction: 'out', state: 'recorded', read: false, sentAt: new Date().toISOString(),
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MeshMessaging /></QueryClientProvider>);
}

beforeEach(() => { runDomain.mockReset(); });

describe('MeshMessaging — message delete + wrap (FIX-mesh-003)', () => {
  it('the confirm deletes via mesh.deleteMessage; the bubble wraps anywhere', async () => {
    runDomain.mockImplementation((_d: string, action: string) => {
      if (action === 'listNodes') return Promise.resolve({ data: { result: { nodes: [] } } });
      if (action === 'listChannels') return Promise.resolve({ data: { result: { channels: [] } } });
      if (action === 'conversation') return Promise.resolve({ data: { result: { messages: [MSG], total: 1, unread: 0 } } });
      if (action === 'deleteMessage') return Promise.resolve({ data: { result: { deleted: 'msg_1', removedFrames: 0 } } });
      return Promise.resolve({ data: { result: {} } });
    });
    wrap();
    const body = await screen.findByText(LONG);
    expect(body.className).toContain('[overflow-wrap:anywhere]');
    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(runDomain.mock.calls.filter((c) => c[1] === 'deleteMessage')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(runDomain).toHaveBeenCalledWith('mesh', 'deleteMessage', { id: 'msg_1' }));
  });
});
