/**
 * ConKayWidgetLayer — the single mount point for <ConKayWidget />. No test
 * file existed for this component before this one. Covers the three real
 * signals it now threads through: the CK2 attention-derived state, the CK3
 * occlusion check (real DOM marker, hides rather than relocates), and the
 * CK4 pending-initiative count (real backend poll, never invented).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ConKayWidgetLayer, CONKAY_WIDGET_HIDDEN_KEY } from './ConKayWidgetLayer';
import { useConkayAttentionStore } from '../conkayAttentionStore';
import { useConkayInitiativeStore } from '../conkayInitiativeStore';

function jsonOf(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  window.localStorage.removeItem(CONKAY_WIDGET_HIDDEN_KEY);
  useConkayAttentionStore.setState({ open: false, listening: false, thinking: false, speaking: false } as never, true);
  useConkayInitiativeStore.setState({ pending: [], ready: false });
  document.querySelectorAll('[data-conkay-occludes-top-right]').forEach((n) => n.remove());
  vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-conkay-occludes-top-right]').forEach((n) => n.remove());
});

describe('ConKayWidgetLayer — mounts by default', () => {
  it('renders the widget when nothing hides or occludes it', async () => {
    render(<ConKayWidgetLayer />);
    await waitFor(() => expect(screen.getByRole('button', { name: /your Concord assistant/i })).toBeInTheDocument());
  });

  it('respects a persisted dismissal from localStorage', () => {
    window.localStorage.setItem(CONKAY_WIDGET_HIDDEN_KEY, 'true');
    render(<ConKayWidgetLayer />);
    expect(screen.queryByRole('button', { name: /your Concord assistant/i })).not.toBeInTheDocument();
  });
});

describe('ConKayWidgetLayer — CK3 real occlusion (hide, not relocate)', () => {
  it('does not render while a real occluder (e.g. the expanded guide rail) is mounted', async () => {
    const occluder = document.createElement('div');
    occluder.setAttribute('data-conkay-occludes-top-right', 'true');
    document.body.appendChild(occluder);

    render(<ConKayWidgetLayer />);
    // Give the MutationObserver's mount-time check a tick.
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /your Concord assistant/i })).not.toBeInTheDocument();

    occluder.remove();
  });

  it('re-appears once the real occluder is removed', async () => {
    const occluder = document.createElement('div');
    occluder.setAttribute('data-conkay-occludes-top-right', 'true');
    document.body.appendChild(occluder);

    render(<ConKayWidgetLayer />);
    await waitFor(() => expect(screen.queryByRole('button', { name: /your Concord assistant/i })).not.toBeInTheDocument());

    occluder.remove();
    await waitFor(() => expect(screen.getByRole('button', { name: /your Concord assistant/i })).toBeInTheDocument());
  });
});

describe('ConKayWidgetLayer — CK4 real pending-initiative count', () => {
  it('threads the real backend count through to the widget badge', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({
      ok: true,
      initiatives: [
        { id: 'a', message: 'real one', priority: 'normal', createdAt: '' },
        { id: 'b', message: 'real two', priority: 'normal', createdAt: '' },
      ],
    })));

    render(<ConKayWidgetLayer />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  it('stops polling once the full overlay is open (real store-derived signal)', async () => {
    useConkayAttentionStore.setState({ open: true } as never);
    const fetchMock = vi.fn(() => jsonOf({ ok: true, initiatives: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ConKayWidgetLayer />);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/initiative/pending', { credentials: 'include' });
  });
});
