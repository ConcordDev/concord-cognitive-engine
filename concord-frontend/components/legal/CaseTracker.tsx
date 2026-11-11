'use client';

import { useEffect, useState } from 'react';
import { Gavel, Plus, Calendar, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { daysUntilCalendarDate, formatCalendarDate } from '@/lib/calendar-date';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { cn } from '@/lib/utils';
import { SkeletonTableRows } from '@/components/ui';

export interface CaseEvent {
  date: string;
  kind: 'filed' | 'served' | 'motion' | 'hearing' | 'order' | 'ruling' | 'settled' | 'dismissed' | 'appeal';
  description: string;
}

function filedLabel(raw?: string | null): string {
  if (!raw) return '—';
  const calendar = formatCalendarDate(raw);
  if (calendar) return calendar;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

export interface Case {
  id: string;
  caption: string;
  caseNumber: string;
  court: string;
  jurisdiction: string;
  filedAt: string;
  matterId?: string | null;
  status: 'active' | 'on_hold' | 'closed' | 'appealed';
  matterType: 'civil' | 'criminal' | 'family' | 'probate' | 'corporate' | 'admin';
  nextDeadline?: string;
  nextDeadlineKind?: string;
  events: CaseEvent[];
}

interface MatterRef { id: string; name: string; number?: string }

export function CaseTracker() {
  const [cases, setCases] = useState<Case[]>([]);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [matters, setMatters] = useState<MatterRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Case>>({ matterType: 'civil' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'legal', action: 'case-list', input: {} });
      setCases((res.data?.result?.cases || []) as Case[]);
      const m = await lensRun({ domain: 'legal', action: 'matters-list', input: {} });
      setMatters((m.data?.result?.matters || []) as MatterRef[]);
    } catch (e) { console.error('[Cases] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!draft.caption?.trim() || !draft.caseNumber?.trim()) return;
    try {
      const r = await lensRun({ domain: 'legal', action: 'case-add', input: draft });
      if (r.data?.ok === false) { console.error('[Cases] add failed', r.data?.error); return; }
      setDraft({ matterType: 'civil' });
      setAdding(false);
      await refresh();
    } catch (e) { console.error('[Cases] add failed', e); }
  }

  const matterName = (id?: string | null) => matters.find(m => m.id === id);

  const upcomingDeadlines = cases.filter(c => {
    if (!c.nextDeadline) return false;
    const days = daysUntilCalendarDate(c.nextDeadline);
    return days != null && days > 0 && days < 14;
  });

  return (
    <div className="bg-lattice-surface border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Gavel className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Docket — quick case log</span>
        <span className="ml-auto text-[10px] text-gray-400 font-mono tabular-nums">{cases.length} cases{upcomingDeadlines.length > 0 ? ` · ${upcomingDeadlines.length} deadline${upcomingDeadlines.length === 1 ? '' : 's'} soon` : ''}</span>
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
          <select value={draft.matterId || ''} onChange={e => setDraft({ ...draft, matterId: e.target.value || null })} className="col-span-2 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">No linked matter</option>
            {matters.map(m => <option key={m.id} value={m.id}>Matter: {m.number ? `${m.number} · ` : ''}{m.name}</option>)}
          </select>
          <button onClick={add} className="col-span-2 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add case</button>
        </div>
      )}
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <SkeletonTableRows rows={4} columns={4} />
        ) : cases.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Gavel className="w-6 h-6 mx-auto mb-2 opacity-30" /> No active cases.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {cases.map(c => {
              const days = c.nextDeadline ? daysUntilCalendarDate(c.nextDeadline) : null;
              return (
                <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{c.caption}</span>
                    <span className="text-[10px] text-gray-400 font-mono tabular-nums">{c.caseNumber}</span>
                    <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                      c.status === 'active' ? 'bg-blue-500/20 text-blue-300' :
                      c.status === 'on_hold' ? 'bg-yellow-500/20 text-yellow-300' :
                      c.status === 'appealed' ? 'bg-orange-500/20 text-orange-300' :
                      'bg-gray-500/20 text-gray-300'
                    )}>{c.status.replace(/_/g, ' ')}</span>
                    <StickyDeleteConfirm
                      armed={armedId === c.id}
                      onArm={() => setArmedId(c.id)}
                      onCancel={() => setArmedId(null)}
                      onConfirm={async () => {
                        await lensRun({ domain: 'legal', action: 'case-delete', input: { id: c.id } });
                        setArmedId(null);
                        const res = await lensRun({ domain: 'legal', action: 'case-list', input: {} });
                        setCases((res.data?.result?.cases || []) as Case[]);
                      }}
                      armLabel="Delete"
                      confirmLabel={`Delete “${c.caption}”?`}
                      className="text-[11px] text-rose-300 underline"
                    />
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap">
                    <span className="capitalize">{c.matterType}</span>
                    <span>{c.court}</span>
                    <span className="font-mono tabular-nums">Filed {filedLabel(c.filedAt)}</span>
                    {c.nextDeadline && (
                      <span className={cn('inline-flex items-center gap-1 font-mono tabular-nums', days !== null && days < 7 && 'text-red-300', days !== null && days < 14 && days >= 7 && 'text-yellow-300')}>
                        <Calendar className="w-3 h-3" />
                        {c.nextDeadlineKind || 'Deadline'}: {filedLabel(c.nextDeadline)}{days !== null && ` (${days}d)`}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Clock className="w-3 h-3" /> {c.events.length} events</span>
                    {c.matterId && (
                      <span className="text-cyan-300/80">Matter: {matterName(c.matterId)?.number ? `${matterName(c.matterId)?.number} · ` : ''}{matterName(c.matterId)?.name || c.matterId}</span>
                    )}
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
