'use client';

/**
 * AnswerActionPanel — Perplexity / MasterClass-shape action surface for
 * the expert-mode lens. Mounts under a returned answer + sources;
 * exposes 5 paid-app-tier actions wiring real Concord backends.
 *
 *   1. Save Q+A         → dtu.create with question + answer + sources
 *                          as lineage (private; tags=[expert-mode])
 *   2. Extract citations → expert_mode.extract_citations macro
 *   3. DM colleague     → /api/social/dm with question + answer +
 *                          source list
 *   4. Publish answer   → dtu.create public + cite + flag published
 *   5. Follow-up (agent) → chat_agent.do "next question + reasoning"
 */

import { useState } from 'react';
import {
  Sparkles, Quote, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface SourceLike {
  idx: number; id: string; title: string;
  creatorId: string; scope: string;
}

interface AnswerActionPanelProps {
  query: string;
  answer: string;
  sources: SourceLike[];
  provider?: string;
  model?: string;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'save' | 'extract' | 'dm' | 'publish' | 'followup';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ExtractResult { citations?: Array<{ chip: string; sourceIdx: number }>; total?: number }

export function AnswerActionPanel({ query, answer, sources, provider, model }: AnswerActionPanelProps) {
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [recipient, setRecipient] = useState('');
  const [followupReply, setFollowupReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actSave() {
    setBusy('save'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Q+A — ${query.slice(0, 60)}${query.length > 60 ? '…' : ''}`,
          tags: ['expert-mode', 'qa', 'cited'],
          source: 'expert-mode:qa:save',
          lineage: sources.map(s => s.id),
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            qa: {
              query, answer,
              sources: sources.map(s => ({ idx: s.idx, id: s.id, title: s.title, creatorId: s.creatorId, scope: s.scope })),
              provider, model,
              capturedAt: new Date().toISOString(),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSavedDtuId(id); pipe.publish('expert.savedDtuId', id, { label: `Saved DTU ${id.slice(0, 8)}…` }); ok(`Saved DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actExtract() {
    setBusy('extract'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'expert_mode', name: 'extract_citations',
        input: { answer, sources },
      });
      const result = (r.data?.result ?? r.data) as ExtractResult;
      if (result) {
        setExtractResult(result);
        ok(`${result.total ?? result.citations?.length ?? 0} citation chips extracted.`);
      } else err('No result.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🎓 Expert-mode answer`,
      ``,
      `Q: ${query}`,
      ``,
      answer,
      ``,
      sources.length ? `Sources:\n${sources.map(s => `  [${s.idx}] ${s.title} — ${s.creatorId}`).join('\n')}` : '',
      savedDtuId ? `\n[DTU ${savedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok(`Sent to ${recipient.trim()}. 60s to recall.`); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', {
          domain: 'dtu', name: 'create',
          input: {
            title: `Cited answer — ${query.slice(0, 60)}${query.length > 60 ? '…' : ''}`,
            tags: ['expert-mode', 'qa', 'cited', 'public'],
            source: 'expert-mode:qa:publish',
            lineage: sources.map(s => s.id),
            meta: { visibility: 'public', consent: { allowCitations: true }, qa: { query, answer, sourceCount: sources.length, provider, model } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('expert.publishedDtuId', id, { label: `Public answer ${id.slice(0, 8)}…` }); ok(`Answer published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actFollowup() {
    setBusy('followup'); setFeedback(null); setFollowupReply(null);
    try {
      const task = [
        `Original question: "${query}".`,
        `Original answer: ${answer.slice(0, 800)}.`,
        ``,
        `Propose the single best follow-up question that pushes the inquiry one level deeper.`,
        `Return just the question text, plain, no preamble. Then on a new line, one sentence`,
        `explaining why this is the right next step.`,
      ].join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setFollowupReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Follow-up ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'save',     label: savedDtuId      ? 'Saved'     : 'Save Q+A',         desc: savedDtuId      ? `DTU ${savedDtuId.slice(0, 8)}…`      : 'Private DTU lineaging from cited sources',         icon: Sparkles, accent: '#06b6d4', handler: actSave,     disabled: !!savedDtuId },
    { id: 'extract',  label: 'Extract chips', desc: 'Run expert_mode.extract_citations',                                                       icon: Quote,    accent: '#8b5cf6', handler: actExtract },
    { id: 'dm',       label: 'DM colleague', desc: 'Send full answer + source list',                                                            icon: Send,     accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish answer',   desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public DTU + federation pickup',                  icon: Globe,    accent: '#22c55e', handler: actPublish,  disabled: !!publishedDtuId },
    { id: 'followup', label: 'Follow-up',     desc: 'Agent proposes the next-best question',                                                    icon: Wand2,    accent: '#eab308', handler: actFollowup },
  ];

  return (
    <div className="mt-6 rounded-lg border border-amber-500/20 bg-zinc-900/40 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Answer actions</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          perplexity-shape
        </span>
        <span className="ml-auto text-[10px] text-zinc-500 font-mono">
          {sources.length} source{sources.length === 1 ? '' : 's'}
        </span>
      </header>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (optional)</label>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="colleague user id" />
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id} type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-950/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-950/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-amber-400/40',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {extractResult?.citations?.length ? (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
            <Quote className="w-3 h-3" /> Citation chips ({extractResult.total ?? extractResult.citations.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {extractResult.citations.slice(0, 30).map((c, i) => (
              <span key={i} className="rounded bg-purple-500/20 text-purple-300 px-1.5 py-0.5 text-[10px] font-mono">
                {c.chip} → [{c.sourceIdx}]
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {followupReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Follow-up
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{followupReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn(
              'px-3 py-2 rounded text-[11px] flex items-start gap-2 border',
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
  );
}
