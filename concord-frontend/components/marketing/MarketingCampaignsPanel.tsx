'use client';

/**
 * MarketingCampaignsPanel — campaigns with daily metric logging,
 * computed KPIs and budget pacing.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Target, ChevronLeft, Trash2, Pencil } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { calendarDateKey } from '@/lib/calendar-date';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { MarketingGmailSendPanel } from './MarketingGmailSendPanel';

interface Kpis { impressions: number; clicks: number; conversions: number; spend: number; revenue: number; ctr: number; cpc: number; cpa: number; roas: number; conversionRate: number }
interface Campaign { id: string; name: string; channel: string; budget: number; status: string; endDate?: string | null; kpis?: Kpis }
interface Pacing { budget: number; spent: number; expectedSpend: number; pace: string; utilisationPct: number }

const CHANNELS = ['email', 'social', 'search', 'display', 'content', 'video', 'affiliate', 'events'];
const VERDICT_COLOR: Record<string, string> = {
  strong: 'text-emerald-400', acceptable: 'text-sky-400', break_even: 'text-amber-400',
  underperforming: 'text-rose-400', no_data: 'text-zinc-400',
};
const PACE_COLOR: Record<string, string> = {
  on_track: 'text-emerald-400', overpacing: 'text-rose-400', underpacing: 'text-amber-400', not_started: 'text-zinc-400',
};

export function MarketingCampaignsPanel({ onChange }: { onChange: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', channel: 'search', budget: '', startDate: calendarDateKey(), endDate: '' });
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [verdict, setVerdict] = useState('no_data');
  const [pacing, setPacing] = useState<Pacing | null>(null);
  const [metricForm, setMetricForm] = useState({ date: calendarDateKey(), impressions: '', clicks: '', conversions: '', spend: '', revenue: '' });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', budget: '', endDate: '', status: 'draft' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('marketing', 'campaign-list', {});
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load campaigns.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCampaigns(r.data?.result?.campaigns || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCampaign = useCallback(async (c: Campaign) => {
    setSelected(c);
    setEditing(false);
    const [k, p] = await Promise.all([
      lensRun('marketing', 'campaign-kpis', { campaignId: c.id }),
      lensRun('marketing', 'budget-pacing', { campaignId: c.id }),
    ]);
    setKpis(k.data?.result?.kpis || null);
    setVerdict(k.data?.result?.verdict || 'no_data');
    setPacing((p.data?.result as Pacing | null) || null);
  }, []);

  const add = async () => {
    if (!form.name.trim()) { setError('Campaign name is required.'); return; }
    const r = await lensRun('marketing', 'campaign-create', {
      name: form.name.trim(), channel: form.channel, budget: Number(form.budget) || 0,
      startDate: form.startDate, endDate: form.endDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', channel: 'search', budget: '', startDate: calendarDateKey(), endDate: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const del = async (id: string) => {
    const victim = campaigns.find((c) => c.id === id);
    await lensRun('marketing', 'campaign-delete', { id });
    if (selected?.id === id) setSelected(null);
    // FIX-marketing-015: tell the rest of the lens the campaign is gone,
    // so surfaces holding output tied to it by name (the Quick Analysis
    // bench's result card) clear it instead of leaving an orphan behind.
    if (victim) window.dispatchEvent(new CustomEvent('marketing:campaign-removed', { detail: { name: victim.name } }));
    await refresh(); onChange();
  };
  // Edit path (build(marketing) S4 — Review 5 F4): `campaign-update` was
  // registered with no surface anywhere, so a campaign's budget could not
  // be corrected once created. The form edits exactly the verb's field set
  // (name · budget · endDate · status); channel is not updatable server-side
  // and is not offered.
  const startEdit = () => {
    if (!selected) return;
    setEditForm({
      name: selected.name, budget: String(selected.budget ?? ''),
      endDate: selected.endDate || '', status: selected.status || 'draft',
    });
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!selected) return;
    if (!editForm.name.trim()) { setError('Campaign name is required.'); return; }
    const r = await lensRun('marketing', 'campaign-update', {
      id: selected.id, name: editForm.name.trim(),
      budget: Number(editForm.budget) || 0,
      endDate: editForm.endDate || null, status: editForm.status,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    const updated = (r.data?.result as { campaign?: Campaign } | null)?.campaign;
    if (updated) setSelected(updated);
    // A rename orphans name-tied output the same way a delete does
    // (FIX-marketing-015) — the old name's analysis is cleared too.
    if (updated && updated.name !== selected.name) {
      window.dispatchEvent(new CustomEvent('marketing:campaign-removed', { detail: { name: selected.name } }));
    }
    setEditing(false); setError(null);
    await refresh(); onChange();
  };
  const logMetric = async () => {
    if (!selected) return;
    await lensRun('marketing', 'metric-log', {
      campaignId: selected.id, date: metricForm.date,
      impressions: Number(metricForm.impressions) || 0, clicks: Number(metricForm.clicks) || 0,
      conversions: Number(metricForm.conversions) || 0, spend: Number(metricForm.spend) || 0,
      revenue: Number(metricForm.revenue) || 0,
    });
    setMetricForm({ date: calendarDateKey(), impressions: '', clicks: '', conversions: '', spend: '', revenue: '' });
    await openCampaign(selected);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Campaign detail ──
  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All campaigns
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-zinc-100">{selected.name}</h3>
              <p className="text-xs text-zinc-400 capitalize">{selected.channel} · ${selected.budget} budget · {selected.status}</p>
            </div>
            <button type="button" onClick={() => (editing ? setEditing(false) : startEdit())}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg shrink-0">
              <Pencil className="w-3.5 h-3.5" /> {editing ? 'Close edit' : 'Edit campaign'}
            </button>
          </div>
          {editing && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <input placeholder="Campaign name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Budget ($)" inputMode="decimal" value={editForm.budget} onChange={(e) => setEditForm({ ...editForm, budget: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input type="date" title="End date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                {['draft', 'active', 'paused', 'completed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" onClick={saveEdit}
                className="col-span-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save changes</button>
            </div>
          )}
        </div>

        {kpis && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Kpi label="Impr." value={kpis.impressions} />
            <Kpi label="Clicks" value={kpis.clicks} />
            <Kpi label="CTR" value={`${kpis.ctr}%`} />
            <Kpi label="CPC" value={`$${kpis.cpc}`} />
            <Kpi label="CPA" value={`$${kpis.cpa}`} />
            <Kpi label="ROAS" value={`${kpis.roas}×`} className={VERDICT_COLOR[verdict]} />
          </div>
        )}

        {pacing && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">Budget pacing</span>
              <span className={cn('capitalize', PACE_COLOR[pacing.pace])}>{pacing.pace.replace(/_/g, ' ')}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.min(100, pacing.utilisationPct)}%` }} />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              ${pacing.spent} of ${pacing.budget} spent · ${pacing.expectedSpend} expected by now
            </p>
          </div>
        )}

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-zinc-300 mb-2">Log daily metrics</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input type="date" value={metricForm.date} onChange={(e) => setMetricForm({ ...metricForm, date: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Impressions" inputMode="numeric" value={metricForm.impressions} onChange={(e) => setMetricForm({ ...metricForm, impressions: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Clicks" inputMode="numeric" value={metricForm.clicks} onChange={(e) => setMetricForm({ ...metricForm, clicks: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Conversions" inputMode="numeric" value={metricForm.conversions} onChange={(e) => setMetricForm({ ...metricForm, conversions: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Spend ($)" inputMode="decimal" value={metricForm.spend} onChange={(e) => setMetricForm({ ...metricForm, spend: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Revenue ($)" inputMode="decimal" value={metricForm.revenue} onChange={(e) => setMetricForm({ ...metricForm, revenue: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
          <button type="button" onClick={logMetric}
            className="mt-2 px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded-lg">Log metrics</button>
        </div>

        <MarketingGmailSendPanel campaignId={selected.id} campaignName={selected.name} />
      </div>
    );
  }

  // ── Campaign list ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{campaigns.length}</span> campaigns</span>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New campaign
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Budget ($)" inputMode="decimal" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="End date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="col-span-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Create campaign</button>
        </div>
      )}

      {loadError ? (
        <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>
      ) : campaigns.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No campaigns. Launch one to start tracking performance.
        </div>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openCampaign(c)} className="text-left flex items-center gap-2">
                <Target className="w-4 h-4 text-orange-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                  <p className="text-[11px] text-zinc-400 capitalize">
                    {c.channel} · {c.status}
                    {c.kpis ? ` · ${c.kpis.roas}× ROAS · $${c.kpis.spend} spend` : ''}
                  </p>
                </div>
              </button>
              <StickyDeleteConfirm onConfirm={() => del(c.id)} armAriaLabel={`Delete ${c.name}`} confirmAriaLabel={`Confirm delete ${c.name}`} className="text-zinc-600 hover:text-rose-400" armLabel={<Trash2 className="w-3.5 h-3.5" />} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
      <p className={cn('text-sm font-bold text-zinc-100', className)}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase">{label}</p>
    </div>
  );
}
