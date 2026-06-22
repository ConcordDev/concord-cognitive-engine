'use client';

/**
 * AddressBookPanel — surfaces the crypto lens's saved-address book (the
 * crypto.address-book-* macros existed backend-side but had no UI). Save a
 * labelled address per chain, list them, delete. In-memory STATE, no network.
 */

import { useCallback, useEffect, useState } from 'react';
import { BookUser, Plus, Trash2, Loader2, AlertTriangle, Copy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entry {
  id: string;
  label: string;
  address: string;
  chain?: string;
  createdAt?: string;
}

const CHAINS = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'solana', 'bitcoin'];

export function AddressBookPanel({ className }: { className?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState(CHAINS[0]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun('crypto', 'address-book-list', {});
      const list = (r?.data?.result?.entries || []) as Entry[];
      setEntries(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load address book');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!label.trim() || !address.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun('crypto', 'address-book-save', { label: label.trim(), address: address.trim(), chain });
      if (r?.data?.error) setError(String(r.data.error));
      else { setLabel(''); setAddress(''); await load(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save address');
    } finally { setSaving(false); }
  }, [label, address, chain, load]);

  const remove = useCallback(async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id)); // optimistic
    try { await lensRun('crypto', 'address-book-delete', { id }); } catch { void load(); }
  }, [load]);

  return (
    <div className={cn('rounded-xl border border-white/10 bg-[#0d1117] p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <BookUser className="w-4 h-4 text-neon-cyan" />
        <h3 className="text-sm font-semibold text-gray-100">Address Book</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        {entries.length === 0 && !loading && (
          <p className="text-xs text-gray-400">No saved addresses yet.</p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-2 group">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 w-16 shrink-0">{e.chain || 'eth'}</span>
            <span className="text-xs text-gray-200 font-medium w-24 shrink-0 truncate">{e.label}</span>
            <span className="text-xs text-gray-400 font-mono flex-1 truncate">{e.address}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(e.address)}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-200"
              aria-label="Copy address"
            ><Copy className="w-3 h-3" /></button>
            <button
              type="button"
              onClick={() => void remove(e.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"
              aria-label="Delete"
            ><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      <form onSubmit={(ev) => { ev.preventDefault(); void save(); }} className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" maxLength={40}
          className="w-24 bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-neon-cyan focus:outline-none" />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… / address" maxLength={120}
          className="flex-1 min-w-[10rem] bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-gray-100 focus:border-neon-cyan focus:outline-none" />
        <select value={chain} onChange={(e) => setChain(e.target.value)}
          className="bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none">
          {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="submit" disabled={saving || !label.trim() || !address.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan text-xs font-medium hover:bg-neon-cyan/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save
        </button>
      </form>
    </div>
  );
}

export default AddressBookPanel;
