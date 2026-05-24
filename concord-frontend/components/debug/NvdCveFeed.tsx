'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bug, Loader2, ExternalLink, AlertOctagon, Shield } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Cve {
  cve: {
    id: string;
    sourceIdentifier?: string;
    published: string;
    lastModified: string;
    vulnStatus?: string;
    descriptions: { lang: string; value: string }[];
    metrics?: {
      cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string; vectorString?: string } }[];
      cvssMetricV30?: { cvssData: { baseScore: number; baseSeverity: string } }[];
    };
    weaknesses?: { description: { lang: string; value: string }[] }[];
  };
}

const SEVERITY_FILTERS = ['', 'CRITICAL', 'HIGH', 'MEDIUM'] as const;
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  HIGH: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  MEDIUM: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  LOW: 'border-zinc-700 bg-zinc-900 text-zinc-300',
};

export function NvdCveFeed() {
  const [severity, setSeverity] = useState<typeof SEVERITY_FILTERS[number]>('HIGH');

  const cves = useQuery({
    queryKey: ['nvd-cves', severity],
    queryFn: async () => {
      const sev = severity ? `&cvssV3Severity=${severity}` : '';
      const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=25${sev}`);
      if (!r.ok) throw new Error(`nvd ${r.status}`);
      const j = await r.json();
      return (j?.vulnerabilities || []) as Cve[];
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const list = cves.data || [];
  const sevCounts = list.reduce<Record<string, number>>((a, v) => {
    const s = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseSeverity || v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseSeverity || 'UNKNOWN';
    a[s] = (a[s] || 0) + 1; return a;
  }, {});

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-rose-400" />
          <h2 className="text-sm font-semibold text-white">Real-world CVE feed</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">nvd.nist.gov · CVE 2.0 API</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof SEVERITY_FILTERS[number])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {SEVERITY_FILTERS.map((s) => <option key={s} value={s}>{s || 'all severities'}</option>)}
          </select>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="nvd-cve"
              apiUrl={`https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=25${severity ? `&cvssV3Severity=${severity}` : ''}`}
              title={`NVD CVEs${severity ? ` (${severity})` : ''} — ${list.length} latest`}
              content={list.slice(0, 20).map((v, i) => {
                const desc = v.cve.descriptions?.find((d) => d.lang === 'en')?.value || '';
                const sev = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseSeverity || v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseSeverity || '—';
                const score = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore ?? '—';
                return `${i + 1}. ${v.cve.id} · ${sev} (${score})\n   ${desc.slice(0, 240)}${desc.length > 240 ? '…' : ''}`;
              }).join('\n\n')}
              extraTags={['debug', 'security', 'nvd', 'cve', severity.toLowerCase() || 'all']}
              rawData={{ severity, cves: list }}
            />
          )}
        </div>
      </header>
      {cves.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">NVD API unreachable (rate-limit or network).</div>}
      <div className="grid grid-cols-4 gap-2">
        {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) => (
          <div key={s} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">{s}</div>
            <div className={`mt-0.5 font-mono text-lg ${s === 'CRITICAL' ? 'text-rose-300' : s === 'HIGH' ? 'text-orange-300' : s === 'MEDIUM' ? 'text-amber-300' : 'text-zinc-300'}`}>{sevCounts[s] || 0}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((v) => {
          const desc = v.cve.descriptions?.find((d) => d.lang === 'en')?.value || '';
          const sev = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseSeverity || v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseSeverity || 'UNKNOWN';
          const score = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? v.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore;
          const cweList = v.cve.weaknesses?.flatMap((w) => w.description.filter((d) => d.lang === 'en')).map((d) => d.value) || [];
          return (
            <a key={v.cve.id} href={`https://nvd.nist.gov/vuln/detail/${v.cve.id}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-rose-500/15 bg-zinc-950/60 p-2.5 hover:border-rose-500/40">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-white">{v.cve.id}</span>
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${SEVERITY_COLOR[sev] || SEVERITY_COLOR.LOW}`}>
                      {sev === 'CRITICAL' || sev === 'HIGH' ? <AlertOctagon className="inline h-2.5 w-2.5 mr-0.5" /> : <Shield className="inline h-2.5 w-2.5 mr-0.5" />}
                      {sev}{score != null ? ` · ${score}` : ''}
                    </span>
                    {cweList.slice(0, 2).map((w) => <span key={w} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{w}</span>)}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-zinc-200">{desc}</p>
                  <div className="mt-1 text-[10px] text-zinc-400">published {v.cve.published?.slice(0, 10)}</div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
              </div>
            </a>
          );
        })}
        {list.length === 0 && !cves.isPending && !cves.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No CVEs returned.</div>
        )}
      </div>
      {cves.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling NVD…</div>}
    </div>
  );
}
