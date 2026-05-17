'use client';

/**
 * PaperActionPanel — research-paper bench.
 * search (real arXiv) / citationAnalyze / readabilityScore / abstractSummarize +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Search, Quote, BookOpenCheck, FileSearch, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('paper', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'search' | 'cite' | 'read' | 'summarize' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ArxivPaper { id: string; title: string; abstract: string; authors: string[]; published: string; url: string; pdfUrl: string | null; primaryCategory: string | null }
interface SearchResult { papers: ArxivPaper[]; query: string; count: number; source: string }
interface CiteResult { totalCitations: number; byType: Record<string, number>; byYear: Record<string, number>; selfCitations: number; selfCitationRate: number; medianYear: number; recencyIndex: number; recentCount: number; oldestYear: number | null; newestYear: number | null; avgAge: number | null }
interface ReadResult { fleschKincaidGrade: number; fleschReadingEase: number; gunningFog: number; readingLevel: string; stats: { words: number; sentences: number; avgWordsPerSentence: number; avgSyllablesPerWord: number; complexWordRate: number } }
interface SumResult { summary: string; sentenceCount: number; summaryLength: number; compressionRatio: number; keywords: string[] }

const DEFAULT_QUERY = JSON.stringify({ query: 'in-context learning large language models', limit: 8 }, null, 2);
const DEFAULT_CITE = JSON.stringify({ author: 'Smith', citations: [{ year: 2024, journal: 'Nature', authors: 'Smith, J et al.' }, { year: 2023, conference: 'NeurIPS', authors: 'Doe' }, { year: 2018, journal: 'JAMA', authors: 'Smith J' }, { year: 2010, journal: 'Cell', authors: 'Lee, M' }, { year: 2024, journal: 'Science', authors: 'Park, K' }, { year: 2022, url: 'https://arxiv.org/abs/2201.0001', authors: 'Smith, J' }, { year: 2019, journal: 'Nature', authors: 'Kim, S' }, { year: 2021, conference: 'ICML', authors: 'Wong, A' }] }, null, 2);
const DEFAULT_TEXT = JSON.stringify({ text: 'In this paper, we propose a novel architecture for sequence modeling that leverages self-attention and removes the recurrence inherent in conventional recurrent neural networks. Empirically, our model achieves state-of-the-art results on machine translation benchmarks while requiring significantly less training time. We analyze the computational complexity, demonstrating quadratic scaling with sequence length but excellent parallelizability across GPUs. The architecture generalizes to several downstream tasks including text classification and question answering. Limitations include quadratic memory cost for long contexts and the need for large pre-training corpora. We provide an open-source implementation and release pretrained checkpoints.' }, null, 2);

export function PaperActionPanel() {
  const [queryText, setQueryText] = useState(DEFAULT_QUERY);
  const [citeText, setCiteText] = useState(DEFAULT_CITE);
  const [textText, setTextText] = useState(DEFAULT_TEXT);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [citeResult, setCiteResult] = useState<CiteResult | null>(null);
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [sumResult, setSumResult] = useState<SumResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actSearch() {
    try { const parsed = JSON.parse(queryText); setBusy('search'); setFeedback(null);
      const r = await callMacro<SearchResult>('search', { params: parsed });
      if (r.ok && r.result) { setSearchResult(r.result); ok(`${r.result.count} papers from arXiv`); } else err(r.error ?? 'search failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid query JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCite() {
    try { const parsed = JSON.parse(citeText); setBusy('cite'); setFeedback(null);
      const r = await callMacro<CiteResult>('citationAnalyze', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCiteResult(r.result); ok(`${r.result.totalCitations} cites · ${r.result.recencyIndex}% recent`); } else err(r.error ?? 'cite failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid cite JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRead() {
    try { const parsed = JSON.parse(textText); setBusy('read'); setFeedback(null);
      const r = await callMacro<ReadResult>('readabilityScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setReadResult(r.result); ok(`${r.result.readingLevel} · FK ${r.result.fleschKincaidGrade}`); } else err(r.error ?? 'read failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid text JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSum() {
    try { const parsed = JSON.parse(textText); setBusy('summarize'); setFeedback(null);
      const r = await callMacro<SumResult>('abstractSummarize', { artifact: { data: parsed } });
      if (r.ok && r.result) { setSumResult(r.result); ok(`Summary ${r.result.compressionRatio}% of original`); } else err(r.error ?? 'summarize failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid text JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Paper review`, tags: ['paper', readResult?.readingLevel, searchResult?.query].filter((t): t is string => !!t), source: 'paper:review:mint', meta: { visibility: 'private', consent: { allowCitations: false }, paper: { search: searchResult, cite: citeResult, read: readResult, summary: sumResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Review DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📄 Paper review`, '', searchResult ? `Search '${searchResult.query}': ${searchResult.count} arXiv papers${searchResult.papers[0] ? ` — top: ${searchResult.papers[0].title.slice(0, 80)}` : ''}` : '', citeResult ? `Citations: ${citeResult.totalCitations} (${citeResult.recencyIndex}% in last 5y · self ${citeResult.selfCitationRate}%)` : '', readResult ? `Readability: ${readResult.readingLevel} · FK ${readResult.fleschKincaidGrade} · ${readResult.stats.complexWordRate}% complex` : '', sumResult ? `Summary (${sumResult.compressionRatio}%): ${sumResult.summary.slice(0, 200)}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!sumResult && !citeResult) { err('Run summary or cite first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Paper note`, tags: ['paper', 'note', 'public'], source: 'paper:note:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: false, paper: { summary: sumResult, read: readResult, cite: citeResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Research-paper reviewer brief. ${searchResult ? `Found ${searchResult.count} arXiv papers for '${searchResult.query}'.` : ''} ${citeResult ? `Citation profile: ${citeResult.totalCitations} cites, ${citeResult.recencyIndex}% recent, self-cite ${citeResult.selfCitationRate}%.` : ''} ${readResult ? `Readability: ${readResult.readingLevel} (FK ${readResult.fleschKincaidGrade}).` : ''} ${sumResult ? `Summary keywords: ${sumResult.keywords.slice(0, 5).join(', ')}.` : ''} Recommend one specific revision to strengthen the paper + one related search angle. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Reviewer brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'search' as ActionId, label: 'arXiv', desc: 'search (real API)', icon: Search, accent: '#3b82f6', handler: actSearch },
    { id: 'cite' as ActionId, label: 'Citations', desc: 'citationAnalyze', icon: Quote, accent: '#f59e0b', handler: actCite },
    { id: 'read' as ActionId, label: 'Readability', desc: 'FK/Fog/Ease', icon: BookOpenCheck, accent: '#22c55e', handler: actRead },
    { id: 'summarize' as ActionId, label: 'Summary', desc: 'abstractSummarize', icon: FileSearch, accent: '#a855f7', handler: actSum },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private review', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send review', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public note', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Reviewer', desc: 'Agent: revision+next', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <FileSearch className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Research paper bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">arXiv · cite · readability · summary</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">arXiv query (real API)</label>
          <textarea value={queryText} onChange={(e) => setQueryText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Citations JSON</label>
          <textarea value={citeText} onChange={(e) => setCiteText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Text for read/summary</label>
          <textarea value={textText} onChange={(e) => setTextText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
        {searchResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">arXiv · '{searchResult.query.slice(0, 24)}'</div>
            <div className="text-2xl font-bold text-blue-200">{searchResult.count}</div>
            <div className="text-[10px] text-zinc-500">{searchResult.source}</div>
            {searchResult.papers.slice(0, 4).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1"><strong className="text-blue-200">{p.id}</strong> {p.title.slice(0, 80)}…<div className="text-[9px] text-zinc-500">{p.authors.slice(0, 2).join(', ')}{p.authors.length > 2 ? '+' : ''} · {p.primaryCategory ?? ''}</div></div>)}
          </div>
        )}
        {citeResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Citations · {citeResult.totalCitations}</div>
            <div className="text-2xl font-bold text-amber-200">{citeResult.recencyIndex}<span className="text-xs text-zinc-400">% recent</span></div>
            <div className="text-[10px] text-zinc-300">Self-cite {citeResult.selfCitationRate}% · median {citeResult.medianYear}</div>
            <div className="text-[10px] text-zinc-500">{citeResult.oldestYear}–{citeResult.newestYear} · avg age {citeResult.avgAge}y</div>
            {Object.entries(citeResult.byType).map(([k, v], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{k}</span><span className="font-mono text-amber-200">{v}</span></div>)}
          </div>
        )}
        {readResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Read · {readResult.readingLevel}</div>
            <div className="text-3xl font-bold text-emerald-200">FK {readResult.fleschKincaidGrade}</div>
            <div className="text-[10px] text-zinc-300">Ease {readResult.fleschReadingEase} · Fog {readResult.gunningFog}</div>
            <div className="text-[10px] text-zinc-500">{readResult.stats.words}w · {readResult.stats.sentences}s · {readResult.stats.avgWordsPerSentence}/sent</div>
            <div className="text-[10px] text-zinc-400">{readResult.stats.complexWordRate}% complex · {readResult.stats.avgSyllablesPerWord} syl/word</div>
          </div>
        )}
        {sumResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Summary · {sumResult.compressionRatio}%</div>
            <div className="text-[10px] text-zinc-200 mt-1">{sumResult.summary}</div>
            <div className="flex flex-wrap gap-1 mt-2">{sumResult.keywords.map((k, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-purple-200">{k}</span>)}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Reviewer brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
