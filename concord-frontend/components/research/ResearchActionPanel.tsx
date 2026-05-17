'use client';

/**
 * ResearchActionPanel — research-lab bench.
 * citationNetwork / methodologyScore / reproducibilityCheck / daily-note +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Network, ClipboardCheck, Repeat, Notebook, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('research', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'cite' | 'method' | 'repro' | 'note' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CitePaper { id: string; title: string; year: number; inDegree: number; outDegree: number; pageRank: number }
interface CiteCluster { keywords: string[]; coOccurrences: number }
interface CiteResult { totalPapers: number; hIndex: number; rankedPapers: CitePaper[]; foundationalWorks: { id: string; title: string; year: number; citations: number }[]; frontierWorks: { id: string; title: string; year: number; references: number }[]; topicClusters: CiteCluster[]; networkDensity: number }
interface MethodResult { overallScore?: number; ratingLevel?: string; criteriaScores?: { name: string; score: number; weight: number; note?: string }[]; strengths?: string[]; weaknesses?: string[] }
interface ReproResult { score?: number; rating?: string; dimensions?: { name: string; score: number; status: string }[]; recommendations?: string[] }
interface NoteResult { id?: string; title?: string; content?: string; created?: string; backlinks?: number }

const DEFAULT_CITE = JSON.stringify({ papers: [{ id: 'p1', title: 'Attention is All You Need', year: 2017, keywords: ['transformer', 'attention'], references: [] }, { id: 'p2', title: 'BERT', year: 2018, keywords: ['transformer', 'language'], references: ['p1'] }, { id: 'p3', title: 'GPT-3', year: 2020, keywords: ['language', 'few-shot'], references: ['p1', 'p2'] }, { id: 'p4', title: 'PaLM', year: 2022, keywords: ['language', 'scaling'], references: ['p1', 'p3'] }, { id: 'p5', title: 'Chain-of-Thought', year: 2022, keywords: ['reasoning', 'language'], references: ['p3', 'p4'] }, { id: 'p6', title: 'LLaMA', year: 2023, keywords: ['language', 'open-source'], references: ['p1', 'p3', 'p4'] }, { id: 'p7', title: 'GPT-4', year: 2023, keywords: ['language', 'reasoning'], references: ['p3', 'p4', 'p5'] }] }, null, 2);
const DEFAULT_METHOD = JSON.stringify({ methodology: { sampleSize: '480', controlGroup: true, randomization: true, blinding: 'single', measurementValidation: 'reported', statisticalTests: ['ANOVA', 'paired t-test'], effectSize: 'Cohen d=0.5', confidenceIntervals: true, reproducibilityInfo: 'partial', preregistered: false, conflictsOfInterest: 'declared', ethicsApproval: 'IRB#2024-01', dataAvailability: 'on-request' } }, null, 2);
const DEFAULT_REPRO = JSON.stringify({ study: { hasCode: true, codePublic: true, hasData: true, dataPublic: false, dependencyManagement: 'requirements.txt', randomSeeds: true, runtimeSpec: 'docker', resultLog: 'partial', documentation: 'comprehensive', preregistration: false } }, null, 2);
const DEFAULT_NOTE = JSON.stringify({ template: 'daily' }, null, 2);

export function ResearchActionPanel() {
  const [citeText, setCiteText] = useState(DEFAULT_CITE);
  const [methodText, setMethodText] = useState(DEFAULT_METHOD);
  const [reproText, setReproText] = useState(DEFAULT_REPRO);
  const [noteText, setNoteText] = useState(DEFAULT_NOTE);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [citeResult, setCiteResult] = useState<CiteResult | null>(null);
  const [methodResult, setMethodResult] = useState<MethodResult | null>(null);
  const [reproResult, setReproResult] = useState<ReproResult | null>(null);
  const [noteResult, setNoteResult] = useState<NoteResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actCite() {
    try { const parsed = JSON.parse(citeText); setBusy('cite'); setFeedback(null);
      const r = await callMacro<CiteResult>('citationNetwork', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCiteResult(r.result); ok(`h=${r.result.hIndex} · density ${r.result.networkDensity}`); } else err(r.error ?? 'cite failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid cite JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMethod() {
    try { const parsed = JSON.parse(methodText); setBusy('method'); setFeedback(null);
      const r = await callMacro<MethodResult>('methodologyScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMethodResult(r.result); ok(`Method ${r.result.overallScore ?? 0}/100 · ${r.result.ratingLevel ?? '?'}`); } else err(r.error ?? 'method failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid method JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRepro() {
    try { const parsed = JSON.parse(reproText); setBusy('repro'); setFeedback(null);
      const r = await callMacro<ReproResult>('reproducibilityCheck', { artifact: { data: parsed } });
      if (r.ok && r.result) { setReproResult(r.result); ok(`Repro ${r.result.score ?? '?'}/100 · ${r.result.rating ?? '?'}`); } else err(r.error ?? 'repro failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid repro JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actNote() {
    try { const parsed = JSON.parse(noteText); setBusy('note'); setFeedback(null);
      const r = await callMacro<NoteResult>('daily-note', { params: parsed });
      if (r.ok && r.result) { setNoteResult(r.result); ok(`Note ${r.result.id?.slice?.(0, 8) ?? '?'}`); } else err(r.error ?? 'note failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid note JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Research review`, tags: ['research', methodResult?.ratingLevel, reproResult?.rating].filter((t): t is string => !!t), source: 'research:review:mint', meta: { visibility: 'private', consent: { allowCitations: false }, research: { cite: citeResult, method: methodResult, repro: reproResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Review DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🔬 Research brief`, '', citeResult ? `Citation network: ${citeResult.totalPapers} papers · h-index ${citeResult.hIndex} · density ${citeResult.networkDensity}` : '', methodResult ? `Methodology: ${methodResult.overallScore ?? '?'}/100 · ${methodResult.ratingLevel ?? '?'}` : '', reproResult ? `Reproducibility: ${reproResult.score ?? '?'}/100 · ${reproResult.rating ?? '?'}` : '', noteResult?.id ? `Note created: ${noteResult.id.slice(0, 8)}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!citeResult && !methodResult && !reproResult) { err('Run at least one analysis first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Research review card`, tags: ['research', 'review', 'public'], source: 'research:review:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: false, research: { cite: citeResult, method: methodResult, repro: reproResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Senior peer reviewer brief. ${citeResult ? `Network: ${citeResult.totalPapers} papers, h=${citeResult.hIndex}, ${citeResult.foundationalWorks.length} foundational + ${citeResult.frontierWorks.length} frontier.` : ''} ${methodResult ? `Methodology: ${methodResult.overallScore ?? '?'}/100 (${methodResult.ratingLevel}); top gap: ${methodResult.weaknesses?.[0] ?? 'n/a'}.` : ''} ${reproResult ? `Reproducibility: ${reproResult.score ?? '?'}/100 (${reproResult.rating}).` : ''} Recommend the single most-impactful change before publication + one follow-on study to design. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Peer review ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'cite' as ActionId, label: 'Network', desc: 'citationNetwork (PageRank)', icon: Network, accent: '#3b82f6', handler: actCite },
    { id: 'method' as ActionId, label: 'Method', desc: 'methodologyScore', icon: ClipboardCheck, accent: '#22c55e', handler: actMethod },
    { id: 'repro' as ActionId, label: 'Repro', desc: 'reproducibilityCheck', icon: Repeat, accent: '#f59e0b', handler: actRepro },
    { id: 'note' as ActionId, label: 'Daily', desc: 'daily-note (Roam)', icon: Notebook, accent: '#a855f7', handler: actNote },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private review', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Reviewer', desc: 'Agent: pre-pub fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Network className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Research lab bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">network · method · repro · note</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Papers + refs JSON</label>
          <textarea value={citeText} onChange={(e) => setCiteText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Methodology JSON</label>
          <textarea value={methodText} onChange={(e) => setMethodText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Repro study JSON</label>
          <textarea value={reproText} onChange={(e) => setReproText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Daily-note params</label>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {citeResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Network · h={citeResult.hIndex}</div>
            <div className="text-2xl font-bold text-blue-200">{citeResult.totalPapers}</div>
            <div className="text-[10px] text-zinc-500">density {citeResult.networkDensity}</div>
            <div className="text-[10px] text-zinc-300 mt-1">Foundational:</div>
            {citeResult.foundationalWorks.slice(0, 3).map((p, i) => <div key={i} className="text-[10px] text-emerald-200 truncate">★ {p.title} ({p.year}) · {p.citations} cites</div>)}
            <div className="text-[10px] text-zinc-300 mt-1">Top by PageRank:</div>
            {citeResult.rankedPapers.slice(0, 3).map((p, i) => <div key={i} className="text-[10px] text-blue-200 truncate">{p.title} · PR={p.pageRank.toFixed(4)}</div>)}
          </div>
        )}
        {methodResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Method · {methodResult.ratingLevel ?? '?'}</div>
            <div className={cn('text-3xl font-bold', (methodResult.overallScore ?? 0) >= 70 ? 'text-emerald-300' : (methodResult.overallScore ?? 0) >= 40 ? 'text-amber-300' : 'text-red-300')}>{methodResult.overallScore ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">of 100</div>
            {methodResult.criteriaScores?.slice(0, 6).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate">{c.name}</span><span className={cn('font-mono', c.score >= c.weight * 0.7 ? 'text-emerald-200' : c.score >= c.weight * 0.4 ? 'text-amber-200' : 'text-red-300')}>{c.score}/{c.weight}</span></div>)}
            {methodResult.weaknesses?.slice(0, 2).map((w, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {w}</div>)}
          </div>
        )}
        {reproResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Repro · {reproResult.rating ?? '?'}</div>
            <div className={cn('text-3xl font-bold', (reproResult.score ?? 0) >= 70 ? 'text-emerald-300' : (reproResult.score ?? 0) >= 40 ? 'text-amber-300' : 'text-red-300')}>{reproResult.score ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">of 100</div>
            {reproResult.dimensions?.slice(0, 6).map((d, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate">{d.name}</span><span className={cn('font-mono', d.status === 'complete' ? 'text-emerald-200' : d.status === 'partial' ? 'text-amber-200' : 'text-red-300')}>{d.score}</span></div>)}
            {reproResult.recommendations?.slice(0, 2).map((r, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">→ {r}</div>)}
          </div>
        )}
        {noteResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Daily Note</div>
            <div className="text-[10px] text-zinc-200 font-mono">{noteResult.id ?? '—'}</div>
            <div className="text-[10px] text-zinc-300 mt-1">{noteResult.title ?? 'Untitled'}</div>
            <div className="text-[10px] text-zinc-500 mt-1">{noteResult.created ?? ''}</div>
            {noteResult.backlinks !== undefined && <div className="text-[10px] text-purple-200 mt-0.5">{noteResult.backlinks} backlinks</div>}
            {noteResult.content && <div className="text-[10px] text-zinc-400 mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap">{noteResult.content.slice(0, 200)}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Peer reviewer</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
