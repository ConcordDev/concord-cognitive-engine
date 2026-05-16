'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ShieldAlert, Loader2, ExternalLink, AlertOctagon, Zap } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { AdvisoryActionMenu } from '@/components/security/AdvisoryActionMenu';

interface Advisory {
  ghsa_id: string;
  cve_id?: string;
  summary: string;
  severity: string;
  html_url: string;
  published_at: string;
  cvss?: { score?: number; vector_string?: string };
}

const SEVERITY = ['', 'critical', 'high', 'medium', 'low'] as const;
const COLOR: Record<string, string> = { critical: 'border-rose-500/40 bg-rose-500/10 text-rose-300', high: 'border-orange-500/40 bg-orange-500/10 text-orange-300', medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300', low: 'border-zinc-700 bg-zinc-900 text-zinc-300' };

export function SecurityAdvisories() {
  const [sev, setSev] = useState<typeof SEVERITY[number]>('high');
  const [actAdvisory, setActAdvisory] = useState<Advisory | null>(null);

  const advs = useQuery({
    queryKey: ['gh-advisories', sev],
    queryFn: async () => {
      const sevQ = sev ? `&severity=${sev}` : '';
      const r = await fetch(`https://api.github.com/advisories?per_page=25${sevQ}`);
      if (!r.ok) throw new Error(`gh ${r.status}`);
      return (await r.json()) as Advisory[];
    },
    staleTime: 30 * 60 * 1000,
  });

  const list = advs.data || [];
  const sevCounts = list.reduce<Record<string, number>>((a, v) => { a[v.severity] = (a[v.severity] || 0) + 1; return a; }, {});

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-400" /><h2 className="text-sm font-semibold text-white">GitHub security advisories</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.github.com/advisories</span></div>
        <div className="flex items-center gap-2">
          <select value={sev} onChange={(e) => setSev(e.target.value as typeof SEVERITY[number])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{SEVERITY.map((s) => <option key={s} value={s}>{s || 'all severities'}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="github-advisories" apiUrl={`https://api.github.com/advisories?per_page=25${sev ? `&severity=${sev}` : ''}`} title={`GH advisories${sev ? ` (${sev})` : ''} — ${list.length}`} content={list.slice(0, 20).map((a, i) => `${i + 1}. ${a.ghsa_id}${a.cve_id ? ` / ${a.cve_id}` : ''} · ${a.severity}${a.cvss?.score ? ` (${a.cvss.score})` : ''}\n   ${a.summary.slice(0, 200)}\n   ${a.html_url}`).join('\n\n')} extraTags={['security', 'github', 'advisory', sev || 'all']} rawData={{ severity: sev, advisories: list }} />}
        </div>
      </header>
      {advs.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub unreachable.</div>}
      <div className="grid grid-cols-4 gap-2">
        {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
          <div key={s} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">{s}</div><div className={`mt-0.5 font-mono text-lg ${s === 'critical' ? 'text-rose-300' : s === 'high' ? 'text-orange-300' : s === 'medium' ? 'text-amber-300' : 'text-zinc-300'}`}>{sevCounts[s] || 0}</div></div>
        ))}
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((a) => (
          <div key={a.ghsa_id} className="rounded-lg border border-rose-500/15 bg-zinc-950/60 p-2.5 hover:border-rose-500/40 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <a href={a.html_url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 block">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-white">{a.ghsa_id}</span>
                  {a.cve_id && <span className="font-mono text-[10px] text-zinc-400">{a.cve_id}</span>}
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${COLOR[a.severity] || COLOR.low}`}><AlertOctagon className="inline h-2.5 w-2.5 mr-0.5" />{a.severity}{a.cvss?.score ? ` · ${a.cvss.score}` : ''}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-zinc-200">{a.summary}</p>
                <div className="mt-1 text-[10px] text-zinc-500">published {a.published_at?.slice(0, 10)}</div>
              </a>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActAdvisory(a); }}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20 transition-colors"
                  title="Incident / escalate / patch / post-mortem / agent"
                >
                  <Zap className="h-3 w-3" /> Actions
                </button>
                <a href={a.html_url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-zinc-800 text-zinc-500" aria-label="Open advisory">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && !advs.isPending && !advs.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No advisories.</div>}
      </div>
      {advs.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}

      <AnimatePresence>
        {actAdvisory && (
          <AdvisoryActionMenu advisory={actAdvisory} onClose={() => setActAdvisory(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
