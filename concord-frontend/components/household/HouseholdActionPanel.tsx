'use client';

/**
 * HouseholdActionPanel — Tody + Sweepy-shape home workbench. Surfaces
 * generateGroceryList / choreRotation / maintenanceDue / weeklySummary +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Home, ShoppingCart, ListChecks, Wrench, Calendar,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('household', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'grocery' | 'chores' | 'maintenance' | 'summary' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface GroceryResult { items?: Array<{ name: string; quantity: string; aisle?: string }>; total?: number }
interface ChoreResult { rotation?: Array<{ chore: string; assignee: string; due: string }>; weekOf?: string }
interface MaintResult { items?: Array<{ task: string; dueDate: string; daysOverdue?: number }>; overdueCount?: number }
interface SummaryResult { choresDone?: number; choresTotal?: number; maintCompleted?: number; sentiment?: string }

export function HouseholdActionPanel() {
  const [meals, setMeals] = useState('');
  const [chores, setChores] = useState('');
  const [members, setMembers] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [groceryResult, setGroceryResult] = useState<GroceryResult | null>(null);
  const [choreResult, setChoreResult] = useState<ChoreResult | null>(null);
  const [maintResult, setMaintResult] = useState<MaintResult | null>(null);
  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actGrocery() {
    const mealList = meals.split('\n').map(l => l.trim()).filter(Boolean);
    if (!mealList.length) { err('Add meals.'); return; }
    setBusy('grocery'); setFeedback(null);
    try { const r = await callMacro<GroceryResult>('generateGroceryList', { meals: mealList }); if (r.ok && r.result) { setGroceryResult(r.result); pipe.publish('household.grocery', r.result, { label: `${r.result.items?.length ?? 0} items` }); ok(`${r.result.items?.length ?? 0} items.`); } else err(r.error ?? 'grocery failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actChores() {
    const c = chores.split('\n').map(s => s.trim()).filter(Boolean);
    const m = members.split('\n').map(s => s.trim()).filter(Boolean);
    if (!c.length || !m.length) { err('Add chores + members.'); return; }
    setBusy('chores'); setFeedback(null);
    try { const r = await callMacro<ChoreResult>('choreRotation', { chores: c, members: m, weekStart: new Date().toISOString().slice(0, 10) }); if (r.ok && r.result) { setChoreResult(r.result); pipe.publish('household.chores', r.result, { label: `${r.result.rotation?.length ?? 0} rotated` }); ok(`${r.result.rotation?.length ?? 0} chores rotated.`); } else err(r.error ?? 'chores failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMaintenance() {
    setBusy('maintenance'); setFeedback(null);
    try { const r = await callMacro<MaintResult>('maintenanceDue', { window: 'month' }); if (r.ok && r.result) { setMaintResult(r.result); pipe.publish('household.maint', r.result, { label: `${r.result.overdueCount ?? 0} overdue` }); ok(`${r.result.overdueCount ?? 0} overdue.`); } else err(r.error ?? 'maintenance failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSummary() {
    setBusy('summary'); setFeedback(null);
    try { const r = await callMacro<SummaryResult>('weeklySummary', {}); if (r.ok && r.result) { setSummaryResult(r.result); pipe.publish('household.summary', r.result, { label: `${r.result.choresDone}/${r.result.choresTotal} chores` }); ok(`${r.result.choresDone}/${r.result.choresTotal} chores done.`); } else err(r.error ?? 'summary failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Household — week of ${new Date().toISOString().slice(0, 10)}`, tags: ['household', 'week'], source: 'household:week:mint', meta: { visibility: 'private', consent: { allowCitations: false }, household: { meals: meals.split('\n').filter(Boolean), grocery: groceryResult, chores: choreResult, maintenance: maintResult, summary: summaryResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('household.mintedDtuId', id, { label: `Week DTU ${id.slice(0, 8)}…` }); ok(`Week DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏠 Household — week of ${new Date().toLocaleDateString()}`, '',
      groceryResult ? `Grocery: ${groceryResult.items?.length} items` : '',
      choreResult ? `Chores rotated: ${choreResult.rotation?.length}` : '',
      maintResult ? `Maintenance overdue: ${maintResult.overdueCount}` : '',
      summaryResult ? `Sentiment: ${summaryResult.sentiment}` : '',
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
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Household routine — ${chores.split('\n').filter(Boolean).length} chores`, tags: ['household', 'public', 'routine'], source: 'household:routine:publish', meta: { visibility: 'public', consent: { allowCitations: true }, routine: { chores: chores.split('\n').filter(Boolean), meals: meals.split('\n').filter(Boolean) } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('household.publishedDtuId', id, { label: `Public routine ${id.slice(0, 8)}…` }); ok(`Routine published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Household state: ${members.split('\n').filter(Boolean).length} members, ${chores.split('\n').filter(Boolean).length} chores. ${maintResult ? `${maintResult.overdueCount} overdue maintenance.` : ''} ${summaryResult ? `Sentiment: ${summaryResult.sentiment}.` : ''} Suggest the single weekly meeting agenda item that would most reduce household friction. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Meeting topic ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'grocery' as ActionId, label: 'Grocery', desc: 'generateGroceryList from meals', icon: ShoppingCart, accent: '#22c55e', handler: actGrocery },
    { id: 'chores' as ActionId, label: 'Chores', desc: 'choreRotation weekly', icon: ListChecks, accent: '#8b5cf6', handler: actChores },
    { id: 'maintenance' as ActionId, label: 'Maintain', desc: 'maintenanceDue overdue tasks', icon: Wrench, accent: '#f97316', handler: actMaintenance },
    { id: 'summary' as ActionId, label: 'Summary', desc: 'weeklySummary metrics', icon: Calendar, accent: '#06b6d4', handler: actSummary },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private week DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send week brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public routine DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Meeting', desc: 'Agent: weekly meeting topic', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-teal-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-teal-500/10 pb-2">
        <Home className="h-4 w-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-white">Household workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Meals (one per line)</label><textarea value={meals} onChange={(e) => setMeals(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-teal-200 font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Chores (one per line)</label><textarea value={chores} onChange={(e) => setChores(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-teal-200 font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Members (one per line)</label><textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-teal-200 font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/40 resize-none" /></div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient (housemate / partner)" />
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {groceryResult?.items && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Grocery ({groceryResult.items.length})</div>
            {groceryResult.items.slice(0, 10).map((i, idx) => <div key={idx} className="text-[11px] text-zinc-300">{i.name} <span className="text-zinc-400 font-mono">{i.quantity}</span>{i.aisle && <span className="text-zinc-400"> · {i.aisle}</span>}</div>)}
          </div>
        )}
        {choreResult?.rotation && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Chores (week of {choreResult.weekOf})</div>
            {choreResult.rotation.slice(0, 10).map((r, i) => <div key={i} className="text-[11px] text-zinc-300 flex justify-between"><span>{r.chore}</span><span className="text-purple-200 font-semibold">{r.assignee}</span></div>)}
          </div>
        )}
        {maintResult?.items && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Maintenance ({maintResult.overdueCount} overdue)</div>
            {maintResult.items.slice(0, 6).map((m, i) => <div key={i} className="text-[11px] text-zinc-300 flex justify-between"><span>{m.task}</span><span className={cn('font-mono', (m.daysOverdue ?? 0) > 0 ? 'text-rose-300' : 'text-zinc-400')}>{m.daysOverdue ? `+${m.daysOverdue}d` : m.dueDate}</span></div>)}
          </div>
        )}
        {summaryResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Weekly summary</div>
            <div className="text-2xl font-bold text-cyan-300">{summaryResult.choresDone}/{summaryResult.choresTotal}</div>
            <div className="text-[10px] text-zinc-400">chores · {summaryResult.maintCompleted} maint done · sentiment: {summaryResult.sentiment}</div>
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Meeting topic</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
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
