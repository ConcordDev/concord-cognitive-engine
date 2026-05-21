'use client';

/**
 * CwStatsPanel — manuscript statistics: pacing per scene, top word
 * frequency, dialogue-vs-prose ratio, adverb load and sentence-length
 * profile. All numbers are computed by the `manuscript-stats` macro
 * from the project's real prose; no sample data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, BarChart3, MessageSquare, Gauge } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { cn } from '@/lib/utils';

interface ScenePace {
  sceneId: string; title: string; wordCount: number;
  avgSentenceLength: number; tempo: string; dialogueLines: number;
}
interface Stats {
  hasData: boolean;
  message?: string;
  wordCount: number; sentenceCount: number; paragraphCount: number; sceneCount: number;
  avgSentenceLength: number; avgParagraphWords: number;
  dialoguePct: number; prosePct: number;
  uniqueWords: number; adverbCount: number; adverbPer1000: number;
  longSentences: number; shortSentences: number;
  topWords: { word: string; count: number }[];
  pacing: ScenePace[];
  estimatedReadMinutes: number;
}

const TEMPO_COLOR: Record<string, string> = {
  fast: 'text-emerald-400', moderate: 'text-amber-400', slow: 'text-rose-400',
};

export function CwStatsPanel({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'manuscript-stats', { projectId });
    setStats((r.data?.result as Stats | null) || null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!stats || !stats.hasData) {
    return (
      <p className="text-[11px] text-zinc-500 italic py-8 text-center">
        {stats?.message || 'No prose written yet. Write scene content to see manuscript statistics.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <BarChart3 className="w-3.5 h-3.5 text-amber-400" /> Manuscript statistics
        </h3>
        <button type="button" onClick={refresh}
          className="text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Recalculate</button>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Stat label="Words" value={stats.wordCount.toLocaleString()} />
        <Stat label="Sentences" value={stats.sentenceCount.toLocaleString()} />
        <Stat label="Paragraphs" value={stats.paragraphCount.toLocaleString()} />
        <Stat label="Unique" value={stats.uniqueWords.toLocaleString()} />
        <Stat label="Avg sentence" value={`${stats.avgSentenceLength}w`} />
        <Stat label="Read time" value={`${stats.estimatedReadMinutes}m`} />
      </div>

      {/* Dialogue vs prose ratio */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <MessageSquare className="w-3.5 h-3.5 text-sky-400" /> Dialogue vs prose
          </span>
          <span className="text-[11px] text-zinc-400">{stats.dialoguePct}% dialogue · {stats.prosePct}% prose</span>
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-800">
          <div className="bg-sky-500" style={{ width: `${stats.dialoguePct}%` }} />
          <div className="bg-amber-500" style={{ width: `${stats.prosePct}%` }} />
        </div>
      </div>

      {/* Sentence-length & adverb profile */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Long sentences (>30w)" value={stats.longSentences} />
        <Stat label="Short sentences (≤8w)" value={stats.shortSentences} />
        <Stat label="Adverbs (-ly)" value={stats.adverbCount} />
        <Stat label="Adverbs / 1000w" value={stats.adverbPer1000} />
      </div>

      {/* Word frequency chart */}
      {stats.topWords.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Most-used words (stopwords filtered)</h4>
          <ChartKit
            kind="bar"
            data={stats.topWords.slice(0, 12).map((w) => ({ word: w.word, count: w.count }))}
            xKey="word"
            series={[{ key: 'count', label: 'Uses', color: '#f59e0b' }]}
            height={200}
            showLegend={false}
          />
        </div>
      )}

      {/* Per-scene pacing */}
      {stats.pacing.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Gauge className="w-3.5 h-3.5 text-amber-400" /> Scene pacing
          </h4>
          <ul className="space-y-1">
            {stats.pacing.map((p) => (
              <li key={p.sceneId} className="flex items-center gap-2 text-[11px] bg-zinc-950/60 rounded-lg px-2.5 py-1.5">
                <span className="flex-1 truncate text-zinc-200">{p.title}</span>
                <span className="text-zinc-500">{p.wordCount}w</span>
                <span className="text-zinc-500">{p.avgSentenceLength}w/sent</span>
                <span className="text-zinc-500">{p.dialogueLines} dlg</span>
                <span className={cn('uppercase font-semibold w-16 text-right', TEMPO_COLOR[p.tempo] || 'text-zinc-400')}>
                  {p.tempo}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide leading-tight">{label}</p>
    </div>
  );
}
