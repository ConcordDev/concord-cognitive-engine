'use client';

/**
 * DreamPredictions — the anticipatory half of the substrate-narrative pair.
 *
 * Wraps `dreams.predictions` (server/domains/dreams.js), which reads the
 * Layer 10 forward-sim substrate (`server/lib/embodied/forward-sim.js`,
 * `forward_predictions` table): while the player is offline, the engine
 * speculates about active quests, recently-met NPCs, and joined factions,
 * and stamps a confidence + a grounded one-line anticipation per subject.
 *
 * This is the SAME per-user substrate the world-lens HUD's compact
 * `DreamPanel` (components/world/concordia-hud/panels/DreamPanel.tsx)
 * already polls — this section gives it a real home in the dedicated
 * lens instead of only a corner-of-the-HUD glance, alongside the dream
 * (retrospective) reader above it. Never invents a subject the engine
 * didn't gather; an empty state honestly explains what feeds it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Compass, User, Flag, HelpCircle, Sparkles, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Prediction {
  id: string;
  world_id?: string | null;
  subject_kind: 'quest' | 'npc' | 'faction' | 'decision' | 'self' | string;
  subject_id?: string | null;
  anticipated: string;
  confidence?: number;
  composer?: string;
  composed_at: number;
  expires_at?: number;
}

const KIND_ICON: Record<string, typeof Compass> = {
  quest: Compass,
  npc: User,
  faction: Flag,
  decision: HelpCircle,
  self: Sparkles,
};

const KIND_LABEL: Record<string, string> = {
  quest: 'Quest',
  npc: 'NPC',
  faction: 'Faction',
  decision: 'Decision',
  self: 'Self',
};

function timeUntil(unixSeconds?: number): string | null {
  if (!unixSeconds) return null;
  const ms = unixSeconds * 1000 - Date.now();
  if (ms <= 0) return 'expiring soon';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'expires within the hour';
  if (hours < 24) return `expires in ~${hours}h`;
  return `expires in ~${Math.round(hours / 24)}d`;
}

export function DreamPredictions() {
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun<{ ok: boolean; predictions?: Prediction[] }>('dreams', 'predictions', { limit: 20 });
    if (r.data.ok) {
      setPredictions(r.data.result?.predictions || []);
      setError(null);
    } else {
      setError(r.data.error || 'Prediction substrate unreachable.');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const loading = predictions === null && !error;

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-zinc-100">What&apos;s ahead</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            dreams.predictions · live
          </span>
        </div>
        {predictions && predictions.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-dream-predictions"
            title={`Forward-sim snapshot — ${predictions.length} active predictions`}
            content={predictions
              .map((p) => `${KIND_LABEL[p.subject_kind] || p.subject_kind} (${p.subject_id ?? '—'}): ${p.anticipated} [confidence ${Math.round((p.confidence ?? 0) * 100)}%]`)
              .join('\n')}
            extraTags={['dreams', 'predictions', 'forward-sim']}
            rawData={{ predictions }}
          />
        )}
      </header>

      {error && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the forward-sim substrate…
        </div>
      )}

      {predictions && predictions.length === 0 && !error && (
        <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
          No active predictions. The engine speculates while you&apos;re away, from recent
          quest progress, NPC encounters, and faction membership — come back after
          some world activity and it will have something to anticipate.
        </div>
      )}

      {predictions && predictions.length > 0 && (
        <ul className="space-y-2">
          {predictions.map((p) => {
            const Icon = KIND_ICON[p.subject_kind] || Sparkles;
            const pct = Math.round((p.confidence ?? 0) * 100);
            const expiry = timeUntil(p.expires_at);
            return (
              <li key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                        {KIND_LABEL[p.subject_kind] || p.subject_kind}
                      </span>
                      {p.subject_id && (
                        <span className="truncate font-mono text-[10px] text-zinc-500">{p.subject_id}</span>
                      )}
                      <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono text-[10px] text-purple-300">
                        {pct}% confidence
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-200">{p.anticipated}</p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">
                      {new Date(p.composed_at * 1000).toLocaleString()}
                      {expiry ? ` · ${expiry}` : ''}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
