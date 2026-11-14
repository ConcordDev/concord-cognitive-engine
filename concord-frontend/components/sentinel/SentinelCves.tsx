'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Loader2, ExternalLink, AlertOctagon, RefreshCw } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { publicLookup, carryLookupMeta, lookupMeta } from '@/lib/public-lookup';

interface Cve { cve: { id: string; published: string; descriptions: { lang: string; value: string }[]; metrics?: { cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string } }[]; cvssMetricV30?: { cvssData: { baseScore: number; baseSeverity: string } }[] } } }

const SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM'] as const;

// FIX-sentinel-004: the degraded states must offer a retry. The
// server feed-cache re-attempts the upstream on an expired read
// (stale-while-revalidate), so refetching re-reads after that attempt
// and clears the banner when NVD answers; upstream politeness
// (per-source budget + backoff) is enforced server-side, so a user
// retry cannot hammer NVD.
function RetryButton({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className="flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:border-zinc-500 hover:text-white disabled:cursor-wait disabled:opacity-50"
    >
      <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Retry
    </button>
  );
}

export function SentinelCves() {
  const [sev, setSev] = useState<typeof SEVERITY[number]>('CRITICAL');
  // Freshness captured at fetch time, not only via the data array's
  // WeakMap meta: react-query's structural sharing keeps the previous
  // array reference when a retry returns identical data, which would
  // strand the stale banner (with the old meta) even when the server
  // now serves the same list fresh.
  const [freshness, setFreshness] = useState<{ stale: boolean; fetchedAt: number | null } | undefined>(undefined);

  const cves = useQuery({
    queryKey: ['nvd-sentinel', sev],
    queryFn: async () => {
      const j = await publicLookup<{ vulnerabilities?: Cve[] }>('nvd-cves', { severity: sev });
      const items = (j?.vulnerabilities || []) as Cve[];
      carryLookupMeta(j, items);
      setFreshness(lookupMeta(j));
      return items;
    },
    staleTime: 10 * 60 * 1000,
  });

  const list = cves.data || [];
  const meta = freshness ?? lookupMeta(cves.data);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-400" /><h2 className="text-sm font-semibold text-white">NVD sentinel alerts</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">NVD · via Concord server · {sev}</span></div>
        <div className="flex items-center gap-2">
          <select id="sentinel-sentinelcves-field" name="field" value={sev} onChange={(e) => { setFreshness(undefined); setSev(e.target.value as typeof SEVERITY[number]); }} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="nvd-sentinel" apiUrl="https://nvd.nist.gov/vuln/search" title={`NVD sentinel — ${sev} (${list.length})`} content={list.slice(0, 20).map((v, i) => { const desc = v.cve.descriptions?.find((d) => d.lang === 'en')?.value || ''; return `${i + 1}. ${v.cve.id}\n   ${desc.slice(0, 200)}`; }).join('\n\n')} extraTags={['sentinel', 'nvd', sev.toLowerCase()]} rawData={{ severity: sev, cves: list }} />}
        </div>
      </header>
      {cves.isError && <div className="flex items-center justify-between gap-3 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300"><span>NVD is unavailable right now — nothing is being shown in its place.</span><RetryButton onRetry={() => { void cves.refetch(); }} busy={cves.isFetching} /></div>}
      {meta?.stale && <div className="flex items-center justify-between gap-3 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300"><span>Showing cached NVD data{meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleString()}` : ''} — live source unavailable.</span><RetryButton onRetry={() => { void cves.refetch(); }} busy={cves.isFetching} /></div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">CVEs</div><div className="mt-0.5 font-mono text-lg text-rose-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Sev</div><div className="mt-0.5 font-mono text-lg text-rose-300">{sev}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((v) => {
          const desc = v.cve.descriptions?.find((d) => d.lang === 'en')?.value || '';
          const score = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore;
          return (
            <a key={v.cve.id} href={`https://nvd.nist.gov/vuln/detail/${v.cve.id}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-rose-500/15 bg-zinc-950/60 p-2.5 hover:border-rose-500/40">
              <div className="flex items-center gap-2"><span className="font-mono text-sm text-white">{v.cve.id}</span>{score != null && <span className="rounded bg-rose-500/30 px-1 font-mono text-[9px] text-rose-200"><AlertOctagon className="inline h-2.5 w-2.5 mr-0.5" />{score}</span>}</div>
              <p className="mt-1 line-clamp-2 text-[12px] text-zinc-200">{desc}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400"><span>{v.cve.published?.slice(0, 10)}</span><ExternalLink className="h-3 w-3" /></div>
            </a>
          );
        })}
        {list.length === 0 && !cves.isPending && !cves.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No CVEs.</div>}
      </div>
      {cves.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
