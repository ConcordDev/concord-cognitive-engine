'use client';

/**
 * WhiteboardActionPanel — session workbench.
 * Surfaces the board / vote / template / share macros plus mint/DM/
 * publish/agent. Designed to sit below the existing whiteboard canvas
 * as a session controls strip.
 */

import { useState, useEffect } from 'react';
import {
  Palette, Vote, FileSymlink, Share2, Save, FolderOpen,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Layout,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('whiteboard', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'template' | 'save' | 'vote' | 'tally' | 'share' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface Board { id: string; name: string; updatedAt?: string }
interface Template { id: string; name: string; description?: string }
interface TallyResult { question?: string; totalVotes?: number; optionTallies?: Array<{ option: string; count: number; pct: number }>; winner?: string }

export function WhiteboardActionPanel() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [boardName, setBoardName] = useState('');
  const [boardSnapshot, setBoardSnapshot] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [voteQ, setVoteQ] = useState('');
  const [voteOptions, setVoteOptions] = useState('');
  const [myVote, setMyVote] = useState('');
  const [shareWith, setShareWith] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [savedBoardId, setSavedBoardId] = useState<string | null>(null);
  const [tallyResult, setTallyResult] = useState<TallyResult | null>(null);
  const [shareResult, setShareResult] = useState<{ shareUrl?: string; sharedWith?: number } | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

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

  useEffect(() => {
    (async () => {
      try {
        const t = await callMacro<{ templates: Template[] }>('templates-list', {});
        if (t.ok && t.result?.templates) setTemplates(t.result.templates);
      } catch {/* dormant */}
      try {
        const b = await callMacro<{ boards: Board[] }>('board-list', {});
        if (b.ok && b.result?.boards) setBoards(b.result.boards);
      } catch {/* dormant */}
    })();
  }, []);

  async function actTemplate() {
    if (!templates.length) { err('No templates available.'); return; }
    setBusy('template'); setFeedback(null);
    const tpl = templates[0];
    try {
      const r = await callMacro<{ board: { name: string; shapes: unknown[] } }>('template-load', { templateId: tpl.id });
      if (r.ok && r.result?.board) {
        setBoardSnapshot(JSON.stringify(r.result.board, null, 2));
        setBoardName(r.result.board.name + ' (from template)');
        ok(`Loaded template: ${tpl.name}.`);
      } else err(r.error ?? 'template load failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actSave() {
    if (!boardName.trim()) { err('Board name required.'); return; }
    setBusy('save'); setFeedback(null);
    try {
      let snapshotData;
      try { snapshotData = JSON.parse(boardSnapshot); } catch { err('Invalid snapshot JSON.'); setBusy(null); return; }
      const r = await callMacro<{ boardId?: string }>('board-save', { name: boardName.trim(), snapshot: snapshotData });
      if (r.ok && r.result?.boardId) {
        setSavedBoardId(r.result.boardId);
        pipe.publish('whiteboard.boardId', r.result.boardId, { label: `board ${r.result.boardId.slice(0, 8)}` });
        ok(`Board saved ${r.result.boardId.slice(0, 8)}…`);
        // Refresh list
        const b = await callMacro<{ boards: Board[] }>('board-list', {});
        if (b.ok && b.result?.boards) setBoards(b.result.boards);
      } else err(r.error ?? 'save failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actVote() {
    if (!myVote.trim() || !voteQ.trim()) { err('Question + your vote required.'); return; }
    setBusy('vote'); setFeedback(null);
    try {
      const boardId = selectedBoardId || savedBoardId || 'session';
      const r = await callMacro<{ ok?: boolean; voteId?: string }>('vote-cast', { boardId, question: voteQ.trim(), choice: myVote.trim() });
      if (r.ok) { pipe.publish('whiteboard.vote', { question: voteQ.trim(), choice: myVote.trim() }, { label: myVote.trim() }); ok(`Vote cast for "${myVote.trim()}".`); }
      else err(r.error ?? 'vote failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actTally() {
    setBusy('tally'); setFeedback(null);
    try {
      const boardId = selectedBoardId || savedBoardId || 'session';
      const r = await callMacro<TallyResult>('vote-tally', { boardId, question: voteQ.trim() });
      if (r.ok && r.result) { setTallyResult(r.result); pipe.publish('whiteboard.tally', r.result, { label: `winner ${r.result.winner ?? '—'}` }); ok(`${r.result.totalVotes ?? 0} votes; winner: ${r.result.winner ?? '—'}.`); }
      else err(r.error ?? 'tally failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actShare() {
    if (!savedBoardId) { err('Save the board first.'); return; }
    if (!shareWith.trim()) { err('Enter user id(s) to share with (comma-separated).'); return; }
    setBusy('share'); setFeedback(null);
    try {
      const users = shareWith.split(',').map(s => s.trim()).filter(Boolean);
      const r = await callMacro<{ shareUrl?: string; sharedWith?: number }>('share-board', { boardId: savedBoardId, userIds: users });
      if (r.ok && r.result) { setShareResult(r.result); pipe.publish('whiteboard.share', r.result, { label: `shared with ${r.result.sharedWith ?? users.length}` }); ok(`Shared with ${r.result.sharedWith ?? users.length}.`); }
      else err(r.error ?? 'share failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Whiteboard — ${boardName.trim() || 'session'}`,
          tags: ['whiteboard', 'board'],
          source: 'whiteboard:board:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, board: { name: boardName, snapshot: boardSnapshot.slice(0, 8000), boardId: savedBoardId, voteResult: tallyResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('whiteboard.mintedDtuId', id, { label: `board ${id.slice(0, 8)}` }); ok(`Board DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🎨 Whiteboard: ${boardName.trim() || 'untitled'}`, '',
      tallyResult ? `Vote winner: ${tallyResult.winner} (${tallyResult.totalVotes} votes)` : '',
      shareResult?.shareUrl ? `Share URL: ${shareResult.shareUrl}` : '',
      mintedDtuId ? `\n[Board DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Public whiteboard — ${boardName.trim() || 'session'}`,
            tags: ['whiteboard', 'public'],
            source: 'whiteboard:board:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, board: { name: boardName, snapshot: boardSnapshot.slice(0, 8000), tally: tallyResult } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('whiteboard.publishedDtuId', id, { label: `board ${id.slice(0, 8)}` }); ok(`Board published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Whiteboard session summary:`,
        `Board: ${boardName || 'untitled'}.`,
        tallyResult ? `Vote on "${tallyResult.question}": ${tallyResult.totalVotes} votes, winner ${tallyResult.winner}.` : '',
        '',
        'Write a 3-sentence retro: what was decided, what was deferred, what to revisit next session. Plain text.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Retro ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'template', label: 'Template', desc: 'template-load first available',         icon: FileSymlink, accent: '#06b6d4', handler: actTemplate },
    { id: 'save',     label: savedBoardId ? 'Saved' : 'Save',  desc: savedBoardId ? `board ${savedBoardId.slice(0, 8)}…` : 'board-save snapshot', icon: Save, accent: '#22c55e', handler: actSave },
    { id: 'vote',     label: 'Vote',     desc: 'vote-cast your choice',                  icon: Vote,        accent: '#8b5cf6', handler: actVote },
    { id: 'tally',    label: 'Tally',    desc: 'vote-tally winner + breakdown',          icon: Layout,      accent: '#eab308', handler: actTally },
    { id: 'share',    label: shareResult ? 'Shared' : 'Share', desc: shareResult ? `${shareResult.sharedWith} users` : 'share-board with users', icon: Share2, accent: '#f97316', handler: actShare, disabled: !savedBoardId },
    { id: 'mint',     label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private board DTU',                       icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM',       desc: 'Send board + tally to user',             icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish',  desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public board DTU + federation',          icon: Globe,    accent: '#15803d', handler: actPublish },
    { id: 'agent',    label: 'Retro',    desc: 'Agent: 3-sentence session retro',        icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Palette className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Whiteboard session</h3>
        {templates.length > 0 && <span className="ml-auto text-[10px] text-zinc-400">{templates.length} templates · {boards.length} boards</span>}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="text" value={boardName} onChange={(e) => setBoardName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Board name" />
        <input type="text" value={voteQ} onChange={(e) => setVoteQ(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Vote question" />
        <textarea value={voteOptions} onChange={(e) => setVoteOptions(e.target.value)} rows={3} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-none" placeholder="Options (one per line)" />
        <select value={myVote} onChange={(e) => setMyVote(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          <option value="">— pick your vote —</option>
          {voteOptions.split('\n').filter(l => l.trim()).map(opt => <option key={opt} value={opt.trim()}>{opt.trim()}</option>)}
        </select>
        <input type="text" value={shareWith} onChange={(e) => setShareWith(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Share with (comma-separated user ids)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Board snapshot JSON</label>
        <textarea value={boardSnapshot} onChange={(e) => setBoardSnapshot(e.target.value)} rows={6} className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-[11px] text-violet-100 font-mono focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-y" />
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={a.disabled || !!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {boards.length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2 max-h-32 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5"><FolderOpen className="w-3 h-3" /> Saved boards</div>
          {boards.slice(0, 10).map(b => (
            <button key={b.id} onClick={() => setSelectedBoardId(b.id)} className={cn('block w-full text-left text-[11px] py-0.5 px-1 hover:bg-zinc-800 rounded', selectedBoardId === b.id ? 'text-violet-300 font-semibold' : 'text-zinc-300')}>
              <span className="font-mono text-zinc-400">{b.id.slice(0, 8)}</span> {b.name}
            </button>
          ))}
        </div>
      )}

      {tallyResult && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5"><Vote className="w-3 h-3" /> Vote tally ({tallyResult.totalVotes})</div>
          <div className="text-sm font-semibold text-zinc-100 mt-1">Winner: {tallyResult.winner}</div>
          {tallyResult.optionTallies?.map(o => (
            <div key={o.option} className="text-[11px] text-zinc-300 flex items-center justify-between">
              <span className={cn(o.option === tallyResult.winner && 'font-semibold text-yellow-200')}>{o.option}</span>
              <span className="font-mono">{o.count} ({o.pct}%)</span>
            </div>
          ))}
        </div>
      )}

      {shareResult?.shareUrl && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 text-[11px]">
          <Share2 className="w-3 h-3 inline text-orange-300" /> <span className="text-zinc-300">Share URL:</span> <code className="text-orange-200 font-mono">{shareResult.shareUrl}</code>
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Session retro</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed italic">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
