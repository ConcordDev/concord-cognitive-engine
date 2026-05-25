'use client';

/**
 * EFBPlates — approach-plate / airport-diagram viewer.
 *
 * ForeFlight feature-parity backlog item 5. Pulls the real FAA d-TPP
 * Terminal Procedures index for an airport via the approach-plates macro
 * (keyless aviationapi.com) and lets the pilot open any published
 * approach, departure, arrival, airport diagram, or minimums PDF.
 * No fabricated charts — every PDF link is a live FAA document.
 */

import { useState, useCallback } from 'react';
import { Loader2, FileText, ExternalLink, Plane, Map } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Chart {
  name: string;
  code: string;
  category: string;
  pdfUrl: string;
  cycle: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  airport_diagram: 'Airport diagrams',
  approach: 'Instrument approaches',
  departure: 'Departure procedures',
  arrival: 'Arrival procedures',
  minimums: 'Takeoff minimums',
  other: 'Other procedures',
};
const CATEGORY_ORDER = ['airport_diagram', 'approach', 'departure', 'arrival', 'minimums', 'other'];

export default function EFBPlates() {
  const [apt, setApt] = useState('');
  const [byCategory, setByCategory] = useState<Record<string, Chart[]>>({});
  const [total, setTotal] = useState(0);
  const [loadedApt, setLoadedApt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    const id = apt.trim().toUpperCase();
    if (!id) {
      setError('Enter an airport identifier (e.g. KSFO).');
      return;
    }
    setLoading(true);
    setError(null);
    const r = await lensRun('aviation', 'approach-plates', { apt: id });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { byCategory?: Record<string, Chart[]>; total?: number; apt?: string };
      setByCategory(res.byCategory || {});
      setTotal(res.total || 0);
      setLoadedApt(res.apt || id);
    } else {
      setError(r.data?.error || 'No terminal procedures found.');
      setByCategory({});
      setTotal(0);
      setLoadedApt('');
    }
    setLoading(false);
  }, [apt]);

  const categories = CATEGORY_ORDER.filter((c) => (byCategory[c] || []).length > 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sky-500/20 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Map className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            Approach plates & airport diagrams
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={apt}
            onChange={(e) => setApt(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') lookup();
            }}
            placeholder="Airport ICAO (KSFO)"
            maxLength={4}
            className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase"
          />
          <button
            type="button"
            onClick={lookup}
            disabled={loading}
            className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Load charts
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          Live FAA d-TPP terminal procedures via aviationapi.com (keyless).
        </p>
        {error && <p className="text-xs text-rose-300 mt-2">{error}</p>}
      </div>

      {loadedApt && total > 0 && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs text-gray-300 mb-3 font-mono">
            <Plane className="w-3 h-3 inline mr-1 text-sky-400" />
            {loadedApt} · {total} published charts
          </p>
          <div className="space-y-3">
            {categories.map((cat) => (
              <div key={cat}>
                <p className="text-[10px] uppercase tracking-wider text-sky-400 mb-1.5">
                  {CATEGORY_LABEL[cat]} ({byCategory[cat].length})
                </p>
                <div className="space-y-1">
                  {byCategory[cat].map((c, i) => (
                    <div
                      key={c.name + i}
                      className="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/30 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-gray-200 truncate">{c.name}</p>
                        {c.cycle && (
                          <p className="text-[10px] text-gray-400 font-mono">{c.cycle}</p>
                        )}
                      </div>
                      {c.pdfUrl ? (
                        <a
                          href={c.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-200 flex-shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" /> Open PDF
                        </a>
                      ) : (
                        <span className="text-[10px] text-gray-400 flex-shrink-0">no PDF</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
