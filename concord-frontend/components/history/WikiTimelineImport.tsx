'use client';

/**
 * WikiTimelineImport — auto-builds a full timeline from a Wikipedia article
 * by extracting every year-bearing sentence. Wires
 * history.timeline-from-wikipedia. All events come from the live article;
 * nothing is fabricated.
 */

import { useCallback, useState } from 'react';
import { BookOpen, Wand2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface BuiltResult {
  timeline: { id: string; title: string; description: string; eventCount: number; sourceArticle: string };
  extractedCount: number;
  usedCount: number;
}

export function WikiTimelineImport({ onBuilt }: { onBuilt?: (timelineId: string) => void }) {
  const [article, setArticle] = useState('');
  const [maxEvents, setMaxEvents] = useState('60');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BuiltResult | null>(null);

  const build = useCallback(async () => {
    if (!article.trim()) return;
    setBusy(true); setError(''); setResult(null);
    const r = await lensRun<BuiltResult>('history', 'timeline-from-wikipedia', {
      title: article.trim(),
      maxEvents: Number(maxEvents) || 60,
    });
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
      onBuilt?.(r.data.result.timeline.id);
    } else {
      setError(r.data?.error || 'Could not build timeline');
    }
    setBusy(false);
  }, [article, maxEvents, onBuilt]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
        <BookOpen className="w-3.5 h-3.5 text-amber-400" /> Auto-build from Wikipedia
      </p>
      <div className="flex flex-wrap gap-1.5">
        <input value={article} onChange={(e) => setArticle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void build(); }}
          placeholder="Wikipedia article title (e.g. Roman Empire)"
          className="flex-1 min-w-[180px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={maxEvents} onChange={(e) => setMaxEvents(e.target.value)} inputMode="numeric"
          title="Max events" placeholder="max"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={build} disabled={busy || !article.trim()}
          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Build
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
      {result && (
        <p className="text-[10px] text-emerald-400">
          Built &quot;{result.timeline.title}&quot; — {result.usedCount} of {result.extractedCount} dated
          events extracted from the article &quot;{result.timeline.sourceArticle}&quot;.
        </p>
      )}
    </div>
  );
}
