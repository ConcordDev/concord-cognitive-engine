'use client';

import { useCallback, useState } from 'react';
import { Search, Loader2, Microscope } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Candidate {
  commonName: string;
  scientificName: string;
  rank: string;
  kingdom: string | null;
  family: string | null;
  confidence: number;
  matchType: string;
  taxonKey: number | null;
}

interface SuggestResult {
  query: string;
  primary: Candidate | null;
  alternatives: Candidate[];
  source: string;
}

function confidenceTone(c: number): string {
  if (c >= 0.75) return 'text-green-400';
  if (c >= 0.4) return 'text-amber-400';
  return 'text-gray-400';
}

function CandidateRow({ c, primary }: { c: Candidate; primary?: boolean }) {
  const pct = Math.round(c.confidence * 100);
  return (
    <div
      className={`rounded border p-2.5 ${
        primary ? 'border-green-500/30 bg-green-500/[0.06]' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white truncate">{c.commonName}</div>
          <div className="text-[11px] italic text-gray-400 truncate">{c.scientificName}</div>
        </div>
        <span className={`text-sm font-bold ${confidenceTone(c.confidence)}`}>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-400">
        <span>{c.rank}</span>
        {c.kingdom && <span>{c.kingdom}</span>}
        {c.family && <span>{c.family}</span>}
        <span>{c.matchType.toLowerCase()}</span>
      </div>
    </div>
  );
}

export function SpeciesSuggest() {
  const [name, setName] = useState('');
  const [data, setData] = useState<SuggestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    const q = name.trim();
    if (!q) {
      setError('Enter a species or organism name.');
      return;
    }
    setLoading(true);
    setError(null);
    const r = await lensRun<SuggestResult>('eco', 'species-suggest', { name: q });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
    } else {
      setError(r.data?.error || 'Could not resolve that name.');
      setData(null);
    }
    setLoading(false);
  }, [name]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Microscope className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Species ID — confidence &amp; alternatives
        </span>
      </header>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void lookup();
            }}
            placeholder="e.g. Red-tailed Hawk or Buteo jamaicensis"
            className="flex-1 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
          />
          <button
            onClick={lookup}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Resolve
          </button>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        {!data && !loading && !error && (
          <p className="py-8 text-center text-xs text-gray-400">
            No data yet. Resolve a name against the GBIF taxonomic backbone to see the matched
            taxon and ranked alternatives.
          </p>
        )}

        {data && (
          <div className="space-y-3">
            {data.primary && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  Best match
                </p>
                <CandidateRow c={data.primary} primary />
              </div>
            )}
            {data.alternatives.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  Suggested alternatives
                </p>
                <div className="space-y-1.5">
                  {data.alternatives.map((c, i) => (
                    <CandidateRow key={c.taxonKey ?? i} c={c} />
                  ))}
                </div>
              </div>
            )}
            {!data.primary && data.alternatives.length === 0 && (
              <p className="py-4 text-center text-xs text-gray-400">
                No taxonomic match found for &ldquo;{data.query}&rdquo;.
              </p>
            )}
            <p className="text-[10px] text-gray-400">Source: {data.source}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SpeciesSuggest;
