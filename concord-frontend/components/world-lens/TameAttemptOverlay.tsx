'use client';

/**
 * TameAttemptOverlay — opens when the player presses `KeyJ` near a wild
 * creature whose bond with the player has crossed the tame threshold.
 *
 * The bond build-up happens passively (city-presence co-location +
 * shared-threat ticks call recordTameInteraction server-side). When the
 * bond is high enough this UI surfaces, lets the player pick an optional
 * lure item, and fires the tame attempt. Result is animated in-place.
 *
 * For v1 the "nearest tameable creature" detection is delegated to the
 * world page (which knows rawWorldNPCs + position); this component
 * accepts an `eligibleCreature` prop and renders accordingly.
 */

import { useState, useEffect } from 'react';
import { Cat, Sparkles } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface EligibleCreature {
  id: string;
  name: string;
  worldId: string;
  bond: number;
  threshold: number;
}

interface Props {
  eligibleCreature: EligibleCreature | null;
  onClose: () => void;
}

export function TameAttemptOverlay({ eligibleCreature, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; reason?: string; successProbability?: number } | null>(null);
  const [lureRarity, setLureRarity] = useState<'none' | 'common' | 'rare' | 'legendary'>('none');

  useEffect(() => {
    const off = subscribe<{ ownerId: string; companionId: string; creatureId: string; name?: string }>(
      'companion:tame-success',
      (msg) => {
        if (eligibleCreature && msg.creatureId === eligibleCreature.id) {
          setOutcome({ ok: true });
        }
      },
    );
    return off;
  }, [eligibleCreature]);

  if (!eligibleCreature) return null;

  const submit = async () => {
    setSubmitting(true);
    setOutcome(null);
    try {
      const r = await fetch('/api/companions/tame-attempt', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatureId: eligibleCreature.id,
          creatureName: eligibleCreature.name,
          worldId: eligibleCreature.worldId,
          lureItem: lureRarity !== 'none' ? { rarity: lureRarity } : null,
        }),
      });
      const j = await r.json();
      setOutcome(j);
    } catch {
      setOutcome({ ok: false, reason: 'network_error' });
    } finally {
      setSubmitting(false);
    }
  };

  const bondProgress = Math.min(100, (eligibleCreature.bond / eligibleCreature.threshold) * 100);
  const bondReady = eligibleCreature.bond >= eligibleCreature.threshold;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-96 rounded-lg border border-pink-500/40 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <Cat className="h-5 w-5 text-pink-300" />
          <h3 className="text-base font-semibold text-pink-100">Attempt to Tame: {eligibleCreature.name}</h3>
        </div>

        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>Bond</span>
            <span className="tabular-nums">{Math.round(eligibleCreature.bond)} / {eligibleCreature.threshold}</span>
          </div>
          <div className="h-2 w-full rounded bg-slate-700">
            <div
              className={`h-full rounded transition-all ${bondReady ? 'bg-emerald-400' : 'bg-amber-400'}`}
              style={{ width: `${bondProgress}%` }}
            />
          </div>
          {!bondReady && (
            <div className="mt-1 text-[10px] text-amber-300">
              Trust isn't high enough yet. Spend more time near {eligibleCreature.name} or fight alongside them.
            </div>
          )}
        </div>

        {bondReady && !outcome && (
          <>
            <div className="mb-3">
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Lure (optional)</label>
              <div className="flex gap-1">
                {(['none', 'common', 'rare', 'legendary'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setLureRarity(r)}
                    className={`flex-1 rounded px-1.5 py-1 text-[10px] capitalize ${
                      lureRarity === r ? 'bg-pink-600 text-pink-50' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-700 px-3 py-2 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {submitting ? 'Trying…' : 'Tame'}
              </button>
              <button
                onClick={onClose}
                className="rounded bg-slate-700 px-3 py-2 text-xs hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {outcome && (
          <div
            className={`mt-2 rounded p-3 text-xs ${
              outcome.ok ? 'bg-emerald-950/40 text-emerald-100' : 'bg-rose-950/40 text-rose-100'
            }`}
          >
            {outcome.ok ? (
              <>
                <div className="font-semibold">Success!</div>
                <div className="mt-1 text-[10px] opacity-80">
                  {eligibleCreature.name} now follows you. Check the Companion Roster panel to deploy.
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">No tame: {outcome.reason || 'creature_resisted'}</div>
                {outcome.successProbability !== undefined && (
                  <div className="mt-1 text-[10px] opacity-80">
                    Probability was {Math.round((outcome.successProbability ?? 0) * 100)}% — try again or build more bond.
                  </div>
                )}
              </>
            )}
            <button onClick={onClose} className="mt-2 text-[10px] underline opacity-70 hover:opacity-100">
              Close
            </button>
          </div>
        )}

        {!bondReady && !outcome && (
          <button
            onClick={onClose}
            className="mt-2 w-full rounded bg-slate-700 px-3 py-2 text-xs hover:bg-slate-600"
          >
            OK
          </button>
        )}
      </div>
    </div>
  );
}
