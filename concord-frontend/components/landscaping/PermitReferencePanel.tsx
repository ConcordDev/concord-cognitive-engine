'use client';

/**
 * PermitReferencePanel — paraphrased, cited zoning/setback/planting-permit
 * quick reference for a small set of NAMED example jurisdictions.
 *
 * Backend: landscaping.permit-reference (content/landscaping-code-
 * reference.json via server/lib/landscaping-code-reference.js). Unlike
 * plumbing (one national model-code family), there is no single national
 * source for landscaping/zoning permit rules — municipal ordinances are
 * public record but vary by jurisdiction. Every entry names its example
 * jurisdiction and cites the real, named ordinance/permit program, or is
 * honestly flagged as an uncited cross-jurisdiction pattern
 * (`citationConfidence: "general-pattern"`) rather than risking a
 * fabricated citation. This is a small representative sample, not a
 * comprehensive or authoritative permit database — the disclaimer says so
 * and is always visible, mirroring healthcare's ProtocolsPanel.
 */

import { useEffect, useState } from 'react';
import { ScrollText, Loader2, Info, ShieldQuestion, ExternalLink, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface PermitRefEntry {
  id: string;
  jurisdiction: string;
  category: string;
  title: string;
  citation: string | null;
  citationConfidence: 'named-ordinance' | 'named-program' | 'general-pattern';
  summary: string;
  disclaimer: string;
}

interface PermitRefResult {
  entries: PermitRefEntry[];
  jurisdictions: string[];
  categories: string[];
  total: number;
  disclaimer: string;
}

export function PermitReferencePanel() {
  const [entries, setEntries] = useState<PermitRefEntry[]>([]);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [libraryDisclaimer, setLibraryDisclaimer] = useState('');
  const [jurisdictionFilter, setJurisdictionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = {};
    if (jurisdictionFilter) params.jurisdiction = jurisdictionFilter;
    if (categoryFilter) params.category = categoryFilter;
    lensRun<PermitRefResult>('landscaping', 'permit-reference', params)
      .then((r) => {
        if (cancelled) return;
        if (r.data?.ok && r.data.result) {
          setEntries(r.data.result.entries || []);
          setJurisdictions(r.data.result.jurisdictions || []);
          setCategories(r.data.result.categories || []);
          setLibraryDisclaimer(r.data.result.disclaimer || '');
        }
      })
      .catch(() => { /* honest empty state below */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jurisdictionFilter, categoryFilter]);

  return (
    <div className="overflow-hidden rounded-xl border border-lime-500/20 bg-gradient-to-br from-zinc-950 via-lime-950/10 to-zinc-950">
      <header className="flex items-center justify-between gap-2 border-b border-lime-500/20 bg-zinc-900/40 px-4 py-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-lime-400" />
          <span className="text-sm font-semibold text-white">Permit / zoning quick reference</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">landscaping.permit-reference</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={jurisdictionFilter}
            onChange={(e) => setJurisdictionFilter(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          >
            <option value="">All jurisdictions</option>
            {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* Always-visible library disclaimer — never buried. */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            {libraryDisclaimer || 'A small sample of named example jurisdictions, not a comprehensive or authoritative permit database. Zoning and permitting rules vary by jurisdiction and sub-zone and change over time — always confirm current requirements with your local planning/zoning department.'}
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading permit reference library…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="py-8 text-center text-xs text-zinc-400">No reference entries for this filter.</div>
        )}
        {!loading && entries.length > 0 && (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-lg border border-white/10 bg-zinc-950/40 p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs font-semibold text-gray-100">{e.title}</div>
                    <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-lime-300/90">
                      <MapPin className="h-2.5 w-2.5" /> {e.jurisdiction}
                    </div>
                  </div>
                  {e.citation ? (
                    <span className="inline-flex items-center gap-1 rounded bg-lime-500/10 border border-lime-500/25 px-1.5 py-0.5 text-[10px] font-mono text-lime-200">
                      <ExternalLink className="h-2.5 w-2.5" /> {e.citation}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      <ShieldQuestion className="h-2.5 w-2.5" /> general pattern — no single jurisdiction cited
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-300">{e.summary}</p>
                <p className="mt-1.5 text-[10px] italic leading-relaxed text-zinc-500">{e.disclaimer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PermitReferencePanel;
