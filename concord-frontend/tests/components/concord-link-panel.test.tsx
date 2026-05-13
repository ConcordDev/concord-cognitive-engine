/**
 * Tier-2 frontend test for ConcordLinkPanel.
 *
 * Pins:
 *   - Three tabs render: inbox / compose / anchors
 *   - Inbox fetches /api/concord-link/inbox on mount
 *   - Anchors tab fetches /api/concord-link/anchors/:worldId
 *   - Empty inbox shows the "Inbox empty" empty-state
 *   - Compose tab renders the four input controls + Send button
 *   - Compose Send hits /api/concord-link/send with the right payload
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';
import { ConcordLinkPanel } from '@/components/world/concordia-hud/panels/ConcordLinkPanel';

function jsonResponse(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  useHUDContext.setState({ worldId: 'tunya' });
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/concord-link/inbox')) return jsonResponse({ ok: true, messages: [] });
    if (url.includes('/api/concord-link/anchors/')) return jsonResponse({ ok: true, anchors: [
      { id: 'anc_1', name: 'Tunya Pillar', access_method: 'resonance_stone', stability: 0.9 },
    ] });
    if (url.includes('/api/concord-link/cost')) return jsonResponse({ ok: true, cost: 42 });
    if (url.includes('/api/concord-link/send')) return jsonResponse({ ok: true, id: 'msg_1' });
    return jsonResponse({ ok: true });
  }));
});

describe('ConcordLinkPanel — tabs', () => {
  it('renders inbox / compose / anchors tabs', () => {
    const { container } = render(<ConcordLinkPanel />);
    const tabs = container.querySelectorAll('button[data-tab]');
    expect(tabs.length).toBe(3);
    expect(Array.from(tabs).map((t) => t.getAttribute('data-tab'))).toEqual(['inbox', 'compose', 'anchors']);
  });

  it('inbox is the default tab and shows empty state', async () => {
    const { container } = render(<ConcordLinkPanel />);
    // Allow microtask flush for fetch
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/Inbox empty/i);
  });
});

describe('ConcordLinkPanel — compose', () => {
  it('compose tab renders all input controls + Send button', async () => {
    const { container } = render(<ConcordLinkPanel />);
    act(() => { (container.querySelector('button[data-tab="compose"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('input[aria-label="Receiver"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Destination world"]')).not.toBeNull();
    expect(container.querySelector('textarea[aria-label="Message body"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Send message"]')).not.toBeNull();
  });

  it('Send fires fetch to /api/concord-link/send with payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<ConcordLinkPanel />);
    act(() => { (container.querySelector('button[data-tab="compose"]') as HTMLButtonElement).click(); });
    const receiver = container.querySelector('input[aria-label="Receiver"]') as HTMLInputElement;
    const dest = container.querySelector('input[aria-label="Destination world"]') as HTMLInputElement;
    const body = container.querySelector('textarea[aria-label="Message body"]') as HTMLTextAreaElement;
    fireEvent.change(receiver, { target: { value: 'user_42' } });
    fireEvent.change(dest, { target: { value: 'cyber' } });
    fireEvent.change(body, { target: { value: 'hello cross-world' } });
    await act(async () => {
      (container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const sendCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/api/concord-link/send'));
    expect(sendCall).toBeTruthy();
    const init = sendCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body as string);
    expect(payload.receiverId).toBe('user_42');
    expect(payload.destWorld).toBe('cyber');
    expect(payload.sourceWorld).toBe('tunya');
    expect(payload.payload).toBe('hello cross-world');
  });
});

describe('ConcordLinkPanel — anchors', () => {
  it('anchors tab fetches /api/concord-link/anchors/:worldId and renders rows', async () => {
    const { container } = render(<ConcordLinkPanel />);
    await act(async () => {
      (container.querySelector('button[data-tab="anchors"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const rows = container.querySelectorAll('[data-anchor-id]');
    expect(rows.length).toBe(1);
    expect(container.textContent).toMatch(/Tunya Pillar/);
  });
});
