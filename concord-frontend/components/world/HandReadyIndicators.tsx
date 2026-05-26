'use client';

/**
 * HandReadyIndicators — Skyrim-style bottom-left "what's in each hand"
 * display. Two stacked panels (right hand on top, left below) showing
 * the equipped weapon's class icon + category color, OR the active
 * spell glyph + element color when in cast mode.
 *
 * Subscribes to:
 *   - `concordia:loadout-changed` to refresh weapons
 *   - `concordia:spell-primed` { hand, name, element, glyph } when a
 *     spell is bound to a hand via GlyphCastHUD
 *
 * Hand routing in this game:
 *   - Right hand = `E` (default attack)
 *   - Left hand  = `Shift + E`
 *   - Two-handed weapon occupies both slots and routes every E to a
 *     heavy swing — both panels show the same item with a "2H" banner.
 */

import { useCallback, useEffect, useState } from 'react';

interface LoadoutItem {
  id: string;
  item_name: string;
  weapon_class: string | null;
  handedness: string | null;
  category?: string | null;
  rarity?: string | null;
  rarity_color?: string | null;
}

interface PrimedSpell {
  hand: 'right' | 'left';
  name: string;
  element: string | null;
  glyph: string;
}

// Match the palette used in CharacterSheet.
const CATEGORY_COLOR: Record<string, string> = {
  firearm:           '#fb923c',  // orange-400
  energy:            '#22d3ee',  // cyan-400
  heavy_explosive:   '#f87171',  // red-400
  projectile:        '#34d399',  // emerald-400
  melee_blade_1h:    '#cbd5e1',  // slate-300
  melee_blade_2h:    '#e2e8f0',  // slate-200
  melee_polearm:     '#d6d3d1',  // stone-300
  melee_blunt_1h:    '#fbbf24',  // amber-400
  melee_blunt_2h:    '#fcd34d',  // amber-300
  melee_exotic:      '#e879f9',  // fuchsia-400
  fist:              '#fb7185',  // rose-400
  focus:             '#a78bfa',  // violet-400
  shield:            '#38bdf8',  // sky-400
  cyberware:         '#2dd4bf',  // teal-400
  hybrid:            '#818cf8',  // indigo-400
  amorphous:         '#f9a8d4',  // pink-300
};

const ELEMENT_COLOR: Record<string, string> = {
  fire:      '#f87171', ice:       '#7dd3fc', lightning: '#fde047',
  water:     '#60a5fa', earth:     '#a8a29e', wind:      '#86efac',
  metal:     '#cbd5e1', wood:      '#a7f3d0',
  holy:      '#fbbf24', light:     '#fde68a', dark:      '#94a3b8',
  shadow:    '#475569', void:      '#581c87',
  physical:  '#cbd5e1', force:     '#a3e635', gravity:   '#7c3aed',
  sonic:     '#f0abfc',
  bio:       '#86efac', poison:    '#84cc16', blood:     '#dc2626',
  energy:    '#22d3ee', radiation: '#a3e635', arcane:    '#c084fc',
  psychic:   '#e879f9', time:      '#fcd34d', space:     '#67e8f9',
  refusal:   '#facc15', amorphous: '#f9a8d4',
};

export default function HandReadyIndicators() {
  const [rightHand, setRightHand] = useState<LoadoutItem | null>(null);
  const [leftHand,  setLeftHand]  = useState<LoadoutItem | null>(null);
  const [primed,    setPrimed]    = useState<{ right?: PrimedSpell; left?: PrimedSpell }>({});

  const refresh = useCallback(() => {
    fetch('/api/combat-flow/loadout', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const lo = j?.loadout;
        setRightHand(lo?.rightHand ?? null);
        setLeftHand(lo?.leftHand ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onLoadout = () => refresh();
    const onPrime = (e: Event) => {
      const ce = e as CustomEvent<PrimedSpell>;
      if (!ce.detail) return;
      setPrimed((prev) => ({ ...prev, [ce.detail.hand]: ce.detail }));
    };
    const onUnprime = (e: Event) => {
      const ce = e as CustomEvent<{ hand: 'right' | 'left' }>;
      if (!ce.detail?.hand) return;
      setPrimed((prev) => {
        const next = { ...prev };
        delete next[ce.detail.hand];
        return next;
      });
    };
    window.addEventListener('concordia:loadout-changed', onLoadout);
    window.addEventListener('concordia:spell-primed', onPrime as EventListener);
    window.addEventListener('concordia:spell-unprimed', onUnprime as EventListener);
    return () => {
      window.removeEventListener('concordia:loadout-changed', onLoadout);
      window.removeEventListener('concordia:spell-primed', onPrime as EventListener);
      window.removeEventListener('concordia:spell-unprimed', onUnprime as EventListener);
    };
  }, [refresh]);

  const isTwoHanded = !!(rightHand && leftHand && rightHand.id === leftHand.id);

  return (
    <div className="pointer-events-none fixed bottom-24 left-3 z-40 flex flex-col gap-1.5">
      {isTwoHanded && (
        <div className="text-[9px] uppercase tracking-widest font-bold text-amber-300 text-center">
          Two-Handed
        </div>
      )}
      <HandPanel
        label="R"
        keyBind="E"
        item={rightHand}
        spell={primed.right}
        isTwoHand={isTwoHanded}
      />
      <HandPanel
        label="L"
        keyBind="⇧E"
        item={leftHand}
        spell={primed.left}
        isTwoHand={isTwoHanded}
      />
    </div>
  );
}

function HandPanel({
  label,
  keyBind,
  item,
  spell,
  isTwoHand,
}: {
  label: string;
  keyBind: string;
  item: LoadoutItem | null;
  spell?: PrimedSpell;
  isTwoHand: boolean;
}) {
  // Spell-primed mode wins over weapon display.
  if (spell) {
    const color = ELEMENT_COLOR[spell.element ?? ''] || '#cbd5e1';
    return (
      <div
        className="w-44 rounded-md border-2 px-2 py-1.5 bg-slate-950/85 backdrop-blur-sm relative overflow-hidden"
        style={{ borderColor: color, boxShadow: `0 0 12px ${color}40` }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{ background: `radial-gradient(circle at 30% 50%, ${color}, transparent 70%)` }}
        />
        <div className="flex items-center gap-2 relative">
          <div
            className="font-mono text-2xl leading-none"
            style={{ color, textShadow: `0 0 6px ${color}` }}
          >
            {spell.glyph}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wider text-slate-400">
              {label} hand · {keyBind}
            </div>
            <div className="text-xs font-semibold text-white truncate" style={{ color }}>
              {spell.name}
            </div>
            <div className="text-[9px] opacity-70" style={{ color }}>
              {spell.element || 'spell'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="w-44 rounded-md border border-white/10 bg-slate-950/60 backdrop-blur-sm px-2 py-1.5">
        <div className="text-[9px] uppercase tracking-wider text-slate-500">
          {label} hand · {keyBind}
        </div>
        <div className="text-xs text-slate-500 italic">empty</div>
      </div>
    );
  }

  const catColor = CATEGORY_COLOR[item.category ?? ''] || '#94a3b8';
  return (
    <div
      className="w-44 rounded-md border bg-slate-950/85 backdrop-blur-sm px-2 py-1.5"
      style={{
        borderColor: catColor,
        borderLeftWidth: 3,
        borderLeftColor: item.rarity_color || catColor,
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-[9px] uppercase tracking-wider text-slate-400">
          {label} hand · {keyBind}
        </div>
        {item.rarity && (
          <div
            className="text-[8px] uppercase tracking-widest font-bold"
            style={{ color: item.rarity_color || '#94a3b8' }}
          >
            {item.rarity}
          </div>
        )}
      </div>
      <div
        className="text-xs font-semibold truncate"
        style={{ color: item.rarity_color || '#fff' }}
      >
        {item.item_name}
      </div>
      <div className="text-[9px]" style={{ color: catColor, opacity: 0.85 }}>
        {item.weapon_class || '—'}
        {item.category ? ` · ${item.category.replace(/_/g, ' ')}` : ''}
        {isTwoHand ? ' · 2H' : ''}
      </div>
    </div>
  );
}
