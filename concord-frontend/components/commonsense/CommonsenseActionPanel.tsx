'use client';

/**
 * CommonsenseActionPanel — knowledge graph + reasoning bench.
 * conceptnet-edges / conceptnet-relatedness / plausibilityCheck /
 * analogyMapping + mint/DM/publish/agent.
 *
 * Max-polish pass: empty defaults (no seed concepts/statements), pipe
 * publish/import for cross-panel hand-off, recall window on DM + publish.
 */

import { useState } from 'react';
import { Brain, Link2, Lightbulb, ArrowLeftRight, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  usePipe,
  PipeImporter,
  useRecallableAction,
  RecallSlot,
} from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('commonsense', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'edges' | 'rel' | 'plaus' | 'analog' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Edge { relation?: string; start?: string; end?: string; weight?: number; surfaceText?: string }
interface EdgesResult { concept: string; edges: Edge[]; count: number }
interface RelResult { concept1: string; concept2: string; relatedness: number; interpretation: string }
interface PlausResult { statement?: string; plausibilityScore?: number; reasoning?: string; verdict?: string }
interface AnalogResult { source?: string; target?: string; mappings?: { sourceConcept: string; targetConcept: string; similarity?: number }[]; coherence?: number }

export function CommonsenseActionPanel() {
  const pipe = usePipe();

  const [concept, setConcept] = useState('');
  const [concept2, setConcept2] = useState('');
  const [statement, setStatement] = useState('');
  const [analogSource, setAnalogSource] = useState('');
  const [analogTarget, setAnalogTarget] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [edgesResult, setEdgesResult] = useState<EdgesResult | null>(null);
  const [relResult, setRelResult] = useState<RelResult | null>(null);
  const [plausResult, setPlausResult] = useState<PlausResult | null>(null);
  const [analogResult, setAnalogResult] = useState<AnalogResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const dmRecall = useRecallableAction({
    label: 'DM', windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish', windowMs: 30_000,
    onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); },
  });

  async function actEdges() {
    if (!concept.trim()) { err('Concept required.'); return; }
    setBusy('edges'); setFeedback(null);
    try {
      const r = await callMacro<EdgesResult>('conceptnet-edges', { concept: concept.trim(), limit: 30 });
      if (r.ok && r.result) {
        setEdgesResult(r.result);
        pipe.publish('commonsense.edges', r.result, { label: `${r.result.concept}: ${r.result.count} edges` });
        ok(`${r.result.count} edges.`);
      } else err(r.error ?? 'edges failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRel() {
    if (!concept.trim() || !concept2.trim()) { err('Both concepts required.'); return; }
    setBusy('rel'); setFeedback(null);
    try {
      const r = await callMacro<RelResult>('conceptnet-relatedness', { concept1: concept.trim(), concept2: concept2.trim() });
      if (r.ok && r.result) {
        setRelResult(r.result);
        pipe.publish('commonsense.rel', r.result, { label: `${r.result.concept1} ↔ ${r.result.concept2}: ${r.result.relatedness.toFixed(2)}` });
        ok(`${r.result.relatedness.toFixed(2)} · ${r.result.interpretation}.`);
      } else err(r.error ?? 'rel failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPlaus() {
    if (!statement.trim()) { err('Statement required.'); return; }
    setBusy('plaus'); setFeedback(null);
    try {
      const r = await callMacro<PlausResult>('plausibilityCheck', { artifact: { data: { statement: statement.trim() } } });
      if (r.ok && r.result) {
        setPlausResult(r.result);
        pipe.publish('commonsense.plaus', r.result, { label: `Plausibility: ${r.result.verdict ?? '?'}` });
        ok(`${r.result.verdict ?? '-'}.`);
      } else err(r.error ?? 'plaus failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAnalog() {
    if (!analogSource.trim() || !analogTarget.trim()) { err('Source + target required.'); return; }
    setBusy('analog'); setFeedback(null);
    try {
      const r = await callMacro<AnalogResult>('analogyMapping', { artifact: { data: { source: analogSource.trim(), target: analogTarget.trim() } } });
      if (r.ok && r.result) {
        setAnalogResult(r.result);
        pipe.publish('commonsense.analog', r.result, { label: `${r.result.source} → ${r.result.target}` });
        ok(`${r.result.mappings?.length ?? 0} mappings.`);
      } else err(r.error ?? 'analogy failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Commonsense — ${concept || 'kg'}`, tags: ['commonsense', 'kg', concept].filter(Boolean), source: 'commonsense:kg:mint', meta: { visibility: 'private', consent: { allowCitations: false }, cs: { edges: edgesResult, rel: relResult, plaus: plausResult, analog: analogResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('commonsense.mintedDtuId', id, { label: `KG DTU ${id.slice(0, 8)}…` }); ok(`KG DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🧠 Commonsense brief`, '',
      edgesResult ? `${edgesResult.concept}: ${edgesResult.count} edges (top: ${edgesResult.edges[0]?.surfaceText || edgesResult.edges[0]?.relation})` : '',
      relResult ? `${relResult.concept1} ↔ ${relResult.concept2}: ${relResult.relatedness.toFixed(2)} (${relResult.interpretation})` : '',
      plausResult ? `Plausibility: ${plausResult.verdict} (${plausResult.plausibilityScore})` : '',
      analogResult ? `Analogy ${analogResult.source} → ${analogResult.target}: ${analogResult.mappings?.length} mappings · coherence ${analogResult.coherence}` : '',
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
    if (!edgesResult && !analogResult) { err('Run edges or analogy first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `KG card — ${concept || 'kg'}`, tags: ['commonsense', 'public'], source: 'commonsense:kg:publish', meta: { visibility: 'public', consent: { allowCitations: true }, edges: edgesResult, analog: analogResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('commonsense.publishedDtuId', id, { label: `Public KG card ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Commonsense reasoning brief. ${edgesResult ? `Concept "${edgesResult.concept}": ${edgesResult.count} edges, top: ${edgesResult.edges.slice(0, 3).map(e => e.surfaceText || `${e.relation}: ${e.end}`).join('; ')}.` : ''} ${relResult ? `Relatedness ${relResult.concept1} ↔ ${relResult.concept2}: ${relResult.relatedness.toFixed(2)} (${relResult.interpretation}).` : ''} ${plausResult ? `Statement plausibility: ${plausResult.verdict}.` : ''} Synthesize the most interesting commonsense observation + one follow-up query. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2);
        setAgentReply(text); pipe.publish('commonsense.agentReply', text, { label: 'KG observation' });
        ok('Insight ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  // Pull concept from a recently piped commonsense edges/rel result.
  function importConceptFromEdges(v: EdgesResult) { if (v?.concept) setConcept(v.concept); }
  function importPairFromRel(v: RelResult) { if (v?.concept1) setConcept(v.concept1); if (v?.concept2) setConcept2(v.concept2); }

  const actions = [
    { id: 'edges' as ActionId, label: 'Edges', desc: 'ConceptNet edges', icon: Link2, accent: '#3b82f6', handler: actEdges },
    { id: 'rel' as ActionId, label: 'Related', desc: 'embedding similarity', icon: ArrowLeftRight, accent: '#22c55e', handler: actRel },
    { id: 'plaus' as ActionId, label: 'Plausible', desc: 'plausibilityCheck', icon: Lightbulb, accent: '#f59e0b', handler: actPlaus },
    { id: 'analog' as ActionId, label: 'Analogy', desc: 'analogyMapping', icon: Brain, accent: '#a855f7', handler: actAnalog },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private KG DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public KG card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Insight', desc: 'Agent: observation', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const INTERP_COLOR: Record<string, string> = { 'very-related': 'text-emerald-300', related: 'text-blue-300', 'weakly-related': 'text-amber-300', unrelated: 'text-zinc-400' };

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Brain className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Commonsense KG</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">ConceptNet 5 · plausibility · analogy</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="flex items-center gap-1">
          <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Concept" />
          <PipeImporter<EdgesResult> accept={['commonsense.edges']} onImport={importConceptFromEdges} compact />
        </div>
        <div className="flex items-center gap-1">
          <input type="text" value={concept2} onChange={(e) => setConcept2(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Concept B" />
          <PipeImporter<RelResult> accept={['commonsense.rel']} onImport={importPairFromRel} compact />
        </div>
        <input type="text" value={analogSource} onChange={(e) => setAnalogSource(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Analogy source" />
        <input type="text" value={analogTarget} onChange={(e) => setAnalogTarget(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Analogy target" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} className="md:col-span-5 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Statement to plausibility-check" />
        <div className="md:col-span-5 flex items-center gap-2 flex-wrap">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {edgesResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Edges · {edgesResult.concept} ({edgesResult.count})</div>
            {edgesResult.edges.slice(0, 12).map((e, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1"><span className="font-mono text-blue-200">{e.relation}</span> <span className="text-zinc-400">→</span> <strong>{e.end}</strong> {e.weight != null && <span className="text-[9px] text-zinc-500 ml-1">w={e.weight.toFixed(2)}</span>}{e.surfaceText && <div className="text-[10px] text-zinc-500 italic ml-3">&ldquo;{e.surfaceText}&rdquo;</div>}</div>)}
          </div>
        )}
        {relResult && (
          <div className={cn('rounded-md border p-2.5', relResult.relatedness > 0.7 ? 'border-emerald-500/30 bg-emerald-500/5' : relResult.relatedness > 0.4 ? 'border-blue-500/30 bg-blue-500/5' : relResult.relatedness > 0.2 ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-500/30 bg-zinc-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">{relResult.concept1} ↔ {relResult.concept2}</div>
            <div className={cn('text-3xl font-bold', INTERP_COLOR[relResult.interpretation])}>{relResult.relatedness.toFixed(2)}</div>
            <div className={cn('text-[11px] font-semibold capitalize', INTERP_COLOR[relResult.interpretation])}>{relResult.interpretation.replace('-', ' ')}</div>
          </div>
        )}
        {plausResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Plausibility · {plausResult.verdict}</div>
            {plausResult.plausibilityScore != null && <div className="text-2xl font-bold text-amber-300">{plausResult.plausibilityScore}</div>}
            {plausResult.reasoning && <div className="text-[10px] text-zinc-300 italic">{plausResult.reasoning}</div>}
          </div>
        )}
        {analogResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{analogResult.source} → {analogResult.target}</div>
            {analogResult.coherence != null && <div className="text-[11px] text-zinc-300">coherence: <span className="font-mono text-purple-200">{analogResult.coherence}</span></div>}
            {(analogResult.mappings ?? []).slice(0, 5).map((m, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1"><span className="font-mono text-purple-200">{m.sourceConcept}</span> ↔ <span className="font-mono text-purple-200">{m.targetConcept}</span>{m.similarity != null && <span className="text-[10px] text-zinc-500 ml-2">sim {m.similarity}</span>}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Observation</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
