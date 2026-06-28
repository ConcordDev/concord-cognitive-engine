'use client';
/* eslint-disable @next/next/no-img-element -- remote book-cover thumbnails; next/image needs per-domain config */

/**
 * ClassroomActionPanel — librarian/teacher book bench.
 * ol-search / ol-subject / ol-work / ol-isbn (Open Library API) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { BookOpen, Library, Hash, Search, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('classroom', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'search' | 'subj' | 'work' | 'isbn' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Book { workId: string; title: string; authors: string[]; firstPublishYear?: number; editionCount?: number; subjects?: string[]; coverImage?: string | null; readUrl?: string | null }
interface SearchResult { query?: string; works: Book[]; count: number; totalResults?: number }
interface WorkResult { workId: string; title: string; description?: string; subjects?: string[]; subjectPlaces?: string[]; subjectPeople?: string[]; firstPublishDate?: string; covers?: string[] }
interface IsbnResult { isbn?: string; title?: string; subtitle?: string; publishers?: string[]; publishDate?: string; pages?: number; coverImage?: string | null }

export function ClassroomActionPanel() {
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [workId, setWorkId] = useState('');
  const [isbn, setIsbn] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [subjResult, setSubjResult] = useState<SearchResult | null>(null);
  const [workResult, setWorkResult] = useState<WorkResult | null>(null);
  const [isbnResult, setIsbnResult] = useState<IsbnResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actSearch() {
    if (!query.trim()) { err('Query required.'); return; }
    setBusy('search'); setFeedback(null);
    try {
      const r = await callMacro<SearchResult>('ol-search', { query: query.trim(), limit: 12 });
      if (r.ok && r.result) { setSearchResult(r.result); pipe.publish('classroom.search', r.result, { label: `Search ${r.result.count}` }); ok(`${r.result.count} of ${r.result.totalResults?.toLocaleString()} works.`); } else err(r.error ?? 'search failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSubj() {
    if (!subject.trim()) { err('Subject required.'); return; }
    setBusy('subj'); setFeedback(null);
    try {
      const r = await callMacro<SearchResult>('ol-subject', { subject: subject.trim(), ebooks: true, limit: 12 });
      if (r.ok && r.result) { setSubjResult(r.result); pipe.publish('classroom.subj', r.result, { label: `${subject}: ${r.result.count}` }); ok(`${r.result.count} works in ${subject}.`); } else err(r.error ?? 'subject failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWork() {
    if (!workId.trim()) { err('Work ID required (OL...W).'); return; }
    setBusy('work'); setFeedback(null);
    try {
      const r = await callMacro<WorkResult>('ol-work', { workId: workId.trim() });
      if (r.ok && r.result) { setWorkResult(r.result); pipe.publish('classroom.work', r.result, { label: `Work: ${r.result.title}` }); ok(`${r.result.title} loaded.`); } else err(r.error ?? 'work failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actIsbn() {
    if (!isbn.trim()) { err('ISBN required.'); return; }
    setBusy('isbn'); setFeedback(null);
    try {
      const r = await callMacro<IsbnResult>('ol-isbn', { isbn: isbn.trim() });
      if (r.ok && r.result) { setIsbnResult(r.result); pipe.publish('classroom.isbn', r.result, { label: `ISBN: ${r.result.title}` }); ok(`${r.result.title ?? isbn}.`); } else err(r.error ?? 'isbn failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Reading list — ${query}`, tags: ['classroom', 'reading', subject], source: 'classroom:reading:mint', meta: { visibility: 'private', consent: { allowCitations: false }, books: { search: searchResult, subj: subjResult, work: workResult, isbn: isbnResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('classroom.mintedDtuId', id, { label: `Reading DTU ${id.slice(0, 8)}…` }); ok(`Reading DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📚 Reading list`, '',
      searchResult ? `Search "${searchResult.query}": ${searchResult.count} results${searchResult.works[0] ? `\n→ ${searchResult.works[0].title} (${searchResult.works[0].authors[0] ?? '?'}, ${searchResult.works[0].firstPublishYear ?? '?'})` : ''}` : '',
      subjResult ? `Subject ${subject}: top "${subjResult.works[0]?.title}"` : '',
      workResult ? `Work: ${workResult.title} (${workResult.firstPublishDate ?? '?'})` : '',
      isbnResult ? `ISBN ${isbnResult.isbn}: ${isbnResult.title}${isbnResult.publishers?.length ? ` (${isbnResult.publishers.join(', ')})` : ''}` : '',
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
    if (!searchResult && !subjResult) { err('Run a search first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Curriculum list — ${subject || query}`, tags: ['classroom', 'curriculum', 'public', subject], source: 'classroom:curriculum:publish', meta: { visibility: 'public', consent: { allowCitations: true }, search: searchResult, subj: subjResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('classroom.publishedDtuId', id, { label: `Public curriculum ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const top = searchResult?.works.slice(0, 3).map(w => w.title).join(', ') || subjResult?.works.slice(0, 3).map(w => w.title).join(', ');
      const task = `Curriculum advisor. Topic: "${query}" / subject ${subject}. ${top ? `Top books: ${top}.` : ''} ${workResult?.title ? `Selected: ${workResult.title}.` : ''} Suggest a one-week reading plan with a discussion question. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Plan ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'search' as ActionId, label: 'Search', desc: 'Open Library search', icon: Search, accent: '#3b82f6', handler: actSearch },
    { id: 'subj' as ActionId, label: 'Subject', desc: 'subject catalog', icon: Library, accent: '#22c55e', handler: actSubj },
    { id: 'work' as ActionId, label: 'Work', desc: 'OL{...}W detail', icon: BookOpen, accent: '#a855f7', handler: actWork },
    { id: 'isbn' as ActionId, label: 'ISBN', desc: 'ISBN lookup', icon: Hash, accent: '#f59e0b', handler: actIsbn },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private reading DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send reading list', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public curriculum', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Plan', desc: 'Agent: week plan', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <BookOpen className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Classroom library</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">openlibrary.org · ~30M works</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Search query" />
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Subject" />
        <input type="text" value={workId} onChange={(e) => setWorkId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="OL...W" />
        <input type="text" value={isbn} onChange={(e) => setIsbn(e.target.value.replace(/[^0-9X]/gi, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="ISBN" />
        <div className="md:col-span-5 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
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
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {searchResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-72 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Search · {searchResult.totalResults?.toLocaleString()} matches</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1.5">
              {searchResult.works.slice(0, 8).map((w, i) => <button key={i} type="button" onClick={() => setWorkId(w.workId?.replace('/works/', ''))} className="text-left bg-blue-500/5 hover:bg-blue-500/15 border border-blue-500/20 rounded p-1.5">{w.coverImage && <img src={w.coverImage} alt={w.title} className="w-full h-20 object-cover rounded mb-1" />}<div className="text-[10px] font-semibold text-blue-200 line-clamp-2">{w.title}</div><div className="text-[9px] text-zinc-400 line-clamp-1">{w.authors[0]} · {w.firstPublishYear}</div></button>)}
            </div>
          </div>
        )}
        {subjResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Subject {subject} · {subjResult.count}</div>
            {subjResult.works.slice(0, 6).map((w, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1"><strong className="text-green-200">{w.title}</strong> · {w.authors?.[0] ?? '?'}</div>)}
          </div>
        )}
        {workResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{workResult.title}</div>
            {workResult.firstPublishDate && <div className="text-[10px] text-zinc-400">first published: {workResult.firstPublishDate}</div>}
            {workResult.description && <div className="text-[11px] text-zinc-300 mt-1 line-clamp-4">{workResult.description}</div>}
            {(workResult.subjects ?? []).slice(0, 5).map((s, i) => <span key={i} className="inline-block text-[9px] bg-purple-500/10 text-purple-200 px-1.5 py-0.5 rounded mr-1 mt-1">{s}</span>)}
          </div>
        )}
        {isbnResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">ISBN {isbnResult.isbn}</div>
            <div className="flex gap-2 mt-1">{isbnResult.coverImage && <img src={isbnResult.coverImage} alt={isbnResult.title} className="w-16 h-24 object-cover rounded" />}<div><div className="text-[11px] font-semibold text-amber-200">{isbnResult.title}</div>{isbnResult.subtitle && <div className="text-[10px] text-zinc-400">{isbnResult.subtitle}</div>}<div className="text-[10px] text-zinc-400">{[(isbnResult.publishers ?? []).join(', '), isbnResult.publishDate].filter(Boolean).join(' · ')}</div>{isbnResult.pages && <div className="text-[10px] text-zinc-400">{isbnResult.pages} pages</div>}</div></div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Week plan</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
