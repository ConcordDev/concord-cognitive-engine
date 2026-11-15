// @vitest-environment jsdom
/**
 * FIX-world-006 — the Ledger lens reset the audited world to sere on
 * every reload. The selection now lives in the URL (?world=tunya):
 * read at first render, written back on every change via
 * history.replaceState, so a reload, a shared link, or a back/forward
 * hop keeps auditing the same world.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], create: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/ledger/LedgerDrilldowns', () => ({
  FactionDossier: () => null,
  GlobalFlowPulse: () => null,
}));

import LedgerLensPage from './page';

function setUrl(path: string) {
  window.history.replaceState(null, '', path);
}

function mockAnomalies() {
  lensRunMock.mockImplementation(async (_domain: string, _action: string, params: Record<string, unknown> = {}) => {
    void params;
    return {
      data: {
        ok: true,
        result: { ok: true, managedParity: [], extractionLiens: [] },
        error: null,
      },
    };
  });
}

describe('Ledger lens — audited world in the URL (FIX-world-006)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    mockAnomalies();
    setUrl('/lenses/ledger');
  });
  afterEach(() => {
    cleanup();
    setUrl('/');
  });

  it('opens on the world named by ?world= instead of always resetting to sere', async () => {
    setUrl('/lenses/ledger?world=tunya');
    render(React.createElement(LedgerLensPage));
    const select = (await screen.findByLabelText('World to audit')) as HTMLSelectElement;
    expect(select.value).toBe('tunya');
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('ledger', 'anomalies', { worldId: 'tunya' }),
    );
  });

  it('writes the world to the URL on switch, and a fresh mount (reload) keeps it', async () => {
    const first = render(React.createElement(LedgerLensPage));
    const select = (await screen.findByLabelText('World to audit')) as HTMLSelectElement;
    expect(select.value).toBe('sere');

    await act(async () => {
      fireEvent.change(select, { target: { value: 'tunya' } });
    });
    expect(new URLSearchParams(window.location.search).get('world')).toBe('tunya');

    first.unmount();
    render(React.createElement(LedgerLensPage));
    const select2 = (await screen.findByLabelText('World to audit')) as HTMLSelectElement;
    expect(select2.value).toBe('tunya');
  });
});
