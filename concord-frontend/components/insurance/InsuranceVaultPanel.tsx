'use client';

/**
 * InsuranceVaultPanel — agents, covered assets and reminders.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, UserRound, Package, BellRing, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Agent { id: string; name: string; agency: string | null; phone: string | null; role: string }
interface Asset { id: string; name: string; kind: string; value: number }
interface Reminder { id: string; title: string; kind: string; dueDate: string | null; done: boolean; status: string }

const STATUS_COLOR: Record<string, string> = {
  overdue: 'text-rose-400', due_soon: 'text-amber-400', scheduled: 'text-emerald-400', done: 'text-zinc-400', none: 'text-zinc-400',
};

export function InsuranceVaultPanel({ onChange }: { onChange: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetValue, setAssetValue] = useState(0);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState({ name: '', agency: '', phone: '' });
  const [assetForm, setAssetForm] = useState({ name: '', kind: 'vehicle', value: '' });
  const [remForm, setRemForm] = useState({ title: '', kind: 'renewal', dueDate: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [ag, as, rm] = await Promise.all([
      lensRun('insurance', 'agent-list', {}),
      lensRun('insurance', 'asset-list', {}),
      lensRun('insurance', 'reminder-list', {}),
    ]);
    setAgents(ag.data?.result?.agents || []);
    setAssets(as.data?.result?.assets || []);
    setAssetValue(as.data?.result?.totalValue || 0);
    setReminders(rm.data?.result?.reminders || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addAgent = async () => {
    if (!agentForm.name.trim()) { setError('Agent name is required.'); return; }
    const r = await lensRun('insurance', 'agent-add', {
      name: agentForm.name.trim(), agency: agentForm.agency.trim(), phone: agentForm.phone.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setAgentForm({ name: '', agency: '', phone: '' }); setError(null);
    await refresh();
  };
  const addAsset = async () => {
    if (!assetForm.name.trim()) { setError('Asset name is required.'); return; }
    const r = await lensRun('insurance', 'asset-add', {
      name: assetForm.name.trim(), kind: assetForm.kind, value: Number(assetForm.value) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setAssetForm({ name: '', kind: 'vehicle', value: '' }); setError(null);
    await refresh();
  };
  const addReminder = async () => {
    if (!remForm.title.trim()) { setError('Reminder title is required.'); return; }
    const r = await lensRun('insurance', 'reminder-create', {
      title: remForm.title.trim(), kind: remForm.kind, dueDate: remForm.dueDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRemForm({ title: '', kind: 'renewal', dueDate: '' }); setError(null);
    await refresh();
  };
  const toggleReminder = async (r: Reminder) => {
    await lensRun('insurance', 'reminder-complete', { id: r.id, reopen: r.done });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Reminders */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BellRing className="w-3.5 h-3.5 text-blue-400" /> Reminders
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Title" value={remForm.title} onChange={(e) => setRemForm({ ...remForm, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={remForm.kind} onChange={(e) => setRemForm({ ...remForm, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['renewal', 'payment', 'inspection', 'review', 'general'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="date" value={remForm.dueDate} onChange={(e) => setRemForm({ ...remForm, dueDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addReminder}
            className="flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {reminders.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No reminders.</p>
        ) : (
          <ul className="space-y-1">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => toggleReminder(r)}
                  className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    r.done ? 'bg-blue-600 border-blue-600' : 'border-zinc-600')}>
                  {r.done && <Check className="w-3 h-3 text-white" />}
                </button>
                <span className={cn('flex-1 text-xs', r.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{r.title}</span>
                <span className={cn('text-[10px]', STATUS_COLOR[r.status] || 'text-zinc-400')}>{r.dueDate || 'no date'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Covered assets */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Package className="w-3.5 h-3.5 text-blue-400" /> Covered assets
          {assetValue > 0 && <span className="text-[10px] text-zinc-400">· ${assetValue} total</span>}
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Asset name" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={assetForm.kind} onChange={(e) => setAssetForm({ ...assetForm, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['vehicle', 'property', 'valuable', 'electronics', 'jewelry', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Value ($)" inputMode="decimal" value={assetForm.value} onChange={(e) => setAssetForm({ ...assetForm, value: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addAsset}
            className="flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {assets.length > 0 && (
          <ul className="space-y-1">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-200">{a.name} <span className="text-zinc-400 capitalize">· {a.kind}</span></span>
                <span className="text-zinc-400 font-mono">${a.value}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Agents */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <UserRound className="w-3.5 h-3.5 text-blue-400" /> Agents &amp; contacts
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Name" value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Agency" value={agentForm.agency} onChange={(e) => setAgentForm({ ...agentForm, agency: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Phone" value={agentForm.phone} onChange={(e) => setAgentForm({ ...agentForm, phone: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addAgent}
            className="flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {agents.length > 0 && (
          <ul className="space-y-1">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-200">{a.name} <span className="text-zinc-400">{a.agency}</span></span>
                <span className="text-zinc-400">{a.phone}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
