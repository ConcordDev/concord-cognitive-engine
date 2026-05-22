'use client';

/**
 * CollabActionPanel — team facilitator bench.
 * sessionAnalytics / contributionScore / detectConsensus / balanceWorkload +
 * mint/DM/publish/agent.
 *
 * Max-polish pass: structured row editors instead of JSON textareas, pipe
 * publish/import for cross-panel hand-off, recall-window on DM + publish.
 */

import { useState } from 'react';
import { Users, Trophy, Vote, Scale, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  StructuredArrayEditor,
  type ColumnSpec,
  usePipe,
  PipeImporter,
  useRecallableAction,
  RecallSlot,
  LoadFromSubstrate,
} from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('collab', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'session' | 'contrib' | 'consensus' | 'load' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

// ── Row shapes (replace JSON textareas) ────────────────────────────────────
interface MsgRow { author: string; content: string }
interface ContribRow { name: string; type: string; quality: number; count: number }
interface VoteRow { voter: string; position: string }
interface MemberRow { name: string; capacityHours: number }
interface TaskRow { assignee: string; hours: number }

interface PStat { name: string; messages: number; wordCount: number; avgWordsPerMessage: number; sharePercent: number }
interface SessionResult { totalMessages: number; totalParticipants: number; durationMinutes: number; messagesPerMinute: number; participantStats: PStat[]; participationBalance: number; balanceRating: string }
interface Rank { name: string; totalScore: number; contributions: number }
interface ContribResult { rankings: Rank[]; totalContributions: number; topContributor: string }
interface ConsResult { totalVotes: number; tally: Record<string, number>; leadingPosition: string; consensusPercent: number; hasConsensus: boolean; hasSupermajority: boolean; status: string; dissenting?: { position: string; count: number; percent: number }[] }
interface MemberLoad { name: string; assignedTasks: number; totalHours: number; capacity: number; utilization: number; status: string }
interface LoadResult { members: MemberLoad[]; unassignedTasks: number; overloadedMembers: number; suggestions: string[]; avgUtilization: number }

// No seeded examples — every row in these editors comes from real user
// input or from a Load-from-substrate fetch against a live backend endpoint.
interface CollabWorkspace { id: string; name?: string; members?: { userId: string; role?: string }[]; dtuCount?: number }
interface DmConvo { conversationId?: string; otherUserId?: string; messageCount?: number; lastMessage?: { content?: string; fromUserId?: string; createdAt?: string } }
interface DmMessage { id?: string; fromUserId?: string; content?: string; createdAt?: string }

const MSG_COLS: ColumnSpec<MsgRow>[] = [
  { key: 'author', label: 'Author', type: 'text', width: '6rem', placeholder: 'name' },
  { key: 'content', label: 'Content', type: 'textarea', flex: 1, placeholder: 'message' },
];
const CONTRIB_COLS: ColumnSpec<ContribRow>[] = [
  { key: 'name', label: 'Name', type: 'text', width: '6rem' },
  { key: 'type', label: 'Type', type: 'select', width: '7rem', defaultValue: 'code', options: [
    { value: 'code' }, { value: 'review' }, { value: 'design' }, { value: 'discussion' }, { value: 'document' }, { value: 'test' },
  ] },
  { key: 'quality', label: 'Quality', type: 'number', width: '4.5rem', step: 0.05, min: 0, max: 1, defaultValue: 0.8 },
  { key: 'count', label: 'Count', type: 'number', width: '4.5rem', step: 1, min: 0, defaultValue: 1 },
];
const VOTE_COLS: ColumnSpec<VoteRow>[] = [
  { key: 'voter', label: 'Voter', type: 'text', width: '6rem' },
  { key: 'position', label: 'Position', type: 'text', flex: 1 },
];
const MEMBER_COLS: ColumnSpec<MemberRow>[] = [
  { key: 'name', label: 'Member', type: 'text', flex: 1 },
  { key: 'capacityHours', label: 'Capacity h/wk', type: 'number', width: '6rem', step: 1, min: 0, defaultValue: 40 },
];
const TASK_COLS: ColumnSpec<TaskRow>[] = [
  { key: 'assignee', label: 'Assignee (blank = unassigned)', type: 'text', flex: 1 },
  { key: 'hours', label: 'Hours', type: 'number', width: '5rem', step: 1, min: 0, defaultValue: 4 },
];

export function CollabActionPanel() {
  const pipe = usePipe();

  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [contribs, setContribs] = useState<ContribRow[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [contribResult, setContribResult] = useState<ContribResult | null>(null);
  const [consResult, setConsResult] = useState<ConsResult | null>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  // ── Recall controllers ───────────────────────────────────────────────────
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (messageId) => { await api.delete(`/api/social/dm/${encodeURIComponent(messageId)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (dtuId) => {
      await api.delete(`/api/dtus/${encodeURIComponent(dtuId)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actSession() {
    if (messages.length === 0) { err('Add messages or "Load DM" first.'); return; }
    setBusy('session'); setFeedback(null);
    try {
      const parsed = { durationMinutes, participants: Array.from(new Set(messages.map(m => m.author).filter(Boolean))), messages };
      const r = await callMacro<SessionResult>('sessionAnalytics', { artifact: { data: parsed } });
      if (r.ok && r.result) {
        setSessionResult(r.result);
        pipe.publish('collab.session', r.result, { label: `Session (${r.result.totalMessages} msgs)` });
        ok(`${r.result.balanceRating} · Gini ${r.result.participationBalance}.`);
      } else err(r.error ?? 'session failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actContrib() {
    if (contribs.length === 0) { err('Add contributions first.'); return; }
    setBusy('contrib'); setFeedback(null);
    try {
      const r = await callMacro<ContribResult>('contributionScore', { artifact: { data: { contributions: contribs } } });
      if (r.ok && r.result) {
        setContribResult(r.result);
        pipe.publish('collab.contrib', r.result, { label: `Contributions (top: ${r.result.topContributor})` });
        ok(`Top: ${r.result.topContributor}.`);
      } else err(r.error ?? 'contrib failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actConsensus() {
    if (votes.length === 0) { err('Add votes first.'); return; }
    setBusy('consensus'); setFeedback(null);
    try {
      const r = await callMacro<ConsResult>('detectConsensus', { artifact: { data: { votes } } });
      if (r.ok && r.result) {
        setConsResult(r.result);
        pipe.publish('collab.consensus', r.result, { label: `Vote: ${r.result.leadingPosition} (${r.result.consensusPercent}%)` });
        ok(`${r.result.status} · ${r.result.consensusPercent}%.`);
      } else err(r.error ?? 'consensus failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLoad() {
    if (members.length === 0 || tasks.length === 0) { err('Add members and tasks first ("Load workspace" pulls real members).'); return; }
    setBusy('load'); setFeedback(null);
    try {
      const tasksForApi = tasks.map(t => ({ ...(t.assignee ? { assignee: t.assignee } : {}), hours: t.hours }));
      const r = await callMacro<LoadResult>('balanceWorkload', { artifact: { data: { members, tasks: tasksForApi } } });
      if (r.ok && r.result) {
        setLoadResult(r.result);
        pipe.publish('collab.workload', r.result, { label: `Workload (${r.result.overloadedMembers} overloaded)` });
        ok(`${r.result.overloadedMembers} overloaded · avg ${r.result.avgUtilization}%.`);
      } else err(r.error ?? 'load failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Team session`, tags: ['collab', 'team', sessionResult?.balanceRating].filter((t): t is string => !!t), source: 'collab:team:mint', meta: { visibility: 'private', consent: { allowCitations: false }, team: { session: sessionResult, contrib: contribResult, cons: consResult, load: loadResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) {
        setMintedDtuId(id);
        pipe.publish('collab.mintedDtuId', id, { label: `Team DTU ${id.slice(0, 8)}…` });
        ok(`Team DTU ${id.slice(0, 8)}…`);
      } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`👥 Team brief`, '',
      sessionResult ? `Session: ${sessionResult.totalMessages} msgs / ${sessionResult.totalParticipants} ppl · ${sessionResult.balanceRating} (Gini ${sessionResult.participationBalance})` : '',
      contribResult ? `Top contributor: ${contribResult.topContributor} · ${contribResult.rankings[0]?.totalScore} pts` : '',
      consResult ? `Vote: ${consResult.leadingPosition} (${consResult.consensusPercent}%) · ${consResult.status}` : '',
      loadResult ? `Workload: ${loadResult.overloadedMembers} overloaded · avg ${loadResult.avgUtilization}%${loadResult.suggestions[0] ? ` · ${loadResult.suggestions[0]}` : ''}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        const id = r.data?.message?.id;
        if (!id) throw new Error('no message id returned');
        return id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!sessionResult) { err('Run session first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Team health card`, tags: ['collab', 'team', 'public'], source: 'collab:health:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, session: sessionResult, contrib: contribResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) {
        setPublishedDtuId(id);
        pipe.publish('collab.publishedDtuId', id, { label: `Public DTU ${id.slice(0, 8)}…` });
        ok(`Published ${id.slice(0, 8)}… · 30s to recall.`);
      }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Team facilitator brief. ${sessionResult ? `Session balance: ${sessionResult.balanceRating} (Gini ${sessionResult.participationBalance}, ${sessionResult.totalMessages} msgs across ${sessionResult.totalParticipants} ppl).` : ''} ${contribResult ? `Top contributor: ${contribResult.topContributor}.` : ''} ${consResult ? `${consResult.status}.` : ''} ${loadResult ? `${loadResult.overloadedMembers} overloaded teammates.` : ''} Identify single most important facilitation move + one structural change. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2);
        setAgentReply(text);
        pipe.publish('collab.agentReply', text, { label: 'Facilitator brief' });
        ok('Brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'session' as ActionId, label: 'Session', desc: 'sessionAnalytics + Gini', icon: Users, accent: '#3b82f6', handler: actSession },
    { id: 'contrib' as ActionId, label: 'Score', desc: 'contributionScore', icon: Trophy, accent: '#f59e0b', handler: actContrib },
    { id: 'consensus' as ActionId, label: 'Consensus', desc: 'detectConsensus', icon: Vote, accent: '#22c55e', handler: actConsensus },
    { id: 'load' as ActionId, label: 'Workload', desc: 'balanceWorkload', icon: Scale, accent: '#a855f7', handler: actLoad },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private team DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send team brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon health card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Facilitate', desc: 'Agent: next move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const BALANCE_COLOR: Record<string, string> = { 'well-balanced': 'text-emerald-300', 'slightly-uneven': 'text-amber-300', 'dominated-by-few': 'text-red-300' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Users className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Team facilitator</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">session · contrib · consensus · load</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Session</label>
              <label className="text-[10px] text-zinc-500 flex items-center gap-1">duration
                <input type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value) || 1)} className="w-12 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-white font-mono" />
                <span>min</span>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <LoadFromSubstrate<DmConvo>
                label="Load DM"
                compact
                emptyHint="No conversations yet."
                fetcher={async () => {
                  const r = await api.get('/api/social/dm/conversations');
                  return (r.data?.conversations ?? []) as DmConvo[];
                }}
                describe={(c) => ({
                  id: c.conversationId ?? `${c.otherUserId}`,
                  primary: c.otherUserId ?? 'unknown',
                  secondary: `${c.messageCount ?? 0} msgs · last: ${c.lastMessage?.content?.slice(0, 40) ?? ''}`,
                })}
                onSelect={async (c) => {
                  if (!c.conversationId) return;
                  try {
                    const r = await api.get(`/api/social/dm/${encodeURIComponent(c.conversationId)}`, { params: { limit: 200 } });
                    const msgs = (r.data?.messages ?? []) as DmMessage[];
                    const rows: MsgRow[] = msgs.slice().reverse()
                      .filter((m) => !!m.content)
                      .map((m) => ({ author: m.fromUserId ?? 'unknown', content: m.content ?? '' }));
                    setMessages(rows);
                    ok(`Loaded ${rows.length} messages from real DM.`);
                  } catch (e) { err(pickMessage(e)); }
                }}
              />
              <PipeImporter<MsgRow[]> accept={['collab.sessionImport']} onImport={(rows) => Array.isArray(rows) && setMessages(rows)} compact />
            </div>
          </div>
          <StructuredArrayEditor<MsgRow> value={messages} onChange={setMessages} template={{ author: '', content: '' }} columns={MSG_COLS} accent="blue" maxRows={200} />
        </div>
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Contributions</label>
            <PipeImporter<ContribRow[]> accept={['collab.contribImport']} onImport={(rows) => Array.isArray(rows) && setContribs(rows)} compact />
          </div>
          <StructuredArrayEditor<ContribRow> value={contribs} onChange={setContribs} template={{ name: '', type: 'code', quality: 0.8, count: 1 }} columns={CONTRIB_COLS} accent="amber" />
        </div>
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Votes</label>
            <PipeImporter<VoteRow[]> accept={['collab.voteImport']} onImport={(rows) => Array.isArray(rows) && setVotes(rows)} compact />
          </div>
          <StructuredArrayEditor<VoteRow> value={votes} onChange={setVotes} template={{ voter: '', position: '' }} columns={VOTE_COLS} accent="green" />
        </div>
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Members</label>
            <LoadFromSubstrate<CollabWorkspace>
              label="Load workspace"
              compact
              emptyHint="No workspaces yet."
              fetcher={async () => {
                const r = await api.get('/api/collab/workspaces');
                const data = r.data as { workspaces?: CollabWorkspace[] } | CollabWorkspace[];
                return Array.isArray(data) ? data : (data.workspaces ?? []);
              }}
              describe={(w) => ({ id: w.id, primary: w.name ?? w.id, secondary: `${w.members?.length ?? 0} members · ${w.dtuCount ?? 0} dtus` })}
              onSelect={(w) => {
                const next: MemberRow[] = (w.members ?? []).map((m) => ({ name: m.userId, capacityHours: 40 }));
                setMembers(next);
                ok(`Loaded ${next.length} members from workspace.`);
              }}
            />
          </div>
          <StructuredArrayEditor<MemberRow> value={members} onChange={setMembers} template={{ name: '', capacityHours: 40 }} columns={MEMBER_COLS} accent="purple" />
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold mt-2 block">Tasks</label>
          <StructuredArrayEditor<TaskRow> value={tasks} onChange={setTasks} template={{ assignee: '', hours: 4 }} columns={TASK_COLS} accent="purple" />
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient (userId)" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {sessionResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Session · {sessionResult.balanceRating}</div>
            <div className={cn('text-2xl font-bold', BALANCE_COLOR[sessionResult.balanceRating])}>{sessionResult.totalMessages}<span className="text-xs text-zinc-400"> msgs</span></div>
            <div className="text-[10px] text-zinc-500">Gini {sessionResult.participationBalance} · {sessionResult.messagesPerMinute}/min</div>
            {sessionResult.participantStats.slice(0, 4).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-12">{p.name}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${p.sharePercent}%` }} /></div><span className="font-mono text-blue-200">{p.sharePercent}%</span></div>)}
          </div>
        )}
        {contribResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Contribution · top: {contribResult.topContributor}</div>
            <div className="text-[10px] text-zinc-500">{contribResult.totalContributions} contributions</div>
            {contribResult.rankings.slice(0, 5).map((r, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">{i + 1}. <strong>{r.name}</strong> · <span className="font-mono text-amber-200">{r.totalScore}</span> pts ({r.contributions})</div>)}
          </div>
        )}
        {consResult && (
          <div className={cn('rounded-md border p-2.5', consResult.hasSupermajority ? 'border-emerald-500/30 bg-emerald-500/5' : consResult.hasConsensus ? 'border-blue-500/30 bg-blue-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Vote · {consResult.status}</div>
            <div className={cn('text-2xl font-bold', consResult.hasSupermajority ? 'text-emerald-300' : consResult.hasConsensus ? 'text-blue-300' : 'text-amber-300')}>{consResult.consensusPercent}%</div>
            <div className="text-[10px] text-zinc-200">{consResult.leadingPosition}</div>
            {(consResult.dissenting ?? []).slice(0, 3).map((d, i) => <div key={i} className="text-[10px] text-zinc-500 mt-0.5">{d.position}: {d.count} ({d.percent}%)</div>)}
          </div>
        )}
        {loadResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Workload · avg {loadResult.avgUtilization}%</div>
            <div className="text-[10px] text-red-300">{loadResult.overloadedMembers} overloaded · {loadResult.unassignedTasks} unassigned</div>
            {loadResult.members.slice(0, 5).map((m, i) => <div key={i} className={cn('text-[10px] mt-0.5 flex items-center gap-2', m.status === 'overloaded' ? 'text-red-300' : m.status === 'near-capacity' ? 'text-amber-300' : 'text-zinc-300')}><span className="font-mono w-12">{m.name}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, m.utilization)}%`, backgroundColor: m.status === 'overloaded' ? '#f87171' : m.status === 'near-capacity' ? '#fbbf24' : '#a78bfa' }} /></div><span className="font-mono">{m.utilization}%</span></div>)}
            {loadResult.suggestions.map((s, i) => <div key={i} className="text-[10px] text-purple-200 mt-0.5">→ {s}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Facilitator move</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
