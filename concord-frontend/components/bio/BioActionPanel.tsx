'use client';

/**
 * BioActionPanel — molecular biology workbench.
 * sequence-analyze / primer-design / align-pairwise / restriction-map +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Dna, Scissors, GitMerge, Microscope, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('bio', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'analyze' | 'primer' | 'align' | 'restrict' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface SeqResult { length: number; kind: string; gcPercent?: number; tm?: number; orfs?: { start: number; end: number; length: number }[] }
interface PrimerInfo { sequence: string; length: number; tm: number; gcPercent: number }
interface PrimerResult { forward: PrimerInfo; reverse: PrimerInfo; productSize: number; notes?: string }
interface AlignResult { score: number; alignA: string; alignB: string; alignBars: string; matches: number; identity: number; alignmentLength: number }
// bio.restriction-map returns sites as objects {enzyme, position, cutAt, site}
// plus a count + the list of enzymes scanned — NOT a number[] of positions and
// NOT a fragments array (those were never emitted by the handler, so the old
// shape rendered "[object Object]" cut positions and never showed fragments).
interface RestrictSite { enzyme: string; position: number; cutAt: number; site: string }
interface RestrictResult { sites?: RestrictSite[]; count?: number; enzymesScanned?: string[] }

// No seed sequences — paste real DNA / RNA / protein strings.
export function BioActionPanel() {
  const [sequence, setSequence] = useState('');
  const [seqKind, setSeqKind] = useState<'dna' | 'rna' | 'protein'>('dna');
  const [seqB, setSeqB] = useState('');
  const [enzyme, setEnzyme] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [seqResult, setSeqResult] = useState<SeqResult | null>(null);
  const [primerResult, setPrimerResult] = useState<PrimerResult | null>(null);
  const [alignResult, setAlignResult] = useState<AlignResult | null>(null);
  const [restrictResult, setRestrictResult] = useState<RestrictResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actAnalyze() {
    if (!sequence.trim()) { err('Sequence required.'); return; }
    setBusy('analyze'); setFeedback(null);
    try {
      const r = await callMacro<SeqResult>('sequence-analyze', { sequence: sequence.trim(), kind: seqKind });
      if (r.ok && r.result) { setSeqResult(r.result); pipe.publish('bio.analyze', r.result, { label: `${r.result.length}bp GC${r.result.gcPercent}%` }); ok(`${r.result.length} bp · GC ${r.result.gcPercent ?? '-'}%.`); } else err(r.error ?? 'analyze failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPrimer() {
    if (sequence.trim().length < 100) { err('Need ≥100 bp for primer design.'); return; }
    setBusy('primer'); setFeedback(null);
    try {
      const r = await callMacro<PrimerResult>('primer-design', { sequence: sequence.trim(), targetTm: 60, targetLength: 20 });
      if (r.ok && r.result) { setPrimerResult(r.result); pipe.publish('bio.primer', r.result, { label: `Primers ${r.result.productSize}bp` }); ok(`Primer pair → ${r.result.productSize} bp amplicon.`); } else err(r.error ?? 'primer failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAlign() {
    if (!sequence.trim() || !seqB.trim()) { err('Both sequence A and B required.'); return; }
    setBusy('align'); setFeedback(null);
    try {
      const r = await callMacro<AlignResult>('align-pairwise', { seqA: sequence.trim(), seqB: seqB.trim(), match: 2, mismatch: -1, gap: -2 });
      if (r.ok && r.result) { setAlignResult(r.result); pipe.publish('bio.align', r.result, { label: `Align ${r.result.identity}%` }); ok(`Identity ${r.result.identity}%.`); } else err(r.error ?? 'align failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRestrict() {
    if (!sequence.trim()) { err('Sequence required.'); return; }
    if (!enzyme.trim()) { err('Enzyme required (e.g. EcoRI, BamHI, HindIII).'); return; }
    setBusy('restrict'); setFeedback(null);
    try {
      // Handler reads params.enzymes (an array); pass the single enzyme as a
      // one-element array so the filter actually applies (a singular `enzyme`
      // field is ignored by the handler and silently scans ALL 10 enzymes).
      const r = await callMacro<RestrictResult>('restriction-map', { sequence: sequence.trim(), enzymes: [enzyme.trim()] });
      if (r.ok && r.result) { setRestrictResult(r.result); pipe.publish('bio.restrict', r.result, { label: `${enzyme}: ${r.result.sites?.length ?? 0} sites` }); ok(`${r.result.sites?.length ?? 0} cut sites.`); } else err(r.error ?? 'restrict failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `${seqKind.toUpperCase()} — ${seqResult?.length ?? sequence.length} ${seqKind === 'protein' ? 'aa' : 'bp'}`, tags: ['bio', seqKind, 'sequence'], source: 'bio:seq:mint', meta: { visibility: 'private', consent: { allowCitations: false }, bio: { sequence: sequence.slice(0, 1000), kind: seqKind, analyze: seqResult, primers: primerResult, align: alignResult, restrict: restrictResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('bio.mintedDtuId', id, { label: `Seq DTU ${id.slice(0, 8)}…` }); ok(`Seq DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🧬 Bio bench`, '',
      seqResult ? `${seqResult.length} ${seqKind === 'protein' ? 'aa' : 'bp'} ${seqKind.toUpperCase()} · GC ${seqResult.gcPercent ?? '-'}% · Tm ${seqResult.tm ?? '-'}°C` : '',
      primerResult ? `Primers: F=${primerResult.forward.sequence} / R=${primerResult.reverse.sequence} → ${primerResult.productSize} bp` : '',
      alignResult ? `Alignment identity: ${alignResult.identity}% over ${alignResult.alignmentLength} bp` : '',
      restrictResult ? `${enzyme}: ${restrictResult.sites?.length ?? 0} sites` : '',
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
    if (!seqResult) { err('Run analyze first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Public ${seqKind.toUpperCase()} profile`, tags: ['bio', seqKind, 'public'], source: 'bio:seq:publish', meta: { visibility: 'public', consent: { allowCitations: true }, kind: seqKind, analyze: seqResult, primers: primerResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('bio.publishedDtuId', id, { label: `Public bio ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Molecular bio bench. ${seqResult ? `${seqResult.length} ${seqKind === 'protein' ? 'aa' : 'bp'} ${seqKind.toUpperCase()}, GC ${seqResult.gcPercent ?? '-'}%, Tm ${seqResult.tm ?? '-'}°C${(seqResult.orfs?.length ?? 0) > 0 ? `, ${seqResult.orfs?.length} ORFs` : ''}.` : ''} ${primerResult ? `Primer Tm: F=${primerResult.forward.tm}°C / R=${primerResult.reverse.tm}°C.` : ''} ${alignResult ? `Alignment identity ${alignResult.identity}%.` : ''} Identify the most likely experimental purpose + one optimization. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Bench brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'analyze' as ActionId, label: 'Analyze', desc: 'GC% / Tm / ORFs', icon: Microscope, accent: '#22c55e', handler: actAnalyze },
    { id: 'primer' as ActionId, label: 'Primers', desc: 'F+R 18-28 bp', icon: GitMerge, accent: '#06b6d4', handler: actPrimer },
    { id: 'align' as ActionId, label: 'Align', desc: 'Needleman-Wunsch', icon: Dna, accent: '#a855f7', handler: actAlign },
    { id: 'restrict' as ActionId, label: 'Restrict', desc: `restriction-map ${enzyme}`, icon: Scissors, accent: '#f59e0b', handler: actRestrict },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private seq DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send bench results', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public seq profile', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: purpose + opt', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-green-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-green-500/10 pb-2">
        <Dna className="h-4 w-4 text-green-400" />
        <h3 className="text-sm font-semibold text-white">Bio bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">FASTA · primer · align · digest</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Sequence A ({seqKind})</label>
          <textarea value={sequence} onChange={(e) => setSequence(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-2">
          <select value={seqKind} onChange={(e) => setSeqKind(e.target.value as typeof seqKind)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
            <option value="dna">DNA</option>
            <option value="rna">RNA</option>
            <option value="protein">Protein</option>
          </select>
          <input type="text" value={enzyme} onChange={(e) => setEnzyme(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Enzyme (EcoRI...)" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
        <div className="md:col-span-3">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Sequence B (for alignment)</label>
          <textarea value={seqB} onChange={(e) => setSeqB(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono mt-1" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {seqResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">{seqResult.kind.toUpperCase()} · {seqResult.length} {seqResult.kind === 'protein' ? 'aa' : 'bp'}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
              {seqResult.gcPercent != null && <div className="text-[11px] text-zinc-300">GC <span className="text-green-200 font-mono">{seqResult.gcPercent}%</span></div>}
              {seqResult.tm != null && <div className="text-[11px] text-zinc-300">Tm <span className="text-green-200 font-mono">{seqResult.tm}°C</span></div>}
              {seqResult.orfs && <div className="text-[11px] text-zinc-300 col-span-2">ORFs <span className="text-green-200 font-mono">{seqResult.orfs.length}</span> {seqResult.orfs.slice(0, 3).map((o, i) => <span key={i} className="text-[10px] text-zinc-400 ml-1">{o.start}-{o.end} ({o.length})</span>)}</div>}
            </div>
          </div>
        )}
        {primerResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Primer pair · {primerResult.productSize} bp</div>
            <div className="mt-1">
              <div className="text-[10px] text-cyan-400">FWD ({primerResult.forward.length}b · Tm {primerResult.forward.tm}°C · GC {primerResult.forward.gcPercent}%)</div>
              <div className="font-mono text-[11px] text-cyan-100 break-all">{primerResult.forward.sequence}</div>
              <div className="text-[10px] text-cyan-400 mt-1">REV ({primerResult.reverse.length}b · Tm {primerResult.reverse.tm}°C · GC {primerResult.reverse.gcPercent}%)</div>
              <div className="font-mono text-[11px] text-cyan-100 break-all">{primerResult.reverse.sequence}</div>
            </div>
          </div>
        )}
        {alignResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Alignment · score {alignResult.score} · identity {alignResult.identity}%</div>
            <div className="font-mono text-[10px] text-purple-100 mt-1 leading-tight overflow-x-auto max-h-32"><div>{alignResult.alignA}</div><div className="text-purple-400">{alignResult.alignBars}</div><div>{alignResult.alignB}</div></div>
          </div>
        )}
        {restrictResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">{enzyme} · {restrictResult.sites?.length ?? 0} sites</div>
            <div className="text-[10px] text-zinc-400 mt-1">cuts at: {(restrictResult.sites ?? []).slice(0, 10).map(s => s.cutAt).join(', ') || 'none'}</div>
            {(restrictResult.sites?.length ?? 0) > 0 && <div className="text-[10px] text-amber-200 mt-1 font-mono break-all">{(restrictResult.sites ?? []).slice(0, 6).map((s, i) => <span key={i} className="mr-2">{s.enzyme}@{s.position}</span>)}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Bench brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
