'use client';

// Wave 4 gap-closure — Skill Affinity Panel (Foundry Phase-7 per-player
// skill-learning system, docs/lens-specs/foundry-capability-map.md
// "Honest residual").
//
// server/lib/foundry/skill-affinity.js (recordSkillUse / getPlayerAffinity /
// effectiveAffinity) + the skill_affinity.record / skill_affinity.get
// macros were real and tested but had zero frontend caller. This panel is
// that caller for skill_affinity.get (per-skill query surface); recording a
// use is the combat/craft/cast path's job elsewhere, not this panel's.
//
// Config-gated: useFoundrySystemGate('skill-affinity-player') reads the
// current world's real rule_modulators.foundry.systems. Note this system's
// registry entry is `activation: { kind: 'always_on' }`
// (server/lib/foundry/system-registry.js) — the compiler intentionally
// writes NOTHING under a per-system rule_modulators key for it
// (compiler.js `case "always_on": break`), because it's a player-scoped
// system, not a per-world one. It is still recorded in
// rule_modulators.foundry.systems when a worldspec selects it, which is
// why that array — not "does a keyed config object exist" — is this
// panel's one honest gate, exactly like the other three systems.
//
// Skill ids come from ALL_SKILL_KEYS, the real mirror of the server's
// SKILL_CATALOG (lib/concordia/skill-descriptors.ts) — not an invented
// list. A skill the player has never used correctly reads back affinity
// 1.0 (the real DB-backed baseline from getPlayerAffinity, not a fake
// placeholder — see that function's own doc comment).

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useFoundrySystemGate } from './useFoundrySystemGate';
import { ALL_SKILL_KEYS } from '@/lib/concordia/skill-descriptors';

interface AffinityResult {
  skillId: string;
  playerAffinity: number;
  effective: number;
}

interface Props {
  worldId: string;
}

export function SkillAffinityPanel({ worldId }: Props) {
  const gate = useFoundrySystemGate(worldId, 'skill-affinity-player');
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState<string>(ALL_SKILL_KEYS[0]);
  const [result, setResult] = useState<AffinityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun<AffinityResult>('skill_affinity', 'get', { skillId: id, worldId });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setError(r.data?.error || 'Could not load affinity');
        setResult(null);
      }
    } catch {
      setError('Could not load affinity');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [worldId]);

  useEffect(() => {
    if (open) query(skillId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function onOpen() { setOpen(true); }
    // Real dispatcher: CommandPalette.tsx's HUD_DISPATCH_EVENTS table maps
    // 'hud:skill-affinity' -> 'concordia:open-skill-affinity', same keyed-object +
    // dynamic-Event indirection as the other hud:* HUD listeners. Confirmed live
    // by tests/components/CommandPalette.test.tsx (DET-C continuation, 2026-07-24).
    // @dead-event-ok
    window.addEventListener('concordia:open-skill-affinity', onOpen);
    return () => window.removeEventListener('concordia:open-skill-affinity', onOpen);
  }, []);

  // Honest gate: renders nothing for a world that never selected the
  // per-player skill-affinity system.
  if (!gate.loaded || !gate.enabled) return null;

  const growthPct = result ? Math.round((result.playerAffinity - 1) * 100) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Skill affinity"
        className="pointer-events-auto fixed bottom-[19rem] right-4 z-20 rounded-lg border border-indigo-500/30 bg-black/70 px-2 py-1.5 text-center text-[10px] text-indigo-200 backdrop-blur-sm hover:bg-indigo-500/10"
      >
        <TrendingUp size={12} className="mb-0.5 inline" />
        <div>Affinity</div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
          onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        >
          <div className="w-full max-w-sm rounded-xl border border-indigo-500/40 bg-zinc-950/95 p-4 shadow-2xl">
            <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
                <TrendingUp size={14} /> Skill affinity
              </h2>
              <button aria-label="Close" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
                <X size={12} />
              </button>
            </header>

            <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500" htmlFor="skill-affinity-select">
              Skill
            </label>
            <select
              id="skill-affinity-select"
              value={skillId}
              disabled={busy}
              onChange={(e) => { setSkillId(e.target.value); query(e.target.value); }}
              className="mb-3 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-200"
            >
              {ALL_SKILL_KEYS.map((id) => (
                <option key={id} value={id}>{id.replace(/_/g, ' ')}</option>
              ))}
            </select>

            {error && <p className="mb-2 text-[11px] text-rose-300">{error}</p>}

            {!result && !error && (
              <p className="py-4 text-center text-[12px] text-zinc-500">Loading…</p>
            )}

            {result && (
              <div className="space-y-2">
                <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Personal affinity</span>
                    <span className="text-sm font-semibold text-indigo-200">{`${result.playerAffinity.toFixed(3)}x`}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div
                      className="h-full bg-indigo-400 transition-[width]"
                      style={{ width: `${Math.min(100, Math.max(0, ((result.playerAffinity - 0.5) / (3.0 - 0.5)) * 100))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {growthPct > 0 ? `+${growthPct}% above baseline from real use` : growthPct < 0 ? `${growthPct}% below baseline (idle decay)` : 'Baseline — no recorded use yet'}
                  </p>
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Effective (combined with world modulator)</span>
                  <span className="text-indigo-100">{`${result.effective.toFixed(3)}x`}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default SkillAffinityPanel;
