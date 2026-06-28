'use client';

/**
 * NeuroActionPanel — EEG/neural signal workbench.
 * frequencyAnalysis (FFT band power) / connectivityAnalysis / erpAnalysis +
 * mint/DM/publish/agent.
 */

import { useState, useMemo } from 'react';
import { Brain, Activity, Network, Zap, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('neuro', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'freq' | 'conn' | 'erp' | 'sim' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface BandStat { absolutePower: number; relativePower: number; label: string; association: string }
interface FreqChannel { channel: string; sampleRate: number; sampleCount: number; bands: Record<string, BandStat>; peakFrequency: number; totalPower: number; dominantBand: { name: string; relativePower: number; association: string }; indices: { alphaBetaRatio: number; thetaBetaRatio: number; arousalLevel: string; attentionIndex: string } }
interface FreqResult { channels: FreqChannel[]; channelCount: number }
interface Connection { from: string; to: string; correlation: number; strength?: string }
interface ConnResult { channelCount: number; significantConnections?: Connection[]; totalConnections?: number; correlationMatrix?: { labels: string[]; matrix: number[][] }; networkMetrics?: { averageConnectivity: number; density: number; strongConnections: number }; hubs?: { channel: string; connectivityScore: number }[] }
interface ErpPeak { latencyMs: number; amplitude: number; polarity: string; component: string | null }
interface ErpIdentified { component: string; latencyMs: number; amplitude: number }
interface ErpResult { epochCount: number; peakAmplitude: number; snr: number; snrQuality: string; baselineRms: number; peaks: ErpPeak[]; identifiedComponents: ErpIdentified[] }

// Composite EEG signal generator: alpha-dominant base + slight beta on CH1, delta-dominant on CH2.
function generateChannels(): { name: string; samples: number[]; sampleRate: number }[] {
  const sampleRate = 256, durationSec = 4, n = sampleRate * durationSec;
  const ch1 = new Array(n).fill(0).map((_, i) => {
    const t = i / sampleRate;
    return 0.6 * Math.sin(2 * Math.PI * 10 * t) + 0.25 * Math.sin(2 * Math.PI * 20 * t) + 0.05 * Math.sin(2 * Math.PI * 2 * t) + (Math.random() - 0.5) * 0.05;
  });
  const ch2 = new Array(n).fill(0).map((_, i) => {
    const t = i / sampleRate;
    return 0.7 * Math.sin(2 * Math.PI * 2 * t) + 0.15 * Math.sin(2 * Math.PI * 10 * t) + (Math.random() - 0.5) * 0.06;
  });
  return [{ name: 'Fz', samples: ch1, sampleRate }, { name: 'Pz', samples: ch2, sampleRate }];
}

const BAND_COLORS: Record<string, string> = { delta: '#1e40af', theta: '#7c3aed', alpha: '#22c55e', beta: '#f59e0b', gamma: '#ef4444' };

export function NeuroActionPanel() {
  const [signalKind, setSignalKind] = useState<'composite' | 'alpha' | 'beta' | 'delta' | 'gamma'>('composite');
  const [recipient, setRecipient] = useState('');
  const channels = useMemo(() => {
    if (signalKind === 'composite') return generateChannels();
    const sampleRate = 256, n = sampleRate * 4;
    const freqMap = { alpha: 10, beta: 20, delta: 2, gamma: 40 };
    const freq = freqMap[signalKind];
    return [{ name: 'CH1', samples: new Array(n).fill(0).map((_, i) => Math.sin(2 * Math.PI * freq * (i / sampleRate)) + (Math.random() - 0.5) * 0.05), sampleRate }];
  }, [signalKind]);

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [freqResult, setFreqResult] = useState<FreqResult | null>(null);
  const [connResult, setConnResult] = useState<ConnResult | null>(null);
  const [erpResult, setErpResult] = useState<ErpResult | null>(null);
  const [simState, setSimState] = useState<{ kind: string; channels: number; samples: number } | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actFreq() {
    setBusy('freq'); setFeedback(null);
    try { const r = await callMacro<FreqResult>('frequencyAnalysis', { artifact: { data: { channels } } }); if (r.ok && r.result) { setFreqResult(r.result); pipe.publish('neuro.freq', r.result, { label: `${r.result.channelCount}ch FFT` }); ok(`${r.result.channelCount} channels analyzed.`); } else err(r.error ?? 'freq failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actConn() {
    if (channels.length < 2) { err('Need 2+ channels (use composite).'); return; }
    setBusy('conn'); setFeedback(null);
    try { const r = await callMacro<ConnResult>('connectivityAnalysis', { artifact: { data: { channels } } }); if (r.ok && r.result) { setConnResult(r.result); pipe.publish('neuro.connectivity', r.result, { label: `${r.result.significantConnections?.length ?? 0} edges` }); ok(`${r.result.significantConnections?.length ?? 0} connections.`); } else err(r.error ?? 'conn failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actErp() {
    setBusy('erp'); setFeedback(null);
    try { const r = await callMacro<ErpResult>('erpAnalysis', { artifact: { data: { signal: channels[0], eventOnset: 0.5 } } }); if (r.ok && r.result) { setErpResult(r.result); pipe.publish('neuro.erp', r.result, { label: r.result.identifiedComponents?.[0]?.component ?? 'ERP' }); ok(`ERP analyzed.`); } else err(r.error ?? 'erp failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSim() {
    setBusy('sim'); setFeedback(null);
    setSimState({ kind: signalKind, channels: channels.length, samples: channels[0].samples.length });
    ok(`Simulated ${signalKind} (${channels.length}×${channels[0].samples.length}).`);
    setBusy(null);
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Neuro — ${signalKind} (${channels.length}ch)`, tags: ['neuro', 'eeg', signalKind], source: 'neuro:bench:mint', meta: { visibility: 'private', consent: { allowCitations: false }, neuro: { kind: signalKind, freq: freqResult, conn: connResult, erp: erpResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('neuro.mintedDtuId', id, { label: `bench ${id.slice(0, 8)}` }); ok(`Neuro DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const ch0 = freqResult?.channels?.[0];
    const body = [`🧠 EEG bench`, '', ch0 ? `Dominant: ${ch0.dominantBand.name} (${ch0.dominantBand.relativePower}%) — ${ch0.dominantBand.association}` : '', ch0 ? `Peak ${ch0.peakFrequency} Hz · arousal ${ch0.indices.arousalLevel} · attention ${ch0.indices.attentionIndex}` : '', connResult?.significantConnections?.length ? `${connResult.significantConnections.length} functional connections` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!freqResult) { err('Run freq analysis first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `EEG dataset — ${signalKind}`, tags: ['neuro', 'eeg', 'public'], source: 'neuro:dataset:publish', meta: { visibility: 'public', consent: { allowCitations: true }, freq: freqResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('neuro.publishedDtuId', id, { label: `dataset ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const ch0 = freqResult?.channels?.[0];
      const task = `EEG bench. ${ch0 ? `Channel ${ch0.channel}: dominant ${ch0.dominantBand.name} (${ch0.dominantBand.relativePower}%, ${ch0.dominantBand.association}), peak ${ch0.peakFrequency} Hz, arousal ${ch0.indices.arousalLevel}, attention ${ch0.indices.attentionIndex}.` : ''} ${connResult?.significantConnections?.length ? `${connResult.significantConnections.length} functional connections.` : ''} Interpret the most likely cognitive state + one neurofeedback intervention. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Interpretation ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'freq' as ActionId, label: 'FFT bands', desc: 'frequencyAnalysis', icon: Activity, accent: '#22c55e', handler: actFreq },
    { id: 'conn' as ActionId, label: 'Connectivity', desc: 'cross-channel corr', icon: Network, accent: '#a855f7', handler: actConn },
    { id: 'erp' as ActionId, label: 'ERP', desc: 'event-related potential', icon: Zap, accent: '#f59e0b', handler: actErp },
    { id: 'sim' as ActionId, label: 'Sim signal', desc: 'generate channels', icon: Brain, accent: '#06b6d4', handler: actSim },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private EEG DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send EEG brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public dataset', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Interpret', desc: 'Agent: cognitive state', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <Brain className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Neuro bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">EEG · FFT · connectivity · ERP</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select value={signalKind} onChange={(e) => setSignalKind(e.target.value as typeof signalKind)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
          <option value="composite">Composite 2-ch</option>
          <option value="alpha">Alpha 10 Hz</option>
          <option value="beta">Beta 20 Hz</option>
          <option value="delta">Delta 2 Hz</option>
          <option value="gamma">Gamma 40 Hz</option>
        </select>
        <div className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-zinc-400 font-mono">{channels.length} ch · {channels[0].samples.length} samp · {channels[0].sampleRate} Hz</div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        {simState && <div className="bg-zinc-900 border border-cyan-700 rounded px-3 py-1.5 text-[11px] text-cyan-300 font-mono">sim: {simState.kind}</div>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {freqResult && freqResult.channels.map((ch, ci) => (
          <div key={ci} className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{ch.channel} · peak {ch.peakFrequency} Hz</div>
            <div className="text-[11px] text-zinc-300">dominant: <span className="font-bold capitalize" style={{ color: BAND_COLORS[ch.dominantBand.name] }}>{ch.dominantBand.name}</span> ({ch.dominantBand.relativePower}%)</div>
            <div className="text-[10px] text-zinc-400 italic">{ch.dominantBand.association}</div>
            <div className="flex gap-0.5 h-6 mt-1.5">
              {Object.entries(ch.bands).map(([name, b]) => <div key={name} className="flex-1 rounded-sm relative group" style={{ backgroundColor: BAND_COLORS[name] + '40', borderTop: `2px solid ${BAND_COLORS[name]}`, height: `${Math.max(8, b.relativePower)}%` }} title={`${b.label}: ${b.relativePower}%`}>
                <div className="absolute -bottom-3.5 left-0 right-0 text-center text-[8px] text-zinc-400 uppercase">{name[0]}</div>
              </div>)}
            </div>
            <div className="text-[10px] text-zinc-400 mt-4">α/β {ch.indices.alphaBetaRatio} · θ/β {ch.indices.thetaBetaRatio} · {ch.indices.arousalLevel} / {ch.indices.attentionIndex}</div>
          </div>
        ))}
        {connResult?.significantConnections && (
          <div className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/5 p-2.5 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 font-semibold">Connectivity ({connResult.significantConnections.length}{connResult.networkMetrics ? ` · density ${connResult.networkMetrics.density}%` : ''})</div>
            <div className="space-y-0.5 mt-1 max-h-32 overflow-y-auto">
              {connResult.significantConnections.slice(0, 8).map((c, i) => <div key={i} className="text-[11px] text-zinc-300 flex items-center gap-2"><span className="font-mono">{c.from} ↔ {c.to}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-fuchsia-400" style={{ width: `${Math.min(100, Math.abs(c.correlation) * 100)}%` }} /></div><span className="font-mono text-fuchsia-200 text-[10px]">{c.correlation.toFixed(2)}</span></div>)}
            </div>
          </div>
        )}
        {erpResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">ERP · {erpResult.epochCount} epoch{erpResult.epochCount === 1 ? '' : 's'}</div>
            <div className="text-2xl font-bold text-amber-300">{erpResult.peakAmplitude} μV</div>
            <div className="text-[10px] text-zinc-400">SNR {erpResult.snr} ({erpResult.snrQuality}) · baseline RMS {erpResult.baselineRms}</div>
            {erpResult.identifiedComponents.length > 0 ? (
              <div className="text-[10px] text-amber-200 mt-1">
                {erpResult.identifiedComponents.map((c, i) => (
                  <span key={i} className="mr-2">{c.component}@{c.latencyMs}ms ({c.amplitude}μV)</span>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-zinc-500 mt-1">{erpResult.peaks.length} peak{erpResult.peaks.length === 1 ? '' : 's'}, none matched a known component</div>
            )}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Cognitive interpretation</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
