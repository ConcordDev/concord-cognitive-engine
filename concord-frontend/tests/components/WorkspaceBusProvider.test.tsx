import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import { KeyboardProvider } from '@/lib/keyboard';
import { useUIStore } from '@/store/ui';
import {
  WorkspaceBusProvider,
  useWorkspaceBus,
  WORKSPACE_BUS_MAX_HISTORY,
  type WorkspaceBusApi,
  type WorkspaceBusDTU,
} from '@/components/workspace-bus';

// This suite targets the bus's data/ingest contract (publish, history,
// dedupe, cap, ingest routing). The picker overlay (WorkspaceBusPicker,
// lazily loaded via next/dynamic) renders DTUEmbed + its social
// sub-components, which is DTUEmbed's own test surface
// (tests/components/DTUEmbed.test.tsx) — none of the tests below open the
// picker, so that chunk never mounts here.

function Harness({ onApi }: { onApi: (api: WorkspaceBusApi) => void }) {
  const api = useWorkspaceBus();
  onApi(api);
  return <div data-testid="ready" />;
}

function renderBus(onApi: (api: WorkspaceBusApi) => void) {
  return render(
    <KeyboardProvider>
      <WorkspaceBusProvider>
        <Harness onApi={onApi} />
      </WorkspaceBusProvider>
    </KeyboardProvider>
  );
}

const sampleDTU: WorkspaceBusDTU = {
  id: 'dtu-1',
  kind: 'regular',
  title: 'Q3 Revenue Forecast',
  summary: 'A forecast DTU.',
  domain: 'finance',
  citation: { allowCitation: true, visibility: 'public' },
};

describe('WorkspaceBusProvider', () => {
  beforeEach(() => {
    useUIStore.getState().setActiveLens('finance');
    // Fresh clipboard stub per test — jsdom doesn't implement navigator.clipboard.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('exposes a safe no-op fallback outside a provider', () => {
    let api: WorkspaceBusApi | undefined;
    render(<Harness onApi={(a) => { api = a; }} />);
    expect(api?.history).toEqual([]);
    expect(api?.isOpen).toBe(false);
    expect(async () => api?.ingestDTU(sampleDTU)).not.toThrow();
  });

  it('publish() adds an entry to history with the active lens as source', () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    act(() => { api.publish(sampleDTU); });
    expect(api.history).toHaveLength(1);
    expect(api.history[0].dtu.id).toBe('dtu-1');
    expect(api.history[0].dtu.title).toBe('Q3 Revenue Forecast');
    expect(api.history[0].sourceLensId).toBe('finance');
  });

  it('publish() dedupes by dtu id, moving the freshest copy to the front', () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    act(() => { api.publish(sampleDTU); });
    act(() => { api.publish({ ...sampleDTU, title: 'Q3 Revenue Forecast (revised)' }); });
    expect(api.history).toHaveLength(1);
    expect(api.history[0].dtu.title).toBe('Q3 Revenue Forecast (revised)');
  });

  it(`caps history at WORKSPACE_BUS_MAX_HISTORY (${WORKSPACE_BUS_MAX_HISTORY})`, () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    act(() => {
      for (let i = 0; i < WORKSPACE_BUS_MAX_HISTORY + 5; i++) {
        api.publish({ ...sampleDTU, id: `dtu-${i}` });
      }
    });
    expect(api.history).toHaveLength(WORKSPACE_BUS_MAX_HISTORY);
    // Newest publish is first; oldest ones fell off the back.
    expect(api.history[0].dtu.id).toBe(`dtu-${WORKSPACE_BUS_MAX_HISTORY + 4}`);
  });

  it('removeEntry() removes a single entry; clear() empties history', () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    act(() => {
      api.publish(sampleDTU);
      api.publish({ ...sampleDTU, id: 'dtu-2' });
    });
    const target = api.history.find((e) => e.dtu.id === 'dtu-2')!;
    act(() => { api.removeEntry(target.entryId); });
    expect(api.history).toHaveLength(1);
    expect(api.history[0].dtu.id).toBe('dtu-1');
    act(() => { api.clear(); });
    expect(api.history).toHaveLength(0);
  });

  it('ingestDTU() routes to a registered handler for the target lens and reports it claimed the ingest', async () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    const handler = vi.fn().mockResolvedValue(true);
    act(() => { api.registerIngestHandler('finance', handler); });

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.ingestDTU(sampleDTU, 'finance');
    });

    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual(sampleDTU);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('ingestDTU() falls back to the clipboard + reports false when no handler is registered for the target lens', async () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.ingestDTU(sampleDTU, 'some-unregistered-lens');
    });

    expect(handled).toBe(false);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('dtu-1');
  });

  it('ingestDTU() falls back honestly (never reports success) when a registered handler throws', async () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    act(() => {
      api.registerIngestHandler('finance', () => {
        throw new Error('handler boom');
      });
    });

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.ingestDTU(sampleDTU, 'finance');
    });

    expect(handled).toBe(false);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('ingestDTU() falls back honestly when a registered handler returns false', async () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    act(() => { api.registerIngestHandler('finance', vi.fn().mockResolvedValue(false)); });

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.ingestDTU(sampleDTU, 'finance');
    });

    expect(handled).toBe(false);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('registerIngestHandler() returns an unregister function that removes the handler', async () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    const handler = vi.fn().mockResolvedValue(true);
    let unregister!: () => void;
    act(() => { unregister = api.registerIngestHandler('finance', handler); });
    act(() => { unregister(); });

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.ingestDTU(sampleDTU, 'finance');
    });

    expect(handler).not.toHaveBeenCalled();
    expect(handled).toBe(false);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('open()/close() toggle isOpen', () => {
    let api!: WorkspaceBusApi;
    renderBus((a) => { api = a; });
    expect(api.isOpen).toBe(false);
    act(() => { api.open(); });
    expect(api.isOpen).toBe(true);
    act(() => { api.close(); });
    expect(api.isOpen).toBe(false);
  });
});
