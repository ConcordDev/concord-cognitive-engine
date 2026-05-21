'use client';

/**
 * MarketingContactsPanel — CRM contact book with bidirectional lead sync.
 * Wires: contact-upsert, contact-list, contact-delete, contact-sync.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Contact, Trash2, RefreshCw, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const LIFECYCLE_STAGES = ['subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer'] as const;

interface CrmContact {
  id: string; email: string; name?: string; company?: string | null;
  phone?: string | null; lifecycleStage?: string; updatedAt?: string;
}

export function MarketingContactsPanel() {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<string>('subscriber');

  const refresh = useCallback(async (q?: string) => {
    setLoading(true);
    const r = await lensRun('marketing', 'contact-list', q ? { query: q } : {});
    setContacts(r.data?.result?.contacts || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const upsert = async () => {
    if (!email.trim()) { setError('Contact email is required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('marketing', 'contact-upsert', {
      email: email.trim(), name: name.trim(), company: company.trim(),
      phone: phone.trim(), lifecycleStage: stage,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEmail(''); setName(''); setCompany(''); setPhone(''); setStage('subscriber');
    await refresh(query);
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'contact-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh(query);
  };

  const sync = async () => {
    setBusy(true); setError(null); setSyncInfo(null);
    const r = await lensRun('marketing', 'contact-sync', {});
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Sync failed'); return; }
    const res = r.data?.result;
    if (res) {
      setSyncInfo(`Imported ${res.importedFromLeads} from leads · exported ${res.exportedToLeads} to leads · ${res.totalContacts} contacts total`);
    }
    await refresh(query);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      {syncInfo && <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">{syncInfo}</div>}

      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Contact className="w-3.5 h-3.5 text-orange-400" /> CRM contacts ({contacts.length})
        </h3>
        <button type="button" onClick={sync} disabled={busy}
          className="flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 border border-blue-800/60 rounded-lg px-3 py-1.5">
          <RefreshCw className={cn('w-3.5 h-3.5', busy && 'animate-spin')} /> Sync with leads
        </button>
      </div>

      {/* Upsert form */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex items-center gap-2">
          <select value={stage} onChange={(e) => setStage(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 capitalize">
            {LIFECYCLE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={upsert} disabled={busy}
            className={cn('flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 text-white',
              busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
            <Plus className="w-3.5 h-3.5" /> Save contact
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <input value={query} onChange={(e) => { setQuery(e.target.value); void refresh(e.target.value); }}
          placeholder="Search contacts…" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-100" />
      </div>

      {contacts.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No contacts. Add one above or sync from the leads pipeline.</p>
      ) : (
        <ul className="space-y-1.5">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs text-zinc-100 truncate">{c.name || c.email}</p>
                <p className="text-[10px] text-zinc-500 truncate">
                  {c.email}{c.company ? ` · ${c.company}` : ''}{c.phone ? ` · ${c.phone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] capitalize bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">{c.lifecycleStage}</span>
                <button type="button" onClick={() => del(c.id)} aria-label="Delete contact"
                  className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
