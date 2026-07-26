/**
 * DET-C batch 4 (dead-event-listener closure) — WorldTravelPanel's dead
 * window-toggle listener.
 *
 * `components/world-travel/WorldTravelPanel.tsx` used to listen for a
 * `concordia:world-travel-toggle` window event that nothing anywhere in the
 * codebase ever dispatched. Removed — the panel's real, working
 * open-trigger is its own "Worlds · <world>" pill button, which this test
 * confirms still works end-to-end. Same shape as the sibling
 * ConcordLinkPanel fix (tests/components/concord-link-panel-toggle.test.tsx).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { WorldTravelPanel } from '@/components/world-travel/WorldTravelPanel';

function jsonResponse(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/world-travel/me')) return jsonResponse({ currentWorld: 'concordia' });
    if (url.includes('/api/world-travel/worlds')) return jsonResponse({ worlds: [] });
    return jsonResponse({});
  }));
});

describe('WorldTravelPanel — open/close wiring', () => {
  it('starts closed, showing the "Open World Travel" pill', () => {
    render(<WorldTravelPanel myUserId="u1" />);
    expect(screen.getByLabelText('Open World Travel')).toBeInTheDocument();
    expect(screen.queryByText('World Travel')).not.toBeInTheDocument();
  });

  it('does NOT open on the old, never-dispatched concordia:world-travel-toggle event', async () => {
    render(<WorldTravelPanel myUserId="u1" />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('concordia:world-travel-toggle'));
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Open World Travel')).toBeInTheDocument();
    expect(screen.queryByText('World Travel')).not.toBeInTheDocument();
  });

  it('opens via its own real trigger — clicking the pill button', async () => {
    render(<WorldTravelPanel myUserId="u1" />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Open World Travel'));
      await Promise.resolve();
    });
    expect(screen.getByText('World Travel')).toBeInTheDocument();
  });
});
