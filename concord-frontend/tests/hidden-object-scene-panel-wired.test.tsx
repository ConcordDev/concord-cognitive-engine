// Minigame-depth audit (2026-07-11) — POLISH_AUDIT's minigame-ranking #5
// item: "Hidden-object works but is the only minigame with no juice/SFX and
// no found-markers on the image." Verified true against
// `components/world/HiddenObjectScenePanel.tsx` before this fix (no import
// from lib/concordia/juice, no persisted marker on a confirmed find).
//
// This test renders the real component, mocks the two endpoints it actually
// calls (play + find), and asserts:
//  - a found click renders a persistent marker at the click position
//  - a found click dispatches the shared juice/SFX channels (discovery on a
//    normal find, milestone on the final/complete find)
//  - a miss dispatches the failure channel and adds no marker

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, waitFor, screen } from '@testing-library/react';
import { HiddenObjectScenePanel } from '@/components/world/HiddenObjectScenePanel';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

describe('HiddenObjectScenePanel — juice + found markers (real wiring, not source-matched)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/hidden-object/play/scene-1') {
        return jsonResponse({ ok: true, runId: 'run-1', scene: { title: 'Attic clutter' } });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dispatchSpy.mockRestore();
  });

  function juiceTriggers() {
    return dispatchSpy.mock.calls
      .map((c) => c[0] as CustomEvent)
      .filter((e) => e.type === 'concordia:game-juice')
      .map((e) => e.detail?.trigger);
  }

  function sfxIds() {
    return dispatchSpy.mock.calls
      .map((c) => c[0] as CustomEvent)
      .filter((e) => e.type === 'concordia:soundscape-command')
      .map((e) => e.detail?.sfxId);
  }

  async function openScene() {
    const { container } = render(<HiddenObjectScenePanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:open-hidden-object', { detail: { sceneId: 'scene-1' } }));
    });
    const img = await waitFor(() => {
      const el = container.querySelector('img');
      if (!el) throw new Error('image not rendered yet');
      return el as HTMLImageElement;
    });
    // jsdom returns a zeroed rect by default; stub a real one so the
    // normalized click math is deterministic.
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON() { return {}; },
    } as DOMRect);
    return img;
  }

  it('a found click renders a persistent marker at the click position and fires discovery juice', async () => {
    const img = await openScene();
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/hidden-object/find/run-1') {
        expect(JSON.parse(String(init?.body))).toEqual({ x: 0.5, y: 0.5 });
        return jsonResponse({ ok: true, found: true, foundId: 't1', label: 'Old lamp', totalFound: 1, totalTargets: 3, complete: false });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    fireEvent.click(img, { clientX: 200, clientY: 150 });

    await waitFor(() => {
      expect(screen.getByText('Found: Old lamp')).toBeTruthy();
    });

    const markers = document.querySelectorAll('[data-testid="hidden-object-found-marker"]');
    expect(markers.length).toBe(1);
    expect((markers[0] as HTMLElement).style.left).toBe('50%');
    expect((markers[0] as HTMLElement).style.top).toBe('50%');

    expect(juiceTriggers()).toContain('discovery');
    expect(sfxIds()).toContain('ui_discovery');
  });

  it('the completing click fires milestone juice instead of discovery', async () => {
    const img = await openScene();
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/hidden-object/find/run-1') {
        return jsonResponse({ ok: true, found: true, foundId: 't3', label: 'Last item', totalFound: 3, totalTargets: 3, complete: true });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    fireEvent.click(img, { clientX: 100, clientY: 75 });

    await waitFor(() => {
      expect(screen.getByText('⭐ All targets found!')).toBeTruthy();
    });

    expect(juiceTriggers()).toContain('milestone');
    expect(juiceTriggers()).not.toContain('discovery');
  });

  it('a miss fires failure juice and adds no marker', async () => {
    const img = await openScene();
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/hidden-object/find/run-1') {
        return jsonResponse({ ok: true, found: false });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    fireEvent.click(img, { clientX: 10, clientY: 10 });

    await waitFor(() => {
      expect(screen.getByText('Nothing there. Look more carefully.')).toBeTruthy();
    });

    expect(document.querySelectorAll('[data-testid="hidden-object-found-marker"]').length).toBe(0);
    expect(juiceTriggers()).toContain('failure');
  });
});
