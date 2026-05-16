'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Loader2, ExternalLink, AlertOctagon } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Cve { cve: { id: string; published: string; descriptions: { lang: string; value: string }[]; metrics?: { cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string } }[]; cvssMetricV30?: { cvssData: { baseScore: number; baseSeverity: string } }[] } } }

const SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM'] as const;

export function SentinelCves() {
  const [sev, setSev] = useState<typeof SEVERITY[number]>('CRITICAL');

  const cves = useQuery({
    queryKey: ['nvd-sentinel', sev],
    queryFn: async () => {
      const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=25&cvssV3Severity=${sev}`);
      if (!r.ok) throw new Error(`nvd ${r.status}`);
      const j = await r.json();
      return (j?.vulnerabilities || []) as Cve[];
    },
    staleTime: 10 * 60 * 1000,
  });

  const list = cves.data || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-400" /><h2 className="text-sm font-semibold text-white">NVD sentinel alerts</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">nvd · {sev}</span></div>
        <div className="flex items-center gap-2">
          <select value={sev} onChange={(e) => setSev(e.target.value as typeof SEVERITY[number])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="nvd-sentinel" apiUrl={`https://services.nvd.nist.gov/rest/json/cves/2.0?cvssV3Severity=${sev}`} title={`NVD sentinel — ${sev} (${list.length})`} content={list.slice(0, 20).map((v, i) => { const desc = v.cve.descriptions?.find((d) => d.lang === 'en')?.value || ''; return `${i + 1}. ${v.cve.id}\n   ${desc.slice(0, 200)}`; }).join('\n\n')} extraTags={['sentinel', 'nvd', sev.toLowerCase()]} rawData={{ severity: sev, cves: list }} />}
        </div>
      </header>
      {cves.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">NVD unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">CVEs</div><div className="mt-0.5 font-mono text-lg text-rose-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Sev</div><div className="mt-0.5 font-mono text-lg text-rose-300">{sev}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((v) => {
          const desc = v.cve.descriptions?.find((d) => d.lang === 'en')?.value || '';
          const score = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore;
          return (
            <a key={v.cve.id} href={`https://nvd.nist.gov/vuln/detail/${v.cve.id}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-rose-500/15 bg-zinc-950/60 p-2.5 hover:border-rose-500/40">
              <div className="flex items-center gap-2"><span className="font-mono text-sm text-white">{v.cve.id}</span>{score != null && <span className="rounded bg-rose-500/30 px-1 font-mono text-[9px] text-rose-200"><AlertOctagon className="inline h-2.5 w-2.5 mr-0.5" />{score}</span>}</div>
              <p className="mt-1 line-clamp-2 text-[12px] text-zinc-200">{desc}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500"><span>{v.cve.published?.slice(0, 10)}</span><ExternalLink className="h-3 w-3" /></div>
            </a>
          );
        })}
        {list.length === 0 && !cves.isPending && !cves.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No CVEs.</div>}
      </div>
      {cves.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
