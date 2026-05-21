'use client';

/**
 * MemberNotifications — Cozi-shape per-member notifications for assigned tasks.
 * Real CRUD against household.notification-create / -list / -mark-read.
 * Each notification targets a household member by name with a kind tag.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Check, Loader2, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Notif {
  id: string; recipient: string; message: string; kind: string;
  refId: string | null; read: boolean; createdAt: string;
}

const KINDS = ['task', 'event', 'bill', 'general'] as const;
const KIND_COLOR: Record<string, string> = {
  task: 'text-sky-400', event: 'text-violet-400', bill: 'text-amber-400', general: 'text-zinc-400',
};

export function MemberNotifications() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ recipient: '', message: '', kind: 'task' });
  const [filterRecipient, setFilterRecipient] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (recipient: string, unreadFlag: boolean) => {
    const r = await lensRun<{ notifications: Notif[]; unread: number }>('household', 'notification-list', {
      recipient: recipient || undefined, unreadOnly: unreadFlag,
    });
    if (r.data?.ok) { setNotifs(r.data.result?.notifications || []); setUnread(r.data.result?.unread || 0); }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(filterRecipient, unreadOnly); }, [refresh, filterRecipient, unreadOnly]);

  async function send() {
    if (!form.recipient.trim() || !form.message.trim()) return;
    setBusy(true);
    await lensRun('household', 'notification-create', {
      recipient: form.recipient.trim(), message: form.message.trim(), kind: form.kind,
    });
    setForm({ ...form, message: '' }); setBusy(false);
    await refresh(filterRecipient, unreadOnly);
  }
  async function markRead(id: string) {
    await lensRun('household', 'notification-mark-read', { id });
    await refresh(filterRecipient, unreadOnly);
  }
  async function markAll() {
    await lensRun('household', 'notification-mark-read', { all: true });
    await refresh(filterRecipient, unreadOnly);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-zinc-100">Member Notifications</h3>
        {unread > 0 && <span className="text-[10px] bg-rose-600 text-white rounded-full px-1.5 py-0.5 font-bold">{unread}</span>}
        {unread > 0 && (
          <button onClick={markAll} className="ml-auto px-2 py-1 text-[11px] rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1">
            <BellOff className="w-3 h-3" />Mark all read
          </button>
        )}
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex gap-1.5 flex-wrap">
        <input value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })} placeholder="To (member)"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') void send(); }} placeholder="Notification message"
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={send} disabled={busy || !form.recipient.trim() || !form.message.trim()}
          className="px-2.5 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}Send
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input value={filterRecipient} onChange={e => setFilterRecipient(e.target.value)} placeholder="Filter by member"
          className="w-36 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>

      {notifs.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No data yet — send a notification to a household member above.</p>
      ) : (
        <ul className="space-y-1">
          {notifs.map(n => (
            <li key={n.id} className={cn('flex items-center gap-2 border rounded-lg px-3 py-1.5',
              n.read ? 'border-zinc-800 bg-zinc-900/40' : 'border-violet-800/50 bg-violet-950/30')}>
              <span className={cn('text-[9px] uppercase font-bold w-12 shrink-0', KIND_COLOR[n.kind])}>{n.kind}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-100 truncate">{n.message}</p>
                <p className="text-[10px] text-zinc-500">to {n.recipient} · {new Date(n.createdAt).toLocaleString()}</p>
              </div>
              {!n.read && (
                <button onClick={() => markRead(n.id)} title="Mark read"
                  className="w-5 h-5 rounded-full bg-violet-700/40 hover:bg-violet-600 text-violet-200 hover:text-white flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
