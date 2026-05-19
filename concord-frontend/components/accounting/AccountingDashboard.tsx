'use client';

import { useEffect, useState } from 'react';
import { Wallet, Receipt, FileText, TrendingUp, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DashboardSummary {
  cashOnHand: number; openInvTotal: number; openInvCount: number;
  openBillsTotal: number; openBillsCount: number;
  ytdRevenue: number; ytdExpense: number; ytdNetIncome: number;
  uncategorizedTxns: number; customerCount: number; vendorCount: number;
}

export function AccountingDashboard({ onJumpTo }: { onJumpTo?: (nav: string) => void }) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'accounting', action: 'dashboard-summary', input: {} });
      setData((r.data?.result as DashboardSummary) || null);
    } catch (e) { console.error('[Dashboard] failed', e); }
    finally { setLoading(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading dashboard…</div>;
  }
  if (!data) {
    return <div className="p-10 text-center text-xs text-gray-500">No dashboard data yet.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Cash on hand" value={`$${data.cashOnHand.toLocaleString()}`} icon={Wallet} tone="positive" onClick={() => onJumpTo?.('coa')} />
        <Tile label="Open invoices" value={`$${data.openInvTotal.toLocaleString()}`} sub={`${data.openInvCount} unpaid`} icon={FileText} tone="positive" onClick={() => onJumpTo?.('invoices')} />
        <Tile label="Open bills" value={`$${data.openBillsTotal.toLocaleString()}`} sub={`${data.openBillsCount} unpaid`} icon={Receipt} tone="negative" onClick={() => onJumpTo?.('bills')} />
        <Tile label="YTD net income" value={`${data.ytdNetIncome >= 0 ? '+' : ''}$${data.ytdNetIncome.toLocaleString()}`} sub={`rev $${data.ytdRevenue.toLocaleString()}`} icon={TrendingUp} tone={data.ytdNetIncome >= 0 ? 'positive' : 'negative'} onClick={() => onJumpTo?.('pl')} bold />
      </div>

      {data.uncategorizedTxns > 0 && (
        <button
          onClick={() => onJumpTo?.('banking')}
          className="w-full p-3 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/30 flex items-center gap-3 hover:bg-emerald-500/[0.12] text-left"
        >
          <Sparkles className="w-5 h-5 text-emerald-400" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-200">{data.uncategorizedTxns} bank txns waiting</div>
            <div className="text-[11px] text-emerald-300/70">Use AI bulk-categorize to clear them in one click</div>
          </div>
          <span className="text-[10px] text-emerald-300">→</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onJumpTo?.('customers')}
          className="p-3 rounded border border-white/10 bg-black/30 hover:bg-white/[0.04] text-left flex items-center gap-3"
        >
          <div className="text-2xl font-mono text-emerald-300">{data.customerCount}</div>
          <div>
            <div className="text-xs text-white">Customers</div>
            <div className="text-[10px] text-gray-500">Manage → bills, invoices</div>
          </div>
        </button>
        <button
          onClick={() => onJumpTo?.('vendors')}
          className="p-3 rounded border border-white/10 bg-black/30 hover:bg-white/[0.04] text-left flex items-center gap-3"
        >
          <div className="text-2xl font-mono text-amber-300">{data.vendorCount}</div>
          <div>
            <div className="text-xs text-white">Vendors</div>
            <div className="text-[10px] text-gray-500">Including 1099 contractors</div>
          </div>
        </button>
      </div>

      {data.ytdNetIncome < 0 && (
        <div className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.04] flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <div className="flex-1 text-xs text-amber-100">
            You're running a net loss YTD. <button onClick={() => onJumpTo?.('runway')} className="underline text-amber-300 hover:text-amber-200">Check runway →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  label, value, sub, icon: Icon, tone = 'positive', bold, onClick,
}: { label: string; value: string; sub?: string; icon: typeof Wallet; tone?: 'positive' | 'negative'; bold?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-3 rounded-lg border bg-black/30 text-left hover:bg-white/[0.04] transition',
        bold ? 'border-emerald-500/30' : 'border-white/10',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className={cn('text-2xl font-mono tabular-nums', tone === 'positive' ? 'text-emerald-300' : 'text-rose-300', bold && 'font-bold')}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </button>
  );
}

export default AccountingDashboard;
