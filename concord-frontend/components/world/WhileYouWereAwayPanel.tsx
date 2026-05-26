'use client';

/**
 * WhileYouWereAwayPanel — Wave 3 / T2.2.
 *
 * Mounted in the world lens; auto-opens on first scene mount when the
 * offline window is ≥ 30 minutes. Reads from /api/world/digest and
 * groups events by channel.
 *
 * Auto-dismisses on Esc / explicit close. Sticky-dismissed for the
 * current session via sessionStorage so re-mounts don't re-open it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface DigestEvent {
  id: number;
  channel: string;
  world_id: string;
  actor_kind: string | null;
  actor_id: string | null;
  payload_json: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
}

interface DigestResponse {
  ok: boolean;
  worldId: string;
  sinceTs: number;
  now: number;
  elapsedSeconds: number;
  shouldShow: boolean;
  eventCount: number;
  channels: string[];
  events: DigestEvent[];
  grouped: Record<string, DigestEvent[]>;
}

interface Props {
  worldId?: string;
}

const SESSION_KEY = 'concordia:digest-shown:v1';

const CHANNEL_LABEL: Record<string, string> = {
  'world:hybrid-spawned':            'New hybrid species',
  'world:loot-dropped':              'Loot remained from kills',
  'world:companion-tamed':           'Companions tamed',
  'world:companion-bred':            'Companions bred',
  'world:building-state':            'Building state shifts',
  'world:event:scheduled':           'World events scheduled',
  'world:event:ended':               'World events ended',
  'world:crisis':                    'Crises arose',
  'world:crisis-resolved':           'Crises resolved',
  'faction-strategy:move-applied':   'Faction strategy moves',
  'faction:declared-war':            'Wars declared',
  'faction:proposed-truce':          'Truces proposed',
  'faction:alliance-formed':         'Alliances formed',
  'lattice:meta:derived':            'Lattice derivations',
  'quest:lattice-spawned':           'Lattice-born quests',
  'weather:update':                  'Weather shifted',
  'season:transition':               'Season turned',
  'evo:asset-promoted':              'Asset evolutions promoted',
};

function formatElapsed(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

function summariseEvent(ev: DigestEvent): string {
  const p = ev.payload || {};
  switch (ev.channel) {
    case 'world:hybrid-spawned': {
      const t = p.topology as string | undefined;
      return t ? `${t.replace(/_/g, ' ')} hybrid spawned` : 'New hybrid spawned';
    }
    case 'world:loot-dropped': {
      const src = p.sourceName as string | undefined;
      return src ? `${src} dropped loot` : 'Loot dropped';
    }
    case 'faction-strategy:move-applied': {
      const faction = (p.faction || p.factionId) as string | undefined;
      const move = (p.move || p.kind) as string | undefined;
      return `${faction ?? 'A faction'} ${move ?? 'made a move'}`.toLowerCase();
    }
    case 'faction:declared-war': {
      const a = (p.aggressorId || p.aggressor) as string | undefined;
      const d = (p.defenderId || p.defender) as string | undefined;
      return `${a ?? 'Aggressor'} declared war on ${d ?? 'defender'}`;
    }
    case 'world:event:scheduled': {
      return `${(p.title as string) ?? 'A world event'} scheduled`;
    }
    case 'world:event:ended': {
      return `${(p.title as string) ?? 'A world event'} ended`;
    }
    case 'season:transition': {
      return `Season turned to ${(p.season as string) ?? 'a new season'}`;
    }
    case 'world:companion-tamed': {
      return 'A nearby creature was tamed';
    }
    case 'world:companion-bred': {
      return 'A new companion was bred';
    }
    case 'weather:update': {
      return `Weather: ${(p.kind as string) ?? 'shifted'}`;
    }
    default: return ev.channel;
  }
}

export default function WhileYouWereAwayPanel({ worldId = 'concordia-hub' }: Props) {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Load on mount unless sticky-dismissed for this session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(SESSION_KEY) === '1') return;
    let cancelled = false;
    fetch(`/api/world/digest?worldId=${encodeURIComponent(worldId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DigestResponse | null) => {
        if (cancelled) return;
        if (!j?.ok || !j.shouldShow || j.eventCount === 0) return;
        setData(j);
        setOpen(true);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [worldId]);

  const close = useCallback(() => {
    setOpen(false);
    setDismissed(true);
    try { window.sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ok */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const sortedSections = useMemo(() => {
    if (!data) return [] as Array<{ channel: string; events: DigestEvent[] }>;
    return Object.entries(data.grouped)
      .map(([channel, events]) => ({ channel, events }))
      .sort((a, b) => b.events.length - a.events.length);
  }, [data]);

  if (!open || dismissed || !data) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center" onClick={close}>
      <div
        className="bg-slate-950/95 border border-amber-400/40 rounded-lg p-5 backdrop-blur-md w-[560px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-amber-300 uppercase tracking-wider">While You Were Away</h2>
            <div className="text-[10px] text-slate-400 mt-1">
              {formatElapsed(data.elapsedSeconds)} ago · {data.eventCount} events on {sortedSections.length} channels
            </div>
          </div>
          <button onClick={close} className="text-slate-400 hover:text-white text-sm">✕  Esc</button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {sortedSections.map(({ channel, events }) => (
            <div key={channel}>
              <div className="text-[10px] uppercase tracking-wider text-amber-200/70 mb-1">
                {CHANNEL_LABEL[channel] ?? channel} · {events.length}
              </div>
              <div className="space-y-1">
                {events.slice(0, 8).map((ev) => (
                  <div key={ev.id} className="text-xs text-slate-300 border border-white/5 bg-slate-900/50 rounded px-2 py-1">
                    {summariseEvent(ev)}
                  </div>
                ))}
                {events.length > 8 && (
                  <div className="text-[10px] text-slate-500 italic pl-1">…and {events.length - 8} more</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-slate-500 leading-relaxed">
          The simulation kept running while you were offline. Pop back in to see what changed.
        </div>
      </div>
    </div>
  );
}
