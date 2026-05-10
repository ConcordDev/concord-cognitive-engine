'use client';

/**
 * RefusalFieldHUD — always-on overlay that surfaces the live refusal-field
 * strength + warns when compound-refusal threshold (≥6) is about to gate
 * an action.
 *
 * Wraps the Phase 2 macros: refusal.strength, refusal.composition.
 * Polls every 5s; subscribes to world:refusal-field socket events for
 * instant updates when a field is applied or expires.
 *
 * UX: tiny pill in the top-right that goes from grey → amber (≥3) →
 * crimson (≥6, compound). Click to expand a per-field breakdown.
 */

import { useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface FieldEntry {
  kind: string;
  strength: number;
  expiresAt?: number;
}

interface Composition {
  strength: number;
  composedFrom: number;
  glyph?: { numerical?: string; semantic?: string };
  entries?: FieldEntry[];
}

interface Props {
  worldId?: string;
  pollMs?: number;
}

async function callRefusalMacro(name: string, worldId: string) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'refusal', name, input: { worldId } }),
  }).catch(() => null);
  if (!r?.ok) return null;
  return r.json().catch(() => null);
}

export default function RefusalFieldHUD({ worldId = 'concordia-hub', pollMs = 5000 }: Props) {
  const [composition, setComposition] = useState<Composition | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const r = await callRefusalMacro('composition', worldId);
      if (alive && r?.ok) setComposition(r);
    };
    void refresh();
    const interval = window.setInterval(refresh, pollMs);
    const off = subscribe(
      'world:refusal-field' as Parameters<typeof subscribe>[0],
      () => { void refresh(); },
    );
    return () => {
      alive = false;
      window.clearInterval(interval);
      off?.();
    };
  }, [worldId, pollMs]);

  if (!composition || !composition.strength) return null;

  const strength = composition.strength;
  const compound = strength >= 6;
  const colorClass = compound
    ? 'bg-red-900/80 border-red-500 text-red-100'
    : strength >= 3
      ? 'bg-amber-900/80 border-amber-500 text-amber-100'
      : 'bg-zinc-900/80 border-zinc-600 text-zinc-200';

  return (
    <div className={`fixed top-3 right-3 z-50 pointer-events-auto ${colorClass} backdrop-blur-md border rounded-xl px-3 py-2 shadow-lg select-none`}>
      <button
        type="button"
        className="flex items-center gap-2 text-xs font-mono"
        onClick={() => setExpanded(v => !v)}
        title="Refusal Field strength — compound at ≥6"
      >
        <span aria-hidden="true">⊘</span>
        <span>RF {strength.toFixed(1)}</span>
        {compound && <span className="text-[10px] uppercase tracking-wider font-bold">COMPOUND</span>}
        {composition.composedFrom > 1 && (
          <span className="text-[10px] opacity-70">×{composition.composedFrom}</span>
        )}
      </button>
      {expanded && composition.entries && composition.entries.length > 0 && (
        <ul className="mt-2 pt-2 border-t border-current/30 space-y-1 text-[10px] font-mono">
          {composition.entries.slice(0, 8).map((e, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="opacity-80">{e.kind}</span>
              <span>{e.strength?.toFixed(1) ?? '?'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
