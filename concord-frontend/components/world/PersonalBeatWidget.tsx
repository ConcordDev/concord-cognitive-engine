'use client';

/**
 * Personal Beat Widget
 *
 * Phase 3 — surfaces the goddess's anticipated beat to the player as an
 * unobtrusive floating card. Subscribes to 'beat:offered' socket events,
 * also polls `beats.list` on mount to catch beats offered while offline.
 *
 * The player can:
 *   - Realise it (counts as completed; concordia_alignment +0.05)
 *   - Reject it (counts as refused; refusal_debt +0.02)
 *   - Dismiss it (no-op, beat stays open until TTL)
 *
 * The card auto-collapses 6s after surfacing if the player doesn't
 * interact, then re-expands on hover.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface BeatPayload {
  id: string;
  prediction_id?: string;
  predictionId?: string;
  prose: string;
  surfaced_at?: number;
  completed_at?: number | null;
  outcome?: string | null;
  subjectKind?: string;
  subject_kind?: string;
}

async function callMacro<T = unknown>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ domain, name, input }),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function PersonalBeatWidget() {
  const [beat, setBeat] = useState<BeatPayload | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  const surfaceBeat = useCallback((b: BeatPayload) => {
    setBeat(b);
    setCollapsed(false);
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => setCollapsed(true), 6000);
  }, []);

  // Initial poll on mount — picks up beats offered while the page wasn't open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await callMacro<{ ok: boolean; beats?: BeatPayload[] }>('beats', 'list', { limit: 10 });
      if (cancelled || !r?.ok || !Array.isArray(r.beats)) return;
      const open = r.beats.find((x) => !x.completed_at);
      if (open) surfaceBeat(open);
    })();
    return () => {
      cancelled = true;
    };
  }, [surfaceBeat]);

  // Subscribe to live beat:offered events.
  useEffect(() => {
    // SocketEvent type union doesn't yet include 'beat:offered'; cast is safe
    // — the realtime layer accepts arbitrary event names at runtime.
    const off = subscribe('beat:offered' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const p = payload as BeatPayload;
      if (!p?.id || !p.prose) return;
      surfaceBeat(p);
    });
    return () => off?.();
  }, [surfaceBeat]);

  const resolve = useCallback(
    async (outcome: 'realised' | 'rejected' | 'ignored') => {
      if (!beat || busy) return;
      setBusy(true);
      try {
        await callMacro('beats', 'realise', { beatId: beat.id, outcome });
      } finally {
        setBeat(null);
        setBusy(false);
        if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
      }
    },
    [beat, busy],
  );

  if (!beat) return null;

  return (
    <div
      onMouseEnter={() => {
        setCollapsed(false);
        if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
      }}
      style={{
        position: 'fixed',
        bottom: '120px',
        right: '20px',
        maxWidth: collapsed ? '120px' : '360px',
        background: 'rgba(20, 18, 38, 0.92)',
        color: '#e7e0ff',
        border: '1px solid rgba(180, 150, 255, 0.4)',
        borderRadius: '8px',
        padding: collapsed ? '8px 10px' : '12px 14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: collapsed ? '11px' : '13px',
        lineHeight: 1.5,
        zIndex: 998,
        cursor: collapsed ? 'pointer' : 'default',
        transition: 'max-width 240ms ease, padding 240ms ease',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div
        style={{
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(200, 180, 255, 0.7)',
          marginBottom: collapsed ? 0 : '6px',
        }}
      >
        {collapsed ? 'beat' : 'a beat surfaces'}
      </div>
      {!collapsed && (
        <>
          <div style={{ marginBottom: '10px', whiteSpace: 'pre-wrap' }}>{beat.prose}</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => resolve('realised')}
              style={beatButtonStyle('rgba(120, 220, 160, 0.18)', 'rgba(160, 240, 190, 0.5)')}
            >
              Carry it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => resolve('rejected')}
              style={beatButtonStyle('rgba(220, 120, 120, 0.18)', 'rgba(240, 160, 160, 0.5)')}
            >
              Refuse
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBeat(null);
                if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
              }}
              style={beatButtonStyle('rgba(150, 150, 180, 0.12)', 'rgba(180, 180, 200, 0.4)')}
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function beatButtonStyle(bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    color: '#e7e0ff',
    border: `1px solid ${border}`,
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
