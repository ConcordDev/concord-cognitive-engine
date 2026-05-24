'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Loader2, ExternalLink, Coins } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Advisory {
  ghsa_id: string;
  cve_id?: string;
  summary: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  published_at: string;
  html_url: string;
  vulnerabilities?: { package?: { ecosystem: string; name: string }; vulnerable_version_range?: string }[];
  cvss?: { score: number; vector_string: string };
  type?: string;
}

const SEV_COLOR: Record<string, string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-200',
  high: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  medium: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
  low: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-200',
};

export function GhsaAdvisories() {
  const [severity, setSeverity] = useState<'all' | 'critical' | 'high'>('high');

  const advisories = useQuery({
    queryKey: ['ghsa-advisories', severity],
    queryFn: async () => {
      const params = new URLSearchParams({ per_page: '30' });
      if (severity !== 'all') params.set('severity', severity);
      const r = await fetch(`https://api.github.com/advisories?${params}`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(`github advisories ${r.status}`);
      return (await r.json()) as Advisory[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Public bug-bounty surface — GHSA advisories</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.github.com/advisories · live</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {(['all', 'critical', 'high'] as const).map((s) => (
              <button key={s} onClick={() => setSeverity(s)} className={`rounded px-2 py-0.5 font-mono uppercase ${severity === s ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{s}</button>
            ))}
          </div>
          {(advisories.data?.length ?? 0) > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="github-advisories"
              apiUrl={`https://api.github.com/advisories?severity=${severity}`}
              title={`GHSA advisories (${severity}) — ${advisories.data?.length}`}
              content={(advisories.data || []).slice(0, 20).map((a, i) => `${i + 1}. ${a.ghsa_id}${a.cve_id ? ` / ${a.cve_id}` : ''} · ${a.severity.toUpperCase()}\n   ${a.summary}\n   ${(a.vulnerabilities || []).slice(0, 3).map((v) => `${v.package?.ecosystem}/${v.package?.name}${v.vulnerable_version_range ? ` ${v.vulnerable_version_range}` : ''}`).join(' · ')}`).join('\n\n')}
              extraTags={['bounties', 'ghsa', 'security', severity]}
              rawData={{ severity, advisories: advisories.data }}
            />
          )}
        </div>
      </header>
      {advisories.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub advisories unreachable.</div>}
      {advisories.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling advisories…</div>}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {(advisories.data || []).map((a) => {
          const cls = SEV_COLOR[a.severity] || SEV_COLOR.low;
          return (
            <a key={a.ghsa_id} href={a.html_url} target="_blank" rel="noopener noreferrer" className={`block rounded-lg border-l-4 ${cls.split(' ')[0]} border border-zinc-800 bg-zinc-950/40 p-3 hover:bg-zinc-950/70`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-white">{a.ghsa_id}</span>
                    {a.cve_id && <span className="font-mono text-[11px] text-zinc-400">{a.cve_id}</span>}
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{a.severity.toUpperCase()}</span>
                    {a.cvss?.score && <span className="font-mono text-[10px] text-cyan-300">CVSS {a.cvss.score.toFixed(1)}</span>}
                    <span title="Bounty-eligible via vendor program"><Coins className="h-3 w-3 text-amber-300" /></span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-zinc-200">{a.summary}</p>
                  {a.vulnerabilities && a.vulnerabilities.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                      {a.vulnerabilities.slice(0, 4).map((v, i) => (
                        <span key={i} className="rounded bg-zinc-800 px-1 font-mono text-cyan-300/80">{v.package?.ecosystem}/{v.package?.name}{v.vulnerable_version_range ? ` ${v.vulnerable_version_range}` : ''}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-zinc-400">published {new Date(a.published_at).toLocaleDateString()}</div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
