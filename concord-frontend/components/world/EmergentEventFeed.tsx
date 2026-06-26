'use client';

import { useState, useEffect, useRef } from 'react';
import { Activity, Pause, Play, X, ChevronDown, ChevronUp } from 'lucide-react';
import { subscribe, type SocketEvent } from '@/lib/realtime/socket';
import { eventPriority } from '@/lib/concordia/event-digest';

// Emergent simulation events the panel surfaces. These are the things the
// world *creates on its own* — NPC death, evo-asset promotion, refusal
// fields declared, weather rolls, attention shifts — i.e. signals that
// previously fired silently to no UI surface.
//
// Authored events (combat-hit, marketplace-purchase, chat:token) are
// intentionally excluded — those have their own surfaces (CombatHUD,
// CurrencyHUD, chat panel).
type EmergentChannel = 'world' | 'entity' | 'agent' | 'evo' | 'weather' | 'crisis' | 'companion' | 'system_health' | 'faction' | 'npc' | 'self' | 'economy' | 'social';

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
  { name: 'companion:tame-success',      channel: 'companion', label: 'Companion tamed' },
  { name: 'companion:level-up',          channel: 'companion', label: 'Companion leveled up' },
  { name: 'kingdom:founded',             channel: 'world',     label: 'Kingdom founded' },
  { name: 'kingdom:decree-enacted',      channel: 'world',     label: 'Decree enacted' },
  { name: 'kingdom:contested',           channel: 'crisis',    label: 'Kingdom contested' },
  { name: 'kingdom:fallen',              channel: 'crisis',    label: 'Kingdom fallen' },
  { name: 'faction-war:clash',           channel: 'crisis',    label: 'Faction clash' },
  { name: 'fishing:caught',              channel: 'world',     label: 'Fish caught' },
  { name: 'minigame:complete',           channel: 'world',     label: 'Minigame complete' },
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
  // Phase 3 — system health channel surfaces detector-emitted invariant warnings.
  { name: 'world:invariant-warning' as SocketEvent, channel: 'system_health', label: 'System invariant warning' },
  // Phase F3.5 — strategic faction + scheme + prediction + dream + refusal.
  { name: 'faction:war-declared'      as SocketEvent, channel: 'faction', label: 'Faction war declared' },
  { name: 'faction:alliance-formed'   as SocketEvent, channel: 'faction', label: 'Faction alliance formed' },
  { name: 'faction:truce-sought'      as SocketEvent, channel: 'faction', label: 'Faction truce sought' },
  { name: 'faction:strategy-move'     as SocketEvent, channel: 'faction', label: 'Faction strategic move' },
  { name: 'npc:scheme-resolved'       as SocketEvent, channel: 'npc',     label: 'NPC scheme resolved' },
  { name: 'dream:composed'            as SocketEvent, channel: 'self',    label: 'Dream composed' },
  { name: 'prediction:realised'       as SocketEvent, channel: 'self',    label: 'Prediction realised' },
  { name: 'refusal:compound-threshold' as SocketEvent, channel: 'world',  label: 'Compound refusal' },
  // Phase G1.5 — batched NPC sim + chain + social bridge surfacing.
  { name: 'combat:chain'              as SocketEvent, channel: 'world',   label: 'Lightning chain' },
  { name: 'npc:activity-batch'        as SocketEvent, channel: 'npc',     label: 'NPC activity batch' },
  { name: 'npc:economy-batch'         as SocketEvent, channel: 'economy', label: 'NPC economy batch' },
  { name: 'social:shadows-synced'     as SocketEvent, channel: 'social',  label: 'Social bridge synced' },
  // WS-LEGIBILITY — surface the silent world-simulation events the dynamism audit
  // flagged (verify-event-consumers.mjs). Discrete, player-facing signals only;
  // per-frame combat/mount noise + infra channels stay excluded by design.
  { name: 'boss:phase-enter'          as SocketEvent, channel: 'crisis',    label: 'World boss phase' },
  { name: 'boss:state'                as SocketEvent, channel: 'crisis',    label: 'World boss state' },
  { name: 'combat:death'              as SocketEvent, channel: 'entity',    label: 'Combatant died' },
  { name: 'combat:hero_kill'          as SocketEvent, channel: 'world',     label: 'Hero kill' },
  { name: 'concordia:lethal-hit'      as SocketEvent, channel: 'crisis',    label: 'Lethal hit' },
  { name: 'house:visitor-arrived'     as SocketEvent, channel: 'social',    label: 'House visitor' },
  { name: 'mount:hungry'              as SocketEvent, channel: 'companion', label: 'Mount hungry' },
  { name: 'mount:loyalty-low'         as SocketEvent, channel: 'companion', label: 'Mount loyalty low' },
  { name: 'nemesis:defeated'          as SocketEvent, channel: 'npc',       label: 'Nemesis defeated' },
  { name: 'npc:combat-resolved'       as SocketEvent, channel: 'npc',       label: 'NPC combat resolved' },
  { name: 'npc:level-up'              as SocketEvent, channel: 'npc',       label: 'NPC leveled up' },
  { name: 'npc:quest-accepted'        as SocketEvent, channel: 'npc',       label: 'NPC took a quest' },
  { name: 'npc:quest-completed'       as SocketEvent, channel: 'npc',       label: 'NPC finished a quest' },
  { name: 'player:corpse-dropped'     as SocketEvent, channel: 'entity',    label: 'Corpse dropped' },
  { name: 'player:corpse-recovered'   as SocketEvent, channel: 'entity',    label: 'Corpse recovered' },
  { name: 'quest:accepted'            as SocketEvent, channel: 'self',      label: 'Quest accepted' },
  { name: 'quest:rewards_granted'     as SocketEvent, channel: 'self',      label: 'Quest rewards' },
  { name: 'event:reward'              as SocketEvent, channel: 'self',      label: 'Event reward' },
  { name: 'scheme:intervened'         as SocketEvent, channel: 'npc',       label: 'Scheme intervened' },
  { name: 'scheme:deception'          as SocketEvent, channel: 'npc',       label: 'Saw through a con' },
  { name: 'weaponise:fired'           as SocketEvent, channel: 'npc',       label: 'Secret weaponised' },
  { name: 'skill:tier-witnessed'      as SocketEvent, channel: 'self',      label: 'Mastery tier witnessed' },
  { name: 'stealth:detected'          as SocketEvent, channel: 'crisis',    label: 'Spotted while sneaking' },
  { name: 'tournament:bracket-advanced' as SocketEvent, channel: 'world',   label: 'Tournament advanced' },
  { name: 'tournament:complete'       as SocketEvent, channel: 'world',     label: 'Tournament complete' },
  { name: 'ghost-hunt:residue-confronted' as SocketEvent, channel: 'crisis', label: 'Residue confronted' },
  { name: 'fishing:bite'              as SocketEvent, channel: 'world',     label: 'Fish on the line' },
  { name: 'minigame:scored'           as SocketEvent, channel: 'world',     label: 'Minigame score' },
  { name: 'world:building-placed'     as SocketEvent, channel: 'world',     label: 'Building placed' },
  { name: 'world:building-removed'    as SocketEvent, channel: 'world',     label: 'Building removed' },
  { name: 'world:building-spawned'    as SocketEvent, channel: 'world',     label: 'Building spawned' },
  { name: 'world:legendary-achievement' as SocketEvent, channel: 'world',   label: 'Legendary achievement' },
  { name: 'world:npc-alert'           as SocketEvent, channel: 'crisis',    label: 'NPC alert' },
  { name: 'world:player-arrived'      as SocketEvent, channel: 'entity',    label: 'Player arrived' },
  { name: 'world:season-transition'   as SocketEvent, channel: 'weather',   label: 'Season turned' },
  { name: 'world:weather'             as SocketEvent, channel: 'weather',   label: 'Weather shifted' },
  // WS-LEGIBILITY (cont.) — 9 backend emits to world:${worldId} that had no
  // frontend listener. Each carries a discrete, player-facing signal.
  { name: 'world:npc-bark'           as SocketEvent, channel: 'npc',       label: 'NPC said' },
  { name: 'world:npc-attack'         as SocketEvent, channel: 'npc',       label: 'NPC attacked' },
  { name: 'world:npc-spared'         as SocketEvent, channel: 'npc',       label: 'NPC spared' },
  { name: 'world:racing-started'     as SocketEvent, channel: 'world',     label: 'Race started' },
  { name: 'world:basketball-started' as SocketEvent, channel: 'world',     label: 'Match started' },
  { name: 'mount:behavior'           as SocketEvent, channel: 'npc',       label: 'Mount behavior' },
  { name: 'world:node-update'        as SocketEvent, channel: 'world',     label: 'Resource node changed' },
  { name: 'world:loot-node'          as SocketEvent, channel: 'world',     label: 'Loot dropped' },
  { name: 'world:broadcast'          as SocketEvent, channel: 'system_health', label: 'World broadcast' },
];

const CHANNEL_COLORS: Record<EmergentChannel, string> = {
  world:         'text-emerald-300',
  entity:        'text-amber-300',
  agent:         'text-sky-300',
  evo:           'text-violet-300',
  weather:       'text-slate-300',
  crisis:        'text-rose-300',
  companion:     'text-pink-300',
  system_health: 'text-red-400',
  faction:       'text-orange-300',
  npc:           'text-purple-300',
  self:          'text-indigo-300',
  economy:       'text-amber-300',
  social:        'text-cyan-300',
};

const MAX_FEED_ITEMS = 50;

interface FeedItem {
  id: string;
  ts: number;
  channel: EmergentChannel;
  label: string;
  detail: string;
  // Track 3 — curation: priority tier + batched-count so a burst of the same
  // ambient kind reads as one "×N" row and critical beats sort to the top.
  priority: 'critical' | 'major' | 'ambient';
  count: number;
}

const FEED_BATCH_WINDOW_MS = 4000;
const FEED_PRIORITY_RANK: Record<FeedItem['priority'], number> = { critical: 3, major: 2, ambient: 1 };

/** Critical first, then most-recent; over cap, ambient drops before critical. */
function sortFeed(items: FeedItem[]): FeedItem[] {
  const cmp = (a: FeedItem, b: FeedItem) => {
    const pr = FEED_PRIORITY_RANK[b.priority] - FEED_PRIORITY_RANK[a.priority];
    return pr !== 0 ? pr : b.ts - a.ts;
  };
  const sorted = items.slice().sort(cmp);
  if (sorted.length <= MAX_FEED_ITEMS) return sorted;
  const critical = sorted.filter((i) => i.priority === 'critical');
  const rest = sorted.filter((i) => i.priority !== 'critical').slice(0, Math.max(0, MAX_FEED_ITEMS - critical.length));
  return [...critical, ...rest].sort(cmp);
}

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  // Prefer human-readable fields when present.
  // Spoken / broadcast text reads as the detail line verbatim when present
  // (npc-bark `text`, world:broadcast `message`). These carry the real signal.
  const spoken = (p.text as string | undefined) || (p.message as string | undefined) || '';
  if (spoken) return spoken;
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
    new Set(['world', 'entity', 'agent', 'evo', 'weather', 'crisis', 'companion']),
  );
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    for (const evt of TRACKED_EVENTS) {
      const off = subscribe(evt.name, (payload: unknown) => {
        if (pausedRef.current) return;
        const now = Date.now();
        const priority = eventPriority(evt.name, evt.channel);
        setItems((prev) => {
          // Curation: batch a same-kind ambient/major burst within the window into
          // one row (count++), so the feed digests instead of flooding. Critical
          // beats never batch — each is its own line.
          if (priority !== 'critical') {
            const idx = prev.findIndex(
              (it) => it.label === evt.label && it.priority !== 'critical' && now - it.ts <= FEED_BATCH_WINDOW_MS,
            );
            if (idx >= 0) {
              const merged = prev.slice();
              merged[idx] = { ...merged[idx], count: merged[idx].count + 1, ts: now, detail: summarize(payload) || merged[idx].detail };
              return sortFeed(merged);
            }
          }
          const next: FeedItem = {
            id: `${evt.name}-${now}-${Math.random().toString(36).slice(2, 6)}`,
            ts: now,
            channel: evt.channel,
            label: evt.label,
            detail: summarize(payload),
            priority,
            count: 1,
          };
          return sortFeed([next, ...prev]);
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
                        : 'text-slate-400'
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
                <div className="px-3 py-6 text-center text-[11px] text-slate-400">
                  Watching for world events…
                </div>
              ) : (
                <ul className="divide-y divide-emerald-500/10">
                  {visible.map((item) => (
                    <li key={item.id} className="px-3 py-1.5">
                      <div className="flex items-baseline gap-2 text-[11px]">
                        <span className={`font-medium ${CHANNEL_COLORS[item.channel]}`}>
                          {item.label}{item.count > 1 ? ` ×${item.count}` : ''}
                        </span>
                        {item.priority === 'critical' && (
                          <span className="text-[9px] uppercase tracking-wide text-rose-400">!</span>
                        )}
                        <span className="ml-auto text-[10px] tabular-nums text-slate-400">
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
