'use client';

// P-D — minimal frontend surface for the lattice-fork "forked self" preview
// primitive (server/domains/fork.js#fork.instantiate_preview, wrapping
// server/lib/lattice-fork.js). HARD SCOPE: preview-only, non-money — this
// panel has NO price/rental UI anywhere, matching docs/GOVERNANCE_DESIGN.md
// §5.5 ("no monetary fork rental ships in Wave 1 — sandboxes stay
// non-commercial/preview-only").
//
// Flow: pick a bounded set of your own DTU ids -> instantiate a confined
// preview fork -> see the disclosed AI identity + the bounded DTU preview it
// can read. Nothing here writes anywhere except the fork object + its
// disclosure record (both honest, both real).

import { useState } from 'react';
import { GitFork, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ForkDisclosureBadge } from './ForkDisclosureBadge';

interface ForkPreviewDtu {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  tier: string;
}

interface ForkPreviewResult {
  preview: true;
  forkObjectId: string;
  ownerUserId: string;
  sourceUserId: string;
  sourceDisplayName: string;
  dtuCount: number;
  maxForkDtus: number;
  status: string;
  agentUserId: string;
  agentIdentityId: string | null;
  isAgentDisclosed: boolean;
  agentKind: string | null;
  temperament: { capturedFrom: string; coreValues: string[]; driveProfile: Record<string, number> };
  confined: { ok: boolean; reason: string };
  dtus: ForkPreviewDtu[];
}

const ERROR_COPY: Record<string, string> = {
  auth_required: 'Sign in to instantiate a fork preview.',
  missing_input: 'Enter at least one DTU id to fork.',
  fork_not_found: 'No fork object found for that id.',
  forbidden: "You can only preview forks you own.",
  fork_bound_exceeded: 'Too many DTUs — a fork is a bounded, hand-picked slice, not a full corpus mirror.',
  fork_create_failed: 'Could not create the fork object.',
  confinement_check_failed: 'The sandbox failed its own confinement self-check — refused to preview.',
};

export function ForkPreviewPanel() {
  const [dtuIdsInput, setDtuIdsInput] = useState('');
  const [sourceUserId, setSourceUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForkPreviewResult | null>(null);

  const instantiate = async () => {
    const dtuIds = dtuIdsInput.split(',').map((s) => s.trim()).filter(Boolean);
    if (dtuIds.length === 0) {
      setError(ERROR_COPY.missing_input);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await lensRun('fork', 'instantiate_preview', {
        dtuIds,
        ...(sourceUserId.trim() ? { sourceUserId: sourceUserId.trim() } : {}),
      });
      const payload = res.data.result as unknown as (ForkPreviewResult & { ok?: boolean; error?: string; reason?: string }) | null;
      if (res.data.ok && payload?.preview) {
        setResult(payload);
      } else {
        const code = payload?.error || res.data.error || 'unknown_error';
        setError(ERROR_COPY[code] || payload?.reason || code);
        setResult(null);
      }
    } catch {
      setError('Network error instantiating the preview.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-amber-500/15 pb-3">
        <div className="flex items-center gap-2">
          <GitFork className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Forked self — preview (beta)</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            fork.instantiate_preview
          </span>
        </div>
        <span className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
          <ShieldCheck className="h-3 w-3" /> preview only — no rental, no pricing
        </span>
      </header>

      <p className="text-[11px] leading-relaxed text-zinc-400">
        Instantiate a bounded, confined preview of a "forked" agent built from a
        hand-picked set of DTUs (max {result?.maxForkDtus ?? 500}). The preview
        sandbox can only read those DTUs — it has zero access to macros, money,
        or any other user&apos;s data. The instantiated agent is disclosed as an
        AI by construction.
      </p>

      <div className="space-y-2">
        <label className="block text-xs text-zinc-400">
          DTU ids to fork (comma-separated)
          <input
            type="text"
            value={dtuIdsInput}
            onChange={(e) => setDtuIdsInput(e.target.value)}
            placeholder="dtu_abc123, dtu_def456"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-600"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Source user id (optional — defaults to yourself)
          <input
            type="text"
            value={sourceUserId}
            onChange={(e) => setSourceUserId(e.target.value)}
            placeholder="leave blank to fork your own corpus"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-600"
          />
        </label>
        <button
          type="button"
          onClick={instantiate}
          disabled={loading || !dtuIdsInput.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />}
          Instantiate preview
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ForkDisclosureBadge
              isAgent={result.isAgentDisclosed}
              personName={result.sourceDisplayName}
              agentKind={result.agentKind}
            />
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {result.forkObjectId}
            </span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              status: {result.status}
            </span>
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              confined: {result.confined.ok ? 'yes' : result.confined.reason}
            </span>
          </div>

          <div className="text-[11px] text-zinc-400">
            {result.dtuCount} DTU{result.dtuCount === 1 ? '' : 's'} forked from{' '}
            <span className="text-zinc-300">{result.sourceDisplayName}</span>.
            {result.temperament.capturedFrom === 'agent_identity' ? (
              <> Temperament snapshot captured from a real agent self-model ({result.temperament.coreValues.join(', ') || 'no values on file'}).</>
            ) : (
              <> No agent self-model existed for the source — temperament snapshot is honestly empty.</>
            )}
          </div>

          <div className="space-y-1">
            {result.dtus.map((d) => (
              <div key={d.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-sm text-white">{d.title}</span>
                  <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">{d.tier}</span>
                </div>
                {d.summary && <p className="mt-1 text-zinc-400">{d.summary}</p>}
                {d.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.tags.map((t) => (
                      <span key={t} className="rounded bg-zinc-800/70 px-1 text-[9px] text-zinc-500">#{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {result.dtus.length === 0 && (
              <p className="text-[11px] text-zinc-500">No DTUs were readable in this preview.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ForkPreviewPanel;
