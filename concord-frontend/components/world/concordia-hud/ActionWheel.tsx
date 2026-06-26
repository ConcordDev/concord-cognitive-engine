'use client';

/**
 * ActionWheel — Layer 4 of the dynamic HUD.
 *
 * Generalised ≤ 8-spoke radial. Configurations:
 *   - 'quick_panel'  (Tab hold)   — 8 most-used panels
 *   - 'skill'        (Q hold)     — bloodline-aware skill picks
 *   - 'tool'         (T hold)     — context tool actions
 *
 * Hold-to-open, mouse-over-spoke to preview, release to select.
 * Honors expertise level via useHUDContext — newcomers see 4 spokes,
 * standard 6, detailed/engineering 8.
 *
 * Mode-aware: skill wheel still available in combat (the only one);
 * others hidden in combat/dialogue/vehicle/photo.
 */

import { useEffect, useState } from 'react';
import { useHUDContext } from './HUDContextProvider';

export interface WheelSpoke {
  id: string;
  label: string;
  glyph?: string;
  disabled?: boolean;
  action: () => void;
}

interface ActionWheelProps {
  variant: 'quick_panel' | 'skill' | 'tool';
  /** Override hold key. Defaults: Tab / q / t */
  holdKey?: string;
  /** Externally-supplied spokes; if absent, defaults derived per variant. */
  spokes?: WheelSpoke[];
}

const DEFAULT_KEY: Record<ActionWheelProps['variant'], string> = {
  quick_panel: 'Tab',
  skill: 'q',
  tool: 't',
};

function dispatchPanelOpen(panelId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId } }));
}

function defaultSpokes(variant: ActionWheelProps['variant']): WheelSpoke[] {
  if (variant === 'quick_panel') {
    return [
      { id: 'bloodline', label: 'Bloodline', glyph: '✦', action: () => dispatchPanelOpen('bloodline') },
      { id: 'schemes',   label: 'Schemes',   glyph: '⚐', action: () => dispatchPanelOpen('schemes') },
      { id: 'jobs',      label: 'Jobs',      glyph: '⚒', action: () => dispatchPanelOpen('jobs') },
      { id: 'crafts',    label: 'Crafts',    glyph: '⚜', action: () => dispatchPanelOpen('crafts') },
      { id: 'dynasty',   label: 'Dynasty',   glyph: '☥', action: () => dispatchPanelOpen('dynasty') },
      { id: 'marriage',  label: 'Marriage',  glyph: '∞', action: () => dispatchPanelOpen('marriage') },
      { id: 'council',   label: 'Council',   glyph: '⚖', action: () => dispatchPanelOpen('council') },
      { id: 'calendar',  label: 'Calendar',  glyph: '☼', action: () => dispatchPanelOpen('calendar') },
    ];
  }
  if (variant === 'skill') {
    return [
      { id: 'basic_strike', label: 'Strike',    glyph: '✖', action: () => dispatch('skill', 'basic_strike') },
      { id: 'fire_proj',    label: 'Fire Bolt', glyph: '✦', action: () => dispatch('skill', 'fire_projectile') },
      { id: 'heal_self',    label: 'Heal',      glyph: '☥', action: () => dispatch('skill', 'heal_self') },
      { id: 'precision',    label: 'Precision', glyph: '✺', action: () => dispatch('skill', 'precision_strike') },
      { id: 'lightning',    label: 'Lightning', glyph: '⚡', action: () => dispatch('skill', 'lightning_chain') },
      { id: 'ice',          label: 'Ice',       glyph: '❄', action: () => dispatch('skill', 'ice_lance') },
      { id: 'force',        label: 'Force',     glyph: '◉', action: () => dispatch('skill', 'force_push') },
      { id: 'bio',          label: 'Bio',       glyph: '☣', action: () => dispatch('skill', 'bio_poison') },
    ];
  }
  // tool
  return [
    { id: 'mount',     label: 'Mount',     glyph: '◍', action: () => dispatch('tool', 'mount') },
    { id: 'dismount',  label: 'Dismount',  glyph: '◎', action: () => dispatch('tool', 'dismount') },
    { id: 'equip',     label: 'Equip',     glyph: '⚔', action: () => dispatch('tool', 'equip') },
    { id: 'unequip',   label: 'Unequip',   glyph: '⚒', action: () => dispatch('tool', 'unequip') },
    { id: 'torch',     label: 'Torch',     glyph: '✸', action: () => dispatch('tool', 'torch') },
    { id: 'ration',    label: 'Eat ration', glyph: '◌', action: () => dispatch('tool', 'ration') },
  ];
}

// Tool spoke id → the HUD panel that actually performs it. The default tool
// wheel is a fallback (SkillWheelMount supplies real skills for the skill
// wheel); routing these to panels gives the selection a real effect instead
// of the dead `concordia:wheel-action` event that had no consumer.
const TOOL_PANEL: Record<string, string> = {
  mount: 'mounts',
  dismount: 'mounts',
  equip: 'crafts',
  unequip: 'crafts',
  torch: 'crafts',
  ration: 'crafts',
};

function dispatch(category: string, id: string) {
  if (typeof window === 'undefined') return;
  if (category === 'skill') {
    // Ride the canonical cast channel (same consumer as SkillWheelMount /
    // CombatFlowHotbar → world page.tsx handles anim + VFX + combat:attack).
    window.dispatchEvent(new CustomEvent('concordia:spell-cast', { detail: { spellId: id, spellName: id } }));
    return;
  }
  // Tool wheel → open the panel that owns the action (mounts / crafts /
  // inventory). PanelHost consumes concordia:panel-open.
  const panelId = TOOL_PANEL[id] || 'crafts';
  window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId } }));
}

function maxSpokesFor(expertise: ReturnType<typeof useHUDContext.getState>['expertiseLevel']): number {
  switch (expertise) {
    case 'newcomer':    return 4;
    case 'standard':    return 6;
    case 'detailed':    return 8;
    case 'engineering': return 8;
  }
}

export function ActionWheel({ variant, holdKey, spokes }: ActionWheelProps) {
  const mode = useHUDContext((s) => s.inputMode);
  const expertise = useHUDContext((s) => s.expertiseLevel);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const key = holdKey || DEFAULT_KEY[variant];
  const all = spokes && spokes.length > 0 ? spokes : defaultSpokes(variant);
  const maxSpokes = maxSpokesFor(expertise);
  const visible = all.slice(0, maxSpokes);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onDown(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);
      if (inField) return;
      if (ev.key === key) { ev.preventDefault(); setOpen(true); }
    }
    function onUp(ev: KeyboardEvent) {
      if (ev.key === key) {
        if (hover != null && visible[hover]) {
          try { visible[hover].action(); } catch { /* ignore */ }
        }
        setOpen(false); setHover(null);
      }
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [key, hover, visible]);

  // Mode gating — only skill wheel survives combat.
  if (!open) return null;
  if (mode === 'photo') return null;
  if (variant !== 'skill' && (mode === 'combat' || mode === 'dialogue' || mode === 'vehicle')) return null;

  const radius = 96;
  const n = visible.length;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center" data-testid="hud-action-wheel" data-variant={variant} role="menu" aria-label={`${variant} action wheel`}>
      <div className="relative w-64 h-64 pointer-events-auto">
        {visible.map((s, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const isHover = hover === i;
          return (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              data-spoke-id={s.id}
              aria-label={s.label}
              disabled={s.disabled}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => h === i ? null : h)}
              onClick={() => { try { s.action(); } catch { /* ignore */ } setOpen(false); }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 inline-flex flex-col items-center justify-center w-16 h-16 rounded-full border ${
                s.disabled ? 'bg-zinc-900/50 border-zinc-800 text-zinc-600 cursor-not-allowed'
                : isHover ? 'bg-amber-900/70 border-amber-600 text-amber-100 scale-110'
                : 'bg-zinc-950/80 border-zinc-700/60 text-zinc-300 hover:bg-zinc-900'
              } transition-all duration-100`}
              style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
            >
              <span aria-hidden="true" className="text-lg">{s.glyph || '·'}</span>
              <span className="text-[9px] uppercase tracking-wider leading-none mt-0.5">{s.label}</span>
            </button>
          );
        })}
        {/* Centre label */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] uppercase tracking-widest text-zinc-400 pointer-events-none">
          {variant.replace('_', ' ')}
        </div>
      </div>
    </div>
  );
}
