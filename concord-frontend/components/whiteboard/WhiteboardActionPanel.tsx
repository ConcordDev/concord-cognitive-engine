'use client';

/**
 * WhiteboardActionPanel — session workbench.
 * Surfaces the board / vote / template / share macros plus mint/DM/
 * publish/agent. Designed to sit below the existing whiteboard canvas
 * as a session controls strip.
 */

import { useState, useEffect, useRef } from 'react';
import {
  Palette, Vote, FileSymlink, Share2, Save, FolderOpen,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Layout,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';

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
interface AccessGrant { granteeId: string; username: string | null; level: string; grantedAt: string }
interface SharedBoardEntry { id: string; title: string; ownerName: string | null; level: string }
type ActionId = 'template' | 'save' | 'vote' | 'tally' | 'share' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface Board { id: string; title: string; updatedAt?: string }
interface Template { id: string; name: string; elementCount?: number }
interface TallyResult { question?: string; totalVotes?: number; optionTallies?: Array<{ option: string; count: number; pct: number }>; winner?: string }

// vote-cast/vote-tally are per-canvas-element (a sticky note gets votes),
// not a "question with named text options" poll — there is no such macro
// in the whiteboard domain. This panel's Vote/Tally UI is option-text based,
// so options are mapped onto deterministic synthetic elementIds scoped to
// the question text; tally then filters the board's full vote-tally result
// down to just this question's option ids and re-aggregates client-side.
// This keeps every number real (backed by the real per-user vote ledger)
// without inventing a text-poll macro that doesn't exist server-side.
function optionElementId(question: string, option: string): string {
  const raw = `${question.trim().toLowerCase()}::${option.trim().toLowerCase()}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `poll_${Math.abs(h).toString(36)}`;
}

export function WhiteboardActionPanel() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [boardName, setBoardName] = useState('');
  const [boardSnapshot, setBoardSnapshot] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [voteQ, setVoteQ] = useState('');
  const [voteOptions, setVoteOptions] = useState('');
  const [myVote, setMyVote] = useState('');
  const [inviteQuery, setInviteQuery] = useState('');
  const [candidates, setCandidates] = useState<Array<{ id: string; username: string }>>([]);
  const [inviteLevel, setInviteLevel] = useState<'view' | 'edit'>('view');
  const [accessGrants, setAccessGrants] = useState<AccessGrant[] | null>(null);
  const [sharedWithMe, setSharedWithMe] = useState<SharedBoardEntry[]>([]);
  const inviteInputRef = useRef<HTMLInputElement | null>(null);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [savedBoardId, setSavedBoardId] = useState<string | null>(null);
  const [tallyResult, setTallyResult] = useState<TallyResult | null>(null);
  const [shareResult, setShareResult] = useState<{ sharedBoardId?: string; sharedWith?: number; participants?: string[] } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
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


  // ── S14 follow-up: platform-ACL membership ──────────────────────
  async function loadAccess(boardId: string) {
    try {
      const r = await callMacro<{ level: string; grants?: AccessGrant[] }>('board-access', { boardId });
      setAccessGrants(r.ok && r.result ? (r.result.grants ?? null) : null);
    } catch { setAccessGrants(null); }
  }
  async function loadSharedWithMe() {
    try {
      const r = await callMacro<{ boards: SharedBoardEntry[] }>('board-shared-with-me', {});
      if (r.ok && r.result?.boards) setSharedWithMe(r.result.boards);
    } catch { /* dormant */ }
  }
  useEffect(() => { void loadSharedWithMe(); }, []);
  useEffect(() => {
    if (savedBoardId) void loadAccess(savedBoardId);
    else setAccessGrants(null);
  }, [savedBoardId]);
  useEffect(() => {
    const q = inviteQuery.trim();
    if (q.length < 2) { setCandidates([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/api/social/users/search', { params: { q } });
        const users = (res as { data?: { users?: Array<{ id: string; username: string }> } }).data?.users;
        if (live && Array.isArray(users)) setCandidates(users.slice(0, 6));
      } catch { if (live) setCandidates([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [inviteQuery]);

  async function actInvite(candidate: { id: string; username: string }) {
    if (!savedBoardId) { err('Save the board first.'); return; }
    setBusy('share'); setFeedback(null);
    try {
      const r = await callMacro<{ grant?: { level: string } }>('board-grant', { boardId: savedBoardId, granteeId: candidate.id, level: inviteLevel });
      if (r.ok) {
        ok(`${candidate.username} can now ${inviteLevel === 'edit' ? 'edit' : 'view'} this board.`);
        setInviteQuery(''); setCandidates([]);
        await loadAccess(savedBoardId);
      } else err(r.error ?? 'invite failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actRevoke(granteeId: string, label: string) {
    if (!savedBoardId) return;
    setBusy('share'); setFeedback(null);
    try {
      const r = await callMacro<{ revoked: boolean }>('board-revoke', { boardId: savedBoardId, granteeId });
      if (r.ok) { ok(`Access removed for ${label}.`); await loadAccess(savedBoardId); }
      else err(r.error ?? 'revoke failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actSetLevel(granteeId: string, label: string, level: 'view' | 'edit') {
    if (!savedBoardId) return;
    setBusy('share'); setFeedback(null);
    try {
      const r = await callMacro<{ grant?: { level: string } }>('board-grant', { boardId: savedBoardId, granteeId, level });
      if (r.ok) { ok(`${label} can now ${level === 'edit' ? 'edit' : 'view'} this board.`); await loadAccess(savedBoardId); }
      else err(r.error ?? 'access change failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  function actShareFocus() {
    if (!savedBoardId) { err('Save the board first.'); return; }
    void loadAccess(savedBoardId);
    inviteInputRef.current?.focus();
    ok('Invite by name above — pick who can view or edit this board.');
  }

  async function actTemplate() {
    if (!templates.length) { err('No templates available.'); return; }
    setBusy('template'); setFeedback(null);
    const tpl = templates[0];
    try {
      // template-load takes { id } and returns { template: { id, name, elements } }
      // — not { templateId } / { board: { shapes } } as this used to send/read.
      const r = await callMacro<{ template: { name: string; elements: unknown[] } }>('template-load', { id: tpl.id });
      if (r.ok && r.result?.template) {
        setBoardSnapshot(JSON.stringify({ elements: r.result.template.elements, appState: {} }, null, 2));
        setBoardName(r.result.template.name + ' (from template)');
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
      // board-save takes { id?, title, scene } and returns { board } — NOT
      // { name, snapshot } / { boardId } as this used to send/read (those
      // keys don't exist on either side, so every save silently persisted an
      // empty "Untitled board" while reporting "save failed" to the user).
      const r = await callMacro<{ board?: { id: string } }>('board-save', {
        id: savedBoardId || undefined, title: boardName.trim(), scene: snapshotData,
      });
      const boardId = r.result?.board?.id;
      if (r.ok && boardId) {
        setSavedBoardId(boardId);
        pipe.publish('whiteboard.boardId', boardId, { label: `board ${boardId.slice(0, 8)}` });
        ok(`Board saved ${boardId.slice(0, 8)}…`);
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
      // vote-cast is per-element ({ boardId, elementId }), not per-question-
      // text — map this question+choice onto a deterministic synthetic
      // elementId so the real per-user vote ledger backs this poll UI.
      const elementId = optionElementId(voteQ, myVote);
      const r = await callMacro<{ voteCount?: number }>('vote-cast', { boardId, elementId });
      if (r.ok) { pipe.publish('whiteboard.vote', { question: voteQ.trim(), choice: myVote.trim() }, { label: myVote.trim() }); ok(`Vote cast for "${myVote.trim()}".`); }
      else err(r.error ?? 'vote failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actTally() {
    if (!voteQ.trim()) { err('Enter the vote question first.'); return; }
    setBusy('tally'); setFeedback(null);
    try {
      const boardId = selectedBoardId || savedBoardId || 'session';
      const options = voteOptions.split('\n').map(o => o.trim()).filter(Boolean);
      if (options.length === 0) { err('Enter at least one option.'); setBusy(null); return; }
      // vote-tally returns every voted-on elementId for the board — filter
      // down to just this question's options (matched by the same
      // deterministic id derivation actVote used) and re-aggregate.
      const r = await callMacro<{ tally: Array<{ elementId: string; count: number }>; total: number }>('vote-tally', { boardId });
      if (r.ok && r.result) {
        const byElementId = new Map(r.result.tally.map(t => [t.elementId, t.count]));
        const counts = options.map(option => ({ option, count: byElementId.get(optionElementId(voteQ, option)) || 0 }));
        const totalVotes = counts.reduce((s, c) => s + c.count, 0);
        const winner = counts.reduce((best, c) => (c.count > best.count ? c : best), counts[0]);
        const optionTallies = counts.map(c => ({ ...c, pct: totalVotes > 0 ? Math.round((c.count / totalVotes) * 100) : 0 }));
        const result: TallyResult = { question: voteQ.trim(), totalVotes, optionTallies, winner: totalVotes > 0 ? winner.option : undefined };
        setTallyResult(result);
        pipe.publish('whiteboard.tally', result, { label: `winner ${result.winner ?? '—'}` });
        ok(`${totalVotes} votes; winner: ${result.winner ?? '—'}.`);
      } else err(r.error ?? 'tally failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actSessionCopy() {
    if (!savedBoardId) { err('Save the board first.'); return; }
    setBusy('share'); setFeedback(null);
    try {
      // share-board promotes a live session copy (found under Collab →
      // Shared); access to the board itself is the ACL membership
      // above, not this. The copy starts with the owner as its only
      // participant — people join the session from the Shared tab.
      const r = await callMacro<{ board?: { id: string; participants?: string[] }; sharedWith?: number }>('share-board', { id: savedBoardId, userIds: [] });
      if (r.ok && r.result) {
        setShareResult({ sharedWith: r.result.sharedWith ?? 0, sharedBoardId: r.result.board?.id, participants: r.result.board?.participants });
        ok('Live session copy started — participants join it under Collab → Shared.');
      } else err(r.error ?? 'session start failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: withContentLicense({
          title: `Whiteboard — ${boardName.trim() || 'session'}`,
          tags: ['whiteboard', 'board'],
          source: 'whiteboard:board:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, board: { name: boardName, snapshot: boardSnapshot.slice(0, 8000), boardId: savedBoardId, voteResult: tallyResult } },
        }, 'knowledge', ['private']),
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
      shareResult?.sharedBoardId ? `Shared board: ${shareResult.sharedBoardId} (find it under Collab → Shared)` : '',
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
          input: withContentLicense({
            title: `Public whiteboard — ${boardName.trim() || 'session'}`,
            tags: ['whiteboard', 'public'],
            source: 'whiteboard:board:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, board: { name: boardName, snapshot: boardSnapshot.slice(0, 8000), tally: tallyResult } },
          }, 'knowledge', ['private', 'public_view', 'social_post']),
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
      // S7: the retro task carries the board's actual notes. Before,
      // it named the board and nothing else \u2014 on a fresh session the
      // agent had literally nothing to summarize and returned empty.
      const retroBoardId = selectedBoardId || savedBoardId;
      let notes: string[] = [];
      if (retroBoardId) {
        const loaded = await lensRun({ domain: 'whiteboard', action: 'board-load', input: { id: retroBoardId } });
        const els = (loaded.data?.result?.board?.scene?.elements || []) as Array<{ kind?: string; type?: string; text?: string }>;
        notes = els.filter((el) => (el.kind === 'sticky' || el.type === 'notecard') && el.text).map((el) => String(el.text)).slice(0, 12);
      }
      if (notes.length === 0 && !tallyResult) {
        err(retroBoardId
          ? 'Nothing to retro yet \u2014 this board has no notes and no vote tally. Add stickies first, or run a vote.'
          : 'Save the board in this tab first (Save board), then run the retro.');
        return;
      }
      const task = [
        `Whiteboard session summary:`,
        `Board: ${boardName || 'untitled'}.`,
        notes.length ? `Notes: ${notes.join(' | ')}` : '',
        tallyResult ? `Vote on \"${tallyResult.question}\": ${tallyResult.totalVotes} votes, winner ${tallyResult.winner}.` : '',
        '',
        'Write a 3-sentence retro: what was decided, what was deferred, what to revisit next session. Plain text.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.answer ?? r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
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
    { id: 'share',    label: 'Share', desc: accessGrants ? (accessGrants.length ? `${accessGrants.length} ${accessGrants.length === 1 ? 'person has' : 'people have'} access` : 'only you — invite by name') : 'invite by name · view or edit', icon: Share2, accent: '#f97316', handler: actShareFocus, disabled: !savedBoardId },
    { id: 'mint',     label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private board DTU',                       icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM',       desc: 'Send board + tally to user',             icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish',  desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public board DTU + federation',          icon: Globe,    accent: '#15803d', handler: actPublish },
    { id: 'agent',    label: 'Retro',    desc: 'Agent: 3-sentence session retro',        icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-violet-500/20 bg-lattice-void/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Palette className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Whiteboard session</h3>
        {templates.length > 0 && <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{templates.length} templates · {boards.length} boards</span>}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="text" value={boardName} onChange={(e) => setBoardName(e.target.value)} className="bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[12px] text-white" placeholder="Board name" />
        <input type="text" value={voteQ} onChange={(e) => setVoteQ(e.target.value)} className="md:col-span-2 bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[12px] text-white" placeholder="Vote question" />
        <textarea value={voteOptions} onChange={(e) => setVoteOptions(e.target.value)} rows={3} className="md:col-span-2 bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-none" placeholder="Options (one per line)" />
        <select value={myVote} onChange={(e) => setMyVote(e.target.value)} className="bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[11px] text-white">
          <option value="">— pick your vote —</option>
          {voteOptions.split('\n').filter(l => l.trim()).map(opt => <option key={opt} value={opt.trim()}>{opt.trim()}</option>)}
        </select>
        <div className="relative">
          <input ref={inviteInputRef} type="text" value={inviteQuery} onChange={(e) => setInviteQuery(e.target.value)} aria-label="Invite by name" className="w-full bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[11px] text-white" placeholder="Invite by name…" />
          {candidates.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-lattice-border bg-lattice-surface shadow-lg">
              {candidates.map(c => (
                <button key={c.id} type="button" onClick={() => void actInvite(c)} className="block w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-lattice-elevated">
                  Invite <span className="font-semibold text-white">{c.username}</span> · can {inviteLevel}
                </button>
              ))}
            </div>
          )}
        </div>
        <select value={inviteLevel} onChange={(e) => setInviteLevel(e.target.value as 'view' | 'edit')} aria-label="Access level for the invite" className="bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[11px] text-white">
          <option value="view">Can view</option>
          <option value="edit">Can edit</option>
        </select>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 block">Board snapshot JSON</label>
        <textarea value={boardSnapshot} onChange={(e) => setBoardSnapshot(e.target.value)} rows={6} className="w-full bg-lattice-void border border-lattice-border rounded px-3 py-2 text-[11px] text-violet-100 font-mono focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-y" />
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={a.disabled || isBusy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-lattice-surface/40 border-lattice-border hover:bg-lattice-elevated/60 hover:border-white/20', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-gray-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-gray-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {boards.length > 0 && (
        <div className="rounded-md border border-lattice-border bg-lattice-surface/30 p-2 max-h-32 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5"><FolderOpen className="w-3 h-3" /> Saved boards</div>
          {boards.slice(0, 10).map(b => (
            <button key={b.id} onClick={() => setSelectedBoardId(b.id)} className={cn('block w-full text-left text-[11px] py-0.5 px-1 hover:bg-lattice-elevated rounded', selectedBoardId === b.id ? 'text-violet-300 font-semibold' : 'text-gray-300')}>
              <span className="font-mono text-gray-400">{b.id.slice(0, 8)}</span> {b.title}
            </button>
          ))}
        </div>
      )}

      {sharedWithMe.length > 0 && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2 max-h-32 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5"><Share2 className="w-3 h-3" /> Shared with you</div>
          {sharedWithMe.map(b => (
            <button key={b.id} onClick={() => setSelectedBoardId(b.id)} className={cn('block w-full text-left text-[11px] py-0.5 px-1 hover:bg-orange-500/10 rounded', selectedBoardId === b.id ? 'text-violet-300 font-semibold' : 'text-gray-300')}>
              <span className="font-mono text-gray-400">{b.id.slice(0, 8)}</span> {b.title} <span className="text-orange-300">· shared by {b.ownerName ?? 'the owner'} · can {b.level}</span>
            </button>
          ))}
          {sharedWithMe.filter(b => b.id === selectedBoardId && b.level === 'view').map(b => (
            <div key={b.id} className="text-[11px] text-gray-400 mt-1">View only — {b.ownerName ?? 'the owner'} shared this board with you. You can open and read it; saving is disabled.</div>
          ))}
        </div>
      )}

      {tallyResult && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5"><Vote className="w-3 h-3" /> Vote tally (<span className="tabular-nums">{tallyResult.totalVotes}</span>)</div>
          <div className="text-sm font-semibold text-gray-100 mt-1">Winner: {tallyResult.winner}</div>
          {tallyResult.optionTallies?.map(o => (
            <div key={o.option} className="text-[11px] text-gray-300 flex items-center justify-between">
              <span className={cn(o.option === tallyResult.winner && 'font-semibold text-yellow-200')}>{o.option}</span>
              <span className="font-mono tabular-nums">{o.count} ({o.pct}%)</span>
            </div>
          ))}
        </div>
      )}

      {savedBoardId && accessGrants !== null && (
        <div className="rounded-md border border-lattice-border bg-lattice-surface/30 p-2.5 text-[11px] space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">People with access</div>
          {accessGrants.length === 0 && <div className="text-gray-400">Only you. Invite someone by name above to share this board.</div>}
          {accessGrants.map(g => (
            <div key={g.granteeId} className="flex items-center gap-2">
              <span className="text-gray-200 font-medium">{g.username ?? g.granteeId.slice(0, 8)}</span>
              <select value={g.level} onChange={(e) => void actSetLevel(g.granteeId, g.username ?? 'That person', e.target.value as 'view' | 'edit')} aria-label={`Access level for ${g.username ?? g.granteeId}`} className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-0.5 text-[11px] text-white">
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
              <span className="text-gray-500">since {String(g.grantedAt).slice(0, 10)}</span>
              <button type="button" onClick={() => void actRevoke(g.granteeId, g.username ?? 'that person')} className="ml-auto px-1.5 py-0.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10">Revoke</button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => void actSessionCopy()} className="px-2 py-1 rounded border border-orange-500/40 text-orange-200 hover:bg-orange-500/10">Start a live session copy</button>
            <span className="text-gray-500">Sessions are live collab copies under Collab → Shared — access to this board itself is the list above.</span>
          </div>
        </div>
      )}

      {shareResult && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 text-[11px] space-y-1.5">
          <div>
            <Share2 className="w-3 h-3 inline text-orange-300" /> <span className="text-gray-300">Session board </span>
            <code className="text-orange-200 font-mono">{shareResult.sharedBoardId}</code>
            <button type="button"
              onClick={() => { void navigator.clipboard?.writeText(shareResult.sharedBoardId || ''); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); }}
              className="ml-2 px-1.5 py-0.5 rounded border border-orange-500/40 text-orange-200 hover:bg-orange-500/10">
              {shareCopied ? 'Copied ✓' : 'Copy ID'}
            </button>
          </div>
          {shareResult.participants && shareResult.participants.length > 0 && (
            <div className="text-gray-400">Participants: {shareResult.participants.join(', ')}</div>
          )}
          <div className="text-gray-400">This is a live session copy — people join it under Collab → Shared and every participant can edit the copy. Access to the board itself is managed under “People with access” above.</div>
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Session retro</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-gray-200 leading-relaxed italic">{agentReply}</pre>
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
