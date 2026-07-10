'use client';

/**
 * OpenLibrarySearch — bespoke Open Library book lookup for the
 * classroom lens. Backed by classroom.ol-search + classroom.ol-work +
 * classroom.ol-isbn + classroom.ol-subject (Open Library, ~30M books,
 * no key required).
 *
 * Per category-leader research (Open Library, Goodreads, LibraryThing,
 * Anna's Archive): cover-art grid with author + year overlay, click →
 * detail card with editions + read-on-IA link, Save-as-DTU.
 *
 * Wave 3 rebuild: this component used to coexist with a second, separate
 * "Classroom library" action-bench (ClassroomActionPanel) that duplicated
 * the exact same 4 Open Library macros behind a plainer card-grid UI, plus
 * added 4 more actions (mint/DM/publish/agent). Two of those four were
 * themselves redundant — SaveAsDtuButton below already mints a private OR
 * public DTU with a real visibility toggle, which is what the old "Mint"
 * and "Publish" buttons did by hand. Only "DM this book to someone" and
 * "ask the agent for a week reading plan" were genuinely distinct — both
 * are folded into this detail view so there's one real book-browsing
 * surface instead of two overlapping ones. See the removed panel's history
 * in git log for the prior shape if needed.
 */

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Loader2, Search, ExternalLink, Send, Wand2, Check, AlertTriangle } from 'lucide-react';
import { api, apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { useRecallableAction, RecallSlot } from '@/components/panel-polish';
import { cn } from '@/lib/utils';

interface Work {
  workId: string;
  title: string;
  authors?: string[];
  firstPublishYear?: number;
  editionCount?: number;
  languages?: string[];
  subjects?: string[];
  isbn?: string;
  coverId?: number;
  coverImage?: string | null;
  ebookAccess?: string;
  iaIdentifier?: string;
  readUrl?: string | null;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('classroom', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const POPULAR_SUBJECTS = ['biology', 'physics', 'world_history', 'computer_science', 'economics', 'philosophy', 'mathematics', 'literature'];

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function OpenLibrarySearch() {
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<Work[]>([]);
  const [focus, setFocus] = useState<Work | null>(null);

  // DM this book + ask-the-agent-for-a-plan — the two real capabilities the
  // retired ClassroomActionPanel had that this cover-grid view didn't.
  const [recipient, setRecipient] = useState('');
  const [dmBusy, setDmBusy] = useState(false);
  const [dmFeedback, setDmFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const dmRecall = useRecallableAction({
    label: 'DM', windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });

  // A new book takes focus — the per-book DM/agent scratch state resets so a
  // reply for a previous book can't be mistaken for the current one.
  useEffect(() => {
    setDmFeedback(null); setAgentReply(null); setRecipient('');
  }, [focus?.workId]);

  async function sendDm() {
    if (!focus || !recipient.trim()) { setDmFeedback({ kind: 'err', text: 'Recipient required.' }); return; }
    setDmBusy(true); setDmFeedback(null);
    const body = [
      `📚 Book recommendation`, '',
      `${focus.title}${focus.authors?.[0] ? ` — ${focus.authors[0]}` : ''}${focus.firstPublishYear ? ` (${focus.firstPublishYear})` : ''}`,
      focus.readUrl ? `Read: ${focus.readUrl}` : `Open Library: https://openlibrary.org/works/${focus.workId}`,
    ].join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { setDmFeedback({ kind: 'ok', text: 'Sent. 60s to recall.' }); setRecipient(''); }
    } catch (e) { setDmFeedback({ kind: 'err', text: pickMessage(e) }); }
    finally { setDmBusy(false); }
  }

  async function askAgentForPlan() {
    if (!focus) return;
    setAgentBusy(true); setAgentReply(null);
    try {
      const task = `Curriculum advisor. Book: "${focus.title}"${focus.authors?.[0] ? ` by ${focus.authors[0]}` : ''}${focus.subjects?.length ? `. Subjects: ${focus.subjects.slice(0, 5).join(', ')}` : ''}. Suggest a one-week reading plan with a discussion question. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
      else setAgentReply('The agent returned an empty plan — try again.');
    } catch (e) { setAgentReply(`Could not reach the agent: ${pickMessage(e)}`); }
    finally { setAgentBusy(false); }
  }

  const searchMutation = useMutation({
    mutationFn: async (params: Record<string, unknown>) => callMacro<{ works: Work[] }>('ol-search', { ...params, limit: 24 }),
    onSuccess: (env) => { if (env.ok && env.result) setWorks(env.result.works); else setWorks([]); },
  });
  const subjectMutation = useMutation({
    mutationFn: async (subject: string) => callMacro<{ works: Work[] }>('ol-subject', { subject, limit: 24 }),
    onSuccess: (env) => { if (env.ok && env.result) setWorks(env.result.works); else setWorks([]); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setFocus(null);
    searchMutation.mutate({ query: q });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Open Library</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">~30M books</span>
        </div>
      </header>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, author, ISBN — 'fahrenheit 451', 'clean code'…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none" />
        </div>
        <button type="submit" disabled={!query.trim() || searchMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50">
          {searchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-400">Subjects:</span>
        {POPULAR_SUBJECTS.map((s) => (
          <button key={s} type="button" onClick={() => { setFocus(null); subjectMutation.mutate(s); }} className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-cyan-500/30 hover:text-cyan-200">
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {works.length > 0 && !focus && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {works.map((w) => (
            <button key={w.workId} type="button" onClick={() => setFocus(w)} className="group overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40 text-left transition-colors hover:border-cyan-500/30">
              <div className="aspect-[2/3] w-full bg-zinc-900">
                {w.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.coverImage} alt={w.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center"><BookOpen className="h-6 w-6 text-zinc-700" /></div>
                )}
              </div>
              <div className="space-y-0.5 p-2">
                <div className="line-clamp-2 text-[11px] text-white">{w.title}</div>
                {w.authors?.[0] && <div className="line-clamp-1 text-[10px] text-zinc-400">{w.authors[0]}</div>}
                {w.firstPublishYear && <div className="text-[9px] font-mono text-zinc-400">{w.firstPublishYear}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {focus && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4">
          <button type="button" onClick={() => setFocus(null)} className="mb-2 text-xs text-zinc-400 hover:text-zinc-200">← Back to results</button>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              {focus.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={focus.coverImage.replace('-M', '-L')} alt={focus.title} className="w-full rounded border border-zinc-800" />
              ) : (
                <div className="flex aspect-[2/3] items-center justify-center rounded border border-zinc-800 bg-zinc-900"><BookOpen className="h-12 w-12 text-zinc-700" /></div>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-white">{focus.title}</h3>
                  {focus.authors && <p className="text-sm text-cyan-300/90">{focus.authors.join(', ')}</p>}
                  {focus.firstPublishYear && <p className="text-[11px] text-zinc-400">First published {focus.firstPublishYear} · {focus.editionCount || 0} editions</p>}
                </div>
                <SaveAsDtuButton
                  apiSource="open-library"
                  apiUrl={`https://openlibrary.org/works/${focus.workId}.json`}
                  title={`${focus.title}${focus.authors?.[0] ? ` — ${focus.authors[0]}` : ''}`}
                  content={[
                    `Title: ${focus.title}`,
                    focus.authors ? `Authors: ${focus.authors.join(', ')}` : '',
                    focus.firstPublishYear ? `First published: ${focus.firstPublishYear}` : '',
                    focus.editionCount ? `Editions: ${focus.editionCount}` : '',
                    focus.languages ? `Languages: ${focus.languages.join(', ')}` : '',
                    focus.subjects ? `Subjects: ${focus.subjects.slice(0, 8).join(', ')}` : '',
                    focus.isbn ? `ISBN: ${focus.isbn}` : '',
                    `Open Library: https://openlibrary.org/works/${focus.workId}`,
                    focus.readUrl ? `Read on Internet Archive: ${focus.readUrl}` : '',
                  ].filter(Boolean).join('\n')}
                  extraTags={['classroom', 'book', 'open-library', ...(focus.subjects || []).slice(0, 3).map((s) => s.toLowerCase().replace(/\s+/g, '-'))]}
                  rawData={focus}
                />
              </div>
              {focus.subjects && focus.subjects.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {focus.subjects.slice(0, 8).map((s) => (
                    <span key={s} className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400">{s}</span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <a href={`https://openlibrary.org/works/${focus.workId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-cyan-200 hover:bg-cyan-500/20"><ExternalLink className="h-3 w-3" /> Open Library</a>
                {focus.readUrl && (
                  <a href={focus.readUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-200 hover:bg-emerald-500/20"><BookOpen className="h-3 w-3" /> Read on archive.org</a>
                )}
                <button type="button" onClick={askAgentForPlan} disabled={agentBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-yellow-200 hover:bg-yellow-500/20 disabled:opacity-40">
                  {agentBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Ask agent for a week plan
                </button>
              </div>

              {agentReply && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-400"><Wand2 className="h-3 w-3" /> Week plan</div>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-200">{agentReply}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/60 pt-2">
                <Send className="h-3.5 w-3.5 shrink-0 text-pink-400" />
                <input
                  type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendDm()}
                  placeholder="DM this book to… (user id)"
                  className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white placeholder-zinc-600 focus:border-pink-500/40 focus:outline-none"
                />
                <button type="button" onClick={sendDm} disabled={dmBusy || !recipient.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-pink-500/30 bg-pink-500/10 px-2.5 py-1 text-[11px] text-pink-200 hover:bg-pink-500/20 disabled:opacity-40">
                  {dmBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
                </button>
                <RecallSlot ctl={dmRecall} />
              </div>
              <AnimatePresence>
                {dmFeedback && (
                  <motion.div key={dmFeedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
                    className={cn('flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px]', dmFeedback.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300')}>
                    {dmFeedback.kind === 'ok' ? <Check className="mt-0.5 h-3 w-3" /> : <AlertTriangle className="mt-0.5 h-3 w-3" />}
                    <span>{dmFeedback.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
