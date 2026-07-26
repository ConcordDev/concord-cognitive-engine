'use client';

/**
 * NonprofitActionPanel — Candid + GiveWell-shape NPO quick-analysis workbench.
 *
 * Wires 9 real nonprofit.* macros with CORRECT field shapes (fixed this pass —
 * see docs/lens-specs/nonprofit-capability-map.md for the three field-shape
 * bugs this replaces):
 *   donorRetention        — cohort retention %, built from the REAL donor-list
 *                            gift history (not a fabricated donor-count input).
 *   grantReporting         — deliverable + impact-metric progress.
 *   grant-deadline-check   — reporting-deadline urgency.
 *   impact-report          — beneficiary/outcome summary.
 *   campaignProgress       — ad-hoc goal/pace calculator (ungoverned, no
 *                            persistence — for a real, persisted campaign use
 *                            CampaignManager below, which is a separate real
 *                            surface backed by campaign-create/list/update).
 *   send-acknowledgment    — quick thank-you queue (distinct from the CRM's
 *                            full comm-send/thankyou-run path in
 *                            NonprofitWorkbench, which persists to a donor's
 *                            comm log — this one is a stateless quick queue).
 *   search-orgs            — ProPublica name/state search.
 *   lookup-org-by-ein      — ProPublica full-filing EIN lookup.
 * plus mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Heart, Users, FileText, Target, Search, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, CalendarClock, FileBarChart, Bell, Plus, Trash2, FileBadge,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('nonprofit', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

type ActionId = 'retention' | 'grant' | 'campaign' | 'ack' | 'search' | 'ein' | 'mint' | 'dm' | 'publish' | 'agent';

interface RetentionResult { retentionRate: number; retained: number; priorTotal: number; currentTotal: number; period: string }
interface GrantReportResult { deliverableProgress: number; completedDeliverables: number; totalDeliverables: number; funder: string; amount: number; impactSummary: { name: string; target: number; actual: number; achieved: boolean }[] }
interface DeadlineResult { daysRemaining: number | null; status: string; funder: string | null }
interface ImpactResult { beneficiaries: number; metricCount: number; summary: string }
interface CampaignCalcResult { goal: number; raised: number; percentComplete: number; donorCount: number; dailyRate: number; projected: number; onTrack: boolean }
interface AckResult { acknowledged: boolean; donor: string; amount: number; channel: string; message: string }
interface Org { ein: string; name: string; city?: string; state?: string; nteeCode?: string; rulingYear?: number }
interface EinOrg { ein: string; name: string; nteeClassification?: string; taxExemptStatus?: string; rulingYear?: number | null; address?: { city?: string; state?: string }; filings?: { year: number; totalRevenue: number; totalExpenses: number; totalAssets: number }[] }

interface Deliverable { name: string; status: string }
interface ImpactMetric { name: string; target: string; actual: string }

const inp = 'bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[12px] text-white font-mono';

// No seeded data — every input starts empty.
export function NonprofitActionPanel() {
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  // ── donorRetention (real, fetched donor-list giving history) ──
  const [retentionYear, setRetentionYear] = useState(String(new Date().getFullYear()));
  const [retentionResult, setRetentionResult] = useState<RetentionResult | null>(null);
  async function actRetention() {
    setBusy('retention'); setFeedback(null);
    try {
      const dl = await lensRun<{ donors: { id: string; gifts: { at: string }[] }[] }>('nonprofit', 'donor-list', {});
      if (!dl.data.ok) { err(dl.data.error || 'Could not load donors.'); return; }
      const donors = dl.data.result?.donors || [];
      const givingHistory = donors.flatMap((d) => d.gifts.map((g) => ({ date: g.at, donorId: d.id })));
      if (!givingHistory.length) { err('No gifts logged yet — log gifts in the Donor CRM below first.'); return; }
      const r = await callMacro<RetentionResult>('donorRetention', { givingHistory, year: parseInt(retentionYear, 10) || undefined });
      if (r.ok && r.result) { setRetentionResult(r.result); pipe.publish('nonprofit.retention', r.result, { label: `${r.result.retentionRate}%` }); ok(`Retention ${r.result.retentionRate}% (${r.result.period}).`); }
      else err(r.error ?? 'retention failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  // ── grantReporting + grant-deadline-check + impact-report (one shared form) ──
  const [grantName, setGrantName] = useState('');
  const [grantFunder, setGrantFunder] = useState('');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantDeadline, setGrantDeadline] = useState('');
  const [beneficiaries, setBeneficiaries] = useState('');
  const [deliverables, setDeliverables] = useState<Deliverable[]>([{ name: '', status: 'in_progress' }]);
  const [metrics, setMetrics] = useState<ImpactMetric[]>([{ name: '', target: '', actual: '' }]);
  const [grantResult, setGrantResult] = useState<GrantReportResult | null>(null);
  const [deadlineResult, setDeadlineResult] = useState<DeadlineResult | null>(null);
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);

  async function actGrant() {
    setBusy('grant'); setFeedback(null);
    try {
      const cleanDeliverables = deliverables.filter((d) => d.name.trim());
      const cleanMetrics = metrics.filter((m) => m.name.trim()).map((m) => ({ name: m.name, target: Number(m.target) || 0, actual: Number(m.actual) || 0 }));
      const shared = { name: grantName || undefined, funder: grantFunder || undefined, amount: Number(grantAmount) || 0 };
      const [rep, dl, imp] = await Promise.all([
        callMacro<GrantReportResult>('grantReporting', { ...shared, deliverables: cleanDeliverables, impactMetrics: cleanMetrics }),
        callMacro<DeadlineResult>('grant-deadline-check', { ...shared, deadline: grantDeadline || undefined }),
        callMacro<ImpactResult>('impact-report', { ...shared, impactMetrics: cleanMetrics, beneficiaries: Number(beneficiaries) || 0 }),
      ]);
      let any = false;
      if (rep.ok && rep.result) { setGrantResult(rep.result); any = true; }
      if (dl.ok && dl.result) { setDeadlineResult(dl.result); any = true; }
      if (imp.ok && imp.result) { setImpactResult(imp.result); any = true; }
      if (any) { pipe.publish('nonprofit.grant', { report: rep.result, deadline: dl.result, impact: imp.result }, { label: grantName || 'grant' }); ok('Grant analysis ready.'); }
      else err(rep.error || dl.error || imp.error || 'grant analysis failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  const addDeliverable = () => setDeliverables((d) => [...d, { name: '', status: 'in_progress' }]);
  const addMetric = () => setMetrics((m) => [...m, { name: '', target: '', actual: '' }]);

  // ── campaignProgress (ad-hoc pace calculator — correct goalAmount/raisedAmount/startDate/endDate shape) ──
  const [cGoal, setCGoal] = useState('');
  const [cRaised, setCRaised] = useState('');
  const [cDonors, setCDonors] = useState('');
  const [cStart, setCStart] = useState('');
  const [cEnd, setCEnd] = useState('');
  const [campaignResult, setCampaignResult] = useState<CampaignCalcResult | null>(null);
  async function actCampaign() {
    setBusy('campaign'); setFeedback(null);
    try {
      const r = await callMacro<CampaignCalcResult>('campaignProgress', {
        goalAmount: Number(cGoal) || 0, raisedAmount: Number(cRaised) || 0, donorCount: parseInt(cDonors, 10) || 0,
        startDate: cStart || undefined, endDate: cEnd || undefined,
      });
      if (r.ok && r.result) { setCampaignResult(r.result); pipe.publish('nonprofit.campaign', r.result, { label: `${r.result.percentComplete}%` }); ok(`${r.result.percentComplete}% of goal · ${r.result.onTrack ? 'on track' : 'behind pace'}.`); }
      else err(r.error ?? 'campaign calc failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  // ── send-acknowledgment (stateless quick queue, distinct from the CRM comm log) ──
  const [ackDonor, setAckDonor] = useState('');
  const [ackAmount, setAckAmount] = useState('');
  const [ackChannel, setAckChannel] = useState<'email' | 'letter' | 'phone'>('email');
  const [ackResult, setAckResult] = useState<AckResult | null>(null);
  async function actAck() {
    if (!ackDonor.trim()) { err('Donor name required.'); return; }
    setBusy('ack'); setFeedback(null);
    try {
      const r = await callMacro<AckResult>('send-acknowledgment', { name: ackDonor.trim(), donor: ackDonor.trim(), amount: Number(ackAmount) || 0, channel: ackChannel });
      if (r.ok && r.result) { setAckResult(r.result); ok(r.result.message); }
      else err(r.error ?? 'acknowledgment failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  // ── search-orgs / lookup-org-by-ein (ProPublica Nonprofit Explorer) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  async function actSearch() {
    if (!searchQuery.trim()) { err('Query required.'); return; }
    setBusy('search'); setFeedback(null);
    try { const r = await callMacro<{ orgs?: Org[] }>('search-orgs', { query: searchQuery.trim() }); if (r.ok && r.result?.orgs) { setOrgs(r.result.orgs); pipe.publish('nonprofit.orgs', r.result.orgs, { label: `${r.result.orgs.length} orgs` }); ok(`${r.result.orgs.length} orgs.`); } else err(r.error ?? 'search failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  const [einInput, setEinInput] = useState('');
  const [einResult, setEinResult] = useState<EinOrg | null>(null);
  async function actEin() {
    const ein = einInput.replace(/\D/g, '');
    if (ein.length !== 9) { err('EIN must be 9 digits.'); return; }
    setBusy('ein'); setFeedback(null);
    try { const r = await callMacro<EinOrg>('lookup-org-by-ein', { ein }); if (r.ok && r.result) { setEinResult(r.result); pipe.publish('nonprofit.ein', r.result, { label: r.result.name }); ok(`${r.result.name} · ${r.result.filings?.length ?? 0} filing(s).`); } else err(r.error ?? 'EIN not found'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  // ── mint / DM / publish / agent ──
  const [orgName, setOrgName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `NPO — ${orgName.trim() || 'analysis'}`, tags: ['nonprofit'], source: 'nonprofit:org:mint', meta: { visibility: 'private', consent: { allowCitations: false }, npo: { orgName, retention: retentionResult, grant: grantResult, campaign: campaignResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('nonprofit.mintedDtuId', id, { label: `org ${id.slice(0, 8)}` }); ok(`NPO DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`💗 ${orgName || 'NPO'} brief`, '', retentionResult ? `Retention: ${retentionResult.retentionRate}% (${retentionResult.period})` : '', campaignResult ? `Campaign: ${campaignResult.percentComplete}% raised, ${campaignResult.onTrack ? 'on track' : 'behind pace'}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!campaignResult) { err('Run the campaign calculator first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Campaign — ${orgName.trim() || 'public'}`, tags: ['nonprofit', 'campaign', 'public'], source: 'nonprofit:campaign:publish', meta: { visibility: 'public', consent: { allowCitations: true }, campaign: campaignResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('nonprofit.publishedDtuId', id, { label: `campaign ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `NPO: ${orgName || 'unnamed'}. ${retentionResult ? `Retention ${retentionResult.retentionRate}%.` : ''} ${campaignResult ? `Campaign ${campaignResult.percentComplete}% raised.` : ''} Suggest the single highest-ROI donor-engagement move for next month. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const busyIcon = (id: ActionId, Icon: typeof Heart) => (busy === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />);

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-4">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Heart className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Nonprofit quick-analysis workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">retention · grants · campaign pace · 990 lookup</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Retention */}
        <div className="space-y-1.5 rounded-md border border-zinc-800 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300"><Users className="w-3.5 h-3.5" /> Donor retention (cohort, live donor-list)</div>
          <div className="flex gap-1.5">
            <input type="text" value={retentionYear} onChange={(e) => setRetentionYear(e.target.value.replace(/\D/g, ''))} className={cn(inp, 'w-24')} placeholder="year" />
            <button onClick={actRetention} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('retention', Users)} Analyze</button>
          </div>
          {retentionResult && (
            <div className="text-[11px] text-zinc-300">
              <span className="text-2xl font-bold text-emerald-300">{retentionResult.retentionRate}%</span> retained · {retentionResult.retained}/{retentionResult.priorTotal} donors · {retentionResult.period}
            </div>
          )}
        </div>

        {/* Campaign pace calculator */}
        <div className="space-y-1.5 rounded-md border border-zinc-800 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-300"><Target className="w-3.5 h-3.5" /> Campaign pace calculator (ad-hoc, unpersisted)</div>
          <div className="grid grid-cols-3 gap-1.5">
            <input value={cGoal} onChange={(e) => setCGoal(e.target.value)} className={inp} placeholder="Goal $" />
            <input value={cRaised} onChange={(e) => setCRaised(e.target.value)} className={inp} placeholder="Raised $" />
            <input value={cDonors} onChange={(e) => setCDonors(e.target.value)} className={inp} placeholder="Donors" />
            <input type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} className={inp} />
            <input type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} className={inp} />
            <button onClick={actCampaign} disabled={!!busy} className="flex items-center justify-center gap-1.5 px-2 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('campaign', Target)} Calc</button>
          </div>
          {campaignResult && (
            <div className="text-[11px] text-zinc-300">
              <span className="text-lg font-bold text-orange-300">{campaignResult.percentComplete}%</span> of ${campaignResult.goal.toLocaleString()} · pace ${campaignResult.dailyRate.toLocaleString()}/day → projected ${campaignResult.projected.toLocaleString()} · <span className={campaignResult.onTrack ? 'text-emerald-400' : 'text-red-400'}>{campaignResult.onTrack ? 'on track' : 'behind pace'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Grant tracker */}
      <div className="space-y-1.5 rounded-md border border-zinc-800 p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300"><FileText className="w-3.5 h-3.5" /> Grant tracker — deliverables, deadline, impact</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          <input value={grantName} onChange={(e) => setGrantName(e.target.value)} className={inp} placeholder="Grant name" />
          <input value={grantFunder} onChange={(e) => setGrantFunder(e.target.value)} className={inp} placeholder="Funder" />
          <input value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} className={inp} placeholder="Amount $" />
          <input type="date" value={grantDeadline} onChange={(e) => setGrantDeadline(e.target.value)} className={inp} />
          <input value={beneficiaries} onChange={(e) => setBeneficiaries(e.target.value)} className={inp} placeholder="Beneficiaries" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center justify-between">Deliverables <button onClick={addDeliverable} className="text-cyan-300" aria-label="Add deliverable"><Plus className="w-3 h-3 inline" aria-hidden="true" /></button></div>
            {deliverables.map((d, i) => (
              <div key={i} className="flex gap-1">
                <input value={d.name} onChange={(e) => setDeliverables((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={cn(inp, 'flex-1')} placeholder="deliverable" />
                <select value={d.status} onChange={(e) => setDeliverables((arr) => arr.map((x, j) => j === i ? { ...x, status: e.target.value } : x))} className={inp}>
                  {['completed', 'in_progress', 'pending'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => setDeliverables((arr) => arr.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-400" aria-label="Remove deliverable"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center justify-between">Impact metrics <button onClick={addMetric} className="text-cyan-300" aria-label="Add impact metric"><Plus className="w-3 h-3 inline" aria-hidden="true" /></button></div>
            {metrics.map((m, i) => (
              <div key={i} className="flex gap-1">
                <input value={m.name} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={cn(inp, 'flex-1')} placeholder="metric" />
                <input value={m.target} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, target: e.target.value } : x))} className={cn(inp, 'w-16')} placeholder="target" />
                <input value={m.actual} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, actual: e.target.value } : x))} className={cn(inp, 'w-16')} placeholder="actual" />
                <button onClick={() => setMetrics((arr) => arr.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-400" aria-label="Remove metric"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </div>
        <button onClick={actGrant} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('grant', FileBarChart)} Analyze grant</button>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {grantResult && (
            <div className="rounded border border-cyan-500/30 bg-cyan-500/5 p-2 text-[11px] text-zinc-300">
              <div className="text-cyan-300 font-semibold">Deliverables</div>
              {grantResult.completedDeliverables}/{grantResult.totalDeliverables} complete ({grantResult.deliverableProgress}%)
              {grantResult.impactSummary.map((m, i) => <div key={i} className={m.achieved ? 'text-emerald-400' : 'text-amber-400'}>{m.name}: {m.actual}/{m.target} {m.achieved ? '✓' : ''}</div>)}
            </div>
          )}
          {deadlineResult && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-zinc-300">
              <div className="flex items-center gap-1 text-amber-300 font-semibold"><CalendarClock className="w-3 h-3" /> Deadline</div>
              {deadlineResult.daysRemaining != null ? `${deadlineResult.daysRemaining}d — ${deadlineResult.status}` : 'no deadline set'}
            </div>
          )}
          {impactResult && (
            <div className="rounded border border-purple-500/30 bg-purple-500/5 p-2 text-[11px] text-zinc-300">
              <div className="text-purple-300 font-semibold">Impact</div>
              {impactResult.summary}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Quick acknowledgment */}
        <div className="space-y-1.5 rounded-md border border-zinc-800 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-pink-300"><Bell className="w-3.5 h-3.5" /> Quick acknowledgment queue</div>
          <div className="flex flex-wrap gap-1.5">
            <input value={ackDonor} onChange={(e) => setAckDonor(e.target.value)} className={cn(inp, 'flex-1 min-w-[100px]')} placeholder="donor name" />
            <input value={ackAmount} onChange={(e) => setAckAmount(e.target.value)} className={cn(inp, 'w-20')} placeholder="$" />
            <select value={ackChannel} onChange={(e) => setAckChannel(e.target.value as typeof ackChannel)} className={inp}>
              {['email', 'letter', 'phone'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={actAck} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('ack', Send)} Queue</button>
          </div>
          {ackResult && <p className="text-[11px] text-emerald-400">{ackResult.message}</p>}
        </div>

        {/* Org lookup */}
        <div className="space-y-1.5 rounded-md border border-zinc-800 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-300"><Search className="w-3.5 h-3.5" /> ProPublica 990 lookup</div>
          <div className="flex gap-1.5">
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={cn(inp, 'flex-1')} placeholder="org name" />
            <button onClick={actSearch} disabled={!!busy} className="flex items-center gap-1.5 px-2 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('search', Search)}</button>
          </div>
          <div className="flex gap-1.5">
            <input value={einInput} onChange={(e) => setEinInput(e.target.value)} className={cn(inp, 'flex-1')} placeholder="9-digit EIN" />
            <button onClick={actEin} disabled={!!busy} className="flex items-center gap-1.5 px-2 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('ein', FileBadge)}</button>
          </div>
          {orgs.length > 0 && (
            <div className="max-h-24 overflow-y-auto text-[11px] text-zinc-300 space-y-0.5">
              {orgs.slice(0, 6).map((o, i) => <div key={i}><strong className="text-purple-200">{o.name}</strong> <span className="font-mono text-zinc-400">{o.ein}</span></div>)}
            </div>
          )}
          {einResult && (
            <div className="text-[11px] text-zinc-300">
              <strong className="text-purple-200">{einResult.name}</strong> · {einResult.taxExemptStatus} · {einResult.nteeClassification}
              {einResult.filings && einResult.filings.length > 0 && <div className="text-zinc-400">latest filing: ${einResult.filings[0].totalRevenue?.toLocaleString()} revenue ({einResult.filings[0].year})</div>}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-3">
        <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className={cn(inp, 'flex-1 min-w-[140px]')} placeholder="Org name (for mint/DM/publish)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className={cn(inp, 'w-40')} placeholder="DM recipient" />
        <button onClick={actMint} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('mint', Sparkles)} {mintedDtuId ? 'Saved' : 'Mint'}</button>
        <button onClick={actDm} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('dm', Send)} DM</button>
        <button onClick={actPublish} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('publish', Globe)} {publishedDtuId ? 'Published' : 'Publish'}</button>
        <button onClick={actAgent} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 text-white rounded text-[12px]">{busyIcon('agent', Wand2)} Engage</button>
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Engagement move</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
