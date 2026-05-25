'use client';

/**
 * TelecommunicationsActionPanel — network ops bench.
 * networkCapacity / signalQuality / coverageMap / costPerLine +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Radio, Signal, Map, DollarSign, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('telecommunications', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'cap' | 'sig' | 'cov' | 'cost' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CapResult { totalBandwidth: string; utilization: string; activeUsers: number; availablePerUser: string; headroom: string; status: string; upgrade: string }
interface SigResult { snr: string; bitErrorRate: number; latencyMs: number; jitterMs: number; mosScore: number; voiceQuality: string; videoCapable: boolean }
interface CovResult { towers: number; activeTowers: number; totalCoverageKm2: number; technologies: string[] }
interface CostResult { subscribers: number; arpu: number; costPerSubscriber: number; margin: number; marginPercent: number; profitable: boolean; breakeven: string }

// No seeded data — every input starts empty.
export function TelecommunicationsActionPanel() {
  const [bandwidth, setBandwidth] = useState('');
  const [utilization, setUtilization] = useState('');
  const [users, setUsers] = useState('');
  const [snr, setSnr] = useState('');
  const [ber, setBer] = useState('');
  const [latency, setLatency] = useState('');
  const [jitter, setJitter] = useState('');
  const [towersText, setTowersText] = useState('');
  const [infraCost, setInfraCost] = useState('');
  const [opsCost, setOpsCost] = useState('');
  const [subscribers, setSubscribers] = useState('');
  const [arpu, setArpu] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [capResult, setCapResult] = useState<CapResult | null>(null);
  const [sigResult, setSigResult] = useState<SigResult | null>(null);
  const [covResult, setCovResult] = useState<CovResult | null>(null);
  const [costResult, setCostResult] = useState<CostResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actCap() {
    const b = parseFloat(bandwidth), u = parseFloat(utilization), n = parseInt(users, 10);
    if (![b, u, n].every(Number.isFinite)) { err('Bandwidth + util % + active users required.'); return; }
    setBusy('cap'); setFeedback(null);
    try {
      const r = await callMacro<CapResult>('networkCapacity', { artifact: { data: { bandwidthGbps: b, utilizationPercent: u, activeUsers: n } } });
      if (r.ok && r.result) { setCapResult(r.result); pipe.publish('telecom.cap', r.result, { label: `Cap ${r.result.utilization}` }); ok(`${r.result.availablePerUser}/user · ${r.result.status}.`); } else err(r.error ?? 'cap failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSig() {
    const s = parseFloat(snr), b = parseFloat(ber), l = parseFloat(latency), j = parseFloat(jitter);
    if (![s, b, l, j].every(Number.isFinite)) { err('SNR + BER + latency + jitter required.'); return; }
    setBusy('sig'); setFeedback(null);
    try {
      const r = await callMacro<SigResult>('signalQuality', { artifact: { data: { snrDb: s, bitErrorRate: b, latencyMs: l, jitterMs: j } } });
      if (r.ok && r.result) { setSigResult(r.result); pipe.publish('telecom.sig', r.result, { label: `Signal MOS ${r.result.mosScore}` }); ok(`MOS ${r.result.mosScore} (${r.result.voiceQuality}).`); } else err(r.error ?? 'sig failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCov() {
    if (!towersText.trim()) { err('Paste towers JSON first.'); return; }
    try { const towers = JSON.parse(towersText); setBusy('cov'); setFeedback(null);
      const r = await callMacro<CovResult>('coverageMap', { artifact: { data: { towers } } });
      if (r.ok && r.result) { setCovResult(r.result); pipe.publish('telecom.cov', r.result, { label: `Cov ${r.result.activeTowers}/${r.result.towers}` }); ok(`${r.result.activeTowers}/${r.result.towers} active · ${r.result.totalCoverageKm2} km².`); } else err(r.error ?? 'cov failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid towers JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCost() {
    const i = parseFloat(infraCost), o = parseFloat(opsCost), s = parseInt(subscribers, 10), a = parseFloat(arpu);
    if (![i, o, s, a].every(Number.isFinite)) { err('Infra + ops + subs + ARPU required.'); return; }
    setBusy('cost'); setFeedback(null);
    try {
      const r = await callMacro<CostResult>('costPerLine', { artifact: { data: { infrastructureCost: i, monthlyOpsCost: o, subscribers: s, arpu: a } } });
      if (r.ok && r.result) { setCostResult(r.result); pipe.publish('telecom.cost', r.result, { label: `Margin ${r.result.marginPercent}%` }); ok(`Margin $${r.result.margin} (${r.result.marginPercent}%).`); } else err(r.error ?? 'cost failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Network — ${capResult?.status ?? 'ops'}`, tags: ['telecom', 'network', capResult?.status].filter((t): t is string => !!t), source: 'telecom:ops:mint', meta: { visibility: 'private', consent: { allowCitations: false }, telecom: { cap: capResult, sig: sigResult, cov: covResult, cost: costResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('telecom.mintedDtuId', id, { label: `Network DTU ${id.slice(0, 8)}…` }); ok(`Network DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📡 NOC brief`, '',
      capResult ? `Capacity: ${capResult.totalBandwidth} · ${capResult.utilization} util · ${capResult.availablePerUser}/user · ${capResult.status}` : '',
      sigResult ? `Signal: MOS ${sigResult.mosScore} (${sigResult.voiceQuality}) · latency ${sigResult.latencyMs}ms · video ${sigResult.videoCapable ? '✓' : '✗'}` : '',
      covResult ? `Coverage: ${covResult.activeTowers}/${covResult.towers} towers · ${covResult.totalCoverageKm2} km² · ${covResult.technologies.join(', ')}` : '',
      costResult ? `Unit econ: ARPU $${costResult.arpu} · cost $${costResult.costPerSubscriber} · margin ${costResult.marginPercent}%` : '',
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
    if (!sigResult && !capResult) { err('Run cap/sig first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Network performance card`, tags: ['telecom', 'performance', 'public'], source: 'telecom:perf:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, cap: capResult, sig: sigResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('telecom.publishedDtuId', id, { label: `Public perf card ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Network ops review. ${capResult ? `Capacity ${capResult.utilization} (${capResult.status}), per-user ${capResult.availablePerUser}.` : ''} ${sigResult ? `MOS ${sigResult.mosScore} (${sigResult.voiceQuality}), latency ${sigResult.latencyMs}ms.` : ''} ${costResult ? `Margin ${costResult.marginPercent}%${costResult.profitable ? '' : ' UNPROFITABLE'}.` : ''} Identify the single most urgent capex or opex action. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Action ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'cap' as ActionId, label: 'Capacity', desc: 'networkCapacity', icon: Radio, accent: '#3b82f6', handler: actCap },
    { id: 'sig' as ActionId, label: 'Signal', desc: 'signalQuality MOS', icon: Signal, accent: '#22c55e', handler: actSig },
    { id: 'cov' as ActionId, label: 'Coverage', desc: 'coverageMap', icon: Map, accent: '#a855f7', handler: actCov },
    { id: 'cost' as ActionId, label: 'Unit econ', desc: 'costPerLine', icon: DollarSign, accent: '#f59e0b', handler: actCost },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private NOC DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send NOC brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon perf card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Action', desc: 'Agent: urgent capex', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { normal: 'text-emerald-300', high: 'text-amber-300', critical: 'text-red-300' };
  const VOICE_COLOR: Record<string, string> = { excellent: 'text-emerald-300', good: 'text-blue-300', fair: 'text-amber-300', poor: 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Radio className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Telecom NOC</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">capacity · signal · coverage · econ</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Capacity</div>
          <input type="text" value={bandwidth} onChange={(e) => setBandwidth(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="BW Gbps" />
          <input type="text" value={utilization} onChange={(e) => setUtilization(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Util %" />
          <input type="text" value={users} onChange={(e) => setUsers(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Active users" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Signal</div>
          <input type="text" value={snr} onChange={(e) => setSnr(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="SNR dB" />
          <input type="text" value={ber} onChange={(e) => setBer(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="BER" />
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={latency} onChange={(e) => setLatency(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Latency ms" />
            <input type="text" value={jitter} onChange={(e) => setJitter(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Jitter ms" />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Towers JSON</div>
          <textarea value={towersText} onChange={(e) => setTowersText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Unit econ</div>
          <input type="text" value={infraCost} onChange={(e) => setInfraCost(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Infra $" />
          <input type="text" value={opsCost} onChange={(e) => setOpsCost(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Ops/mo $" />
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={subscribers} onChange={(e) => setSubscribers(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Subs" />
            <input type="text" value={arpu} onChange={(e) => setArpu(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="ARPU $" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {capResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Capacity · {capResult.status}</div>
            <div className={cn('text-2xl font-bold', STATUS_COLOR[capResult.status])}>{capResult.utilization}</div>
            <div className="text-[10px] text-zinc-400">{capResult.totalBandwidth} → {capResult.availablePerUser}/user</div>
            <div className="text-[10px] text-zinc-400">{capResult.activeUsers.toLocaleString()} users · headroom {capResult.headroom}</div>
            <div className="text-[10px] text-blue-200 italic">{capResult.upgrade}</div>
          </div>
        )}
        {sigResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Signal · {sigResult.voiceQuality}</div>
            <div className={cn('text-2xl font-bold', VOICE_COLOR[sigResult.voiceQuality])}>{sigResult.mosScore}<span className="text-xs text-zinc-400"> MOS</span></div>
            <div className="text-[10px] text-zinc-400">SNR {sigResult.snr} · BER {sigResult.bitErrorRate}</div>
            <div className="text-[10px] text-zinc-400">{sigResult.latencyMs}ms · jitter {sigResult.jitterMs}ms</div>
            <div className="text-[10px] text-green-200">video: {sigResult.videoCapable ? '✓ capable' : '✗ not capable'}</div>
          </div>
        )}
        {covResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Coverage</div>
            <div className="text-2xl font-bold text-purple-300">{covResult.totalCoverageKm2} <span className="text-xs text-zinc-400">km²</span></div>
            <div className="text-[10px] text-zinc-400">{covResult.activeTowers}/{covResult.towers} active</div>
            <div className="flex flex-wrap gap-1 mt-1">{covResult.technologies.map(t => <span key={t} className="text-[10px] bg-purple-500/10 text-purple-200 px-1.5 py-0.5 rounded font-mono">{t}</span>)}</div>
          </div>
        )}
        {costResult && (
          <div className={cn('rounded-md border p-2.5', costResult.profitable ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Unit econ</div>
            <div className={cn('text-2xl font-bold', costResult.profitable ? 'text-emerald-300' : 'text-red-300')}>{costResult.marginPercent}% <span className="text-xs text-zinc-400">margin</span></div>
            <div className="text-[10px] text-zinc-400">ARPU ${costResult.arpu} - cost ${costResult.costPerSubscriber} = ${costResult.margin}</div>
            <div className="text-[10px] text-zinc-400">breakeven: {costResult.breakeven}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Urgent action</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
