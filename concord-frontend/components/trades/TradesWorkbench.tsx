'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Wrench, Users, Calendar, FileText, Plus, Save, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface Job {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'emergency';
  status: 'unassigned' | 'dispatched' | 'en-route' | 'on-site' | 'completed' | 'invoiced' | 'cancelled';
  scheduledFor: string | null;
  assignedTech: string | null;
  estimatedHours: number;
}

export interface Contract {
  id: string;
  customerId: string;
  customerName: string;
  cadence: 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  monthlyRate: number;
  description: string;
  active: boolean;
  nextVisitAt: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'jobs' | 'customers' | 'contracts';

const PRIO_COLOR: Record<Job['priority'], string> = {
  low: 'bg-gray-500/15 text-gray-300',
  normal: 'bg-cyan-500/15 text-cyan-300',
  high: 'bg-amber-500/15 text-amber-300',
  emergency: 'bg-rose-500/15 text-rose-300',
};

const STATUS_COLOR: Record<Job['status'], string> = {
  unassigned: 'bg-gray-500/15 text-gray-300',
  dispatched: 'bg-blue-500/15 text-blue-300',
  'en-route': 'bg-cyan-500/15 text-cyan-300',
  'on-site': 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  invoiced: 'bg-violet-500/15 text-violet-300',
  cancelled: 'bg-rose-500/15 text-rose-300',
};

export function TradesWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('jobs');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[640px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-amber-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-amber-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Trades Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'jobs',      label: 'Dispatch',  icon: Calendar },
          { id: 'customers', label: 'Customers', icon: Users },
          { id: 'contracts', label: 'Contracts', icon: FileText },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'jobs' && <JobsTab />}
        {tab === 'customers' && <CustomersTab />}
        {tab === 'contracts' && <ContractsTab />}
      </div>
    </div>
  );
}

function JobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ customerId: string; description: string; priority: Job['priority']; estimatedHours: number }>({
    customerId: '', description: '', priority: 'normal', estimatedHours: 1,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [j, c] = await Promise.all([
        lensRun({ domain: 'trades', action: 'job-list', input: {} }),
        lensRun({ domain: 'trades', action: 'customer-list', input: {} }),
      ]);
      setJobs(((j.data as { result?: { jobs?: Job[] } }).result?.jobs) || []);
      setCustomers(((c.data as { result?: { customers?: Customer[] } }).result?.customers) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'trades', action: 'job-create', input: draft });
      setCreating(false);
      setDraft({ customerId: '', description: '', priority: 'normal', estimatedHours: 1 });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const updateStatus = async (id: string, status: Job['status']) => {
    try {
      await lensRun({ domain: 'trades', action: 'job-update-status', input: { id, status } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
        <Plus className="w-3 h-3" /> New job
      </button>
      {creating && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <select value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
            <option value="">— select customer —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description of the job" rows={3}
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 resize-none" />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Job['priority'] })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              <option value="low">Low</option><option value="normal">Normal</option>
              <option value="high">High</option><option value="emergency">Emergency</option>
            </select>
            <input type="number" value={draft.estimatedHours} onChange={(e) => setDraft({ ...draft, estimatedHours: Number(e.target.value) })}
              step="0.5" placeholder="Est. hrs"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </div>
          <button type="button" onClick={save} disabled={!draft.customerId || !draft.description.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/15 text-xs text-amber-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Dispatch
          </button>
        </div>
      )}
      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        jobs.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No jobs.</p> :
        jobs.map((j) => (
          <div key={j.id} className="rounded border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-amber-300">{j.number}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded uppercase font-mono', PRIO_COLOR[j.priority])}>{j.priority}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded uppercase font-mono', STATUS_COLOR[j.status])}>{j.status}</span>
                </div>
                <p className="text-sm text-gray-100 mt-1">{j.customerName}</p>
                <p className="text-[11px] text-gray-400 line-clamp-2">{j.description}</p>
                {j.assignedTech && <p className="text-[10px] text-gray-400 mt-1">→ {j.assignedTech}</p>}
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['dispatched', 'en-route', 'on-site', 'completed'] as const).map((s) => (
                <button key={s} type="button" onClick={() => updateStatus(j.id, s)}
                  className="px-2 py-0.5 text-[10px] rounded border border-white/10 hover:border-amber-500/30 text-gray-400 hover:text-amber-300">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))
      }
    </div>
  );
}

function CustomersTab() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '', email: '', address: '', notes: '' });

  const refresh = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'trades', action: 'customer-list', input: {} });
      setCustomers(((r.data as { result?: { customers?: Customer[] } }).result?.customers) || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'trades', action: 'customer-upsert', input: draft });
      setCreating(false);
      setDraft({ name: '', phone: '', email: '', address: '', notes: '' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
        <Plus className="w-3 h-3" /> New customer
      </button>
      {creating && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          {(['name', 'phone', 'email', 'address'] as const).map((k) => (
            <input key={k} type="text" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              placeholder={k} className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          ))}
          <button type="button" onClick={save} disabled={!draft.name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/15 text-xs text-amber-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      )}
      {customers.map((c) => (
        <div key={c.id} className="rounded border border-white/10 bg-black/20 p-3">
          <p className="text-sm font-medium text-gray-100">{c.name}</p>
          {c.phone && <p className="text-[11px] text-gray-400">{c.phone}</p>}
          {c.email && <p className="text-[11px] text-gray-400">{c.email}</p>}
          {c.address && <p className="text-[11px] text-gray-400">{c.address}</p>}
        </div>
      ))}
    </div>
  );
}

function ContractsTab() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ customerId: string; cadence: Contract['cadence']; monthlyRate: number; description: string }>({
    customerId: '', cadence: 'annual', monthlyRate: 50, description: '',
  });

  const refresh = useCallback(async () => {
    try {
      const [c, cust] = await Promise.all([
        lensRun({ domain: 'trades', action: 'contract-list', input: {} }),
        lensRun({ domain: 'trades', action: 'customer-list', input: {} }),
      ]);
      setContracts(((c.data as { result?: { contracts?: Contract[] } }).result?.contracts) || []);
      setCustomers(((cust.data as { result?: { customers?: Customer[] } }).result?.customers) || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'trades', action: 'contract-create', input: draft });
      setCreating(false);
      await refresh();
    } catch (e) { console.error(e); }
  };

  const cancel = async (id: string) => {
    try {
      await lensRun({ domain: 'trades', action: 'contract-cancel', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
        <Plus className="w-3 h-3" /> New contract
      </button>
      {creating && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <select value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
            <option value="">— select customer —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Contract['cadence'] })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
              <option value="semiannual">Semi-annual</option><option value="annual">Annual</option>
            </select>
            <input type="number" value={draft.monthlyRate} onChange={(e) => setDraft({ ...draft, monthlyRate: Number(e.target.value) })}
              placeholder="Monthly rate $"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </div>
          <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description (e.g. quarterly HVAC tune-up)"
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          <button type="button" onClick={save} disabled={!draft.customerId || draft.monthlyRate < 0}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/15 text-xs text-amber-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      )}
      {contracts.map((c) => (
        <div key={c.id} className={cn('rounded border bg-black/20 p-3 group', c.active ? 'border-white/10' : 'border-rose-500/20 opacity-60')}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-100">{c.customerName}</p>
              <p className="text-[11px] text-gray-400">${c.monthlyRate}/mo · {c.cadence}</p>
              {c.description && <p className="text-[11px] text-gray-400 mt-1">{c.description}</p>}
            </div>
            {c.active && (
              <button aria-label="Delete" type="button" onClick={() => cancel(c.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default TradesWorkbench;
