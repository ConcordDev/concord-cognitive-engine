'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Loader2, BellRing, CheckCheck, Mail, Smartphone, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface GovNotification {
  id: string; kind: string; subjectKind: string; subjectId: string; message: string;
  channel: string; contact: string; read: boolean; createdAt: string;
}
interface Subscription {
  id: string; subjectKind: string; subjectId: string; channel: string; contact: string; createdAt: string;
}

const SUBJECT_KINDS = [
  ['permit', 'Permit'], ['service_request', 'Service Request'],
  ['fine', 'Fine'], ['court_case', 'Court Case'],
];

export function NotificationsPanel() {
  const [notifications, setNotifications] = useState<GovNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [subForm, setSubForm] = useState({ subjectKind: 'permit', subjectId: '', channel: 'email', contact: '' });
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subError, setSubError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'notifications-list', input: { unreadOnly } });
      setNotifications((res.data?.result?.notifications || []) as GovNotification[]);
      setUnreadCount((res.data?.result?.unreadCount as number) || 0);
    } catch (e) { console.error('[Notifs] refresh', e); }
    finally { setLoading(false); }
  }, [unreadOnly]);

  useEffect(() => { refresh(); }, [refresh]);

  async function subscribe() {
    setSubError(null);
    if (!subForm.subjectId.trim() || !subForm.contact.trim()) {
      setSubError('Subject ID and contact required.');
      return;
    }
    try {
      const res = await lensRun({ domain: 'government', action: 'notifications-subscribe', input: subForm });
      if (res.data?.ok === false) { setSubError((res.data?.error as string) || 'subscribe failed'); return; }
      const sub = res.data?.result?.subscription as Subscription;
      if (sub) setSubscriptions(prev => [...prev.filter(s => s.id !== sub.id), sub]);
      setSubForm({ subjectKind: 'permit', subjectId: '', channel: 'email', contact: '' });
    } catch (e) { setSubError(e instanceof Error ? e.message : 'failed'); }
  }

  async function markRead(id?: string) {
    try {
      await lensRun({ domain: 'government', action: 'notifications-mark-read', input: id ? { id } : {} });
      await refresh();
    } catch (e) { console.error('[Notifs] markRead', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BellRing className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Case-status notifications</span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-500/20 text-rose-300 font-bold">{unreadCount} unread</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="text-[10px] text-gray-400 inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} className="accent-cyan-500" />
            Unread only
          </label>
          {unreadCount > 0 && (
            <button onClick={() => markRead()} className="text-[10px] text-cyan-400 hover:underline inline-flex items-center gap-0.5">
              <CheckCheck className="w-3 h-3" />Mark all read
            </button>
          )}
        </div>
      </header>

      {/* Subscribe to case updates */}
      <div className="p-3 border-b border-white/10">
        <div className="text-[10px] uppercase text-gray-400 mb-1.5 inline-flex items-center gap-1"><Bell className="w-3 h-3" />Subscribe to a case for email / SMS updates</div>
        <div className="grid grid-cols-6 gap-2">
          <select value={subForm.subjectKind} onChange={e => setSubForm({ ...subForm, subjectKind: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {SUBJECT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={subForm.subjectId} onChange={e => setSubForm({ ...subForm, subjectId: e.target.value })} placeholder="Case / record ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={subForm.channel} onChange={e => setSubForm({ ...subForm, channel: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="both">Both</option>
          </select>
          <button onClick={subscribe} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Sub</button>
        </div>
        <input value={subForm.contact} onChange={e => setSubForm({ ...subForm, contact: e.target.value })} placeholder="Email address or phone number" className="w-full mt-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        {subError && <div className="mt-1 text-[10px] text-rose-400">{subError}</div>}
        {subscriptions.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {subscriptions.map(s => (
              <li key={s.id} className="text-[10px] text-cyan-300 bg-cyan-500/10 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                {s.channel === 'sms' ? <Smartphone className="w-2.5 h-2.5" /> : <Mail className="w-2.5 h-2.5" />}
                {SUBJECT_KINDS.find(k => k[0] === s.subjectKind)?.[1]} {s.subjectId.slice(0, 12)} → {s.contact}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />No notifications yet. Permit, fine and 311 status changes will appear here.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {notifications.map(n => (
              <li key={n.id} className={`px-3 py-2 flex items-start gap-2 ${n.read ? '' : 'bg-cyan-500/[0.04]'}`}>
                <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-gray-600' : 'bg-cyan-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">{n.message}</div>
                  <div className="text-[10px] text-gray-400 inline-flex items-center gap-1.5">
                    <span>{n.subjectKind.replace(/_/g, ' ')}</span>
                    <span>· via {n.channel}{n.contact && ` (${n.contact})`}</span>
                    <span>· {new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                {!n.read && (
                  <button onClick={() => markRead(n.id)} className="text-[10px] text-cyan-400 hover:underline shrink-0">Mark read</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NotificationsPanel;
