'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Loader2, Plus, X, Archive, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { EmptyStateCTA } from '@/components/lens/EmptyStateCTA';

interface Contact { id: string; name: string; kind: string }
interface Matter {
  id: string; number: string; name: string;
  clientName: string; matterType: string; status: string;
  jurisdiction: string; court: string; caseNumber: string;
  hourlyRate: number; billingType: string;
  openedAt: string; closedAt: string | null;
  description: string; partyIds: string[];
}
interface Detail {
  matter: Matter;
  parties: Contact[];
  totals: { billed: number; unbilled: number; hours: number; trustBalance: number };
  time: Array<{ id: string; date: string; description: string; hours: number; amount: number; status: string }>;
  invoices: Array<{ id: string; number: string; total: number; status: string }>;
  documents: Array<{ id: string; name: string; status: string }>;
  events: Array<{ id: string; title: string; date: string; kind: string }>;
}

const TYPES = ['litigation','transactional','family','probate','criminal','employment','ip','real_estate','corporate','immigration','tax','bankruptcy','other'];
const BILLING = ['hourly','flat','contingency','pro_bono'];

export function MattersPanel() {
  const [list, setList] = useState<Matter[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<string>('open');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', clientName: '', matterType: 'litigation', hourlyRate: '', jurisdiction: '', court: '', caseNumber: '', billingType: 'hourly', description: '', partyIds: [] as string[] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filter]);

  async function refresh() {
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        lensRun({ domain: 'legal', action: 'matters-list', input: filter === 'all' ? {} : { status: filter } }),
        lensRun({ domain: 'legal', action: 'contacts-list', input: {} }),
      ]);
      setList((m.data?.result?.matters || []) as Matter[]);
      setContacts((c.data?.result?.contacts || []) as Contact[]);
    } catch (e) { console.error('[Matters] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim()) return;
    try {
      await lensRun({
        domain: 'legal', action: 'matters-create',
        input: { ...draft, hourlyRate: Number(draft.hourlyRate) || 0 },
      });
      setDraft({ name: '', clientName: '', matterType: 'litigation', hourlyRate: '', jurisdiction: '', court: '', caseNumber: '', billingType: 'hourly', description: '', partyIds: [] });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Matters] create failed', e); }
  }

  async function close(id: string) {
    if (!confirm('Close this matter?')) return;
    try {
      await lensRun({ domain: 'legal', action: 'matters-close', input: { id } });
      await refresh();
    } catch (e) { console.error('[Matters] close failed', e); }
  }

  async function openDetail(id: string) {
    setActiveId(id);
    try {
      const r = await lensRun({ domain: 'legal', action: 'matters-detail', input: { id } });
      setDetail((r.data?.result as Detail) || null);
    } catch (e) { console.error('[Matters] detail failed', e); }
  }

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className={cn('space-y-2', activeId ? 'col-span-5' : 'col-span-12')}>
        <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-gray-200">Matters</span>
            <span className="text-[10px] text-gray-400">{list.length}</span>
            <select value={filter} onChange={e => setFilter(e.target.value)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="intake">Intake</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
            <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />New
            </button>
          </header>

          {creating && (
            <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Matter name *" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input value={draft.clientName} onChange={e => setDraft({ ...draft, clientName: e.target.value })} placeholder="Client name" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <select value={draft.matterType} onChange={e => setDraft({ ...draft, matterType: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
              <select value={draft.billingType} onChange={e => setDraft({ ...draft, billingType: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                {BILLING.map(b => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
              </select>
              <input type="number" value={draft.hourlyRate} onChange={e => setDraft({ ...draft, hourlyRate: e.target.value })} placeholder="$/hr" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <input value={draft.jurisdiction} onChange={e => setDraft({ ...draft, jurisdiction: e.target.value })} placeholder="Jurisdiction" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input value={draft.court} onChange={e => setDraft({ ...draft, court: e.target.value })} placeholder="Court" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input value={draft.caseNumber} onChange={e => setDraft({ ...draft, caseNumber: e.target.value })} placeholder="Case #" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <select multiple value={draft.partyIds} onChange={e => setDraft({ ...draft, partyIds: Array.from(e.target.selectedOptions).map(o => o.value) })} className="col-span-9 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" size={3}>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
              </select>
              <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Description" rows={2} className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Open matter</button>
            </div>
          )}

          <div className="max-h-[28rem] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : list.length === 0 ? (
              <EmptyStateCTA lensId="legal" accent="amber" headline="No matters yet"
                caption="Open your first matter to track work, time, and billing."
                buttonLabel="Open a matter" onAction={() => setCreating(true)} className="py-8" />
            ) : (
              <ul className="divide-y divide-white/5">
                {list.map(m => (
                  <li key={m.id} onClick={() => openDetail(m.id)} className={cn('px-3 py-2.5 cursor-pointer flex items-center gap-2 hover:bg-white/[0.03]', activeId === m.id && 'bg-amber-500/[0.06]')}>
                    <span className={cn(
                      'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                      m.status === 'closed' ? 'bg-gray-500/20 text-gray-300' : m.status === 'open' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
                    )}>{m.status}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 font-mono">{m.number}</span>
                        <span>{m.name}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {m.clientName && <span>{m.clientName} · </span>}
                        {m.matterType.replace(/_/g, ' ')} · {m.billingType.replace(/_/g, ' ')}
                        {m.hourlyRate > 0 && <span> · ${m.hourlyRate}/hr</span>}
                      </div>
                    </div>
                    {m.status !== 'closed' && (
                      <button onClick={(e) => { e.stopPropagation(); close(m.id); }} className="p-1 rounded hover:bg-rose-500/20 text-rose-300 opacity-60 hover:opacity-100" title="Close matter">
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {activeId && detail && (
        <div className="col-span-7 bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-gray-200 flex-1 truncate">{detail.matter.name}</span>
            <button aria-label="Close" onClick={() => { setActiveId(null); setDetail(null); }} className="p-1 rounded hover:bg-white/[0.05] text-gray-400"><X className="w-3.5 h-3.5" /></button>
          </header>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Tile label="Unbilled" value={`$${detail.totals.unbilled.toLocaleString()}`} sub={`${detail.totals.hours.toFixed(1)} hrs`} tone="amber" />
              <Tile label="Billed" value={`$${detail.totals.billed.toLocaleString()}`} tone="emerald" />
              <Tile label="Trust" value={`$${detail.totals.trustBalance.toLocaleString()}`} tone="cyan" />
              <Tile label="Docs" value={String(detail.documents.length)} sub={`${detail.events.length} events`} tone="gray" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-400">Type:</span> <span className="text-white">{detail.matter.matterType.replace(/_/g, ' ')}</span></div>
              <div><span className="text-gray-400">Status:</span> <span className="text-white">{detail.matter.status}</span></div>
              <div><span className="text-gray-400">Court:</span> <span className="text-white">{detail.matter.court || '—'}</span></div>
              <div><span className="text-gray-400">Case #:</span> <span className="text-white font-mono">{detail.matter.caseNumber || '—'}</span></div>
              <div><span className="text-gray-400">Jurisdiction:</span> <span className="text-white">{detail.matter.jurisdiction || '—'}</span></div>
              <div><span className="text-gray-400">Opened:</span> <span className="text-white">{detail.matter.openedAt}</span></div>
            </div>

            {detail.parties.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Parties</div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.parties.map(p => (
                    <span key={p.id} className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-white">
                      {p.name} <span className="text-gray-400">· {p.kind.replace(/_/g, ' ')}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detail.time.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Recent time</div>
                <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {detail.time.slice(0, 8).map(t => (
                    <li key={t.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 font-mono w-20">{t.date}</span>
                      <span className="flex-1 truncate text-white">{t.description}</span>
                      <span className="text-gray-400 font-mono">{t.hours.toFixed(1)}h</span>
                      <span className={cn('font-mono w-16 text-right', t.status === 'billed' ? 'text-gray-400' : 'text-amber-300')}>${t.amount.toFixed(0)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.invoices.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Bills</div>
                <ul className="text-xs space-y-0.5">
                  {detail.invoices.map(i => (
                    <li key={i.id} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-gray-400 w-20">{i.number}</span>
                      <span className="flex-1">{i.status}</span>
                      <span className="font-mono text-white">${i.total.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.events.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Upcoming events</div>
                <ul className="text-xs space-y-0.5">
                  {detail.events.slice(0, 5).map(e => (
                    <li key={e.id} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-gray-400 w-20">{e.date}</span>
                      <span className="text-[9px] uppercase px-1 rounded bg-amber-500/15 text-amber-300">{e.kind}</span>
                      <span className="flex-1 truncate text-white">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'amber' | 'emerald' | 'cyan' | 'gray' }) {
  const c = tone === 'amber' ? 'text-amber-300' : tone === 'emerald' ? 'text-emerald-300' : tone === 'cyan' ? 'text-cyan-300' : 'text-gray-300';
  return (
    <div className="rounded border border-white/10 bg-black/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-lg font-mono tabular-nums', c)}>{value}</div>
      {sub && <div className="text-[9px] text-gray-400">{sub}</div>}
    </div>
  );
}

export default MattersPanel;
