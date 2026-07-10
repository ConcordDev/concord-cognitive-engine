'use client';

/**
 * PostInsightsPanel — per-post analyst tools: rank_posts (Wilson/hot/
 * composite scoring breakdown), extract_thesis (heuristic thesis
 * extraction), generate_summary_dtu. All three are real forum.* macros
 * on the persisted post lens-artifact (server.js) that had zero UI
 * caller. generate_summary_dtu is a pure compute preview — it does not
 * persist anything — so its result is labeled "preview," never "saved."
 */

import { useState } from 'react';
import { BarChart3, Quote, FileText, Loader2 } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

interface RankResult {
  wilsonScore: number;
  hotScore: number;
  compositeScore: number;
  factors: {
    upvotes: number;
    downvotes: number;
    totalVotes: number;
    commentCount: number;
    engagementFactor: number;
    ageHours: number;
    gravity: number;
  };
}
interface ThesisResult {
  text: string;
  confidence: number;
  sentenceCount: number;
  method: string;
}
interface SummaryDtuPreview {
  excerpt: string;
  wordCount: number;
  votes: number;
  commentCount: number;
  tags: string[];
  engagement: number;
}

type Tool = 'rank' | 'thesis' | 'summary';

export function PostInsightsPanel({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const runAction = useRunArtifact('forum');

  const [rank, setRank] = useState<RankResult | null>(null);
  const [thesis, setThesis] = useState<ThesisResult | null>(null);
  const [summary, setSummary] = useState<SummaryDtuPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(t: Tool, action: string, apply: (result: Record<string, unknown>) => void) {
    setTool(t);
    setError(null);
    try {
      const res = await runAction.mutateAsync({ id: postId, action, params: {} });
      const result = res.result as { ok?: boolean; error?: string } & Record<string, unknown>;
      if (!res.ok || result?.ok === false) {
        setError(result?.error || `${action} failed`);
      } else {
        apply(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setTool(null);
    }
  }

  const busy = tool !== null;

  return (
    <div className="border-t border-lattice-border pt-3 mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
      >
        <BarChart3 className="w-3.5 h-3.5" />
        Post insights
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => run('rank', 'rank_posts', (r) => setRank(r.rank as RankResult))}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-lattice-bg border border-lattice-border text-gray-300 hover:border-neon-cyan/50 disabled:opacity-40"
            >
              {tool === 'rank' ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
              Rank breakdown
            </button>
            <button
              onClick={() => run('thesis', 'extract_thesis', (r) => setThesis(r.thesis as ThesisResult))}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-lattice-bg border border-lattice-border text-gray-300 hover:border-neon-cyan/50 disabled:opacity-40"
            >
              {tool === 'thesis' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Quote className="w-3 h-3" />}
              Extract thesis
            </button>
            <button
              onClick={() => run('summary', 'generate_summary_dtu', (r) => setSummary(r.dtu as SummaryDtuPreview))}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-lattice-bg border border-lattice-border text-gray-300 hover:border-neon-cyan/50 disabled:opacity-40"
            >
              {tool === 'summary' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
              Preview summary
            </button>
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          {rank && (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="bg-lattice-bg border border-lattice-border rounded px-2 py-1.5">
                <p className="text-sm font-bold text-white">{rank.wilsonScore.toFixed(3)}</p>
                <p className="text-[9px] text-gray-500 uppercase">Wilson</p>
              </div>
              <div className="bg-lattice-bg border border-lattice-border rounded px-2 py-1.5">
                <p className="text-sm font-bold text-white">{rank.hotScore.toFixed(3)}</p>
                <p className="text-[9px] text-gray-500 uppercase">Hot</p>
              </div>
              <div className="bg-lattice-bg border border-lattice-border rounded px-2 py-1.5">
                <p className="text-sm font-bold text-neon-cyan">{rank.compositeScore}</p>
                <p className="text-[9px] text-gray-500 uppercase">Composite</p>
              </div>
              <p className="col-span-3 text-[10px] text-gray-500">
                {rank.factors.upvotes}↑ {rank.factors.downvotes}↓ · {rank.factors.commentCount} comments · {rank.factors.ageHours}h old
              </p>
            </div>
          )}

          {thesis && (
            <div className="bg-lattice-bg border border-lattice-border rounded px-3 py-2">
              <p className="text-xs text-gray-200 italic">&ldquo;{thesis.text}&rdquo;</p>
              <p className="text-[10px] text-gray-500 mt-1">
                {Math.round(thesis.confidence * 100)}% confidence · {thesis.method.replace(/_/g, ' ')} · {thesis.sentenceCount} sentences scanned
              </p>
            </div>
          )}

          {summary && (
            <div className="bg-lattice-bg border border-lattice-border rounded px-3 py-2">
              <p className="text-[9px] text-amber-400 uppercase tracking-wide mb-1">Preview — not saved</p>
              <p className="text-xs text-gray-200">{summary.excerpt}</p>
              <p className="text-[10px] text-gray-500 mt-1">
                {summary.wordCount} words · {summary.votes} votes · {summary.commentCount} comments · engagement {summary.engagement}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
