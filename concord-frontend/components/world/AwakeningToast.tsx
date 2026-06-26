'use client';

// WS4(b) — awakening opportunity toast.
//
// When a player SURVIVES a near-death hit, the server emits
// 'player:awakening-available' (MHA stress-trigger). This surfaces the moment:
// a dramatic toast offering to awaken a power. Previously "Awaken a power"
// dispatched a dead `concordia:awakening-offered` event to a powers UI that
// never existed. It now runs the real `skill-awakening.awaken` macro inline:
// the player picks one of their own skills, the macro realises the awakening
// (power spike + branch unlock, persisted), and the result surfaces in the
// System feed. Auto-dismisses after 8s.

import { useCallback, useEffect, useState } from 'react';
import { Flame, X, Loader2 } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { lensRun } from '@/lib/api/client';
import { pushSystem } from './SystemFeed';

interface AwakeningPayload { worldId?: string; hp?: number; maxHp?: number; source?: string; }

interface MySkill {
  id: string;
  name: string;
  maxDamage: number;
  element?: string;
  level: number;
}

interface RawSkill {
  id: string;
  title?: string;
  name?: string;
  skill_level?: number;
  data?: string | Record<string, unknown>;
}

function parseSkill(raw: RawSkill): MySkill {
  let element: string | undefined;
  let maxDamage = 10;
  try {
    const d = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
    const blob = (d || {}) as Record<string, unknown>;
    element = blob.element ? String(blob.element) : undefined;
    maxDamage = Number(blob.maxDamage ?? blob.max_damage ?? 10) || 10;
  } catch { /* keep defaults */ }
  return {
    id: raw.id,
    name: String(raw.title || raw.name || 'Skill'),
    maxDamage,
    element,
    level: Number(raw.skill_level || 0),
  };
}

export function AwakeningToast() {
  const [offer, setOffer] = useState<AwakeningPayload | null>(null);
  const [skills, setSkills] = useState<MySkill[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = subscribe<AwakeningPayload>('player:awakening-available', (payload) => {
      setOffer(payload || {});
      setSkills(null);
      // Auto-dismiss so a missed awakening doesn't pin the UI.
      window.setTimeout(() => setOffer((cur) => (cur === payload ? null : cur)), 8000);
    });
    return () => { off(); };
  }, []);

  // Load the player's real skills so they can choose which to awaken.
  const loadSkills = useCallback(async () => {
    try {
      const r = await fetch('/api/worlds/skills/mine', { credentials: 'include' });
      if (!r.ok) { setSkills([]); return; }
      const j = await r.json();
      const raw: RawSkill[] = Array.isArray(j?.skills) ? j.skills : [];
      setSkills(raw.map(parseSkill).sort((a, b) => b.level - a.level));
    } catch { setSkills([]); }
  }, []);

  const awaken = useCallback(async (skill: MySkill) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await lensRun('skill-awakening', 'awaken', {
        skill: { name: skill.name, maxDamage: skill.maxDamage, element: skill.element },
        trigger: offer?.source || 'near_death',
        seedKey: skill.id,
        persist: true,
      });
      const result = r?.data?.result as { ok?: boolean; awakening?: { name?: string } } | undefined;
      // Surface the outcome on the System feed (pushSystem → concordia:system).
      if (result?.ok) {
        pushSystem('POWER AWAKENED', result.awakening?.name || skill.name, 'awaken');
      } else {
        pushSystem('AWAKENING FAILED', skill.name, 'notice');
      }
    } catch { /* swallow — toast still closes */ }
    setBusy(false);
    setOffer(null);
    setSkills(null);
  }, [busy, offer]);

  if (!offer) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-28 left-1/2 z-50 -translate-x-1/2 animate-[fadeIn_0.3s_ease-out] rounded-lg border px-5 py-3 text-center shadow-xl backdrop-blur"
      style={{ borderColor: '#fb923c', background: 'rgba(20,10,4,0.82)' }}
      data-testid="awakening-toast"
    >
      <button
        onClick={() => { setOffer(null); setSkills(null); }}
        className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-200"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="flex items-center justify-center gap-2 text-sm font-semibold text-orange-300">
        <Flame size={16} className="text-orange-400" />
        Your power stirs at the brink of death
      </div>
      <div className="mt-0.5 text-xs text-slate-300">
        Surviving the edge has awakened something. Channel it into one of your skills.
      </div>

      {skills === null ? (
        <button
          onClick={loadSkills}
          className="mt-2 rounded-md border border-orange-500/70 bg-orange-500/15 px-4 py-1 text-xs font-medium text-orange-200 hover:bg-orange-500/25"
        >
          Awaken a power
        </button>
      ) : skills.length === 0 ? (
        <div className="mt-2 text-[11px] text-slate-400">No skills to awaken yet.</div>
      ) : (
        <div className="mt-2 flex max-w-xs flex-wrap justify-center gap-1">
          {skills.slice(0, 6).map((s) => (
            <button
              key={s.id}
              disabled={busy}
              onClick={() => awaken(s)}
              className="rounded-md border border-orange-500/60 bg-orange-500/10 px-2.5 py-1 text-[11px] text-orange-200 hover:bg-orange-500/25 disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AwakeningToast;
