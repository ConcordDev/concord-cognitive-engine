'use client';

// Phase 1: Skill Evolution Modal
//
// Triggered by the `skill:evolution-available` socket event when a player's
// skill crosses a 10-level boundary. Shows the deterministic envelope
// (max_damage / range_m / costs that the engine will move to), the lineage
// of prior revisions, and a textarea for the player's upgrade narrative.
//
// Submit calls runMacro("skill_evolution", "commit"). On success, the
// modal closes; the recipe's `current_name` and `max_damage` mutate
// in-place via the existing DTU update path.

import React, { useEffect, useState, useCallback } from 'react';
import { X, Sparkles, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useEvent } from '@/lib/realtime/event-bus';
import RevisionLineageTree from './RevisionLineageTree';

interface EnvelopeShape {
  recipeId: string;
  revisionNum: number;
  levelAtRevision: number;
  composer: string;
  maxDamageBefore: number;
  maxDamageAfter: number;
  rangeMBefore: number;
  rangeMAfter: number;
  costsBefore: Record<string, number>;
  costsAfter: Record<string, number>;
  nameBefore: string;
  nameAfter: string;
  // Phase 1: biomechanics integration
  animationTierBefore?: number;
  animationTierAfter?: number;
  targetZones?: string[] | null;
  requiredLimbs?: string[];
  envelope?: { base: number; ceiling: number; tier: number; animationTier?: number };
}

interface UnlockEvent {
  unlockId: string;
  recipeId: string;
  level: number;
  recipeName?: string;
}

interface CommitResponse { ok: boolean; revisionId?: string; reason?: string; evidence?: unknown }

async function postLensRun<T>(domain: string, name: string, input: object): Promise<T> {
  const res = await api.post('/api/lens/run', { domain, name, input });
  return res.data as T;
}

export default function EvolutionModal() {
  const [unlock, setUnlock] = useState<UnlockEvent | null>(null);
  const [envelope, setEnvelope] = useState<EnvelopeShape | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Subscribe to the unlock socket event.
  useEvent<UnlockEvent>('skill:evolution-available', (data) => {
    if (data?.recipeId && data?.unlockId) setUnlock(data);
  });

  const loadPreview = useCallback(async (recipeId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [previewRes, historyRes] = await Promise.all([
        postLensRun<{ ok: boolean; evolution?: EnvelopeShape; coherence?: { ok: boolean; reason?: string }; reason?: string }>(
          'skill_evolution', 'preview', { recipeId, description: '' },
        ),
        postLensRun<{ ok: boolean; rows?: unknown[] }>('skill_evolution', 'history', { recipeId, limit: 10 }),
      ]);
      if (!previewRes.ok || !previewRes.evolution) {
        setError(previewRes.reason || 'preview_failed');
      } else {
        setEnvelope(previewRes.evolution);
      }
      setHistory(historyRes.rows || []);
    } catch (e) {
      setError(`Failed to load preview: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unlock?.recipeId) loadPreview(unlock.recipeId);
  }, [unlock, loadPreview]);

  async function commit() {
    if (!unlock || !envelope) return;
    if (description.trim().length < 4) {
      setError('Describe the upgrade in at least a few words.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await postLensRun<CommitResponse>('skill_evolution', 'commit', {
        recipeId: unlock.recipeId,
        unlockId: unlock.unlockId,
        description,
        levelAtRevision: unlock.level,
      });
      if (!res.ok) {
        setError(res.reason || 'commit_failed');
        setLoading(false);
        return;
      }
      // Close on success; the recipe DTU will refresh on next read.
      setUnlock(null);
      setEnvelope(null);
      setDescription('');
    } catch (e) {
      setError(`Commit failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  if (!unlock) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-neon-blue/40 rounded-lg shadow-2xl w-[640px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-neon-blue" />
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-400">Skill Evolution Unlocked</p>
              <h2 className="text-lg font-semibold text-gray-100">
                Level {unlock.level} · {envelope?.nameBefore || unlock.recipeName || 'your skill'}
              </h2>
            </div>
          </div>
          <button
            onClick={() => setUnlock(null)}
            className="text-gray-400 hover:text-gray-200"
            aria-label="Dismiss for now"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="overflow-y-auto p-4 space-y-4">
          {loading && !envelope && <p className="text-sm text-gray-400">Composing envelope…</p>}

          {envelope && (
            <section className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded bg-zinc-800/60 border border-zinc-700">
                <p className="text-xs uppercase text-gray-500">Current</p>
                <p className="font-mono text-gray-100">{envelope.nameBefore}</p>
                <p className="text-gray-400 mt-1">max damage {envelope.maxDamageBefore}</p>
                <p className="text-gray-400">range {envelope.rangeMBefore}m</p>
              </div>
              <div className="p-3 rounded bg-neon-blue/10 border border-neon-blue/40">
                <p className="text-xs uppercase text-neon-blue">After commit</p>
                <p className="font-mono text-gray-100">{envelope.nameAfter}</p>
                <p className="text-gray-300 mt-1">max damage <strong>{envelope.maxDamageAfter}</strong> <span className="text-xs text-gray-500">(+{envelope.maxDamageAfter - envelope.maxDamageBefore})</span></p>
                <p className="text-gray-300">range <strong>{envelope.rangeMAfter}m</strong></p>
                {envelope.animationTierAfter != null && envelope.animationTierAfter !== envelope.animationTierBefore && (
                  <p className="text-amber-400 text-xs mt-1">
                    animation tier <span className="font-mono">{envelope.animationTierBefore} → {envelope.animationTierAfter}</span>
                    <span className="text-gray-500"> (procedural anim scales)</span>
                  </p>
                )}
                {envelope.requiredLimbs && envelope.requiredLimbs.length > 0 && (
                  <p className="text-gray-500 text-[11px] mt-1">cast limb: {envelope.requiredLimbs.join(", ")}</p>
                )}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Lineage</p>
              <RevisionLineageTree revisions={history} />
            </section>
          )}

          <section>
            <label className="text-xs uppercase tracking-wider text-gray-400 mb-1 block">
              Describe the upgrade <span className="text-gray-600">(coherence-checked against the lineage)</span>
            </label>
            <textarea
              className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded text-gray-100 text-sm font-mono focus:outline-none focus:border-neon-blue/60"
              rows={4}
              placeholder="e.g. 'water gun grows pressurized and laser-focused on a single weak point, gaining range but losing AoE'"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={400}
            />
            <p className="text-xs text-gray-500 mt-1">{description.length}/400 — describes how the player wants the skill to evolve. Element family must stay coherent (water → ice OK; water → fire REJECT).</p>
          </section>

          {error && (
            <p className="p-2 rounded bg-red-500/10 border border-red-500/40 text-sm text-red-300 font-mono">{error}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            onClick={() => setUnlock(null)}
            className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
            disabled={loading}
          >
            Defer
          </button>
          <button
            onClick={commit}
            disabled={loading || description.trim().length < 4}
            className="px-4 py-2 rounded bg-neon-blue/20 border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50 flex items-center gap-1.5 text-sm"
          >
            {loading ? 'Committing…' : 'Commit Revision'} <ChevronRight className="w-4 h-4" />
          </button>
        </footer>
      </div>
    </div>
  );
}
