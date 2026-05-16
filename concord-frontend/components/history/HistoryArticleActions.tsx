'use client';

/**
 * HistoryArticleActions — Wikipedia / Britannica-shape action panel
 * surfaced inside the article reader when the user opens a page in
 * WikipediaExplorer. Each action wires a real Concord backend.
 *
 *   1. Cite article  → dtu.create with the article as lineage source
 *                     (private DTU citing the Wikipedia source so future
 *                     derivations carry the citation chain)
 *   2. DM article    → /api/social/dm with article title + extract +
 *                     pageUrl (recipient input inline)
 *   3. Study guide   → dtu.create kind=study-guide, first call starts
 *                     guide, subsequent calls append as lineage
 *   4. Publish brief → dtu.create public + allow_citations + flag
 *                     published in one shot (federation pickup)
 *   5. Research links → chat_agent.do "find connections between
 *                     {article} and {topic}" — renders inline
 */

import { useState } from 'react';
import {
  X, Send, Wand2, Globe, BookMarked, Quote,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface ArticleSummaryLike {
  title: string;
  displayTitle?: string;
  description?: string | null;
  extract: string;
  thumbnail?: string;
  pageUrl?: string;
  lang?: string;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type PaneId = 'cite' | 'dm' | 'guide' | 'publish' | 'connect';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function HistoryArticleActions({ article }: { article: ArticleSummaryLike }) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<PaneId>('cite');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [citeDtuId, setCiteDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [dmBody, setDmBody] = useState(
    `📖 ${article.displayTitle || article.title}\n\n${article.extract.slice(0, 220)}${article.extract.length > 220 ? '…' : ''}\n\n${article.pageUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`}`,
  );
  const [guideDtuId, setGuideDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [connectTopic, setConnectTopic] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const sourceUrl = article.pageUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;

  async function actCite() {
    setBusy('cite'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Citing ${article.title}`,
          tags: ['history', 'wikipedia', 'citation'],
          source: 'history:cite',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            citation: { title: article.title, url: sourceUrl, lang: article.lang ?? 'en' },
            extract: article.extract.slice(0, 1000),
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setCiteDtuId(id); ok(`Cited as DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!dmRecipient.trim() || !dmBody.trim()) { err('Recipient + body required.'); return; }
    setBusy('dm'); setFeedback(null);
    try {
      const r = await api.post('/api/social/dm', {
        toUserId: dmRecipient.trim(),
        content: dmBody.trim(),
      });
      if (r.data?.ok !== false) { ok(`Sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actGuide() {
    setBusy('guide'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: guideDtuId
            ? `Added to study guide: ${article.title}`
            : `Study guide (${new Date().toISOString().slice(0, 10)})`,
          tags: ['history', 'study-guide', 'wikipedia'],
          source: 'history:study-guide',
          lineage: guideDtuId ? [guideDtuId] : [],
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            article: { title: article.title, url: sourceUrl, description: article.description ?? null },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) {
        if (!guideDtuId) setGuideDtuId(id);
        ok(guideDtuId ? 'Appended to study guide.' : `Guide started: ${id.slice(0, 8)}…`);
      } else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Brief: ${article.title}`,
          tags: ['history', 'brief', 'public'],
          source: 'history:brief:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            article: { title: article.title, url: sourceUrl, description: article.description ?? null },
            extract: article.extract.slice(0, 2000),
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) {
        setPublishedDtuId(id);
        ok(`Brief published as DTU ${id.slice(0, 8)}…`);
      } else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actConnect() {
    if (!connectTopic.trim()) { err('Enter a topic to connect.'); return; }
    setBusy('connect'); setFeedback(null); setAgentReply(null);
    try {
      const task =
        `Find historical connections between "${article.title}" and "${connectTopic.trim()}". ` +
        `Return a short brief of the strongest 2–3 connections (shared cause, sequence, person/place, ` +
        `or thematic link). Use neutral encyclopaedic tone.`;
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent',
        name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Agent finished.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 transition-colors"
      >
        <Wand2 className="h-3 w-3" />
        Article actions
      </button>
    );
  }

  const panes: { id: PaneId; label: string; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
    { id: 'cite',    label: 'Cite',    icon: Quote,      accent: '#06b6d4' },
    { id: 'dm',      label: 'DM',      icon: Send,       accent: '#ec4899' },
    { id: 'guide',   label: 'Guide',   icon: BookMarked, accent: '#8b5cf6' },
    { id: 'publish', label: 'Publish', icon: Globe,      accent: '#22c55e' },
    { id: 'connect', label: 'Connect', icon: Wand2,      accent: '#eab308' },
  ];

  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-zinc-950/80 overflow-hidden">
      <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/5 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold flex items-center gap-1.5">
          <Wand2 className="h-3 w-3" /> Article actions
        </span>
        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200" aria-label="Close actions">
          <X className="h-3 w-3" />
        </button>
      </div>

      <nav className="flex items-center border-b border-zinc-800 overflow-x-auto">
        {panes.map(p => {
          const Icon = p.icon;
          const active = pane === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { setPane(p.id); setFeedback(null); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap',
                active ? '' : 'border-transparent text-zinc-500 hover:text-zinc-200',
              )}
              style={active ? { borderBottomColor: p.accent, color: p.accent } : {}}
            >
              <Icon className="h-3 w-3" />
              {p.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 min-h-[140px] space-y-2">
        {pane === 'cite' && (
          <>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Mint a private citation DTU. Any future derivation that lineages from it carries the
              Wikipedia source forward through the royalty cascade.
            </p>
            {citeDtuId ? (
              <div className="px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-1.5">
                <Check className="h-3 w-3" /> Cited DTU <span className="font-mono">{citeDtuId.slice(0, 10)}…</span>
              </div>
            ) : (
              <button
                type="button" onClick={actCite} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500 text-white text-[11px] font-semibold hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'cite' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Quote className="h-3 w-3" />}
                Cite this article
              </button>
            )}
          </>
        )}

        {pane === 'dm' && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Recipient</label>
              <input
                type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40"
                placeholder="username or user id" autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Message</label>
              <textarea
                value={dmBody} onChange={(e) => setDmBody(e.target.value)} rows={4}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-pink-400/40 resize-none"
              />
            </div>
            <button
              type="button" onClick={actDm} disabled={!!busy || !dmRecipient.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-pink-500 text-white text-[11px] font-semibold hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'dm' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send DM
            </button>
          </>
        )}

        {pane === 'guide' && (
          <>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              First click starts your private study guide DTU. Subsequent clicks append as lineage so all
              referenced articles trace back to the guide root.
            </p>
            <button
              type="button" onClick={actGuide} disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-500 text-white text-[11px] font-semibold hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'guide' ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookMarked className="h-3 w-3" />}
              {guideDtuId ? 'Append to guide' : 'Start a study guide'}
            </button>
            {guideDtuId && (
              <div className="px-2 py-1.5 rounded bg-purple-500/10 border border-purple-500/30 text-[11px] text-purple-300 flex items-center gap-1.5">
                <BookMarked className="h-3 w-3" /> Guide <span className="font-mono">{guideDtuId.slice(0, 10)}…</span>
              </div>
            )}
          </>
        )}

        {pane === 'publish' && (
          <>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Mints a <span className="text-emerald-300 font-semibold">public</span> brief DTU with the
              first 2000 chars of the article extract + a citation link, then flags it published so
              federation peers can pick it up.
            </p>
            {publishedDtuId ? (
              <div className="px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-1.5">
                <Check className="h-3 w-3" /> Published <span className="font-mono">{publishedDtuId.slice(0, 10)}…</span>
              </div>
            ) : (
              <button
                type="button" onClick={actPublish} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 text-white text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'publish' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                Publish public brief
              </button>
            )}
          </>
        )}

        {pane === 'connect' && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Connect to topic</label>
              <input
                type="text" value={connectTopic} onChange={(e) => setConnectTopic(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40"
                placeholder="another article, person, or theme"
              />
            </div>
            <button
              type="button" onClick={actConnect} disabled={!!busy || !connectTopic.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-yellow-500 text-black text-[11px] font-semibold hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'connect' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              Find connections
            </button>
            {agentReply && (
              <div className="mt-2 px-2.5 py-2 rounded bg-yellow-500/5 border border-yellow-500/30 text-[11px] text-zinc-200 max-h-56 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentReply}</pre>
              </div>
            )}
          </>
        )}

        <AnimatePresence>
          {feedback && (
            <motion.div
              key={feedback.text}
              initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
              className={cn(
                'px-2 py-1.5 rounded text-[11px] flex items-start gap-1.5 border',
                feedback.kind === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-300 border-red-500/30',
              )}
            >
              {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
              <span>{feedback.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
