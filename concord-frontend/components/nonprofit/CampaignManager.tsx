'use client';

/**
 * CampaignManager — a fundraising workbench: run campaigns with goals
 * and deadlines, log donations (one-off or recurring), and view a
 * giving dashboard. Wires the nonprofit.campaign-* / donation-log /
 * nonprofit-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { HeartHandshake, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Donation { id: string; amount: number; donor: string; recurring: boolean; at: string }
interface Campaign { id: string; name: string; goal: number; deadline: string | null; status: string; donations: Donation[]; raised: number; donorCount: number; progressPct: number }
interface Dash { campaigns: number; active: number; totalRaised: number; donations: number; recurringDonors: number }

export function CampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', goal: '', deadline: '' });
  const [donForm, setDonForm] = useState({ amount: '', donor: '', recurring: false });

  const refresh = useCallback(async () => {
    const [cl, d] = await Promise.all([
      lensRun('nonprofit', 'campaign-list', {}),
      lensRun('nonprofit', 'nonprofit-dashboard', {}),
    ]);
    setCampaigns((cl.data?.result?.campaigns as Campaign[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addCampaign() {
    if (!form.name.trim()) return;
    await lensRun('nonprofit', 'campaign-create', {
      name: form.name.trim(), goal: form.goal ? Number(form.goal) : 0, deadline: form.deadline.trim(),
    });
    setForm({ name: '', goal: '', deadline: '' });
    await refresh();
  }
  async function delCampaign(id: string) {
    await lensRun('nonprofit', 'campaign-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function logDonation(campaignId: string) {
    if (!donForm.amount) return;
    await lensRun('nonprofit', 'donation-log', {
      campaignId, amount: Number(donForm.amount), donor: donForm.donor.trim(), recurring: donForm.recurring,
    });
    setDonForm({ amount: '', donor: '', recurring: false });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <HeartHandshake className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Campaign Manager</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Campaigns', dash.campaigns], ['Active', dash.active], ['Raised', `$${dash.totalRaised.toLocaleString()}`], ['Recurring', dash.recurringDonors]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Campaign name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} placeholder="goal $"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} placeholder="deadline"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={addCampaign} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-40">New campaign</button>
      </div>

      <ul className="space-y-1">
        {campaigns.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No campaigns yet.</li>}
        {campaigns.map(c => (
          <li key={c.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <button onClick={() => setActive(active === c.id ? null : c.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{c.name}</p>
                <p className="text-[10px] text-zinc-400">${c.raised.toLocaleString()} raised · {c.progressPct}% of goal · {c.donorCount} donors · {c.status}</p>
                {c.goal > 0 && (
                  <div className="mt-1 h-1 bg-zinc-800 rounded overflow-hidden">
                    <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, c.progressPct)}%` }} />
                  </div>
                )}
              </button>
              <button aria-label="Delete" onClick={() => delCampaign(c.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {active === c.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800">
                {c.donations.map(d => (
                  <p key={d.id} className="text-[11px] text-zinc-400"><span className="text-emerald-400">${d.amount}</span> · {d.donor}{d.recurring ? ' · recurring' : ''}</p>
                ))}
                <div className="flex gap-1 mt-1 flex-wrap items-center">
                  <input value={donForm.amount} onChange={e => setDonForm({ ...donForm, amount: e.target.value })} placeholder="$ amount"
                    className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <input value={donForm.donor} onChange={e => setDonForm({ ...donForm, donor: e.target.value })} placeholder="donor"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <label className="text-[10px] text-zinc-400 inline-flex items-center gap-1">
                    <input type="checkbox" checked={donForm.recurring} onChange={e => setDonForm({ ...donForm, recurring: e.target.checked })} />recurring
                  </label>
                  <button onClick={() => logDonation(c.id)} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" />Log
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
