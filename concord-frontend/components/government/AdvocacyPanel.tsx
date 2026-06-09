'use client';

import { useEffect, useState, useCallback } from 'react';
import { Megaphone, Loader2, Phone, Mail, MessageSquare, FileText, Trash2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface AdvocacyAction {
  id: string; billId: string; billTitle: string;
  stance: 'support' | 'oppose' | 'comment'; channel: 'comment' | 'call' | 'email' | 'letter';
  message: string; representative: string; bioguideId: string; contactedAt: string;
}
interface Tally { support: number; oppose: number; comment: number }

const CHANNEL_ICON = { comment: MessageSquare, call: Phone, email: Mail, letter: FileText } as const;
const STANCE_COLOUR = {
  support: 'bg-emerald-500/15 text-emerald-300',
  oppose: 'bg-rose-500/15 text-rose-300',
  comment: 'bg-cyan-500/15 text-cyan-300',
} as const;

export function AdvocacyPanel() {
  const [actions, setActions] = useState<AdvocacyAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    billId: '', billTitle: '', stance: 'support', channel: 'comment',
    message: '', representative: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<{ billId: string; data: Tally; total: number } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'advocacy-list', input: {} });
      setActions((res.data?.result?.actions || []) as AdvocacyAction[]);
    } catch (e) { console.error('[Advocacy] refresh', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function record() {
    setError(null);
    if (!form.billId.trim()) { setError('Bill ID required (e.g. HR1234-119).'); return; }
    if ((form.channel !== 'call') && !form.message.trim()) {
      setError('Message required for comment / email / letter.');
      return;
    }
    try {
      const res = await lensRun({ domain: 'government', action: 'advocacy-record', input: form });
      if (res.data?.ok === false) { setError((res.data?.error as string) || 'record failed'); return; }
      setForm({ billId: '', billTitle: '', stance: 'support', channel: 'comment', message: '', representative: '' });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'government', action: 'advocacy-delete', input: { id } });
      setActions(prev => prev.filter(a => a.id !== id));
    } catch (e) { console.error('[Advocacy] delete', e); }
  }

  async function showTally(billId: string) {
    try {
      const res = await lensRun({ domain: 'government', action: 'advocacy-bill-tally', input: { billId } });
      if (res.data?.ok && res.data.result) {
        setTally({ billId, data: res.data.result.tally as Tally, total: res.data.result.total as number });
      }
    } catch (e) { console.error('[Advocacy] tally', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Call-your-rep advocacy</span>
        <span className="ml-auto text-[10px] text-gray-400">{actions.length} actions logged</span>
      </header>

      {/* Record an advocacy action */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-6 gap-2">
          <input value={form.billId} onChange={e => setForm({ ...form, billId: e.target.value })} placeholder="Bill ID (HR1234-119)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={form.billTitle} onChange={e => setForm({ ...form, billTitle: e.target.value })} placeholder="Bill title" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.stance} onChange={e => setForm({ ...form, stance: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="support">Support</option>
            <option value="oppose">Oppose</option>
            <option value="comment">Comment</option>
          </select>
          <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="comment">Comment</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="letter">Letter</option>
          </select>
        </div>
        <input value={form.representative} onChange={e => setForm({ ...form, representative: e.target.value })} placeholder="Representative contacted (optional)" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        {form.channel !== 'call' && (
          <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Your message to your representative" rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        )}
        {error && <div className="text-[10px] text-rose-400">{error}</div>}
        <button onClick={record} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1">
          <Megaphone className="w-3 h-3" />Log advocacy action
        </button>
      </div>

      {tally && (
        <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] text-xs text-gray-300">
          <span className="font-mono text-cyan-300">{tally.billId}</span> · {tally.total} actions:
          <span className="ml-2 text-emerald-300"><ThumbsUp className="w-3 h-3 inline" /> {tally.data.support}</span>
          <span className="ml-2 text-rose-300"><ThumbsDown className="w-3 h-3 inline" /> {tally.data.oppose}</span>
          <span className="ml-2 text-cyan-300"><MessageSquare className="w-3 h-3 inline" /> {tally.data.comment}</span>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : actions.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Megaphone className="w-6 h-6 mx-auto mb-2 opacity-30" />No advocacy actions logged yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {actions.map(a => {
              const Icon = CHANNEL_ICON[a.channel];
              return (
                <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <button onClick={() => showTally(a.billId)} className="font-mono text-xs text-cyan-300 hover:underline">{a.billId}</button>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${STANCE_COLOUR[a.stance]}`}>{a.stance}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{new Date(a.contactedAt).toLocaleDateString()}</span>
                    <button aria-label="Delete" onClick={() => remove(a.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  {a.billTitle && <div className="text-xs text-white mt-0.5 truncate">{a.billTitle}</div>}
                  {a.representative && <div className="text-[10px] text-gray-400">via {a.representative} ({a.channel})</div>}
                  {a.message && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{a.message}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AdvocacyPanel;
