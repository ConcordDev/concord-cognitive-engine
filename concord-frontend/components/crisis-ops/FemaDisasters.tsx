'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, ExternalLink, MapPin, Calendar } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Disaster {
  id: string;
  disasterNumber: number;
  state: string;
  declarationType: string;
  declarationDate: string;
  incidentType: string;
  declarationTitle: string;
  incidentBeginDate?: string;
  incidentEndDate?: string;
  designatedArea?: string;
  fyDeclared?: number;
}

const STATES = ['', 'CA', 'TX', 'FL', 'NY', 'LA', 'OK', 'IL', 'WA', 'OR', 'CO', 'AZ', 'GA', 'NC', 'PR'];

export function FemaDisasters() {
  const [state, setState] = useState('');

  const disasters = useQuery({
    queryKey: ['fema-disasters', state],
    queryFn: async () => {
      const filter = state ? `&$filter=state%20eq%20'${state}'` : '';
      const r = await fetch(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=30&$orderby=declarationDate%20desc${filter}`);
      if (!r.ok) throw new Error(`fema ${r.status}`);
      const j = await r.json();
      return (j.DisasterDeclarationsSummaries || []) as Disaster[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">FEMA disaster declarations</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">fema.gov/api/open/v2 · live</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={state} onChange={(e) => setState(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {STATES.map((s) => <option key={s} value={s}>{s || 'all states'}</option>)}
          </select>
          {(disasters.data?.length ?? 0) > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="fema-disasters"
              apiUrl="https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries"
              title={`FEMA disasters${state ? ` (${state})` : ''} — ${disasters.data?.length} recent`}
              content={(disasters.data || []).slice(0, 25).map((d, i) => `${i + 1}. DR-${d.disasterNumber} · ${d.incidentType} · ${d.state}/${d.designatedArea}\n   ${d.declarationTitle}\n   declared ${d.declarationDate?.slice(0, 10)}`).join('\n\n')}
              extraTags={['crisis-ops', 'fema', 'disasters', state.toLowerCase() || 'all']}
              rawData={{ state, disasters: disasters.data }}
            />
          )}
        </div>
      </header>
      {disasters.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">FEMA OpenAPI unreachable.</div>}
      {disasters.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling declarations…</div>}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {(disasters.data || []).map((d) => (
          <a key={d.id} href={`https://www.fema.gov/disaster/${d.disasterNumber}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 hover:border-amber-500/40">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-white">DR-{d.disasterNumber}</span>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{d.incidentType}</span>
                  <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{d.declarationType}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-[12px] text-zinc-200">{d.declarationTitle}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{d.state}{d.designatedArea ? ` · ${d.designatedArea}` : ''}</span>
                  <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />declared {d.declarationDate?.slice(0, 10)}</span>
                  {d.incidentBeginDate && <span>began {d.incidentBeginDate.slice(0, 10)}</span>}
                </div>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
