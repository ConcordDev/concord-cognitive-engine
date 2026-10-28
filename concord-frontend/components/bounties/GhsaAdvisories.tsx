'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Loader2, ExternalLink, Hammer } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
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

export interface BountyDraftFromAdvisory {
  title: string;
  description: string;
  category: string;
  tags: string;
}

const SEV_COLOR: Record<string, string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-200',
  high: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  medium: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
  low: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-200',
};

export function GhsaAdvisories({ onConvertToBounty }: { onConvertToBounty?: (draft: BountyDraftFromAdvisory) => void }) {
  const [severity, setSeverity] = useState<'all' | 'critical' | 'high'>('high');

  const advisories = useQuery({
    queryKey: ['ghsa-advisories', severity],
    queryFn: async () => {
      const res = await lensRun('repos', 'github-advisories', { severity: severity !== 'all' ? severity : undefined });
      if (!res.data?.ok) throw new Error(res.data?.reason || res.data?.error || 'github_unavailable');
      const out = res.data.result as { items?: Advisory[]; stale?: boolean; fetchedAt?: number } | null;
      return { items: out?.items || [], stale: !!out?.stale, fetchedAt: out?.fetchedAt ?? null };
    },
    staleTime: 5 * 60 * 1000,
  });

  const list = advisories.data?.items || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Public bug-bounty surface — GHSA advisories</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">GitHub advisories · via Concord server</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {(['all', 'critical', 'high'] as const).map((s) => (
              <button key={s} onClick={() => setSeverity(s)} className={`rounded px-2 py-0.5 font-mono uppercase ${severity === s ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{s}</button>
            ))}
          </div>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="github-advisories"
              apiUrl="https://github.com/advisories"
              title={`GHSA advisories (${severity}) — ${list.length}`}
              content={list.slice(0, 20).map((a, i) => `${i + 1}. ${a.ghsa_id}${a.cve_id ? ` / ${a.cve_id}` : ''} · ${a.severity.toUpperCase()}\n   ${a.summary}\n   ${(a.vulnerabilities || []).slice(0, 3).map((v) => `${v.package?.ecosystem}/${v.package?.name}${v.vulnerable_version_range ? ` ${v.vulnerable_version_range}` : ''}`).join(' · ')}`).join('\n\n')}
              extraTags={['bounties', 'ghsa', 'security', severity]}
              rawData={{ severity, advisories: list }}
            />
          )}
        </div>
      </header>
      {advisories.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub advisories unavailable right now — nothing is being shown in their place.</div>}
      {advisories.data?.stale && !advisories.isError && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Showing cached GitHub advisories{advisories.data.fetchedAt ? ` from ${new Date(advisories.data.fetchedAt).toLocaleString()}` : ''} — live refresh is rate-limited.</div>}
      {advisories.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling advisories…</div>}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {list.map((a) => {
          const cls = SEV_COLOR[a.severity] || SEV_COLOR.low;
          const pkgList = (a.vulnerabilities || [])
            .slice(0, 4)
            .map((v) => `${v.package?.ecosystem}/${v.package?.name}${v.vulnerable_version_range ? ` ${v.vulnerable_version_range}` : ''}`)
            .filter(Boolean);
          return (
            <div key={a.ghsa_id} className={`rounded-lg border-l-4 ${cls.split(' ')[0]} border border-zinc-800 bg-zinc-950/40 p-3 hover:bg-zinc-950/70`}>
              <div className="flex items-start justify-between gap-2">
                <a href={a.html_url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-white">{a.ghsa_id}</span>
                    {a.cve_id && <span className="font-mono text-[11px] text-zinc-400">{a.cve_id}</span>}
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{a.severity.toUpperCase()}</span>
                    {a.cvss?.score && <span className="font-mono text-[10px] text-cyan-300">CVSS {a.cvss.score.toFixed(1)}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-zinc-200">{a.summary}</p>
                  {pkgList.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                      {pkgList.map((p, i) => (
                        <span key={i} className="rounded bg-zinc-800 px-1 font-mono text-cyan-300/80">{p}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-zinc-400">published {new Date(a.published_at).toLocaleDateString()}</div>
                </a>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <ExternalLink className="h-3 w-3 text-zinc-400" />
                  {onConvertToBounty && (
                    <button
                      onClick={() => onConvertToBounty({
                        title: `Fix ${a.ghsa_id}${a.cve_id ? ` (${a.cve_id})` : ''}`,
                        description: `${a.summary}\n\nAffected: ${pkgList.join(', ') || 'see advisory'}\nSeverity: ${a.severity}${a.cvss?.score ? ` (CVSS ${a.cvss.score.toFixed(1)})` : ''}\nAdvisory: ${a.html_url}`,
                        category: 'security',
                        tags: `ghsa,security,${a.severity}`,
                      })}
                      className="flex items-center gap-1 rounded bg-amber-600/20 hover:bg-amber-600/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                      title="Open a draft on the Concord bounty board for this advisory"
                    >
                      <Hammer className="h-3 w-3" /> Bounty this
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
