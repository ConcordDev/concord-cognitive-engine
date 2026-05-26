'use client';

/**
 * CharacterSheet — categorised loadout + spells + powers + skills.
 *
 * Pulls from GET /api/character-sheet/me, which routes through the
 * taxonomy registries (lib/combat/loadout.js + lib/combat/taxonomies.js)
 * to bucket every weapon / spell / skill into a category. Player-invented
 * entries that don't match a canonical pattern surface in their own
 * "Amorphous" group, so emergent vocabulary stays visible.
 *
 * Four tabs:
 *   - Loadout — equipped weapons + cosmetic slots, grouped by category
 *   - Spells  — known glyph spells, grouped by school/element
 *   - Powers  — superhero archetypes (flight, telekinesis, …) by category
 *   - Skills  — combat / movement / crafting / social / etc.
 *
 * Mount in lenses/world/page.tsx alongside EquipmentSlotsPanel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Decorated {
  id?: string;
  item_name?: string;
  weapon_class?: string | null;
  handedness?: string | null;
  category?: string | null;
  reach_m?: number | null;
  amorphous?: boolean;
}

interface Spell {
  id: string;
  name: string;
  element: string | null;
  element_category: string | null;
  max_damage: number;
  range_m: number;
  composed_glyph: string;
  mana_cost: number;
  stamina_cost: number;
  cooldown_s: number;
  school: string | null;
  amorphous: boolean;
}

interface Power {
  skill_type: string;
  level: number;
  xp: number;
  xp_to_next: number;
  power: string;
  power_category: string;
}

interface Skill {
  skill_type: string;
  level: number;
  xp: number;
  xp_to_next: number;
  skill_category: string | null;
}

interface Sheet {
  userId: string;
  loadout: {
    rightHand: Decorated | null;
    leftHand:  Decorated | null;
    head:      Decorated | null;
    body:      Decorated | null;
    accessory: Decorated | null;
  } | null;
  spells: Spell[];
  powers: Power[];
  skills: Skill[];
}

type Tab = 'loadout' | 'spells' | 'powers' | 'skills';

const TAB_LABELS: Record<Tab, string> = {
  loadout: 'Loadout',
  spells:  'Spells',
  powers:  'Powers',
  skills:  'Skills',
};

const CATEGORY_COLOR: Record<string, string> = {
  firearm:           'border-orange-400/50 bg-orange-500/10 text-orange-200',
  energy:            'border-cyan-400/50  bg-cyan-500/10  text-cyan-200',
  heavy_explosive:   'border-red-400/50   bg-red-500/10   text-red-200',
  projectile:        'border-emerald-400/50 bg-emerald-500/10 text-emerald-200',
  melee_blade_1h:    'border-slate-300/50 bg-slate-500/10 text-slate-200',
  melee_blade_2h:    'border-slate-200/60 bg-slate-400/15 text-slate-100',
  melee_polearm:     'border-stone-300/50 bg-stone-500/10 text-stone-200',
  melee_blunt_1h:    'border-amber-400/50 bg-amber-500/10 text-amber-200',
  melee_blunt_2h:    'border-amber-300/60 bg-amber-400/15 text-amber-100',
  melee_exotic:      'border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-200',
  fist:              'border-rose-400/50  bg-rose-500/10  text-rose-200',
  focus:             'border-violet-400/50 bg-violet-500/10 text-violet-200',
  shield:            'border-sky-400/50   bg-sky-500/10   text-sky-200',
  cyberware:         'border-teal-400/50  bg-teal-500/10  text-teal-200',
  hybrid:            'border-indigo-400/50 bg-indigo-500/10 text-indigo-200',
  amorphous:         'border-pink-400/60  bg-pink-500/15  text-pink-100',
};

const categoryColor = (cat: string | null | undefined) =>
  (cat && CATEGORY_COLOR[cat]) || 'border-white/15 bg-slate-800/40 text-slate-300';

interface Props {
  onClose?: () => void;
}

export default function CharacterSheet({ onClose }: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [tab, setTab] = useState<Tab>('loadout');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/character-sheet/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) {
          setSheet(data.sheet);
          setError(null);
        } else {
          setError(data?.error || 'failed_to_load');
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const onLoadoutChange = () => refresh();
    window.addEventListener('concordia:loadout-changed', onLoadoutChange);
    return () => window.removeEventListener('concordia:loadout-changed', onLoadoutChange);
  }, [refresh]);

  const groupedSpells = useMemo(() => {
    const groups: Record<string, Spell[]> = {};
    for (const s of sheet?.spells || []) {
      const k = s.amorphous ? 'amorphous' : (s.school || s.element_category || s.element || 'uncategorised');
      groups[k] = groups[k] || [];
      groups[k].push(s);
    }
    return groups;
  }, [sheet]);

  const groupedPowers = useMemo(() => {
    const groups: Record<string, Power[]> = {};
    for (const p of sheet?.powers || []) {
      const k = p.power_category || 'uncategorised';
      groups[k] = groups[k] || [];
      groups[k].push(p);
    }
    return groups;
  }, [sheet]);

  const groupedSkills = useMemo(() => {
    const groups: Record<string, Skill[]> = {};
    for (const s of sheet?.skills || []) {
      const k = s.skill_category || 'uncategorised';
      groups[k] = groups[k] || [];
      groups[k].push(s);
    }
    return groups;
  }, [sheet]);

  return (
    <div className="bg-slate-950/95 border border-cyan-500/30 rounded-lg p-4 backdrop-blur-md w-[420px] max-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-cyan-300 uppercase tracking-wider">Character Sheet</h3>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">✕</button>
        )}
      </div>

      <div className="flex gap-1 mb-3">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider transition-colors ${
              tab === t
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                : 'bg-slate-900/60 text-slate-400 border border-white/5 hover:bg-slate-800/60'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && <div className="text-xs text-slate-400 text-center py-6">Loading…</div>}
        {error && <div className="text-xs text-red-300 text-center py-6">{error}</div>}

        {!loading && !error && sheet && tab === 'loadout' && (
          <LoadoutTab sheet={sheet} />
        )}
        {!loading && !error && sheet && tab === 'spells' && (
          <GroupedList
            empty="No spells composed yet — open Glyph Cast HUD to compose."
            groups={groupedSpells}
            renderEntry={(s) => (
              <div className="flex items-center justify-between text-xs">
                <div className="flex-1 min-w-0">
                  <div className="text-white truncate">
                    <span className="font-mono mr-2 text-violet-300">{s.composed_glyph}</span>
                    {s.name}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {s.element || '?'}
                    {' · '}
                    {s.max_damage} dmg
                    {' · '}
                    {s.range_m}m
                    {s.cooldown_s ? ` · ${s.cooldown_s}s cd` : ''}
                  </div>
                </div>
              </div>
            )}
          />
        )}
        {!loading && !error && sheet && tab === 'powers' && (
          <GroupedList
            empty="No powers learned yet — train a power-typed skill."
            groups={groupedPowers}
            renderEntry={(p) => (
              <ProgressLine label={p.skill_type} level={p.level} xp={p.xp} xpToNext={p.xp_to_next} />
            )}
          />
        )}
        {!loading && !error && sheet && tab === 'skills' && (
          <GroupedList
            empty="No skills trained yet — use combat / crafting / movement to gain XP."
            groups={groupedSkills}
            renderEntry={(s) => (
              <ProgressLine label={s.skill_type} level={s.level} xp={s.xp} xpToNext={s.xp_to_next} />
            )}
          />
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-slate-500 leading-relaxed">
        Pink "amorphous" entries are player-invented and outside the canonical
        registry — the system stamps your invention as legit.
      </div>
    </div>
  );
}

function LoadoutTab({ sheet }: { sheet: Sheet }) {
  if (!sheet.loadout) return <div className="text-xs text-slate-400 text-center py-6">No equipment</div>;
  const lo = sheet.loadout;
  const isTwoHanded =
    !!(lo.rightHand && lo.leftHand && lo.rightHand.id === lo.leftHand.id);
  const slots: Array<['Right Hand' | 'Left Hand' | 'Head' | 'Body' | 'Accessory', Decorated | null]> = [
    ['Right Hand', lo.rightHand],
    ['Left Hand',  lo.leftHand],
    ['Head',       lo.head],
    ['Body',       lo.body],
    ['Accessory',  lo.accessory],
  ];

  return (
    <div className="space-y-2">
      {isTwoHanded && (
        <div className="px-2 py-1 bg-amber-500/20 border border-amber-400/40 rounded text-[10px] uppercase tracking-widest text-amber-200 text-center font-bold">
          Two-Handed
        </div>
      )}
      {slots.map(([label, item]) => (
        <div
          key={label}
          className={`rounded-md border p-2 ${
            item ? categoryColor(item.category) : 'border-white/10 bg-slate-900/40 text-slate-500'
          }`}
        >
          <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
          {item ? (
            <>
              <div className="text-sm font-semibold mt-0.5 truncate">{item.item_name}</div>
              <div className="text-[10px] opacity-70 mt-0.5">
                {item.weapon_class || '—'}
                {item.category ? ` · ${item.category}` : ''}
                {item.handedness && item.handedness !== 'either' ? ` · ${item.handedness}-hand` : ''}
                {item.reach_m ? ` · ${item.reach_m}m reach` : ''}
                {item.amorphous ? ' · amorphous' : ''}
              </div>
            </>
          ) : (
            <div className="text-xs mt-0.5 opacity-70">empty</div>
          )}
        </div>
      ))}
    </div>
  );
}

function GroupedList<T>({
  groups,
  renderEntry,
  empty,
}: {
  groups: Record<string, T[]>;
  renderEntry: (entry: T) => React.ReactNode;
  empty: string;
}) {
  const keys = Object.keys(groups).sort();
  if (keys.length === 0) {
    return <div className="text-xs text-slate-400 text-center py-6">{empty}</div>;
  }
  return (
    <div className="space-y-3">
      {keys.map((k) => (
        <div key={k}>
          <div className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider mb-1 inline-block border ${categoryColor(k)}`}>
            {k.replace(/_/g, ' ')}
          </div>
          <div className="space-y-1">
            {groups[k].map((e, idx) => (
              <div key={idx} className="border border-white/5 bg-slate-900/40 rounded px-2 py-1.5">
                {renderEntry(e)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressLine({ label, level, xp, xpToNext }: { label: string; level: number; xp: number; xpToNext: number }) {
  const pct = xpToNext > 0 ? Math.min(100, Math.round((xp / xpToNext) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-white truncate">{label}</span>
        <span className="text-[10px] text-slate-400 font-mono ml-2">Lv {level}</span>
      </div>
      <div className="mt-1 h-1 bg-slate-800 rounded overflow-hidden">
        <div className="h-full bg-cyan-400/60" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[9px] text-slate-500 mt-0.5 font-mono">
        {xp}/{xpToNext} xp
      </div>
    </div>
  );
}
