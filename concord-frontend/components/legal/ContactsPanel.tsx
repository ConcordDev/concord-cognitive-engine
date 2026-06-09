'use client';

import { useEffect, useState } from 'react';
import { Users, Loader2, Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { EmptyStateCTA } from '@/components/lens/EmptyStateCTA';

interface Contact {
  id: string; number: string; name: string; kind: string;
  email: string; phone: string; organization: string; address: string; notes: string;
}
interface ConflictMatch {
  kind: string; contact?: Contact;
  matter?: { id: string; name: string };
  matters?: Array<{ id: string; name: string; number: string }>;
}

const KINDS = ['client','opposing_party','opposing_counsel','witness','court','expert','other'];

export function ContactsPanel() {
  const [list, setList] = useState<Contact[]>([]);
  const [filterKind, setFilterKind] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', kind: 'client', email: '', phone: '', organization: '', address: '', notes: '' });
  const [conflictQ, setConflictQ] = useState('');
  const [conflicts, setConflicts] = useState<{ hits: number; matches: ConflictMatch[] } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filterKind]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'legal', action: 'contacts-list', input: filterKind === 'all' ? {} : { kind: filterKind } });
      setList((r.data?.result?.contacts || []) as Contact[]);
    } catch (e) { console.error('[Contacts] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim()) return;
    try {
      await lensRun({ domain: 'legal', action: 'contacts-create', input: draft });
      setDraft({ name: '', kind: 'client', email: '', phone: '', organization: '', address: '', notes: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Contacts] create failed', e); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this contact?')) return;
    try {
      await lensRun({ domain: 'legal', action: 'contacts-delete', input: { id } });
      setList(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Contacts] delete failed', e); }
  }

  async function runConflict() {
    if (!conflictQ.trim()) return;
    try {
      const r = await lensRun({ domain: 'legal', action: 'conflict-search', input: { name: conflictQ.trim() } });
      setConflicts({ hits: r.data?.result?.hits || 0, matches: (r.data?.result?.matches || []) as ConflictMatch[] });
    } catch (e) { console.error('[Contacts] conflict failed', e); }
  }

  return (
    <div className="space-y-3">
      {/* Conflict check */}
      <div className="bg-rose-500/[0.04] border border-rose-500/20 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          <span className="text-xs uppercase tracking-wider text-rose-300 font-semibold">Conflict check</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); runConflict(); }} className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={conflictQ}
            onChange={(e) => setConflictQ(e.target.value)}
            placeholder="Search name, organization, or case number across all matters + contacts…"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <button type="submit" className="px-3 py-1.5 text-xs rounded bg-rose-500 text-white font-bold hover:bg-rose-400">Run check</button>
        </form>
        {conflicts && (
          <div className="mt-2 text-xs">
            <div className={cn('font-semibold', conflicts.hits > 0 ? 'text-rose-300' : 'text-emerald-300')}>
              {conflicts.hits > 0 ? `⚠️ ${conflicts.hits} potential conflict(s)` : '✓ No conflicts found'}
            </div>
            {conflicts.matches.length > 0 && (
              <ul className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                {conflicts.matches.map((m, i) => (
                  <li key={i} className="text-xs text-rose-100">
                    {m.kind === 'contact' && m.contact && (
                      <>
                        <span className="font-semibold">{m.contact.name}</span> <span className="text-gray-400">({m.contact.kind})</span>
                        {m.matters && m.matters.length > 0 && (
                          <span className="text-gray-400"> in {m.matters.length} matter(s): {m.matters.map(x => x.name).join(', ')}</span>
                        )}
                      </>
                    )}
                    {m.kind === 'matter' && m.matter && (
                      <>Matter: <span className="font-semibold">{m.matter.name}</span></>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Contacts list */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Contacts</span>
          <span className="text-[10px] text-gray-400">{list.length}</span>
          <select value={filterKind} onChange={e => setFilterKind(e.target.value)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="all">All kinds</option>
            {KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />New
          </button>
        </header>

        {creating && (
          <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name *" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="Email" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={draft.organization} onChange={e => setDraft({ ...draft, organization: e.target.value })} placeholder="Organization" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} placeholder="Address" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes" rows={2} className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Save contact</button>
          </div>
        )}

        <div className="max-h-[28rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : list.length === 0 ? (
            <EmptyStateCTA lensId="legal" accent="amber" headline="No contacts yet"
              caption="Add a client or contact to link them to matters and invoices."
              buttonLabel="Add a contact" onAction={() => setCreating(true)} className="py-8" />
          ) : (
            <ul className="divide-y divide-white/5">
              {list.map(c => (
                <li key={c.id} className="px-4 py-2.5 hover:bg-white/[0.02] group flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                    c.kind === 'client' ? 'bg-emerald-500/15 text-emerald-300' : c.kind === 'opposing_party' || c.kind === 'opposing_counsel' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300',
                  )}>{c.name.slice(0, 1).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate flex items-center gap-2">
                      {c.name}
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{c.kind.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      <span className="font-mono">{c.number}</span>
                      {c.organization && <span> · {c.organization}</span>}
                      {c.email && <span> · {c.email}</span>}
                      {c.phone && <span> · {c.phone}</span>}
                    </div>
                  </div>
                  <button aria-label="Delete" onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContactsPanel;
