'use client';

/**
 * CombatFlowHotbar — the contextual combat UI for the procedural emergent
 * combat system. Renders only when combat is active (target present or
 * recently engaged). Lives next to GameJuice in the world lens.
 *
 * Three things stack together in one HUD strip across the lower-left:
 *
 *   1. Context badge   — current combat context (ground/aerial/vehicle/
 *                        hacker/underwater/mixed) with damage/cost modifiers.
 *                        Auto-refreshes when player position / vehicle /
 *                        hacker-mode flag changes.
 *   2. Combo suggestion — when the player has evolved combos for the active
 *                        context, a faint glowing pill suggests the next
 *                        step in a combo branch ("Chain: Pull → Uppercut →
 *                        Aerial Boost → Dive Slam"). Driven by the most
 *                        recently used action sequence.
 *   3. Spell + combo hotbar — slots 1-9. Slot population by priority:
 *                        evolved combos for this context > spell DTUs whose
 *                        contexts list this context > generic spells. Press
 *                        the digit to dispatch the action; click also works.
 *
 * No menus, no spell book screen. Spells live in inventory as DTUs and the
 * hotbar shows the ones the current context can actually use.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface PlayerPos { x: number; y: number; z: number }

interface ContextResult {
  context: string;
  activeContexts: string[];
  modifiers: {
    damageMul: number;
    incomingMul: number;
    manaCostMul: number;
    staminaCostMul: number;
    bioPowerCostMul: number;
    evadeBonus: number;
    styleHints: string[];
  };
  styleHints: string[];
}

interface SpellDTU {
  id: string;
  name: string;
  type: string;
  element: string | null;
  contexts: string[];
  costs: Record<string, number>;
}

interface FighterCombo {
  id: string;
  name: string;
  context: string;
  tier: number;
  uses: number;
  successRate: number;
  steps: Array<{ action: string; action_meta?: Record<string, unknown> }>;
  vfxSeed?: string;
}

interface ComboSuggestion {
  comboId: string;
  comboName: string;
  tier: number;
  successRate: number;
  nextStep: { action: string; action_meta?: Record<string, unknown> };
  remainingSteps: Array<{ action: string }>;
}

interface Props {
  playerPos: PlayerPos;
  inVehicle?: boolean;
  hackerMode?: boolean;
  inCombat: boolean;
  /** Recent action chain — last few actions the player took. Drives suggestions. */
  recentChain: Array<{ action: string }>;
  /** Currently equipped weapon (gates ranged crosshair etc.) */
  equippedWeapon?: { id: string; type: 'melee' | 'ranged' | 'magic' | 'fist' } | null;
}

const CONTEXT_ICON: Record<string, string> = {
  ground: '🦶',
  aerial: '🪶',
  vehicle: '🛞',
  hacker: '⚡',
  underwater: '🌊',
  mixed: '✦',
};

const CONTEXT_LABEL: Record<string, string> = {
  ground: 'Ground',
  aerial: 'Aerial',
  vehicle: 'Vehicle',
  hacker: 'Breach',
  underwater: 'Underwater',
  mixed: 'Adaptive',
};

const CONTEXT_TINT: Record<string, string> = {
  ground: 'border-stone-400/60 text-stone-200',
  aerial: 'border-sky-400/60 text-sky-200',
  vehicle: 'border-amber-400/60 text-amber-200',
  hacker: 'border-fuchsia-400/60 text-fuchsia-200',
  underwater: 'border-cyan-400/60 text-cyan-200',
  mixed: 'border-emerald-400/60 text-emerald-200',
};

export default function CombatFlowHotbar({
  playerPos, inVehicle, hackerMode, inCombat, recentChain, equippedWeapon,
}: Props) {
  const [context, setContext] = useState<ContextResult | null>(null);
  const [combos, setCombos] = useState<FighterCombo[]>([]);
  const [spells, setSpells] = useState<SpellDTU[]>([]);
  const [suggestion, setSuggestion] = useState<ComboSuggestion | null>(null);
  const lastFetchAtRef = useRef(0);

  // ── Poll context every ~700ms while in combat ───────────────────────────────
  useEffect(() => {
    if (!inCombat) return;
    let cancelled = false;
    async function fetchContext() {
      const params = new URLSearchParams({
        x: String(playerPos.x), y: String(playerPos.y), z: String(playerPos.z),
        inVehicle: inVehicle ? '1' : '0',
        hackerMode: hackerMode ? '1' : '0',
      });
      try {
        const r = await fetch(`/api/combat-flow/context?${params}`, { credentials: 'same-origin' });
        const j = await r.json();
        if (!cancelled && j?.ok) setContext(j as ContextResult);
      } catch { /* network silent */ }
    }
    fetchContext();
    const id = setInterval(fetchContext, 700);
    return () => { cancelled = true; clearInterval(id); };
  }, [inCombat, playerPos.x, playerPos.y, playerPos.z, inVehicle, hackerMode]);

  // ── Fetch combos + spells once per context change ───────────────────────────
  useEffect(() => {
    if (!inCombat || !context?.context) return;
    const now = performance.now();
    if (now - lastFetchAtRef.current < 1500) return;
    lastFetchAtRef.current = now;
    Promise.all([
      fetch(`/api/combat-flow/combos?context=${context.context}`, { credentials: 'same-origin' })
        .then((r) => r.json()).catch(() => null),
      fetch(`/api/combat-flow/spells`, { credentials: 'same-origin' })
        .then((r) => r.json()).catch(() => null),
    ]).then(([cRes, sRes]) => {
      if (cRes?.ok) setCombos(cRes.combos ?? []);
      if (sRes?.ok) setSpells(sRes.spells ?? []);
    });
  }, [inCombat, context?.context]);

  // ── Suggest next action whenever the chain or context changes ───────────────
  useEffect(() => {
    if (!inCombat || !context?.context) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    fetch('/api/combat-flow/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentChain: recentChain, context: context.context }),
    }).then((r) => r.json()).then((j) => {
      if (!cancelled) setSuggestion(j?.suggestion ?? null);
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [inCombat, context?.context, recentChain]);

  // ── Listen for evolved-combo broadcast so the suggestion appears live ───────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      // Re-fetch combos so the new branch shows up in the slot row + as a
      // suggestion on the next attack.
      lastFetchAtRef.current = 0;
      if (context?.context) {
        fetch(`/api/combat-flow/combos?context=${context.context}`, { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((j) => { if (j?.ok) setCombos(j.combos ?? []); })
          .catch(() => {});
      }
    };
    window.addEventListener('concordia:combo-evolved', handler);
    return () => window.removeEventListener('concordia:combo-evolved', handler);
  }, [context?.context]);

  // ── Hotbar slot population: combos for this context first, then spells ──────
  type Slot =
    | { kind: 'combo'; combo: FighterCombo }
    | { kind: 'spell'; spell: SpellDTU };
  const slots: Slot[] = useMemo(() => {
    const out: Slot[] = [];
    if (!context) return out;
    for (const c of combos) {
      if (c.context === context.context && out.length < 9) {
        out.push({ kind: 'combo', combo: c });
      }
    }
    // Spells whose contexts list includes this context, then generic spells
    const matchingSpells = spells.filter((s) => !s.contexts?.length || s.contexts.includes(context.context));
    const otherSpells    = spells.filter((s) => s.contexts?.length && !s.contexts.includes(context.context));
    for (const s of [...matchingSpells, ...otherSpells]) {
      if (out.length >= 9) break;
      out.push({ kind: 'spell', spell: s });
    }
    return out;
  }, [context, combos, spells]);

  // ── Slot trigger ────────────────────────────────────────────────────────────
  const triggerSlot = useCallback((idx: number) => {
    const slot = slots[idx];
    if (!slot) return;
    if (slot.kind === 'combo') {
      window.dispatchEvent(new CustomEvent('concordia:combo-trigger', {
        detail: {
          comboId: slot.combo.id,
          comboName: slot.combo.name,
          steps: slot.combo.steps,
          tier: slot.combo.tier,
          vfxSeed: slot.combo.vfxSeed,
        },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('concordia:spell-cast', {
        detail: {
          spellId: slot.spell.id, spellName: slot.spell.name,
          element: slot.spell.element, costs: slot.spell.costs,
        },
      }));
    }
  }, [slots]);

  // ── Keyboard 1-9 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!inCombat) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const n = parseInt(e.key, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        triggerSlot(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inCombat, triggerSlot]);

  if (!inCombat || !context) return null;

  const ctxKey  = context.context;
  const ctxIcon = CONTEXT_ICON[ctxKey] ?? '✦';
  const ctxName = CONTEXT_LABEL[ctxKey] ?? ctxKey;
  const tint    = CONTEXT_TINT[ctxKey] ?? CONTEXT_TINT.ground;

  return (
    <div className="fixed bottom-32 left-4 z-40 pointer-events-none flex flex-col gap-2 max-w-[480px]">
      {/* Context badge */}
      <div className={`pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-950/85 border ${tint} backdrop-blur-md self-start`}>
        <span className="text-base">{ctxIcon}</span>
        <span className="text-xs uppercase tracking-wider font-semibold">{ctxName}</span>
        <span className="text-[10px] text-slate-400">
          dmg ×{context.modifiers.damageMul.toFixed(2)} · evade +{(context.modifiers.evadeBonus * 100).toFixed(0)}%
        </span>
      </div>

      {/* Combo suggestion — only when the player has a partial chain matching */}
      {suggestion && (
        <div
          className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-md self-start"
          style={{
            background: 'rgba(15,23,42,0.85)',
            border: '1px solid rgba(34,211,238,0.55)',
            boxShadow: '0 0 16px rgba(34,211,238,0.3)',
            animation: 'comboPulse 2.4s ease-in-out infinite',
          }}
        >
          <span className="text-cyan-300 text-[10px] uppercase tracking-wider font-semibold">Chain</span>
          <span className="text-cyan-100 text-xs">{suggestion.comboName}</span>
          <span className="text-[10px] text-cyan-400/70">
            T{suggestion.tier} · {(suggestion.successRate * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Slots 1-9 */}
      <div className="pointer-events-auto flex gap-1.5">
        {Array.from({ length: 9 }).map((_, i) => {
          const slot = slots[i];
          const key = i + 1;
          if (!slot) {
            return (
              <div
                key={i}
                className="w-12 h-12 rounded-lg bg-slate-950/70 border border-white/10 flex flex-col items-center justify-center"
              >
                <span className="text-[9px] text-slate-400 font-mono">{key}</span>
              </div>
            );
          }
          if (slot.kind === 'combo') {
            return (
              <button
                key={i}
                onClick={() => triggerSlot(i)}
                className="w-12 h-12 rounded-lg bg-slate-950/85 border-2 border-cyan-500/60 flex flex-col items-center justify-center hover:bg-cyan-500/10 transition-colors relative"
                title={slot.combo.name}
                style={{ boxShadow: '0 0 8px rgba(34,211,238,0.3)' }}
              >
                <span className="text-[8px] text-cyan-300 font-mono absolute top-0.5 left-1">{key}</span>
                <span className="text-base">⚔</span>
                <span className="text-[8px] text-cyan-100 truncate max-w-[44px]">T{slot.combo.tier}</span>
              </button>
            );
          }
          return (
            <button
              key={i}
              onClick={() => triggerSlot(i)}
              className="w-12 h-12 rounded-lg bg-slate-950/85 border-2 border-fuchsia-500/50 flex flex-col items-center justify-center hover:bg-fuchsia-500/10 transition-colors relative"
              title={slot.spell.name}
              style={{ boxShadow: '0 0 8px rgba(232,121,249,0.25)' }}
            >
              <span className="text-[8px] text-fuchsia-300 font-mono absolute top-0.5 left-1">{key}</span>
              <span className="text-base">✦</span>
              <span className="text-[8px] text-fuchsia-100 truncate max-w-[44px]">
                {slot.spell.element ?? slot.spell.type.slice(0, 4)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ranged crosshair hint when ranged equipped */}
      {equippedWeapon?.type === 'ranged' && (
        <div className="pointer-events-none fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30">
          <div className="w-6 h-6 border-2 border-amber-400/70 rounded-full" />
          <div className="absolute top-1/2 left-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 bg-amber-400 rounded-full" />
        </div>
      )}

      <style jsx>{`
        @keyframes comboPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.65; }
        }
      `}</style>
    </div>
  );
}
