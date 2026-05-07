'use client';

import { useState, useEffect, useRef } from 'react';
import { Activity, Pause, Play, X, ChevronDown, ChevronUp } from 'lucide-react';
import { subscribe, type SocketEvent } from '@/lib/realtime/socket';

// Emergent simulation events the panel surfaces. These are the things the
// world *creates on its own* — NPC death, evo-asset promotion, refusal
// fields declared, weather rolls, attention shifts — i.e. signals that
// previously fired silently to no UI surface.
//
// Authored events (combat-hit, marketplace-purchase, chat:token) are
// intentionally excluded — those have their own surfaces (CombatHUD,
// CurrencyHUD, chat panel).
type EmergentChannel = 'world' | 'entity' | 'agent' | 'evo' | 'weather' | 'crisis';

const TRACKED_EVENTS: { name: SocketEvent; channel: EmergentChannel; label: string }[] = [
  { name: 'entity:death',                channel: 'entity',  label: 'NPC died' },
  { name: 'body:instantiated',           channel: 'entity',  label: 'Avatar entered world' },
  { name: 'body:destroyed',              channel: 'entity',  label: 'Avatar left world' },
  { name: 'agent:insights',              channel: 'agent',   label: 'Agent insight' },
  { name: 'forgetting:cycle_complete',   channel: 'agent',   label: 'Forgetting cycle done' },
  { name: 'dream:captured',              channel: 'agent',   label: 'Dream captured' },
  { name: 'lattice:meta:derived',        channel: 'agent',   label: 'Meta-derivation' },
  { name: 'lattice:meta:convergence',    channel: 'agent',   label: 'Meta-convergence' },
  { name: 'attention:allocation',        channel: 'agent',   label: 'Attention shifted' },
  { name: 'evo:asset-promoted',          channel: 'evo',     label: 'Evo-asset promoted' },
  { name: 'combat:combo-evolved',        channel: 'evo',     label: 'Combo evolved' },
  { name: 'world:refusal-field',         channel: 'world',   label: 'Refusal field' },
  { name: 'world:crisis',                channel: 'crisis',  label: 'World crisis' },
  { name: 'world:crisis-resolved',       channel: 'crisis',  label: 'Crisis resolved' },
  { name: 'weather:update',              channel: 'weather', label: 'Weather' },
  { name: 'world:event:scheduled',       channel: 'world',   label: 'Event scheduled' },
  { name: 'faction-war:tick',            channel: 'world',   label: 'Faction war' },
  { name: 'faction-war:kill',            channel: 'world',   label: 'Faction war kill' },
  { name: 'dtu:promoted',                channel: 'agent',   label: 'DTU promoted' },
  { name: 'pain:wound_created',          channel: 'agent',   label: 'Pain wound' },
  { name: 'pain:wound_healed',           channel: 'agent',   label: 'Wound healed' },
];

const CHANNEL_COLORS: Record<EmergentChannel, string> = {
  world:   'text-emerald-300',
  entity:  'text-amber-300',
  agent:   'text-sky-300',
  evo:     'text-violet-300',
  weather: 'text-slate-300',
  crisis:  'text-rose-300',
};

const MAX_FEED_ITEMS = 50;

interface FeedItem {
  id: string;
  ts: number;
  channel: EmergentChannel;
  label: string;
  detail: string;
}

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  // Prefer human-readable fields when present.
  const name =
    (p.npcName as string | undefined) ||
    (p.entityName as string | undefined) ||
    (p.title as string | undefined) ||
    (p.kind as string | undefined) ||
    (p.eventType as string | undefined) ||
    (p.weather as string | undefined) ||
    (p.condition as string | undefined) ||
    '';
  const where =
    (p.worldId as string | undefined) ||
    (p.districtId as string | undefined) ||
    (p.cityId as string | undefined) ||
    '';
  if (name && where) return `${name} · ${where}`;
  if (name) return name;
  if (where) return where;
  return '';
}

export function EmergentEventFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeChannels, setActiveChannels] = useState<Set<EmergentChannel>>(
    new Set(['world', 'entity', 'agent', 'evo', 'weather', 'crisis']),
  );
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    for (const evt of TRACKED_EVENTS) {
      const off = subscribe(evt.name, (payload: unknown) => {
        if (pausedRef.current) return;
        setItems((prev) => {
          const next: FeedItem = {
            id: `${evt.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ts: Date.now(),
            channel: evt.channel,
            label: evt.label,
            detail: summarize(payload),
          };
          // Newest first, capped — old entries fall off.
          return [next, ...prev].slice(0, MAX_FEED_ITEMS);
        });
      });
      unsubs.push(off);
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, []);

  const visible = items.filter((i) => activeChannels.has(i.channel));

  const toggleChannel = (ch: EmergentChannel) => {
    setActiveChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  const formatTime = (ts: number) => {
    const dt = (Date.now() - ts) / 1000;
    if (dt < 5) return 'now';
    if (dt < 60) return `${Math.floor(dt)}s`;
    if (dt < 3600) return `${Math.floor(dt / 60)}m`;
    return `${Math.floor(dt / 3600)}h`;
  };

  return (
    <div className="absolute right-4 top-1/2 z-30 w-72 -translate-y-1/2">
      <div className="rounded-lg border border-emerald-500/30 bg-black/70 backdrop-blur-md shadow-lg">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10"
        >
          <span className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" />
            Emergent feed
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] tabular-nums">
              {visible.length}
            </span>
          </span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {expanded && (
          <>
            <div className="flex items-center gap-1 border-t border-emerald-500/20 px-2 py-1.5">
              <button
                onClick={() => setPaused((v) => !v)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/10"
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? 'Paused' : 'Live'}
              </button>
              <div className="ml-auto flex flex-wrap gap-1">
                {(Object.keys(CHANNEL_COLORS) as EmergentChannel[]).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => toggleChannel(ch)}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      activeChannels.has(ch)
                        ? `${CHANNEL_COLORS[ch]} bg-white/5`
                        : 'text-slate-500'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
                {items.length > 0 && (
                  <button
                    onClick={() => setItems([])}
                    className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200"
                    title="Clear"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border-t border-emerald-500/20">
              {visible.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-slate-500">
                  Watching for world events…
                </div>
              ) : (
                <ul className="divide-y divide-emerald-500/10">
                  {visible.map((item) => (
                    <li key={item.id} className="px-3 py-1.5">
                      <div className="flex items-baseline gap-2 text-[11px]">
                        <span className={`font-medium ${CHANNEL_COLORS[item.channel]}`}>
                          {item.label}
                        </span>
                        <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                          {formatTime(item.ts)}
                        </span>
                      </div>
                      {item.detail && (
                        <div className="mt-0.5 truncate text-[10px] text-slate-400">
                          {item.detail}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
