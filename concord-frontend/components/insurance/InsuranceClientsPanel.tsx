'use client';

/**
 * InsuranceClientsPanel — browse/search/add the persisted Client (CRM)
 * entity. Closes the "no persisted Client entity" gap (docs/lens-specs/
 * insurance-capability-map.md): previously nothing in the insurance lens
 * persisted an insured's contact record (phone/email/address/DOB/risk
 * profile/referral source) or aggregated their book of policies/claims.
 * Backed by the real `insurance.client-add`/`client-list` macros.
 */

import { useCallback, useState } from 'react';
import { Loader2, Plus, Search, Phone, Mail, MapPin, FileText, ClipboardList, DollarSign } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { ClientRecord } from './ClientAutocomplete';

const RISK_PROFILES = ['low', 'standard', 'elevated', 'high'];
const RISK_COLOR: Record<string, string> = {
  low: 'text-emerald-400', standard: 'text-blue-300', elevated: 'text-amber-400', high: 'text-rose-400',
};

interface InsuranceClientsPanelProps {
  clients: ClientRecord[];
  loading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onRefresh: () => void;
}

export function InsuranceClientsPanel({ clients, loading, query, onQueryChange, onRefresh }: InsuranceClientsPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '', dob: '',
    riskProfile: 'standard', referralSource: '', notes: '',
  });

  const addClient = useCallback(async () => {
    if (!form.name.trim()) { setError('Client name is required.'); return; }
    setSaving(true);
    try {
      const r = await lensRun('insurance', 'client-add', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        dob: form.dob,
        riskProfile: form.riskProfile,
        referralSource: form.referralSource.trim(),
        notes: form.notes.trim(),
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed to add client.'); return; }
      setForm({ name: '', phone: '', email: '', address: '', dob: '', riskProfile: 'standard', referralSource: '', notes: '' });
      setShowAdd(false); setError(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [form, onRefresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            placeholder="Search clients by name…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-7 pr-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg whitespace-nowrap">
          <Plus className="w-3.5 h-3.5" /> Add client
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <label className="text-[11px] text-zinc-400">Date of birth
            <input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })}
              className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </label>
          <label className="text-[11px] text-zinc-400">Risk profile
            <select value={form.riskProfile} onChange={(e) => setForm({ ...form, riskProfile: e.target.value })}
              className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {RISK_PROFILES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <input placeholder="Referral source" value={form.referralSource} onChange={(e) => setForm({ ...form, referralSource: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addClient} disabled={saving}
            className="col-span-2 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save client
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : clients.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No clients yet. Add your first one.
        </div>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                <span className={cn('text-[10px] uppercase font-bold', RISK_COLOR[c.riskProfile || 'standard'])}>
                  {c.riskProfile || 'standard'} risk
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-zinc-400">
                {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</span>}
                {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</span>}
                {c.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.address}</span>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]">
                <span className="flex items-center gap-1 text-blue-300">
                  <FileText className="w-3 h-3" /> {c.policyCount ?? 0} polic{(c.policyCount ?? 0) === 1 ? 'y' : 'ies'}
                  {typeof c.activePolicyCount === 'number' ? ` (${c.activePolicyCount} active)` : ''}
                </span>
                <span className="flex items-center gap-1 text-zinc-300">
                  <ClipboardList className="w-3 h-3" /> {c.claimCount ?? 0} claim{(c.claimCount ?? 0) === 1 ? '' : 's'}
                </span>
                {typeof c.totalAnnualPremium === 'number' && c.totalAnnualPremium > 0 && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <DollarSign className="w-3 h-3" /> ${c.totalAnnualPremium}/yr
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default InsuranceClientsPanel;
