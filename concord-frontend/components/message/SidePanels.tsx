'use client';

import { useEffect, useState } from 'react';
import { Bell, Calendar, Bookmark, Inbox, Loader2, XCircle, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Mention { messageId: string; channelId: string; senderId: string; body: string; ts: string }
interface Scheduled { id: string; number: string; channelId: string; body: string; sendAt: string }
interface Snoozed { messageId: string; until: string }

export function ActivityFeed() {
  const [list, setList] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lensRun({ domain: 'message', action: 'activity-feed', input: {} })
      .then(r => setList((r.data?.result?.mentions || []) as Mention[]))
      .catch(e => console.error('[Activity] failed', e))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="bg-[#0d1117] border border-violet-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Bell className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-gray-200">Activity</span>
        <span className="text-[10px] text-gray-400">{list.length} mention(s)</span>
      </header>
      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? <Loading /> : list.length === 0 ? <Empty icon={Bell} label="No mentions yet." /> : (
          <ul className="divide-y divide-white/5">
            {list.map(m => (
              <li key={m.messageId} className="px-4 py-2 hover:bg-white/[0.02]">
                <div className="text-[10px] text-gray-400 font-mono">{new Date(m.ts).toLocaleString()}</div>
                <div className="text-xs text-white">{m.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ScheduledList({ onChanged }: { onChanged?: () => void }) {
  const [list, setList] = useState<Scheduled[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'message', action: 'schedule-list', input: {} });
      setList((r.data?.result?.scheduled || []) as Scheduled[]);
    } catch (e) { console.error('[Sched] failed', e); }
    finally { setLoading(false); }
  }
  async function cancel(id: string) {
    if (!confirm('Cancel this scheduled send?')) return;
    try { await lensRun({ domain: 'message', action: 'schedule-cancel', input: { id } }); await refresh(); onChanged?.(); }
    catch (e) { console.error('[Sched] cancel', e); }
  }
  async function flush() {
    try {
      const r = await lensRun({ domain: 'message', action: 'schedule-flush-due', input: {} });
      const n = r.data?.result?.sentCount || 0;
      alert(`Sent ${n} due message(s).`);
      await refresh();
      onChanged?.();
    } catch (e) { console.error('[Sched] flush', e); }
  }
  return (
    <div className="bg-[#0d1117] border border-violet-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-gray-200">Scheduled sends</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
        <button onClick={flush} className="ml-auto px-2 py-1 text-xs rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10">Flush due now</button>
      </header>
      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? <Loading /> : list.length === 0 ? <Empty icon={Calendar} label="No scheduled sends." /> : (
          <ul className="divide-y divide-white/5">
            {list.map(s => (
              <li key={s.id} className="px-4 py-2 hover:bg-white/[0.02] flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-amber-300 font-mono">→ {new Date(s.sendAt).toLocaleString()}</div>
                  <div className="text-xs text-white whitespace-pre-wrap mt-0.5">{s.body}</div>
                </div>
                <button aria-label="Close" onClick={() => cancel(s.id)} className="p-1 rounded hover:bg-rose-500/20 text-rose-300"><XCircle className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SnoozedList() {
  const [list, setList] = useState<Snoozed[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lensRun({ domain: 'message', action: 'snooze-list', input: {} })
      .then(r => setList((r.data?.result?.snoozed || []) as Snoozed[]))
      .catch(e => console.error('[Snoozed] failed', e))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="bg-[#0d1117] border border-violet-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Bookmark className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-gray-200">Snoozed</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
      </header>
      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? <Loading /> : list.length === 0 ? <Empty icon={Bookmark} label="Nothing snoozed." /> : (
          <ul className="divide-y divide-white/5">
            {list.map(s => (
              <li key={s.messageId} className="px-4 py-2 hover:bg-white/[0.02]">
                <div className="text-[10px] text-amber-300 font-mono">→ {new Date(s.until).toLocaleString()}</div>
                <div className="text-xs text-white">{s.messageId}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function InboxOverview({ onJump }: { onJump: () => void }) {
  const [data, setData] = useState<{ channelCount: number; totalUnread: number; channelsWithUnread: number; mentionCount: number; scheduledCount: number; snoozedCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lensRun({ domain: 'message', action: 'inbox-summary', input: {} })
      .then(r => setData(r.data?.result || null))
      .catch(e => console.error('[Inbox] failed', e))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  if (!data) return <Empty icon={Inbox} label="No data." />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Unread" value={String(data.totalUnread)} sub={`across ${data.channelsWithUnread} ch`} tone="rose" />
        <Tile label="Channels" value={String(data.channelCount)} tone="neutral" />
        <Tile label="Mentions" value={String(data.mentionCount)} tone="violet" />
        <Tile label="Scheduled" value={String(data.scheduledCount)} sub={`${data.snoozedCount} snoozed`} tone="amber" />
      </div>
      {data.totalUnread > 0 && (
        <button onClick={onJump} className="w-full p-3 rounded-lg bg-violet-500/[0.07] border border-violet-500/30 flex items-center gap-3 hover:bg-violet-500/[0.12] text-left">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-violet-200">{data.totalUnread} unread message{data.totalUnread === 1 ? '' : 's'}</div>
            <div className="text-[11px] text-violet-300/70">Click to jump to channels — use the AI Summarize button per channel to catch up.</div>
          </div>
        </button>
      )}
    </div>
  );
}

function Loading() { return <div className="p-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>; }
function Empty({ icon: Icon, label }: { icon: typeof Bell; label: string }) {
  return <div className="px-3 py-10 text-center text-xs text-gray-400"><Icon className="w-6 h-6 mx-auto mb-2 opacity-30" />{label}</div>;
}
function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'rose' | 'violet' | 'amber' | 'neutral' }) {
  const colour = tone === 'rose' ? 'text-rose-300' : tone === 'violet' ? 'text-violet-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className="p-3 rounded-lg border border-white/10 bg-black/30">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-2xl font-mono tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
