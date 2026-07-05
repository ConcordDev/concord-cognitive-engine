/**
 * Fix 4 (verification audit, 2026-07-05) — ConcordLinkPanel's dead
 * window-toggle listener.
 *
 * `components/concord-link/ConcordLinkPanel.tsx` (distinct from the
 * similarly-named HUD panel at
 * components/world/concordia-hud/panels/ConcordLinkPanel.tsx, covered by
 * tests/components/concord-link-panel.test.tsx) used to listen for a
 * `concordia:concord-link-toggle` window event that nothing in the codebase
 * ever dispatches. Removed — the panel's real, working open-trigger is its
 * own "Open Concord Link" pill button, which this test confirms still works
 * end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { ConcordLinkPanel } from '@/components/concord-link/ConcordLinkPanel';

function jsonResponse(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/concord-link/anchors/')) return jsonResponse({ anchors: [] });
    if (url.includes('/api/concord-link/inbox')) return jsonResponse({ messages: [] });
    if (url.includes('/api/world-travel/me')) return jsonResponse({ currentWorld: 'concordia' });
    return jsonResponse({});
  }));
});

describe('ConcordLinkPanel — open/close wiring', () => {
  it('starts closed, showing the "Open Concord Link" pill', () => {
    render(<ConcordLinkPanel myUserId="u1" />);
    expect(screen.getByLabelText('Open Concord Link')).toBeInTheDocument();
    expect(screen.queryByText('The Concord Link')).not.toBeInTheDocument();
  });

  it('does NOT open on the old, never-dispatched concordia:concord-link-toggle event', async () => {
    render(<ConcordLinkPanel myUserId="u1" />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('concordia:concord-link-toggle'));
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Open Concord Link')).toBeInTheDocument();
    expect(screen.queryByText('The Concord Link')).not.toBeInTheDocument();
  });

  it('opens via its own real trigger — clicking the pill button', async () => {
    render(<ConcordLinkPanel myUserId="u1" />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Open Concord Link'));
      await Promise.resolve();
    });
    expect(screen.getByText('The Concord Link')).toBeInTheDocument();
  });
});
