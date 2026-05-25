'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, Clock, AlertTriangle, Check, CalendarClock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reminder {
  billId: string;
  name: string;
  amount: number;
  dueDate: string;
  daysUntil: number;
  status: 'paid' | 'overdue' | 'due_soon';
  autopay: boolean;
  notify: boolean;
  message: string;
}
interface ReminderResult {
  reminders: Reminder[];
  actionable: Reminder[];
  overdueCount: number;
  dueSoonCount: number;
  leadDays: number;
}

const STATUS_STYLE: Record<Reminder['status'], { color: string; icon: typeof Clock }> = {
  overdue: { color: 'text-rose-300', icon: AlertTriangle },
  due_soon: { color: 'text-amber-300', icon: Clock },
  paid: { color: 'text-emerald-300', icon: Check },
};

export function BillReminders() {
  const [data, setData] = useState<ReminderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [leadDays, setLeadDays] = useState(5);

  const refresh = useCallback(async (lead: number) => {
    setLoading(true);
    try {
      const r = await lensRun('finance', 'bill-reminders', { leadDays: lead });
      if (r.data?.ok) setData(r.data.result as ReminderResult);
    } catch (e) { console.error('[BillReminders] load failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(leadDays); }, [refresh, leadDays]);

  async function pay(billId: string) {
    try {
      const r = await lensRun('finance', 'bills-pay', { id: billId });
      if (r.data?.ok) await refresh(leadDays);
    } catch (e) { console.error('[BillReminders] pay failed', e); }
  }

  async function snooze(billId: string) {
    try {
      const r = await lensRun('finance', 'bill-reminder-snooze', { id: billId, days: 3 });
      if (r.data?.ok) await refresh(leadDays);
    } catch (e) { console.error('[BillReminders] snooze failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BellRing className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Bill reminders
        </span>
        <span className="ml-auto text-[10px] text-gray-400 flex items-center gap-1">
          Lead
          <select
            value={leadDays}
            onChange={(e) => setLeadDays(Number(e.target.value))}
            className="px-1 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white"
          >
            {[1, 3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d}d</option>)}
          </select>
        </span>
      </header>

      {data && (data.overdueCount > 0 || data.dueSoonCount > 0) && (
        <div className="px-4 py-2 border-b border-white/10 flex gap-3 text-[10px]">
          {data.overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-300">
              <AlertTriangle className="w-3 h-3" /> {data.overdueCount} overdue
            </span>
          )}
          {data.dueSoonCount > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Clock className="w-3 h-3" /> {data.dueSoonCount} due soon
            </span>
          )}
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : !data || data.reminders.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">
            <BellRing className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No upcoming or overdue bills. Add bills in the Bills tab to get reminders.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.reminders.map((r) => {
              const style = STATUS_STYLE[r.status];
              const Icon = style.icon;
              return (
                <li key={r.billId} className="px-3 py-2.5 hover:bg-white/[0.03] flex items-center gap-3">
                  <Icon className={cn('w-4 h-4 shrink-0', style.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white truncate">{r.name}</span>
                      {r.autopay && (
                        <span className="text-[9px] uppercase bg-cyan-500/15 text-cyan-300 px-1 py-0.5 rounded">
                          autopay
                        </span>
                      )}
                    </div>
                    <div className={cn('text-[10px]', style.color)}>{r.message}</div>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-white shrink-0">
                    ${r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  {r.status !== 'paid' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => snooze(r.billId)}
                        className="inline-flex items-center gap-1 px-1.5 py-1 text-[10px] rounded bg-white/5 text-gray-400 hover:text-white"
                      >
                        <CalendarClock className="w-3 h-3" /> Snooze
                      </button>
                      <button
                        onClick={() => pay(r.billId)}
                        className="inline-flex items-center gap-1 px-1.5 py-1 text-[10px] rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                      >
                        <Check className="w-3 h-3" /> Mark paid
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default BillReminders;
