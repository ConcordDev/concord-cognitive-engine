'use client';

/**
 * MarketingLeadsPanel — lead pipeline with predictive-style scoring
 * and revenue attribution.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, UserPlus, Trash2, Gauge } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Lead { id: string; name: string; email: string | null; source: string; campaignId: string | null; value: number; stage: string; score: number }
interface Campaign { id: string; name: string }
interface AttributionRow { campaignId: string; campaign: string; revenue: number }

const STAGES = ['new', 'contacted', 'qualified', 'opportunity', 'won', 'lost'];
const STAGE_COLOR: Record<string, string> = {
  new: 'text-zinc-400', contacted: 'text-sky-400', qualified: 'text-amber-400',
  opportunity: 'text-violet-400', won: 'text-emerald-400', lost: 'text-rose-400',
};

export function MarketingLeadsPanel({ onChange }: { onChange: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [attribution, setAttribution] = useState<AttributionRow[]>([]);
  const [attrTotal, setAttrTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', source: 'direct', campaignId: '', value: '' });
  const [scoreFor, setScoreFor] = useState<string | null>(null);
  const [scoreForm, setScoreForm] = useState({ emailOpens: '', linkClicks: '', pageViews: '', formSubmits: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [l, c, a] = await Promise.all([
      lensRun('marketing', 'lead-list', {}),
      lensRun('marketing', 'campaign-list', {}),
      lensRun('marketing', 'attribution-report', {}),
    ]);
    setLeads(l.data?.result?.leads || []);
    setCampaigns(c.data?.result?.campaigns || []);
    setAttribution(a.data?.result?.attribution || []);
    setAttrTotal(a.data?.result?.totalRevenue || 0);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.name.trim()) { setError('Lead name is required.'); return; }
    const r = await lensRun('marketing', 'lead-add', {
      name: form.name.trim(), email: form.email.trim(), source: form.source,
      campaignId: form.campaignId || undefined, value: Number(form.value) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', email: '', source: 'direct', campaignId: '', value: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const setStage = async (id: string, stage: string) => {
    await lensRun('marketing', 'lead-update-stage', { id, stage });
    await refresh();
  };
  const del = async (id: string) => { await lensRun('marketing', 'lead-delete', { id }); await refresh(); };
  const score = async (id: string) => {
    await lensRun('marketing', 'lead-score', {
      id, emailOpens: Number(scoreForm.emailOpens) || 0, linkClicks: Number(scoreForm.linkClicks) || 0,
      pageViews: Number(scoreForm.pageViews) || 0, formSubmits: Number(scoreForm.formSubmits) || 0,
    });
    setScoreFor(null);
    setScoreForm({ emailOpens: '', linkClicks: '', pageViews: '', formSubmits: '' });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {attribution.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Revenue attribution · ${attrTotal} won</h3>
          <ul className="space-y-1">
            {attribution.map((a) => (
              <li key={a.campaignId} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-300">{a.campaign}</span>
                <span className="text-emerald-400 font-mono">${a.revenue}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <UserPlus className="w-3.5 h-3.5 text-orange-400" /> Leads
          </h3>
          <button type="button" onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAdd && (
          <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mb-2">
            <input placeholder="Lead / company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">— no campaign —</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input placeholder="Deal value ($)" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={add}
              className="col-span-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add lead</button>
          </div>
        )}

        {leads.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
            No leads. Add prospects to build your pipeline.
          </div>
        ) : (
          <ul className="space-y-2">
            {leads.map((l) => (
              <li key={l.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">
                      {l.name}
                      {l.score > 0 && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-orange-300">score {l.score}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {l.source}{l.value > 0 ? ` · $${l.value}` : ''}
                    </p>
                  </div>
                  <button aria-label="Delete" type="button" onClick={() => del(l.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {STAGES.map((st) => (
                    <button key={st} type="button" onClick={() => setStage(l.id, st)}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded border capitalize',
                        l.stage === st ? `border-zinc-600 ${STAGE_COLOR[st]} bg-zinc-800` : 'border-zinc-800 text-zinc-600')}>
                      {st}
                    </button>
                  ))}
                </div>
                {scoreFor === l.id ? (
                  <div className="grid grid-cols-5 gap-1 mt-2">
                    {(['emailOpens', 'linkClicks', 'pageViews', 'formSubmits'] as const).map((k) => (
                      <input key={k} placeholder={k.replace(/([A-Z])/g, ' $1')} inputMode="numeric"
                        value={scoreForm[k]} onChange={(e) => setScoreForm({ ...scoreForm, [k]: e.target.value })}
                        className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-100" />
                    ))}
                    <button type="button" onClick={() => score(l.id)}
                      className="bg-orange-600 hover:bg-orange-500 text-white text-[10px] rounded">Score</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setScoreFor(l.id); setScoreForm({ emailOpens: '', linkClicks: '', pageViews: '', formSubmits: '' }); }}
                    className="mt-1.5 flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300">
                    <Gauge className="w-3 h-3" /> Score this lead
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
