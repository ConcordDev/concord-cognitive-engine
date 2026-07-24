'use client';

/**
 * AuthorBadge — author identity + TWO deliberately separate trust signals
 * for a plugin gallery entry (SDK-H).
 *
 *   1. Peer reputation — "this author has done real work elsewhere in
 *      Concord." Sourced from `authorReputationSummary`, which the server
 *      computes by reusing the REAL general reputation system
 *      (`profile.reputation-summary` + `server/lib/reputation-badges.js`,
 *      V1.2 Wave A) — never invented here. An author with zero real
 *      activity renders an honest "No reputation history yet" line, never a
 *      fabricated tier or count.
 *
 *   2. Self-attested package signing — "this author signed THIS package
 *      themselves." The pre-existing `trusted`/`trustDescription` fields
 *      (server/lib/plugin-signing.js) are rendered in their own
 *      clearly-labeled block so they can never read as peer-reviewed trust.
 *
 * These two signals are NEVER merged into one badge or one boolean — see
 * CLAUDE.md's plugin-gallery invariants and `docs/PLUGIN_DEVELOPER_GUIDE.md`
 * §3. Both blocks are independently present regardless of the other: a
 * highly-reputed author can still publish an unsigned package, and a signed
 * package can come from an author with no reputation history yet.
 *
 * The author identity shown is the raw `authorId` — gallery entries don't
 * carry a resolved display name today (that would need a separate per-author
 * `profile.profile-get` lookup, out of scope for a reputation badge); showing
 * the real id honestly beats resolving a name via a wider, unscoped change.
 */

import { Award, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { AuthorReputationSummary } from './types';

const TIER_STYLE: Record<string, string> = {
  bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  silver: 'border-slate-400/40 bg-slate-400/10 text-slate-300',
  gold: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  platinum: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300',
  diamond: 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300',
};

export interface AuthorBadgeProps {
  authorId: string;
  reputation?: AuthorReputationSummary;
  trusted: boolean;
  trustDescription: string;
}

export function AuthorBadge({ authorId, reputation, trusted, trustDescription }: AuthorBadgeProps) {
  const hasActivity = !!reputation?.hasActivity;
  const topBadge = reputation?.topBadge ?? null;

  return (
    <div
      className="mt-2 space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-2"
      aria-label={`Author identity for ${authorId}`}
    >
      <div className="truncate text-[11px] font-medium text-slate-300">{authorId}</div>

      {/* Signal 1 — real peer reputation, reused from the general system. */}
      <div className="flex items-start gap-1.5 text-[10px]">
        <Award className={`mt-0.5 h-3 w-3 shrink-0 ${hasActivity ? 'text-amber-300' : 'text-slate-600'}`} aria-hidden="true" />
        <span className="min-w-0">
          <span className="mr-1 text-slate-500">Reputation:</span>
          {hasActivity ? (
            topBadge ? (
              <span
                className={`rounded-full border px-1.5 py-0.5 font-medium ${TIER_STYLE[topBadge.tier] || 'border-zinc-700 bg-zinc-900/60 text-slate-300'}`}
              >
                {topBadge.label}
              </span>
            ) : (
              <span className="text-slate-400">
                {reputation!.dtuCount} DTU{reputation!.dtuCount === 1 ? '' : 's'} · {reputation!.totalCitations} citation
                {reputation!.totalCitations === 1 ? '' : 's'}
              </span>
            )
          ) : (
            <span className="text-slate-600">No reputation history yet.</span>
          )}
        </span>
      </div>

      {/* Signal 2 — self-attested package signing. Distinct block, distinct label. */}
      <div className={`flex items-start gap-1.5 text-[10px] ${trusted ? 'text-emerald-300' : 'text-amber-300'}`}>
        {trusted ? (
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0">
          <span className="mr-1 text-slate-500">Package signing:</span>
          <span>{trustDescription}</span>
        </span>
      </div>
    </div>
  );
}
