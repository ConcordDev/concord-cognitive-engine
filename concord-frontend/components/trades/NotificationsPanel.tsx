'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, Send, MessageSquare, Mail } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  channel: 'sms' | 'email';
  kind: 'reminder' | 'on_the_way' | 'follow_up' | 'confirmation';
  recipient: string;
  message: string;
  jobId: string | null;
  status: string;
  createdAt: string;
}
interface Job { id: string; number: string; customerName: string }

const KINDS = ['reminder', 'on_the_way', 'follow_up', 'confirmation'] as const;
const KIND_LABEL: Record<typeof KINDS[number], string> = {
  reminder: 'Appointment reminder',
  on_the_way: 'On-the-way',
  follow_up: 'Follow-up',
  confirmation: 'Booking confirmation',
};

export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{ channel: 'sms' | 'email'; kind: typeof KINDS[number]; recipient: string; message: string; jobId: string }>({
    channel: 'sms', kind: 'reminder', recipient: '', message: '', jobId: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [n, j] = await Promise.all([
        lensRun<{ notifications: Notification[] }>('trades', 'notifications-list', {}),
        lensRun<{ jobs: Job[] }>('trades', 'job-list', {}),
      ]);
      if (n.data?.ok && n.data.result) setItems(n.data.result.notifications);
      if (j.data?.ok && j.data.result) setJobs(j.data.result.jobs);
    } catch (e) { console.error('[Notifications] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function send() {
    if (!draft.recipient.trim() || !draft.message.trim()) return;
    try {
      const r = await lensRun('trades', 'notifications-send', {
        channel: draft.channel, kind: draft.kind, recipient: draft.recipient,
        message: draft.message, jobId: draft.jobId || null,
      });
      if (r.data?.ok) {
        setDraft(d => ({ ...d, recipient: '', message: '', jobId: '' }));
        await refresh();
      }
    } catch (e) { console.error('[Notifications] send failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Bell className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Customer reminders</span>
        <span className="ml-auto text-[10px] text-gray-400">{items.length} sent</span>
      </header>

      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select value={draft.channel} onChange={e => setDraft(d => ({ ...d, channel: e.target.value as 'sms' | 'email' }))} className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
            <option value="sms">SMS</option><option value="email">Email</option>
          </select>
          <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as typeof KINDS[number] }))} className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <input value={draft.recipient} onChange={e => setDraft(d => ({ ...d, recipient: e.target.value }))} placeholder={draft.channel === 'sms' ? 'Phone number' : 'Email address'} className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
        <select value={draft.jobId} onChange={e => setDraft(d => ({ ...d, jobId: e.target.value }))} className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="">— link to job (optional) —</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.number} · {j.customerName}</option>)}
        </select>
        <textarea value={draft.message} onChange={e => setDraft(d => ({ ...d, message: e.target.value }))} placeholder="Message to the customer" rows={2} className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 resize-none" />
        <button onClick={send} disabled={!draft.recipient.trim() || !draft.message.trim()} className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/15 text-xs text-amber-100 disabled:opacity-40">
          <Send className="w-3 h-3" /> Queue {draft.channel.toUpperCase()}
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />No reminders sent yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map(n => (
              <li key={n.id} className="px-3 py-2 flex items-start gap-2">
                {n.channel === 'sms'
                  ? <MessageSquare className="w-3.5 h-3.5 text-cyan-400 mt-0.5" />
                  : <Mail className="w-3.5 h-3.5 text-violet-400 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white truncate">{n.recipient}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{KIND_LABEL[n.kind]}</span>
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded ml-auto', n.status === 'queued' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300')}>{n.status}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NotificationsPanel;
