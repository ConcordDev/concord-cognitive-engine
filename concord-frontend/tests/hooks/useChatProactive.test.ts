import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatProactive } from '@/components/chat/useChatProactive';

/**
 * This file used to pin three fabricated "proactive suggestion" behaviors
 * (a time-of-day pick, a lens-navigation pick, and a Math.random() idle
 * pick — the idle one literally asserted content claiming "I noticed"
 * something that was never actually noticed). Those generators were a real
 * zero-demo-content violation and have been removed from the hook; this
 * file now pins the real, honest behavior that replaced them — a real
 * fetch of already-pending initiatives from Concord's initiative engine on
 * mount, plus the pre-existing real socket-pushed initiative and DTU-event
 * paths.
 */

function jsonOf(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChatProactive', () => {
  it('initializes with empty proactive messages when there is nothing real pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
    const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));
    expect(result.current.proactiveMessages).toEqual([]);
  });

  it('provides dismissProactive, dismissAll, addDTUNotification, and resetIdleTimer', () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
    const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));
    expect(typeof result.current.dismissProactive).toBe('function');
    expect(typeof result.current.dismissAll).toBe('function');
    expect(typeof result.current.addDTUNotification).toBe('function');
    expect(typeof result.current.resetIdleTimer).toBe('function');
  });

  describe('real pending initiatives (fetched on mount)', () => {
    it('surfaces a real pending initiative from GET /api/initiative/pending', async () => {
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        expect(url).toBe('/api/initiative/pending');
        return jsonOf({
          ok: true,
          initiatives: [
            { id: 'init_1', message: 'Your substrate grew overnight.', priority: 'normal', createdAt: '2026-08-02T00:00:00Z' },
          ],
        });
      }));

      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      await waitFor(() => expect(result.current.proactiveMessages.length).toBe(1));
      expect(result.current.proactiveMessages[0].trigger).toBe('server_initiative');
      expect(result.current.proactiveMessages[0].content).toBe('Your substrate grew overnight.');
    });

    it('drops a row with no real id or message rather than fabricating one', async () => {
      vi.stubGlobal('fetch', vi.fn(() => jsonOf({
        ok: true,
        initiatives: [{ message: 'no id' }, { id: 'x', message: '' }, 'not an object'],
      })));

      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      // Give the fetch effect a tick, then assert nothing fabricated appeared.
      await new Promise((r) => setTimeout(r, 10));
      expect(result.current.proactiveMessages).toEqual([]);
    });

    it('does not fetch when not enabled', async () => {
      const fetchMock = vi.fn(() => jsonOf({ ok: true, initiatives: [] }));
      vi.stubGlobal('fetch', fetchMock);

      renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: false }));
      await new Promise((r) => setTimeout(r, 10));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a fetch failure leaves messages empty rather than crashing', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));

      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));
      await new Promise((r) => setTimeout(r, 10));

      expect(result.current.proactiveMessages).toEqual([]);
    });
  });

  describe('server-pushed initiative:new socket event (real, unchanged)', () => {
    it('surfaces a real socket-pushed initiative', async () => {
      vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
      let handler: ((data: unknown) => void) | undefined;
      const onSocket = vi.fn((event: string, fn: (data: unknown) => void) => {
        if (event === 'initiative:new') handler = fn;
      });
      const offSocket = vi.fn();

      const { result } = renderHook(() =>
        useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true, onSocket, offSocket })
      );

      expect(onSocket).toHaveBeenCalledWith('initiative:new', expect.any(Function));

      act(() => {
        handler?.({ id: 'push_1', message: 'A live push from the engine.', createdAt: '2026-08-02T00:00:00Z' });
      });

      expect(result.current.proactiveMessages.some(m => m.id === 'push_1' && m.content === 'A live push from the engine.')).toBe(true);
    });

    it('unsubscribes on unmount', () => {
      vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
      const onSocket = vi.fn();
      const offSocket = vi.fn();

      const { unmount } = renderHook(() =>
        useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true, onSocket, offSocket })
      );
      unmount();

      expect(offSocket).toHaveBeenCalledWith('initiative:new', expect.any(Function));
    });
  });

  describe('addDTUNotification (real, caller-supplied event data)', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
    });

    it('adds a proactive message with dtu_event trigger', () => {
      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      act(() => {
        result.current.addDTUNotification('My DTU Title', 'created');
      });

      expect(result.current.proactiveMessages.length).toBe(1);
      expect(result.current.proactiveMessages[0].trigger).toBe('dtu_event');
      expect(result.current.proactiveMessages[0].content).toContain('My DTU Title');
      expect(result.current.proactiveMessages[0].content).toContain('created');
    });

    it('handles the promoted action', () => {
      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      act(() => {
        result.current.addDTUNotification('Promoted DTU', 'promoted');
      });

      expect(result.current.proactiveMessages[0].content).toContain('promoted');
      expect(result.current.proactiveMessages[0].content).toContain('globally');
    });

    it('keeps max 5 messages', () => {
      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      for (let i = 0; i < 8; i++) {
        act(() => {
          result.current.addDTUNotification(`DTU ${i}`, 'created');
        });
      }

      expect(result.current.proactiveMessages.length).toBeLessThanOrEqual(5);
    });
  });

  describe('dismiss', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
    });

    it('dismissProactive removes a specific message', () => {
      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      act(() => { result.current.addDTUNotification('DTU 1', 'created'); });
      act(() => { result.current.addDTUNotification('DTU 2', 'created'); });

      expect(result.current.proactiveMessages.length).toBe(2);

      const firstId = result.current.proactiveMessages[0].id;
      act(() => { result.current.dismissProactive(firstId); });

      expect(result.current.proactiveMessages.length).toBe(1);
      expect(result.current.proactiveMessages[0].content).toContain('DTU 2');
    });

    it('dismissAll clears all proactive messages', () => {
      const { result } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 0, enabled: true }));

      act(() => {
        result.current.addDTUNotification('DTU 1', 'created');
        result.current.addDTUNotification('DTU 2', 'created');
      });

      act(() => { result.current.dismissAll(); });

      expect(result.current.proactiveMessages.length).toBe(0);
    });
  });

  it('cleanup on unmount does not throw', () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, initiatives: [] })));
    const { unmount } = renderHook(() => useChatProactive({ currentLens: 'healthcare', messageCount: 5, enabled: true }));
    expect(() => unmount()).not.toThrow();
  });
});
