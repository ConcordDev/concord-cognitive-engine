'use client';

import { useEffect, useState } from 'react';
import { Gavel, Plus, Loader2, Calendar, Clock, FileText } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface CaseEvent {
  date: string;
  kind: 'filed' | 'served' | 'motion' | 'hearing' | 'order' | 'ruling' | 'settled' | 'dismissed' | 'appeal';
  description: string;
}

export interface Case {
  id: string;
  caption: string;
  caseNumber: string;
  court: string;
  jurisdiction: string;
  filedAt: string;
  status: 'active' | 'on_hold' | 'closed' | 'appealed';
  matterType: 'civil' | 'criminal' | 'family' | 'probate' | 'corporate' | 'admin';
  nextDeadline?: string;
  nextDeadlineKind?: string;
  events: CaseEvent[];
}

export function CaseTracker() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Case>>({ matterType: 'civil' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'legal', action: 'case-list', input: {} });
      setCases((res.data?.result?.cases || []) as Case[]);
    } catch (e) { console.error('[Cases] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!draft.caption?.trim() || !draft.caseNumber?.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'legal', action: 'case-add', input: draft });
      setDraft({ matterType: 'civil' });
      setAdding(false);
      await refresh();
    } catch (e) { console.error('[Cases] add failed', e); }
  }

  const upcomingDeadlines = cases.filter(c => {
    if (!c.nextDeadline) return false;
    const days = (new Date(c.nextDeadline).getTime() - Date.now()) / 86400000;
    return days > 0 && days < 14;
  });

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Gavel className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Active matters</span>
        <span className="ml-auto text-[10px] text-gray-500">{cases.length} cases{upcomingDeadlines.length > 0 ? ` · ${upcomingDeadlines.length} deadline${upcomingDeadlines.length === 1 ? '' : 's'} soon` : ''}</span>
        <button onClick={() => setAdding(v => !v)} className="p-1 text-gray-400 hover:text-white" title="Add case">
          <Plus className="w-4 h-4" />
        </button>
      </header>
      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 gap-2 text-xs">
          <input value={draft.caption || ''} onChange={e => setDraft({ ...draft, caption: e.target.value })} placeholder="Case caption (Smith v. Jones)" className="col-span-2 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.caseNumber || ''} onChange={e => setDraft({ ...draft, caseNumber: e.target.value })} placeholder="Case number" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.court || ''} onChange={e => setDraft({ ...draft, court: e.target.value })} placeholder="Court (e.g. SDNY)" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={draft.matterType} onChange={e => setDraft({ ...draft, matterType: e.target.value as Case['matterType'] })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="civil">Civil</option><option value="criminal">Criminal</option><option value="family">Family</option><option value="probate">Probate</option><option value="corporate">Corporate</option><option value="admin">Administrative</option>
          </select>
          <input type="date" value={draft.filedAt || ''} onChange={e => setDraft({ ...draft, filedAt: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="col-span-2 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add case</button>
        </div>
      )}
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : cases.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Gavel className="w-6 h-6 mx-auto mb-2 opacity-30" /> No active cases.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {cases.map(c => {
              const days = c.nextDeadline ? Math.floor((new Date(c.nextDeadline).getTime() - Date.now()) / 86400000) : null;
              return (
                <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{c.caption}</span>
                    <span className="text-[10px] text-gray-500">{c.caseNumber}</span>
                    <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                      c.status === 'active' ? 'bg-blue-500/20 text-blue-300' :
                      c.status === 'on_hold' ? 'bg-yellow-500/20 text-yellow-300' :
                      c.status === 'appealed' ? 'bg-orange-500/20 text-orange-300' :
                      'bg-gray-500/20 text-gray-300'
                    )}>{c.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    <span className="capitalize">{c.matterType}</span>
                    <span>{c.court}</span>
                    <span>Filed {new Date(c.filedAt).toLocaleDateString()}</span>
                    {c.nextDeadline && (
                      <span className={cn('inline-flex items-center gap-1', days !== null && days < 7 && 'text-red-300', days !== null && days < 14 && days >= 7 && 'text-yellow-300')}>
                        <Calendar className="w-3 h-3" />
                        {c.nextDeadlineKind || 'Deadline'}: {new Date(c.nextDeadline).toLocaleDateString()}{days !== null && ` (${days}d)`}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {c.events.length} events</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CaseTracker;
