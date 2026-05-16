'use client';

/**
 * ThreadNodeActions — node-level action panel for the thread lens.
 * Mounts inside the right sidebar below the existing Fork/Copy/Link/
 * Delete bar; replaces the mock "Forking node..." toast with a real
 * dtu.create-with-lineage call plus 4 more paid-app-tier actions.
 *
 *   1. Pin (mint)       → dtu.create with this node's content as the
 *                          private DTU body (private; tagged thread)
 *   2. Branch via DTU   → dtu.create lineaging from the pin DTU to
 *                          start a counter / continuation thread
 *   3. DM this node     → /api/social/dm with node content + thread
 *                          link + author attribution
 *   4. Publish thread   → dtu.create public + flag published with the
 *                          whole thread's content (federation pickup)
 *   5. Synthesize (agent) → chat_agent.do "summarize this conversation
 *                          and surface the key turns" — renders inline
 */

import { useState } from 'react';
import {
  Pin, GitBranch, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ThreadNodeLike {
  id: string;
  parentId: string | null;
  content: string;
  author: 'user' | 'ai';
  depth: number;
  branchName?: string;
}

interface ThreadNodeActionsProps {
  node: ThreadNodeLike;
  threadName: string;
  threadId: string;
  /** Full flattened thread content for publish + synthesize actions. */
  threadFullContent: Array<{ id: string; author: 'user' | 'ai'; content: string }>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'pin' | 'branch' | 'dm' | 'publish' | 'synthesize';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function ThreadNodeActions({ node, threadName, threadId, threadFullContent }: ThreadNodeActionsProps) {
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [pinDtuId, setPinDtuId] = useState<string | null>(null);
  const [branchDtuId, setBranchDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [showDm, setShowDm] = useState(false);
  const [showSynth, setShowSynth] = useState(false);
  const [synthReply, setSynthReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  async function actPin() {
    setBusy('pin'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Pin — ${threadName} — node ${node.id.slice(0, 8)}`,
          tags: ['thread', 'pin', `author:${node.author}`, `thread:${threadId}`],
          source: 'thread:pin',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            threadNode: {
              threadId, threadName,
              nodeId: node.id,
              parentId: node.parentId,
              author: node.author,
              depth: node.depth,
              branchName: node.branchName,
              content: node.content,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setPinDtuId(id); ok(`Pinned as DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actBranch() {
    setBusy('branch'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Branch from ${threadName} — node ${node.id.slice(0, 8)}`,
          tags: ['thread', 'branch', `thread:${threadId}`],
          source: 'thread:branch',
          lineage: pinDtuId ? [pinDtuId] : [],
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            branchFrom: {
              threadId, threadName,
              parentNodeId: node.id,
              parentContent: node.content,
              parentAuthor: node.author,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setBranchDtuId(id); ok(`Branch DTU ${id.slice(0, 8)}… — extend via dtu.update.`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `💬 From thread "${threadName}"`,
      ``,
      `[${node.author === 'user' ? 'User' : 'AI'}${node.branchName ? ` · ${node.branchName}` : ''}]`,
      ``,
      node.content,
      ``,
      pinDtuId ? `[Pin DTU ${pinDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Node DMed to ${dmRecipient.trim()}.`); setDmRecipient(''); setShowDm(false); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const fullText = threadFullContent
        .map(n => `[${n.author === 'user' ? 'User' : 'AI'}] ${n.content}`)
        .join('\n\n');
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Thread: ${threadName}`,
          tags: ['thread', 'conversation', 'public', `thread:${threadId}`],
          source: 'thread:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            thread: {
              id: threadId,
              name: threadName,
              nodeCount: threadFullContent.length,
              transcript: fullText.slice(0, 50000),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Thread published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actSynthesize() {
    setBusy('synthesize'); setFeedback(null); setSynthReply(null);
    if (!showSynth) setShowSynth(true);
    try {
      const transcript = threadFullContent
        .map(n => `[${n.author === 'user' ? 'User' : 'AI'}] ${n.content}`)
        .join('\n\n');
      const task = [
        `Synthesize this conversation thread "${threadName}".`,
        `Return a plaintext brief: 1) what was decided/discovered;`,
        `2) the 2-3 key turning points (with quotes); 3) open questions.`,
        ``,
        `Transcript:`,
        transcript.slice(0, 8000),
      ].join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setSynthReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Synthesis ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean; sub?: string }> = [
    { id: 'pin',        label: pinDtuId ? 'Pinned' : 'Pin',                 icon: Pin,       accent: '#06b6d4', handler: actPin,       disabled: !!pinDtuId, sub: pinDtuId ?? undefined },
    { id: 'branch',     label: branchDtuId ? 'Branched' : 'Branch DTU',     icon: GitBranch, accent: '#8b5cf6', handler: actBranch,    disabled: !!branchDtuId, sub: branchDtuId ?? undefined },
    { id: 'dm',         label: 'DM node',                                    icon: Send,      accent: '#ec4899', handler: () => setShowDm(s => !s) },
    { id: 'publish',    label: publishedDtuId ? 'Published' : 'Publish',    icon: Globe,     accent: '#22c55e', handler: actPublish,   disabled: !!publishedDtuId, sub: publishedDtuId ?? undefined },
    { id: 'synthesize', label: 'Synthesize',                                 icon: Wand2,     accent: '#eab308', handler: actSynthesize },
  ];

  return (
    <div className="rounded-lg border border-neon-purple/20 bg-neon-purple/5 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-neon-purple" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neon-purple">Real actions</h4>
        <span className="text-[10px] text-gray-500 font-mono">node {node.id.slice(0, 8)}</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'flex flex-col items-center gap-1 p-2 rounded-md text-left border transition-colors',
                'bg-lattice-elevated/40 border-white/10',
                'hover:bg-lattice-elevated hover:border-white/20',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/40 disabled:hover:border-white/10',
              )}
              title={a.sub ?? a.label}
            >
              <div className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
              </div>
              <span className="text-[10px] font-medium text-gray-300 leading-tight text-center">{a.label}</span>
            </button>
          );
        })}
      </div>

      {/* DM inline input */}
      {showDm && (
        <div className="rounded-md border border-pink-400/30 bg-pink-400/5 p-2 space-y-1.5">
          <input
            type="text"
            value={dmRecipient}
            onChange={(e) => setDmRecipient(e.target.value)}
            className="w-full bg-lattice-elevated border border-pink-400/30 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40"
            placeholder="recipient user id"
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={actDm}
              disabled={!!busy || !dmRecipient.trim()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-pink-500 text-white text-[10px] font-semibold hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'dm' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
              Send DM
            </button>
            <button type="button" onClick={() => { setShowDm(false); setDmRecipient(''); }} className="text-[10px] text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Synthesis result */}
      {showSynth && synthReply && (
        <div className="rounded-md border border-yellow-400/30 bg-yellow-400/5 p-2 max-h-48 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1 uppercase tracking-wider text-[9px]">
            <Wand2 className="w-2.5 h-2.5" />
            Synthesis
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-gray-200 leading-relaxed">{synthReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn(
              'px-2 py-1.5 rounded text-[10px] flex items-start gap-1.5 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok' ? <Check className="w-2.5 h-2.5 mt-0.5" /> : <AlertTriangle className="w-2.5 h-2.5 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
