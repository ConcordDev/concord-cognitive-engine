'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Send, UserCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
}
interface Lead {
  id: string;
  name: string;
  contact: string;
  message: string;
  intent: string;
  preferredDate: string | null;
  preferredTime: string | null;
  status: string;
  submittedAt: string;
}

const INTENTS = ['buying', 'selling', 'renting', 'investing', 'general'] as const;
const STATUSES = ['new', 'contacted', 'scheduled', 'closed', 'lost'] as const;

const STATUS_STYLE: Record<string, string> = {
  new: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  contacted: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  scheduled: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  closed: 'bg-white/5 text-gray-400 border-white/10',
  lost: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export function ContactAgentForm({ listingId }: { listingId?: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '', contact: '', message: '', intent: 'buying' as string,
    agentId: '', preferredDate: '', preferredTime: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, l] = await Promise.all([
        lensRun({ domain: 'realestate', action: 'agents-list', input: {} }),
        lensRun({ domain: 'realestate', action: 'leads-list', input: listingId ? { listingId } : {} }),
      ]);
      if (a.data?.ok) setAgents((a.data.result?.agents as Agent[]) || []);
      if (l.data?.ok) setLeads((l.data.result?.leads as Lead[]) || []);
    } catch (e) {
      console.error('[ContactAgentForm] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async () => {
    if (!form.name.trim() || !form.contact.trim() || !form.message.trim()) {
      setError('Name, contact, and message are required.');
      return;
    }
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const input: Record<string, unknown> = {
        name: form.name.trim(),
        contact: form.contact.trim(),
        message: form.message.trim(),
        intent: form.intent,
      };
      if (form.agentId) input.agentId = form.agentId;
      if (listingId) input.listingId = listingId;
      if (form.preferredDate) input.preferredDate = form.preferredDate;
      if (form.preferredTime) input.preferredTime = form.preferredTime;
      const r = await lensRun({ domain: 'realestate', action: 'agent-lead-submit', input });
      if (r.data?.ok) {
        setForm({ name: '', contact: '', message: '', intent: 'buying', agentId: '', preferredDate: '', preferredTime: '' });
        setSent(true);
        await refresh();
      } else {
        setError(r.data?.error || 'Could not submit lead.');
      }
    } catch (e) {
      console.error('[ContactAgentForm] submit failed', e);
      setError('Could not submit lead.');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const r = await lensRun({ domain: 'realestate', action: 'lead-update-status', input: { id, status } });
      if (r.data?.ok) {
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
      }
    } catch (e) {
      console.error('[ContactAgentForm] status update failed', e);
    }
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Mail className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Contact an agent</span>
        {listingId && <span className="ml-auto text-[10px] text-gray-400">about this listing</span>}
      </header>

      <div className="p-3 space-y-3">
        {/* Lead form */}
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone or email" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
              {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Any agent</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-1">
              <input type="date" value={form.preferredDate} onChange={(e) => setForm({ ...form, preferredDate: e.target.value })} className="px-1.5 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
              <input type="time" value={form.preferredTime} onChange={(e) => setForm({ ...form, preferredTime: e.target.value })} className="px-1.5 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            </div>
          </div>
          <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What would you like to ask? (e.g. schedule a showing)" rows={3} className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white resize-none" />
          <button onClick={submit} disabled={busy} className="w-full px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send to agent
          </button>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          {sent && <p className="text-[11px] text-emerald-400">Lead submitted — an agent will follow up.</p>}
        </div>

        {/* Lead history */}
        <div className="border-t border-white/10 pt-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Lead history</span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-4 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : leads.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-1">No leads submitted yet.</p>
          ) : (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {leads.map((l) => (
                <li key={l.id} className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{l.name}</span>
                    <span className="text-[10px] text-gray-400">· {l.intent}</span>
                    <select
                      value={l.status}
                      onChange={(e) => updateStatus(l.id, e.target.value)}
                      className={cn('ml-auto text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border bg-transparent', STATUS_STYLE[l.status] || 'text-gray-400 border-white/10')}
                    >
                      {STATUSES.map((s) => <option key={s} value={s} className="bg-[#0d1117] text-white">{s}</option>)}
                    </select>
                  </div>
                  <div className="text-[11px] text-gray-300 mt-0.5">{l.message}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {l.contact}
                    {l.preferredDate ? ` · prefers ${l.preferredDate}${l.preferredTime ? ` ${l.preferredTime}` : ''}` : ''}
                    {` · ${new Date(l.submittedAt).toLocaleDateString()}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContactAgentForm;
