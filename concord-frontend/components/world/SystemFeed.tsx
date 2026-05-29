'use client';

// The System — Concordia's diegetic, push-driven status layer.
//
// In isekai (Solo Leveling, ORV, The Gamer) the "System" is the blue-window
// layer that narrates progression: LEVEL UP, skill acquired, quest updates,
// awakenings, world events. Concordia is uniquely suited to it because players,
// NPCs, and hostiles all run on the SAME substrate (levels, skills, evolution),
// so the System isn't a personal cheat — it's the world's physics made legible.
//
// This component is the single home for those notifications. It subscribes to the
// events that already fire across the engine and renders them as a stack of
// diegetic System windows — never polled. Player-facing + player-richer: players
// get the full window; NPCs/hostiles run on the leaner backend substrate (no UI).
//
// Pushed sources consumed: skill level-ups, power manifestation/fusion, awakening
// opportunities, quest lifecycle, faction clashes, refusal fields, and the
// dedicated system:* channel for anything that wants to address the System directly.

import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUpCircle, Flame, ScrollText, Swords, Cpu, X } from 'lucide-react';
import { subscribe, type SocketEvent } from '@/lib/realtime/socket';

type SystemKind = 'level' | 'power' | 'awaken' | 'quest' | 'world' | 'notice';

interface SystemEntry {
  id: string;
  kind: SystemKind;
  title: string;
  detail?: string;
  ts: number;
}

const ICONS: Record<SystemKind, typeof Sparkles> = {
  level: ArrowUpCircle,
  power: Sparkles,
  awaken: Flame,
  quest: ScrollText,
  world: Swords,
  notice: Cpu,
};
const ACCENTS: Record<SystemKind, string> = {
  level: '#38bdf8',   // sky — LEVEL UP
  power: '#a78bfa',   // violet — power gained
  awaken: '#fb923c',  // orange — awakening
  quest: '#fbbf24',   // amber — quest
  world: '#f87171',   // red — world event
  notice: '#5eead4',  // teal — generic
};

const MAX_VISIBLE = 5;
const TTL_MS = 7000;

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

export function SystemFeed() {
  const [entries, setEntries] = useState<SystemEntry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const push = (kind: SystemKind, title: string, detail?: string) => {
      const id = `sys-${Date.now()}-${idRef.current++}`;
      setEntries((prev) => [{ id, kind, title, detail, ts: Date.now() }, ...prev].slice(0, MAX_VISIBLE));
      window.setTimeout(() => setEntries((prev) => prev.filter((e) => e.id !== id)), TTL_MS);
    };

    // (event, handler) pairs — each maps a live engine event into a System window.
    const wires: Array<[SocketEvent, (p: Record<string, unknown>) => void]> = [
      ['skill:xp-awarded', (p) => {
        if (!p?.leveledUp) return; // only narrate the level-up moment, not every XP tick
        const skill = str(p.skillType) || str(p.action) || 'a skill';
        const lvl = str(p.newLevel) || str(p.level);
        push('level', 'LEVEL UP', lvl ? `${skill} reached Lv ${lvl}` : `${skill} grew stronger`);
      }],
      ['system:level-up', (p) => push('level', 'LEVEL UP', str(p.detail) || str(p.skill))],
      ['system:skill-acquired', (p) => push('power', 'POWER ACQUIRED', str(p.name) || str(p.skill))],
      ['system:skill-evolved', (p) => push('power', 'POWER EVOLVED', str(p.name) || str(p.skill))],
      ['evo:asset-promoted', (p) => push('power', 'POWER MANIFESTED', str(p.description) || str(p.kind))],
      ['player:awakening-available', () => push('awaken', 'AWAKENING', 'Surviving the brink stirred a power. Channel it.')],
      ['quest:new', (p) => push('quest', 'QUEST', str(p.title) || str(p.name) || 'A new quest opened')],
      ['quest:completed', (p) => push('quest', 'QUEST COMPLETE', str(p.title) || str(p.name))],
      ['faction-war:clash', (p) => push('world', 'FACTION CLASH', str(p.winner) ? `${str(p.winner)} prevails` : undefined)],
      ['world:refusal-field', (p) => push('world', 'REFUSAL FIELD', str(p.kind) || str(p.reason))],
      ['system:notice', (p) => push('notice', str(p.title) || 'SYSTEM', str(p.detail))],
    ];

    const unsubs = wires.map(([evt, fn]) => subscribe<Record<string, unknown>>(evt, (p) => {
      try { fn(p || {}); } catch { /* swallow */ }
    }));

    // Local pushes: a client action (the player's own fusion/awakening/quest
    // accept) can surface a System window instantly without a server round-trip,
    // via window.dispatchEvent(new CustomEvent('concordia:system', { detail })).
    const onLocal = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: SystemKind; title?: string; detail?: string }>).detail;
      if (d?.title) push(d.kind && d.kind in ICONS ? d.kind : 'notice', d.title, d.detail);
    };
    window.addEventListener('concordia:system', onLocal);

    return () => { for (const u of unsubs) u(); window.removeEventListener('concordia:system', onLocal); };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-50 flex w-[300px] flex-col gap-2" data-testid="system-feed">
      {entries.map((e) => {
        const Icon = ICONS[e.kind];
        const accent = ACCENTS[e.kind];
        return (
          <div
            key={e.id}
            className="pointer-events-auto animate-[fadeIn_0.25s_ease-out] rounded-md border bg-[rgba(7,11,18,0.82)] px-3 py-2 shadow-lg backdrop-blur"
            style={{ borderColor: accent, boxShadow: `0 0 14px -4px ${accent}` }}
          >
            <div className="flex items-center gap-1.5">
              <Icon size={13} style={{ color: accent }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
                [ System ] {e.title}
              </span>
              <button
                onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                className="ml-auto text-slate-500 hover:text-slate-300"
                aria-label="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
            {e.detail && <div className="mt-0.5 pl-[19px] text-xs text-slate-200">{e.detail}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Surface a System window from anywhere on the client (no server round-trip). */
export function pushSystem(title: string, detail?: string, kind: SystemKind = 'notice'): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('concordia:system', { detail: { kind, title, detail } }));
  } catch { /* no-op */ }
}

export default SystemFeed;
