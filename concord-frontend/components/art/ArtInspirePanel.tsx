'use client';

/**
 * ArtInspirePanel — a daily drawing prompt with category-filtered
 * shuffling, plus the studio's progress at a glance.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lightbulb, Shuffle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Prompt { category: string; text: string }
interface Dash {
  artworks: number; totalStrokes: number; palettes: number;
  referenceBoards: number; latestArtwork: { id: string; title: string } | null;
}

export function ArtInspirePanel() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [p, d] = await Promise.all([
      lensRun('art', 'art-prompt', {}),
      lensRun('art', 'art-dashboard', {}),
    ]);
    setPrompt((p.data?.result?.prompt as Prompt) || null);
    setCategories(p.data?.result?.categories || []);
    setDash((d.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const shuffle = async () => {
    const r = await lensRun('art', 'art-prompt', { random: true, category: activeCat || undefined });
    if (r.data?.result?.prompt) setPrompt(r.data.result.prompt as Prompt);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {prompt && (
        <div className="bg-gradient-to-br from-violet-900/50 to-zinc-900/70 border border-violet-900/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-violet-300 uppercase tracking-wide">
              <Lightbulb className="w-3.5 h-3.5" /> Today's prompt
            </span>
            <button type="button" onClick={shuffle}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-violet-300">
              <Shuffle className="w-3 h-3" /> Shuffle
            </button>
          </div>
          <p className="text-sm text-zinc-100">{prompt.text}</p>
          <p className="text-[10px] text-zinc-400 mt-1 capitalize">{prompt.category}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setActiveCat('')}
          className={cn('text-[11px] px-2.5 py-1 rounded-lg capitalize',
            activeCat === '' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
          Any
        </button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setActiveCat(c)}
            className={cn('text-[11px] px-2.5 py-1 rounded-lg capitalize',
              activeCat === c ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
            {c}
          </button>
        ))}
      </div>

      {dash && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Artworks" value={dash.artworks} />
          <Stat label="Strokes" value={dash.totalStrokes.toLocaleString()} />
          <Stat label="Palettes" value={dash.palettes} />
          <Stat label="Ref boards" value={dash.referenceBoards} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
