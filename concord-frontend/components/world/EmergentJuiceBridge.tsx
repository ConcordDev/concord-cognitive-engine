'use client';

/**
 * Legibility Wave 1 — the world stops being silent.
 *
 * Sibling to LevelUpJuiceBridge (which already juices the player-progression
 * events: level/quest/marketplace/skill/evo/reputation). This bridge gives the
 * ~discrete, world-significant EMERGENT events a felt moment — they currently
 * land only as silent rows in EmergentEventFeed. Reuses the existing juice()
 * (concordia:game-juice) + sfx() (concordia:soundscape-command) + addToast
 * primitives; no new infra.
 *
 * Deliberately SELECTIVE (signal, not noise): only discrete, infrequent,
 * tonally-clear world events get a toast; frequent/ambient streams
 * (weather:update, entity:death, *:batch) are intentionally omitted — the ones
 * that matter to the player get the louder, contextual treatment from the
 * Personal-Stake bridge (Wave 2).
 *
 * No JSX. Mount once near GameJuice in the world page.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { juice, sfx } from '@/lib/concordia/juice';
import { useUIStore } from '@/store/ui';

export function EmergentJuiceBridge() {
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;
    const offs: Array<() => void> = [];
    const on = <T,>(name: string, fn: (m: T) => void) =>
      offs.push(subscribe<T>(name as never, fn));

    // ── Faction arc ──────────────────────────────────────────────────────
    on<{ a?: string; b?: string; aggressor?: string; target?: string }>('faction:war-declared', (m) => {
      const a = m.a ?? m.aggressor ?? 'A faction', b = m.b ?? m.target ?? 'a rival';
      addToast({ type: 'info', message: `⚔ War declared: ${a} → ${b}`, duration: 7000 });
      juice('milestone'); sfx('ui_milestone');
    });
    on<{ a?: string; b?: string }>('faction:alliance-formed', (m) => {
      addToast({ type: 'success', message: `🤝 Alliance formed: ${m.a ?? 'two factions'} + ${m.b ?? ''}`.trim(), duration: 6000 });
      juice('success'); sfx('ui_success');
    });

    // ── World crises + refusal fields ────────────────────────────────────
    on<{ description?: string; type?: string }>('world:crisis', (m) => {
      addToast({ type: 'info', message: `⚠ Crisis: ${m.description ?? m.type ?? 'something stirs in the world'}`, duration: 7000 });
      juice('failure'); sfx('ui_failure');
    });
    on<{ description?: string }>('world:crisis-resolved', (m) => {
      addToast({ type: 'success', message: `✓ Crisis resolved${m.description ? `: ${m.description}` : ''}`, duration: 6000 });
      juice('success'); sfx('ui_success');
    });
    on<{ strength?: number; kind?: string }>('world:refusal-field', (m) => {
      // Only the compound (strength ≥ 6) fields are world-significant.
      if ((m.strength ?? 0) >= 6) {
        addToast({ type: 'info', message: '◈ A compound refusal field has risen', duration: 6000 });
        juice('milestone'); sfx('ui_milestone');
      }
    });
    on<{ kind?: string }>('refusal:compound-threshold', () => {
      juice('milestone'); sfx('ui_milestone');
    });

    // ── Realms ───────────────────────────────────────────────────────────
    on<{ name?: string }>('kingdom:founded', (m) => {
      addToast({ type: 'success', message: `♔ ${m.name ?? 'A kingdom'} founded`, duration: 6000 });
      juice('milestone'); sfx('ui_milestone');
    });
    on<{ name?: string }>('kingdom:fallen', (m) => {
      addToast({ type: 'info', message: `♚ ${m.name ?? 'A kingdom'} has fallen`, duration: 7000 });
      juice('failure'); sfx('ui_failure');
    });

    // ── Creatures ────────────────────────────────────────────────────────
    on<{ species?: string; name?: string }>('companion:tame-success', (m) => {
      addToast({ type: 'success', message: `🐾 Tamed ${m.name ?? m.species ?? 'a creature'}`, duration: 5000 });
      juice('success'); sfx('ui_success');
    });

    // ── Intrigue + the embodied self (the 3 events Wave 1 also wires server-side) ──
    on<{ schemeKind?: string; kind?: string; outcome?: string }>('npc:scheme-resolved', (m) => {
      addToast({ type: 'info', message: `🗝 A scheme came to light${(m.schemeKind ?? m.kind) ? `: ${m.schemeKind ?? m.kind}` : ''}`, duration: 6000 });
      juice('discovery'); sfx('ui_discovery');
    });
    on<{ subjectKind?: string }>('prediction:realised', () => {
      addToast({ type: 'info', message: '✶ Something you foresaw has come to pass', duration: 6000 });
      juice('milestone'); sfx('ui_milestone');
    });
    on<{ title?: string }>('dream:composed', () => {
      // Quiet, personal — soft juice, no toast.
      juice('discovery');
    });

    return () => { for (const off of offs) { try { off(); } catch { /* ok */ } } };
  }, []);

  return null;
}
