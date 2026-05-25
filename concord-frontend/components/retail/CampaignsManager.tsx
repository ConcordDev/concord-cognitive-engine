'use client';

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Loader2, Plus, Send, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

interface Campaign {
  id: string; name: string; channel: string; segment: string;
  subject: string; body: string; discountCode: string | null;
  status: string; audienceSize: number; sentCount: number;
  conversions: number; revenue: number;
}
interface PerfRow {
  id: string; name: string; channel: string; segment: string;
  sentCount: number; conversions: number; revenue: number;
  conversionRate: number; revenuePerRecipient: number;
}
interface OrderLite { id: string; number: string; total: number }

const CHANNELS = ['email', 'sms', 'discount'] as const;
const SEGMENTS = ['all', 'marketing', 'vip', 'new', 'repeat', 'atRisk', 'dormant'] as const;

/**
 * CampaignsManager — email / SMS / discount marketing campaigns targeted
 * at a customer segment, with real conversion tracking. Conversions are
 * attributed by linking an order to a sent campaign, computing revenue
 * and per-recipient ROI from the merchant's own data.
 */
export function CampaignsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [perf, setPerf] = useState<PerfRow[]>([]);
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', channel: 'email' as string, segment: 'marketing' as string, subject: '', body: '', discountCode: '' });
  const [convForm, setConvForm] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, pRes, oRes] = await Promise.all([
        lensRun('retail', 'campaigns-list', {}),
        lensRun('retail', 'campaigns-performance', {}),
        lensRun('retail', 'orders-list', {}),
      ]);
      setCampaigns((cRes.data?.result?.campaigns || []) as Campaign[]);
      setPerf((pRes.data?.result?.campaigns || []) as PerfRow[]);
      setOrders(((oRes.data?.result?.orders || []) as OrderLite[]).slice(0, 30));
    } catch (e) { console.error('[Campaigns] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    if (!form.name.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const r = await lensRun('retail', 'campaigns-create', {
        name: form.name, channel: form.channel, segment: form.segment,
        subject: form.subject, body: form.body,
        discountCode: form.discountCode || undefined,
      });
      if (r.data?.ok === false) setNotice(r.data.error || 'Create failed');
      else { setForm({ name: '', channel: 'email', segment: 'marketing', subject: '', body: '', discountCode: '' }); await refresh(); }
    } catch (e) { console.error('[Campaigns] create failed', e); }
    finally { setBusy(false); }
  }

  async function send(id: string) {
    setBusy(true);
    try {
      const r = await lensRun('retail', 'campaigns-send', { id });
      if (r.data?.ok === false) setNotice(r.data.error || 'Send failed');
      else { setNotice(`Sent to ${r.data?.result?.campaign?.sentCount} recipients`); await refresh(); }
    } catch (e) { console.error('[Campaigns] send failed', e); }
    finally { setBusy(false); }
  }

  async function recordConversion(campaignId: string) {
    const orderId = convForm[campaignId];
    if (!orderId) return;
    setBusy(true);
    try {
      const r = await lensRun('retail', 'campaigns-record-conversion', { id: campaignId, orderId });
      if (r.data?.ok === false) setNotice(r.data.error || 'Attribution failed');
      else { setConvForm({ ...convForm, [campaignId]: '' }); await refresh(); }
    } catch (e) { console.error('[Campaigns] conversion failed', e); }
    finally { setBusy(false); }
  }

  const perfChart = perf.map(p => ({ name: p.name, revenue: p.revenue, conversions: p.conversions }));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-purple-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Marketing campaigns</span>
        <span className="ml-auto text-[10px] text-gray-400">{campaigns.length}</span>
      </header>

      {/* Create */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Campaign name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={form.segment} onChange={e => setForm({ ...form, segment: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Subject" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          {form.channel === 'discount' && (
            <input value={form.discountCode} onChange={e => setForm({ ...form, discountCode: e.target.value.toUpperCase() })} placeholder="Discount code" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          )}
        </div>
        <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="Message body" rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} disabled={busy || !form.name.trim()} className="px-3 py-1.5 text-xs rounded bg-purple-500 text-white font-bold hover:bg-purple-400 disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> Create campaign
        </button>
        {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
      </div>

      {/* Performance chart */}
      {perfChart.length > 0 && (
        <div className="p-3 border-b border-white/10">
          <p className="text-[10px] uppercase text-gray-400 mb-1">Campaign revenue</p>
          <ChartKit kind="bar" data={perfChart} xKey="name" height={160}
            series={[{ key: 'revenue', label: 'Revenue ($)', color: '#a855f7' }, { key: 'conversions', label: 'Conversions', color: '#22c55e' }]} />
        </div>
      )}

      {/* Campaign list */}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Megaphone className="w-6 h-6 mx-auto mb-2 opacity-30" />No campaigns yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {campaigns.map(c => (
              <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] text-gray-400">{c.channel} · {c.segment}</span>
                  <span className={cn('px-1.5 py-0.5 text-[9px] uppercase rounded', c.status === 'sent' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{c.status}</span>
                  {c.status === 'draft' && (
                    <button onClick={() => send(c.id)} disabled={busy} className="px-2 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 inline-flex items-center gap-1 disabled:opacity-40">
                      <Send className="w-3 h-3" /> Send
                    </button>
                  )}
                </div>
                {c.status === 'sent' && (
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-gray-400">
                    <span>{c.sentCount} sent</span>
                    <span className="text-emerald-300">{c.conversions} conversions</span>
                    <span className="text-emerald-300">${c.revenue.toFixed(2)} revenue</span>
                    <div className="ml-auto flex items-center gap-1">
                      <Target className="w-3 h-3 text-gray-400" />
                      <select value={convForm[c.id] || ''} onChange={e => setConvForm({ ...convForm, [c.id]: e.target.value })} className="px-1 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white">
                        <option value="">Attribute order…</option>
                        {orders.map(o => <option key={o.id} value={o.id}>{o.number} (${o.total})</option>)}
                      </select>
                      <button onClick={() => recordConversion(c.id)} disabled={busy || !convForm[c.id]} className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-30">Link</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CampaignsManager;
