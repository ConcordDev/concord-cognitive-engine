'use client';

/**
 * InsuranceActionPanel — agent + broker workbench.
 * coverageGap / lossRatioReport / renewalAlert / riskScore +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Shield, AlertTriangle, TrendingDown, Calendar, Activity, Sparkles, Send, Globe, Wand2, Loader2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('insurance', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'gap' | 'loss' | 'renewal' | 'risk' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface GapResult { coveredTypes?: string[]; gaps?: string[]; gapCount?: number; expiringSoon?: unknown[]; totalPolicies?: number }
interface LossResult { lossRatio?: number; premiumsCollected?: number; claimsPaid?: number; assessment?: string; claimFrequency?: number; averageSeverity?: number }
interface RenewalEntry { policyNumber?: string; holder?: string; type?: string; expiryDate?: string; daysUntilRenewal?: number; premium?: number }
interface RenewalResult { totalUpcomingRenewals?: number; premiumAtRisk?: number; within30Days?: RenewalEntry[]; within60Days?: RenewalEntry[]; urgentCount?: number }
interface RiskResult { risk?: string; probability?: number; impact?: number; rawScore?: number; normalizedScore?: number; level?: string; mitigatedScore?: number }

interface Policy { type: string; premium: number; expiryDate: string; policyNumber: string; holder?: string }

function makePolicies(jsonText: string): { policies: Policy[]; claims: { status: string; amount: number }[] } | null {
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return { policies: parsed as Policy[], claims: [] };
    return parsed;
  } catch { return null; }
}

// No seeded book — paste real policies/claims JSON.
export function InsuranceActionPanel() {
  const [bookText, setBookText] = useState('');
  const [riskTitle, setRiskTitle] = useState('');
  const [probability, setProbability] = useState('');
  const [impact, setImpact] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [gapResult, setGapResult] = useState<GapResult | null>(null);
  const [lossResult, setLossResult] = useState<LossResult | null>(null);
  const [renewalResult, setRenewalResult] = useState<RenewalResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  function bookArtifact() {
    const parsed = makePolicies(bookText);
    if (!parsed) return null;
    return { title: 'Insurance book', data: parsed };
  }

  async function actGap() {
    const a = bookArtifact(); if (!a) { err('Invalid book JSON.'); return; }
    setBusy('gap'); setFeedback(null);
    try { const r = await callMacro<GapResult>('coverageGap', { artifact: a }); if (r.ok && r.result) { setGapResult(r.result); pipe.publish('insurance.gap', r.result, { label: `Gaps ${r.result.gapCount}` }); ok(`${r.result.gapCount} gaps, ${r.result.expiringSoon?.length ?? 0} expiring.`); } else err(r.error ?? 'gap failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLoss() {
    const a = bookArtifact(); if (!a) { err('Invalid book JSON.'); return; }
    setBusy('loss'); setFeedback(null);
    try { const r = await callMacro<LossResult>('lossRatioReport', { artifact: a }); if (r.ok && r.result) { setLossResult(r.result); pipe.publish('insurance.loss', r.result, { label: `Loss ${r.result.lossRatio}%` }); ok(`Loss ratio: ${r.result.lossRatio}% (${r.result.assessment}).`); } else err(r.error ?? 'loss failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRenewal() {
    const a = bookArtifact(); if (!a) { err('Invalid book JSON.'); return; }
    setBusy('renewal'); setFeedback(null);
    try { const r = await callMacro<RenewalResult>('renewalAlert', { artifact: a }); if (r.ok && r.result) { setRenewalResult(r.result); pipe.publish('insurance.renewal', r.result, { label: `${r.result.urgentCount} urgent` }); ok(`${r.result.urgentCount} urgent, $${r.result.premiumAtRisk?.toLocaleString()} at risk.`); } else err(r.error ?? 'renewal failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRisk() {
    const p = parseInt(probability, 10), i = parseInt(impact, 10);
    if (!riskTitle.trim() || ![p, i].every(Number.isFinite)) { err('Risk title + probability + impact required.'); return; }
    setBusy('risk'); setFeedback(null);
    try {
      const r = await callMacro<RiskResult>('riskScore', { artifact: { title: riskTitle, data: { risk: riskTitle, probability: p, impact: i } } });
      if (r.ok && r.result) { setRiskResult(r.result); pipe.publish('insurance.risk', r.result, { label: `Risk ${r.result.level} ${r.result.normalizedScore}%` }); ok(`${r.result.level?.toUpperCase()} (${r.result.normalizedScore}%).`); } else err(r.error ?? 'risk failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Insurance — ${riskTitle || 'book'}`, tags: ['insurance', 'risk', riskResult?.level].filter(Boolean), source: 'insurance:book:mint', meta: { visibility: 'private', consent: { allowCitations: false }, insurance: { gap: gapResult, loss: lossResult, renewal: renewalResult, risk: riskResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('insurance.mintedDtuId', id, { label: `Book DTU ${id.slice(0, 8)}…` }); ok(`Book DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🛡 Insurance brief`, '',
      gapResult ? `${gapResult.gapCount} coverage gaps, ${gapResult.expiringSoon?.length ?? 0} expiring ≤30d` : '',
      lossResult ? `Loss ratio ${lossResult.lossRatio}% (${lossResult.assessment})` : '',
      renewalResult ? `${renewalResult.urgentCount} urgent renewals · $${renewalResult.premiumAtRisk?.toLocaleString()} at risk` : '',
      riskResult ? `Risk: ${riskResult.risk} → ${riskResult.level?.toUpperCase()} (${riskResult.normalizedScore}%)` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
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
    if (!lossResult && !renewalResult) { err('Run loss/renewal first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Insurance benchmark — anonymised`, tags: ['insurance', 'benchmark', 'public'], source: 'insurance:benchmark:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, loss: lossResult, renewal: renewalResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('insurance.publishedDtuId', id, { label: `Public bench ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Insurance book review. ${gapResult ? `${gapResult.gapCount} coverage gaps (${(gapResult.gaps || []).join(', ')}).` : ''} ${lossResult ? `Loss ratio ${lossResult.lossRatio}% — ${lossResult.assessment}.` : ''} ${renewalResult ? `${renewalResult.urgentCount} renewals due in 30 days.` : ''} ${riskResult ? `Top risk: ${riskResult.risk} at ${riskResult.level}.` : ''} Identify the single highest-leverage cross-sell or risk-mitigation play this quarter. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Play ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'gap' as ActionId, label: 'Gap', desc: 'coverageGap by type', icon: AlertTriangle, accent: '#f59e0b', handler: actGap },
    { id: 'loss' as ActionId, label: 'Loss ratio', desc: 'lossRatioReport', icon: TrendingDown, accent: '#ef4444', handler: actLoss },
    { id: 'renewal' as ActionId, label: 'Renewals', desc: 'renewalAlert 30/60/90', icon: Calendar, accent: '#3b82f6', handler: actRenewal },
    { id: 'risk' as ActionId, label: 'Risk', desc: 'riskScore P×I', icon: Activity, accent: '#a855f7', handler: actRisk },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private book DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to underwriter', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon benchmark', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Play', desc: 'Agent: top cross-sell', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Shield className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Insurance workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">broker · underwriter</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Book (JSON · policies + claims)</label>
          <textarea value={bookText} onChange={(e) => setBookText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-2">
          <input type="text" value={riskTitle} onChange={(e) => setRiskTitle(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Risk title" />
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={probability} onChange={(e) => setProbability(e.target.value.replace(/\D/g, '').slice(0, 1) || '1')} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="P 1-5" />
            <input type="text" value={impact} onChange={(e) => setImpact(e.target.value.replace(/\D/g, '').slice(0, 1) || '1')} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="I 1-5" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {gapResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Coverage gaps</div>
            <div className="text-2xl font-bold text-amber-300">{gapResult.gapCount}</div>
            <div className="text-[10px] text-zinc-400 line-clamp-2">missing: {(gapResult.gaps ?? []).join(', ') || 'none'}</div>
            <div className="text-[10px] text-zinc-400 mt-1">expiring ≤30d: {gapResult.expiringSoon?.length ?? 0}</div>
          </div>
        )}
        {lossResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Loss ratio ({lossResult.assessment})</div>
            <div className="text-2xl font-bold text-red-300">{lossResult.lossRatio}%</div>
            <div className="text-[10px] text-zinc-400">premiums ${lossResult.premiumsCollected?.toLocaleString()} · claims ${lossResult.claimsPaid?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-400">freq {lossResult.claimFrequency} · sev ${lossResult.averageSeverity?.toLocaleString()}</div>
          </div>
        )}
        {renewalResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Renewals</div>
            <div className="text-2xl font-bold text-blue-300">{renewalResult.urgentCount} <span className="text-xs text-zinc-400">urgent</span></div>
            <div className="text-[10px] text-zinc-400">${renewalResult.premiumAtRisk?.toLocaleString()} at risk · {renewalResult.totalUpcomingRenewals} ≤90d</div>
            {(renewalResult.within30Days ?? []).slice(0, 2).map((p, i) => <div key={i} className="text-[10px] text-blue-200 mt-0.5"><span className="font-mono">{p.policyNumber}</span> · {p.daysUntilRenewal}d</div>)}
          </div>
        )}
        {riskResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Risk · {riskResult.level?.toUpperCase()}</div>
            <div className="text-2xl font-bold text-purple-300">{riskResult.normalizedScore}%</div>
            <div className="text-[10px] text-zinc-400 line-clamp-1">{riskResult.risk}</div>
            <div className="text-[10px] text-zinc-400">P{riskResult.probability} × I{riskResult.impact} = {riskResult.rawScore} → {riskResult.mitigatedScore} mitigated</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Cross-sell play</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
