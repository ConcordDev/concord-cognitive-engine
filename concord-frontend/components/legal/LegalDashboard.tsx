'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Timer, FileText, Scale, AlertCircle, Loader2, Calendar } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { ClioNav } from './ClioShell';

interface Summary {
  openMatters: number;
  unbilledHours: number;
  unbilledTime: number;
  openInvTotal: number;
  overdueInvoices: number;
  trustBalance: number;
  runningTimers: number;
  upcomingEvents: Array<{ id: string; title: string; date: string; kind: string }>;
  contactCount: number;
}

export function LegalDashboard({ onJumpTo }: { onJumpTo?: (n: ClioNav) => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setLoading(true);
      try {
        const r = await lensRun({ domain: 'legal', action: 'dashboard-summary', input: {} });
        if (!cancelled) setData((r.data?.result as Summary) || null);
      } catch (e) { console.error('[LegalDash] failed', e); }
      finally { if (!cancelled) setLoading(false); }
    }
    refresh();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading dashboard…</div>;
  }
  if (!data) return <div className="p-10 text-center text-xs text-gray-500">No dashboard data yet.</div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Open matters" value={String(data.openMatters)} icon={Briefcase} onClick={() => onJumpTo?.('matters')} />
        <Tile label="Unbilled time" value={`$${data.unbilledTime.toLocaleString()}`} sub={`${data.unbilledHours.toFixed(1)} hrs`} icon={Timer} tone="amber" onClick={() => onJumpTo?.('time')} />
        <Tile label="Open bills" value={`$${data.openInvTotal.toLocaleString()}`} sub={data.overdueInvoices > 0 ? `${data.overdueInvoices} overdue` : 'on track'} icon={FileText} tone={data.overdueInvoices > 0 ? 'negative' : 'amber'} onClick={() => onJumpTo?.('invoices')} />
        <Tile label="Trust balance" value={`$${data.trustBalance.toLocaleString()}`} icon={Scale} tone="positive" onClick={() => onJumpTo?.('trust')} />
      </div>

      {data.runningTimers > 0 && (
        <button
          onClick={() => onJumpTo?.('time')}
          className="w-full p-3 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/30 flex items-center gap-3 hover:bg-emerald-500/[0.12] text-left"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <Timer className="w-4 h-4 text-emerald-300" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-200">{data.runningTimers} timer{data.runningTimers === 1 ? '' : 's'} running</div>
            <div className="text-[11px] text-emerald-300/70">Stop them to log billable time on the matter.</div>
          </div>
          <span className="text-[10px] text-emerald-300">→</span>
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.upcomingEvents.length > 0 ? (
          <button onClick={() => onJumpTo?.('calendar')} className="p-3 rounded border border-white/10 bg-black/30 hover:bg-white/[0.04] text-left">
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar className="w-3.5 h-3.5 text-amber-300" />
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Upcoming events</span>
            </div>
            <ul className="space-y-1">
              {data.upcomingEvents.slice(0, 5).map(e => (
                <li key={e.id} className="text-xs flex items-center gap-2">
                  <span className="font-mono text-[10px] text-gray-500 w-20">{e.date}</span>
                  <span className="text-[9px] uppercase px-1 rounded bg-amber-500/15 text-amber-300">{e.kind}</span>
                  <span className="text-white truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          </button>
        ) : (
          <div className="p-3 rounded border border-white/10 bg-black/20 text-center text-xs text-gray-500">No upcoming events. <button onClick={() => onJumpTo?.('calendar')} className="text-amber-300 underline">Add deadline →</button></div>
        )}

        {data.overdueInvoices > 0 && (
          <button onClick={() => onJumpTo?.('invoices')} className="p-3 rounded border border-rose-500/30 bg-rose-500/[0.04] hover:bg-rose-500/[0.08] flex items-center gap-3 text-left">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-rose-200">{data.overdueInvoices} overdue bill{data.overdueInvoices === 1 ? '' : 's'}</div>
              <div className="text-[11px] text-rose-300/70">Send reminders or write-offs from the Bills tab.</div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({
  label, value, sub, icon: Icon, tone = 'neutral', onClick,
}: { label: string; value: string; sub?: string; icon: typeof Briefcase; tone?: 'positive' | 'negative' | 'amber' | 'neutral'; onClick?: () => void }) {
  const colour = tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <button onClick={onClick} className="p-3 rounded-lg border border-white/10 bg-black/30 text-left hover:bg-white/[0.04]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className={cn('text-2xl font-mono tabular-nums', colour)}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </button>
  );
}

export default LegalDashboard;
