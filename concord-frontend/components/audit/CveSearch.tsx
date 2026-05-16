'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldAlert, Loader2, Search, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface CveItem {
  cve: {
    id: string;
    published: string;
    lastModified: string;
    vulnStatus?: string;
    descriptions: { lang: string; value: string }[];
    metrics?: {
      cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string; vectorString: string } }[];
      cvssMetricV2?: { cvssData: { baseScore: number } }[];
    };
    references?: { url: string; source?: string }[];
  };
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'border-red-500/40 bg-red-500/10 text-red-200',
  HIGH: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  MEDIUM: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
  LOW: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-200',
  NONE: 'border-zinc-700 bg-zinc-900 text-zinc-300',
};

export function CveSearch() {
  const [keyword, setKeyword] = useState('openssl');
  const [hits, setHits] = useState<CveItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=20`);
        if (!r.ok) throw new Error(`nvd ${r.status}`);
        const j = await r.json();
        setHits(j.vulnerabilities || []);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  const descFor = (c: CveItem) => c.cve.descriptions.find((d) => d.lang === 'en')?.value || c.cve.descriptions[0]?.value || '';
  const sevFor = (c: CveItem) => c.cve.metrics?.cvssMetricV31?.[0]?.cvssData;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">CVE security search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">nvd.nist.gov v2.0 · no key</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="nvd"
            apiUrl={`https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}`}
            title={`CVE search — "${keyword}" (${hits.length})`}
            content={hits.slice(0, 15).map((c, i) => `${i + 1}. ${c.cve.id} · ${sevFor(c)?.baseSeverity || 'NONE'} ${sevFor(c)?.baseScore?.toFixed(1) || '—'}\n   ${descFor(c).slice(0, 200)}`).join('\n\n')}
            extraTags={['audit', 'cve', 'security', keyword.toLowerCase()]}
            rawData={{ keyword, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search CVE (vendor/product/keyword)…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!keyword.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-2 max-h-[480px] overflow-y-auto">
        {hits.map((c) => {
          const sev = sevFor(c);
          const sevName = sev?.baseSeverity || 'NONE';
          const cls = SEVERITY_COLOR[sevName] || SEVERITY_COLOR.NONE;
          return (
            <a key={c.cve.id} href={`https://nvd.nist.gov/vuln/detail/${c.cve.id}`} target="_blank" rel="noopener noreferrer" className={`block rounded-lg border-l-4 ${cls.split(' ')[0]} border border-zinc-800 bg-zinc-950/40 p-3 hover:bg-zinc-950/70`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white">{c.cve.id}</span>
                    {sev && <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{sevName} {sev.baseScore.toFixed(1)}</span>}
                    {c.cve.vulnStatus && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{c.cve.vulnStatus}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-zinc-300">{descFor(c)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
                    <span>published {new Date(c.cve.published).toLocaleDateString()}</span>
                    {sev && <span className="font-mono text-zinc-400">{sev.vectorString}</span>}
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
              </div>
            </a>
          );
        })}
        {hits.length === 0 && !search.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">Search the live NVD CVE database.</div>
        )}
      </div>
    </div>
  );
}
