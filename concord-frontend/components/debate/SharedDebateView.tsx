'use client';

/**
 * SharedDebateView — public read-only render of a debate reached via a
 * `?share=<token>` link. Calls debate.shared-view (no owner scoping) and
 * displays the impact-weighted claim tree, positions and support score
 * without any edit affordances.
 */

import { useCallback, useEffect, useState } from 'react';
import { Scale, Loader2, BookOpen, ExternalLink, Layers, Eye } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Source { id: string; title: string; url: string; kind: string; note: string }
interface Claim {
  id: string;
  parentId: string | null;
  positionId: string | null;
  stance: string;
  text: string;
  weight: number;
  voteCount: number;
  impact: number | null;
  sources: Source[];
}
interface Position { id: string; label: string; summary: string }
interface Score { proTotal: number; conTotal: number; supportPct: number; verdict: string }
interface SharedDebate { id: string; thesis: string; positions: Position[]; claims: Claim[] }

const VERDICT_COLOR: Record<string, string> = {
  'well-supported': 'text-emerald-400',
  'leaning-for': 'text-cyan-400',
  'leaning-against': 'text-amber-400',
  'poorly-supported': 'text-rose-400',
};

export function SharedDebateView({ shareToken, onExit }: { shareToken: string; onExit: () => void }) {
  const [debate, setDebate] = useState<SharedDebate | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('debate', 'shared-view', { shareToken });
    if (r.data?.ok) {
      setDebate(r.data.result?.debate as SharedDebate);
      setScore(r.data.result?.score as Score);
      setError(null);
    } else {
      setError(r.data?.error || 'This share link is invalid or has been revoked.');
    }
    setLoading(false);
  }, [shareToken]);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (error || !debate) {
    return (
      <div className="text-center py-12 space-y-3">
        <Scale className="w-10 h-10 mx-auto text-gray-600" />
        <p className="text-sm text-gray-400">{error}</p>
        <button
          onClick={onExit}
          className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
        >
          Back to debates
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="shared-debate-view">
      <div className="flex items-center gap-2">
        <Eye className="w-4 h-4 text-cyan-400" />
        <span className="text-[11px] uppercase tracking-wide text-cyan-300 font-semibold">
          Shared debate · read-only
        </span>
        <button
          onClick={onExit}
          className="ml-auto px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 hover:text-gray-200"
        >
          Back to my debates
        </button>
      </div>

      <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
        <div className="flex items-start gap-2">
          <p className="text-sm font-bold text-white flex-1">{debate.thesis}</p>
          {score && (
            <div className="text-right shrink-0">
              <p className={cn('text-lg font-bold leading-none', VERDICT_COLOR[score.verdict] || 'text-gray-400')}>
                {score.supportPct}%
              </p>
              <p className="text-[9px] text-gray-400 capitalize">{score.verdict.replace(/-/g, ' ')}</p>
            </div>
          )}
        </div>
        {score && (
          <div className="flex h-1.5 rounded overflow-hidden">
            <div className="bg-emerald-500" style={{ width: `${score.supportPct}%` }} />
            <div className="bg-rose-500" style={{ width: `${100 - score.supportPct}%` }} />
          </div>
        )}

        {debate.positions.length > 0 && (
          <div className="bg-violet-950/20 border border-violet-800/30 rounded p-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-violet-300 font-semibold flex items-center gap-1">
              <Layers className="w-3 h-3" /> Positions
            </p>
            {debate.positions.map((p) => (
              <div key={p.id} className="text-xs">
                <span className="font-semibold text-white">{p.label}</span>
                {p.summary && <span className="text-gray-400"> — {p.summary}</span>}
              </div>
            ))}
          </div>
        )}

        {debate.claims.filter((c) => c.parentId === null).length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">No claims in this debate yet.</p>
        ) : (
          <ReadOnlyBranch claims={debate.claims} parentId={null} depth={0} />
        )}
      </div>
    </div>
  );
}

function ReadOnlyBranch({ claims, parentId, depth }: { claims: Claim[]; parentId: string | null; depth: number }) {
  const kids = claims.filter((c) => c.parentId === parentId);
  if (kids.length === 0) return null;
  return (
    <div className={cn(depth > 0 && 'pl-3 border-l border-white/10 ml-1')}>
      {kids.map((c) => {
        const isPro = c.stance === 'pro';
        return (
          <div key={c.id} className="mb-1.5">
            <div
              className={cn(
                'rounded px-2 py-1.5 border-l-2',
                isPro ? 'bg-emerald-950/20 border-emerald-600' : 'bg-rose-950/20 border-rose-600',
              )}
            >
              <div className="flex items-start gap-1.5">
                <span className={cn('text-[9px] font-bold uppercase mt-0.5', isPro ? 'text-emerald-400' : 'text-rose-400')}>
                  {c.stance}
                </span>
                <p className="text-xs text-gray-200 flex-1">{c.text}</p>
                <span className="text-[10px] text-gray-400 font-mono shrink-0">{c.weight.toFixed(1)}</span>
                {c.impact && <span className="text-[9px] text-gray-400 shrink-0">i{c.impact}</span>}
              </div>
              {c.sources.length > 0 && (
                <ul className="mt-1 pl-4 space-y-0.5">
                  {c.sources.map((s) => (
                    <li key={s.id} className="flex items-center gap-1.5 text-[10px]">
                      <BookOpen className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-300 hover:underline truncate flex items-center gap-0.5"
                        >
                          {s.title} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ) : (
                        <span className="text-gray-300 truncate">{s.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ReadOnlyBranch claims={claims} parentId={c.id} depth={depth + 1} />
          </div>
        );
      })}
    </div>
  );
}
