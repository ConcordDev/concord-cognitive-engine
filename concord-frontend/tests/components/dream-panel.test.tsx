/**
 * Tier-2 frontend test for DreamPanel.
 *
 * Pins:
 *   - Two tabs: dreams / predictions
 *   - dreams tab fetches dreams.recent
 *   - predictions tab fetches dreams.predictions
 *   - Renders dream prose from dtu.data.human_summary
 *   - Renders empty-state when no rows
 *   - Confidence chip tone reflects bands
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { DreamPanel } from '@/components/world/concordia-hud/panels/DreamPanel';

function jsonResponse(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  // Default fetch — empty results so initial render is safe.
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ok: true, dreams: [], predictions: [] })));
});

describe('DreamPanel — tabs', () => {
  it('renders dreams + predictions tabs', async () => {
    const { container } = render(<DreamPanel />);
    await act(async () => { await Promise.resolve(); });
    const tabs = container.querySelectorAll('button[data-tab]');
    expect(tabs.length).toBe(2);
    expect(Array.from(tabs).map((t) => t.getAttribute('data-tab'))).toEqual(['dreams', 'predictions']);
  });

  it('default tab is dreams — fetches dreams.recent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<DreamPanel />);
    await act(async () => { await Promise.resolve(); });
    const calls = spy.mock.calls.filter((c) => String(c[0]).includes('/api/lens/run'));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.domain).toBe('dreams');
    expect(body.name).toBe('recent');
  });

  it('shows dreams empty state when no rows', async () => {
    const { container } = render(<DreamPanel />);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/no dreams composed/i);
  });

  it('switching to predictions tab fetches dreams.predictions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<DreamPanel />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      (container.querySelector('button[data-tab="predictions"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const predCall = spy.mock.calls.find((c) =>
      String(c[0]).includes('/api/lens/run') &&
      JSON.parse((c[1] as RequestInit).body as string).name === 'predictions'
    );
    expect(predCall).toBeTruthy();
  });
});

describe('DreamPanel — content', () => {
  it('renders dream prose from dtu.data.human_summary', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      ok: true,
      dreams: [{
        id: 'd1',
        dream_dtu_id: 'dtu_dream_1',
        fragment_count: 8,
        composer: 'deterministic',
        composed_at: Math.floor(Date.now() / 1000) - 3600,
        dtu: {
          id: 'dtu_dream_1',
          title: 'A grey morning by the river',
          data: { human_summary: 'You walked the river bank and the fish sang back.' },
        },
      }],
    })));
    const { container } = render(<DreamPanel />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-dream-id="d1"]')).not.toBeNull();
    expect(container.textContent).toMatch(/A grey morning by the river/);
    expect(container.textContent).toMatch(/You walked the river bank/);
  });

  it('renders predictions with confidence chip', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      ok: true,
      predictions: [{
        id: 'p1', subject_kind: 'npc', subject_id: 'kael',
        anticipated: 'Kael will request the bloodline DTU.',
        confidence: 0.82,
        composer: 'deterministic',
        composed_at: Math.floor(Date.now() / 1000) - 600,
        expires_at: Math.floor(Date.now() / 1000) + 3600 * 6,
      }],
    })));
    const { container } = render(<DreamPanel />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      (container.querySelector('button[data-tab="predictions"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const row = container.querySelector('[data-prediction-id="p1"]');
    expect(row).not.toBeNull();
    expect(container.textContent).toMatch(/conf 82%/);
    expect(container.textContent).toMatch(/Kael will request/);
  });
});
