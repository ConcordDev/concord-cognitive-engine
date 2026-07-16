'use client';

// Wave 4 gap-closure — Isekai Reincarnation prompt HUD (Foundry Phase-7
// system, docs/lens-specs/foundry-capability-map.md "Honest residual").
//
// server/lib/foundry/reincarnation.js (computeInheritance / reincarnate /
// getLives) + the reincarnation.reincarnate / reincarnation.lives macros
// were real and tested but had zero frontend caller. This HUD is that
// caller.
//
// Config-gated: useFoundrySystemGate('isekai-reincarnation') reads the
// current world's real rule_modulators.foundry.systems +
// rule_modulators.reincarnation (both written at Foundry publish time from
// the worldspec's selected systems/config) — this HUD renders nothing for
// a world whose worldspec never selected isekai-reincarnation, and nothing
// for a world that selected it but set `enabled: false` in its config
// (the real reincarnate() macro rejects that with reason
// 'reincarnation_disabled' — this HUD reads gate.config directly to avoid
// even offering a button the backend will just refuse).
//
// Trigger-condition design choice: `isDead` is passed down from
// app/lenses/world/page.tsx's own `combatState.isDead` — the real,
// existing client-tracked signal that flips true only on a genuine
// `combat:kill` socket event targeting the local player (see
// `handleCombatKill` in that file). That is the one honest "the player
// just died" signal already wired end-to-end; this HUD does not invent a
// second one. It is deliberately a SEPARATE, opt-in surface next to the
// existing ordinary hub-respawn flow (CombatSystem's death overlay /
// `handleRespawn`) rather than replacing it — reincarnation is an
// additional choice a Foundry world can offer, not a mandatory override of
// the base respawn contract every world already has.
//
// Honest scope note: `reincarnate()`'s `priorState` carries real numeric
// progress (xp/level/currency/skillPoints/renown) forward proportionally.
// This HUD does not yet have those live values plumbed to it (they live
// scattered across page.tsx's local state) and passes an honest empty
// `priorState: {}` rather than fabricating numbers — `computeInheritance`
// only inherits fields that are actually present, so an empty priorState
// correctly yields an empty `inherited` object (no boon invented). The life
// number, fraction, and memory-fragment text ARE fully real — they come
// straight from the `reincarnations` ledger.

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, X, History } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useFoundrySystemGate } from './useFoundrySystemGate';

interface InheritedRecord {
  fraction: number;
  memoryFragments: string | null;
  xp?: number;
  level?: number;
  currency?: number;
  skillPoints?: number;
  renown?: number;
}

interface Life {
  id: string;
  lifeNumber: number;
  priorAvatarId: string | null;
  inherited: InheritedRecord;
  reincarnatedAt: number;
}

interface Props {
  worldId: string;
  isDead: boolean;
}

export function ReincarnationPromptHUD({ worldId, isDead }: Props) {
  const gate = useFoundrySystemGate(worldId, 'isekai-reincarnation');
  const [dismissed, setDismissed] = useState(false);
  const [lives, setLives] = useState<Life[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ lifeNumber: number; inherited: InheritedRecord } | null>(null);

  const enabledInConfig = gate.config.enabled !== false; // matches reincarnate()'s own default

  const refreshLives = useCallback(async () => {
    if (!gate.enabled || !worldId) return;
    try {
      const r = await lensRun<{ lives: Life[] }>('reincarnation', 'lives', { worldId });
      if (r.data?.ok && r.data.result) setLives(r.data.result.lives);
    } catch { /* best-effort — the prompt still works without prior history */ }
  }, [gate.enabled, worldId]);

  // Reset the dismissal + any stale result once the player is alive again.
  useEffect(() => {
    if (!isDead) { setDismissed(false); setResult(null); setError(null); }
  }, [isDead]);

  useEffect(() => {
    if (isDead && gate.enabled && enabledInConfig) refreshLives();
  }, [isDead, gate.enabled, enabledInConfig, refreshLives]);

  const reincarnate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun<{ lifeNumber: number; inherited: InheritedRecord }>('reincarnation', 'reincarnate', {
        worldId, priorState: {},
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
        refreshLives();
      } else {
        setError(r.data?.error || 'Reincarnation failed');
      }
    } catch {
      setError('Reincarnation failed');
    } finally {
      setBusy(false);
    }
  }, [worldId, refreshLives]);

  // Honest gate: renders nothing for a world that never selected
  // isekai-reincarnation, or one that selected it with enabled:false.
  if (!gate.loaded || !gate.enabled || !enabledInConfig) return null;
  if (!isDead || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="pointer-events-auto fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-fuchsia-500/40 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur"
    >
      <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fuchsia-200">
          <Sparkles size={14} /> Reincarnation
        </h2>
        <button aria-label="Close" onClick={() => setDismissed(true)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
          <X size={12} />
        </button>
      </header>

      {!result ? (
        <>
          <p className="mb-2 text-[12px] text-zinc-300">
            This world offers reincarnation. {lives.length > 0
              ? `You have been reincarnated ${lives.length} time${lives.length === 1 ? '' : 's'} before.`
              : 'A fraction of your progress can carry into a new life.'}
          </p>
          {error && <p className="mb-2 text-[11px] text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={reincarnate}
              className="flex-1 rounded border border-fuchsia-500/40 bg-fuchsia-500/20 px-2 py-1.5 text-[11px] font-medium text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40"
            >
              {busy ? 'Reincarnating…' : 'Reincarnate'}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex-1 rounded border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Respawn normally instead
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-fuchsia-100">
            Life {result.lifeNumber} begins. {Math.round(result.inherited.fraction * 100)}% of your prior progress carries forward.
          </p>
          {result.inherited.memoryFragments && (
            <p className="flex items-start gap-1.5 text-[11px] italic text-zinc-400">
              <History size={12} className="mt-0.5 shrink-0" /> {result.inherited.memoryFragments}
            </p>
          )}
          {(result.inherited.xp || result.inherited.level || result.inherited.currency
            || result.inherited.skillPoints || result.inherited.renown) ? (
            <ul className="space-y-0.5 text-[10px] text-zinc-300">
              {result.inherited.xp !== undefined && <li>Inherited XP: {result.inherited.xp}</li>}
              {result.inherited.level !== undefined && <li>Inherited level floor: {result.inherited.level}</li>}
              {result.inherited.currency !== undefined && <li>Inherited currency: {result.inherited.currency}</li>}
              {result.inherited.skillPoints !== undefined && <li>Inherited skill points: {result.inherited.skillPoints}</li>}
              {result.inherited.renown !== undefined && <li>Inherited renown: {result.inherited.renown}</li>}
            </ul>
          ) : (
            <p className="text-[10px] text-zinc-500">No prior numeric progress was supplied to carry forward.</p>
          )}
          <p className="text-[11px] text-zinc-400">Use the world&apos;s Respawn control to step into this new life.</p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="w-full rounded border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default ReincarnationPromptHUD;
