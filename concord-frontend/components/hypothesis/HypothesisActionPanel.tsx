'use client';

/**
 * HypothesisActionPanel — statistics bench.
 * zTest / abTest / bayesianInference / powerAnalysis +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Sigma, BarChart3, Brain, Target, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('hypothesis', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'z' | 'ab' | 'bayes' | 'power' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ZResult { testType: string; zStatistic: number; pValue: number; significant: boolean; effectSize: number; confidenceInterval?: { lower: number; upper: number; level: string }; conclusion: string }
interface AbResult { control: { visitors: number; conversions: number; rate: string }; variant: { visitors: number; conversions: number; rate: string }; absoluteDifference: string; relativeUplift: string; zStatistic: number; pValue: number; significant: boolean; confidenceInterval: { level: string; lower: string; upper: string }; statisticalPower: string; sampleSizeForPower80: number | string; recommendation: string }
interface BayesResult { prior?: { distribution: string; alpha?: number; beta?: number; mean?: number }; likelihood?: { successes: number; failures: number; trials: number }; posterior?: { distribution: string; alpha?: number; beta?: number; mean?: number; mode?: number; stdDev?: number }; credibleInterval?: { level: string; lower: number; upper: number }; bayesFactor?: number; evidenceStrength?: string }
interface PowerResult { solve: string; requiredN?: number; perGroup?: number; totalForTwoGroups?: number; effectSize?: number; alpha?: number; power?: number | string; detectableEffectSize?: number }

const DEFAULT_Z = JSON.stringify({ sample: { mean: 102.4, stdDev: 14.2, n: 60 }, populationMean: 100 }, null, 2);
const DEFAULT_AB = JSON.stringify({ control: { visitors: 4200, conversions: 168 }, variant: { visitors: 4180, conversions: 213 } }, null, 2);
const DEFAULT_BAYES = JSON.stringify({ prior: { distribution: 'beta', alpha: 2, beta: 8 }, observations: { successes: 14, trials: 40 } }, null, 2);
const DEFAULT_POWER_PARAMS = JSON.stringify({ solve: 'sampleSize', alpha: 0.05, power: 0.8, effectSize: 0.4 }, null, 2);

export function HypothesisActionPanel() {
  const [zText, setZText] = useState(DEFAULT_Z);
  const [abText, setAbText] = useState(DEFAULT_AB);
  const [bayesText, setBayesText] = useState(DEFAULT_BAYES);
  const [powerText, setPowerText] = useState(DEFAULT_POWER_PARAMS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [zResult, setZResult] = useState<ZResult | null>(null);
  const [abResult, setAbResult] = useState<AbResult | null>(null);
  const [bayesResult, setBayesResult] = useState<BayesResult | null>(null);
  const [powerResult, setPowerResult] = useState<PowerResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actZ() {
    try { const parsed = JSON.parse(zText); setBusy('z'); setFeedback(null);
      const r = await callMacro<ZResult>('zTest', { artifact: { data: parsed } });
      if (r.ok && r.result) { setZResult(r.result); ok(`z=${r.result.zStatistic} p=${r.result.pValue} · ${r.result.significant ? 'significant' : 'ns'}`); } else err(r.error ?? 'z failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid z JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAb() {
    try { const parsed = JSON.parse(abText); setBusy('ab'); setFeedback(null);
      const r = await callMacro<AbResult>('abTest', { artifact: { data: parsed } });
      if (r.ok && r.result) { setAbResult(r.result); ok(`${r.result.relativeUplift} · p=${r.result.pValue} · ${r.result.significant ? 'win' : 'ns'}`); } else err(r.error ?? 'ab failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid ab JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBayes() {
    try { const parsed = JSON.parse(bayesText); setBusy('bayes'); setFeedback(null);
      const r = await callMacro<BayesResult>('bayesianInference', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBayesResult(r.result); ok(`BF=${r.result.bayesFactor?.toFixed?.(2)} · ${r.result.evidenceStrength}`); } else err(r.error ?? 'bayes failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid bayes JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPower() {
    try { const parsed = JSON.parse(powerText); setBusy('power'); setFeedback(null);
      const r = await callMacro<PowerResult>('powerAnalysis', { params: parsed });
      if (r.ok && r.result) { setPowerResult(r.result); ok(r.result.requiredN ? `n=${r.result.requiredN}` : `${r.result.solve} computed`); } else err(r.error ?? 'power failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid power JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Stats analysis`, tags: ['hypothesis', 'stats', abResult?.significant ? 'sig' : 'ns'].filter((t): t is string => !!t), source: 'hypothesis:mint', meta: { visibility: 'private', consent: { allowCitations: false }, stats: { z: zResult, ab: abResult, bayes: bayesResult, power: powerResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Stats DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📊 Stats brief`, '', zResult ? `Z (${zResult.testType}): z=${zResult.zStatistic} · p=${zResult.pValue} · ${zResult.significant ? 'SIG' : 'ns'} · ${zResult.conclusion}` : '', abResult ? `A/B: ${abResult.relativeUplift} · p=${abResult.pValue} · ${abResult.statisticalPower} power · ${abResult.recommendation}` : '', bayesResult ? `Bayes: posterior mean ${bayesResult.posterior?.mean?.toFixed?.(3) ?? '?'} · BF=${bayesResult.bayesFactor?.toFixed?.(2)} (${bayesResult.evidenceStrength})` : '', powerResult ? `Power: ${powerResult.solve} → n=${powerResult.requiredN ?? '?'} · effect=${powerResult.effectSize ?? '?'}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!zResult && !abResult && !bayesResult) { err('Run a test first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Experiment result`, tags: ['hypothesis', 'experiment', 'public'], source: 'hypothesis:experiment:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, stats: { z: zResult, ab: abResult, bayes: bayesResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Statistician brief. ${zResult ? `Z-test: ${zResult.conclusion} (z=${zResult.zStatistic}, p=${zResult.pValue}).` : ''} ${abResult ? `A/B: ${abResult.recommendation} (${abResult.statisticalPower} power).` : ''} ${bayesResult ? `Bayes: BF=${bayesResult.bayesFactor?.toFixed?.(2)} (${bayesResult.evidenceStrength}).` : ''} ${powerResult ? `Power: solve ${powerResult.solve} → ${powerResult.requiredN ?? '?'} samples.` : ''} Recommend the next step (more data / different test / ship decision) + one common pitfall to watch. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Stats brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'z' as ActionId, label: 'Z-test', desc: 'zTest', icon: Sigma, accent: '#3b82f6', handler: actZ },
    { id: 'ab' as ActionId, label: 'A/B', desc: 'abTest', icon: BarChart3, accent: '#22c55e', handler: actAb },
    { id: 'bayes' as ActionId, label: 'Bayes', desc: 'bayesianInference', icon: Brain, accent: '#a855f7', handler: actBayes },
    { id: 'power' as ActionId, label: 'Power', desc: 'powerAnalysis', icon: Target, accent: '#f59e0b', handler: actPower },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private analysis', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon result', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Statistician', desc: 'Agent: next step', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const EV_COLOR: Record<string, string> = { decisive: 'text-emerald-300', very_strong: 'text-emerald-300', strong: 'text-emerald-300', substantial: 'text-blue-300', anecdotal: 'text-amber-300', supports_null: 'text-red-300' };

  return (
    <div className="rounded-lg border border-pink-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-pink-500/10 pb-2">
        <Sigma className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-white">Hypothesis statistics bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">z · a/b · bayes · power</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Z-test JSON</label>
          <textarea value={zText} onChange={(e) => setZText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">A/B JSON</label>
          <textarea value={abText} onChange={(e) => setAbText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Bayes JSON</label>
          <textarea value={bayesText} onChange={(e) => setBayesText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Power params</label>
          <textarea value={powerText} onChange={(e) => setPowerText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {zResult && (
          <div className={cn('rounded-md border p-2.5', zResult.significant ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-900/50')}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Z · {zResult.testType}</div>
            <div className={cn('text-3xl font-bold', zResult.significant ? 'text-emerald-300' : 'text-zinc-300')}>{zResult.zStatistic}</div>
            <div className="text-[10px] text-zinc-300">p={zResult.pValue}{zResult.significant ? ' (SIG)' : ' (ns)'}</div>
            <div className="text-[10px] text-zinc-500">Effect: {zResult.effectSize}</div>
            {zResult.confidenceInterval && <div className="text-[10px] text-zinc-400">CI {zResult.confidenceInterval.level}: [{zResult.confidenceInterval.lower}, {zResult.confidenceInterval.upper}]</div>}
            <div className="text-[10px] text-blue-200 mt-1 italic">{zResult.conclusion}</div>
          </div>
        )}
        {abResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', abResult.significant ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">A/B · {abResult.statisticalPower} power</div>
            <div className={cn('text-3xl font-bold', abResult.significant ? 'text-emerald-300' : 'text-amber-300')}>{abResult.relativeUplift}</div>
            <div className="text-[10px] text-zinc-300">p={abResult.pValue} · Δ {abResult.absoluteDifference}</div>
            <div className="text-[10px] text-zinc-500">C: {abResult.control.rate} ({abResult.control.visitors}) · V: {abResult.variant.rate} ({abResult.variant.visitors})</div>
            <div className="text-[10px] text-zinc-400">CI: [{abResult.confidenceInterval.lower}, {abResult.confidenceInterval.upper}]</div>
            <div className="text-[10px] text-emerald-200 mt-1 italic">{abResult.recommendation}</div>
          </div>
        )}
        {bayesResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Bayes · {bayesResult.evidenceStrength}</div>
            <div className="text-2xl font-bold text-purple-200">BF {bayesResult.bayesFactor?.toFixed?.(2) ?? '—'}</div>
            <div className="text-[10px] text-zinc-300">μ posterior: {bayesResult.posterior?.mean?.toFixed?.(3) ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">{bayesResult.posterior?.distribution} α={bayesResult.posterior?.alpha?.toFixed?.(1)} β={bayesResult.posterior?.beta?.toFixed?.(1)}</div>
            {bayesResult.credibleInterval && <div className="text-[10px] text-zinc-400">CI {bayesResult.credibleInterval.level}: [{bayesResult.credibleInterval.lower}, {bayesResult.credibleInterval.upper}]</div>}
            <div className={cn('text-[10px] font-semibold mt-1', EV_COLOR[bayesResult.evidenceStrength ?? 'anecdotal'])}>Evidence: {bayesResult.evidenceStrength}</div>
          </div>
        )}
        {powerResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Power · {powerResult.solve}</div>
            <div className="text-3xl font-bold text-amber-200">n={powerResult.requiredN ?? '?'}</div>
            <div className="text-[10px] text-zinc-300">{powerResult.totalForTwoGroups ? `${powerResult.totalForTwoGroups} total (2-grp)` : `${powerResult.perGroup ?? ''}/group`}</div>
            <div className="text-[10px] text-zinc-500">Effect={powerResult.effectSize ?? '?'} · α={powerResult.alpha} · 1-β={powerResult.power}</div>
            {powerResult.detectableEffectSize && <div className="text-[10px] text-zinc-400">Detectable: {powerResult.detectableEffectSize}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Statistician</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
