'use client';

/**
 * AccountingActionPanel — CFO + bookkeeper bench.
 * trialBalance / profitLoss / invoiceAging / budgetVariance +
 * mint/DM/publish/agent.
 *
 * Max-polish: no seed data (paste real books JSON), pipe publish/import
 * for cross-panel hand-off, recall window on DM + publish.
 */

import { useState } from 'react';
import { Calculator, TrendingUp, FileText, Scale, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('accounting', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'tb' | 'pl' | 'aging' | 'var' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface TbEntry { account: string; debit: number; credit: number }
interface TbResult { balanced?: boolean; totalDebits?: number; totalCredits?: number; difference?: number; entries?: TbEntry[]; accountCount?: number }
interface PlResult { period?: string; revenue: number; expenses: number; netIncome: number; grossMargin?: number; categories?: { name: string; revenue?: number; expenses?: number; net?: number }[] }
interface AgingBucket { invoices: { invoiceId?: string; customer?: string; amount: number; daysOverdue: number }[]; total: number }
interface AgingResult { totalInvoices: number; unpaidCount: number; totalOutstanding: number; totalOverdue: number; avgDaysOutstanding: number; buckets: Record<string, AgingBucket> }
interface VarLine { category?: string; planned: number; actual: number; variance: number; variancePercent: number; status: string }
interface VarResult { lines: VarLine[]; totalPlanned: number; totalActual: number; totalVariance: number; status: string }

export function AccountingActionPanel() {
  const [tbText, setTbText] = useState('');
  const [plText, setPlText] = useState('');
  const [agingText, setAgingText] = useState('');
  const [varText, setVarText] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [tbResult, setTbResult] = useState<TbResult | null>(null);
  const [plResult, setPlResult] = useState<PlResult | null>(null);
  const [agingResult, setAgingResult] = useState<AgingResult | null>(null);
  const [varResult, setVarResult] = useState<VarResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actTb() {
    if (!tbText.trim()) { err('Paste TB JSON first.'); return; }
    try { const parsed = JSON.parse(tbText); setBusy('tb'); setFeedback(null);
      const r = await callMacro<TbResult>('trialBalance', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTbResult(r.result); pipe.publish('accounting.tb', r.result, { label: `TB ${r.result.balanced ? '✓' : '⚠'}` }); ok(`${r.result.balanced ? '✓ balanced' : '⚠ off by ' + r.result.difference}.`); } else err(r.error ?? 'tb failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid TB JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPl() {
    if (!plText.trim()) { err('Paste P&L JSON first.'); return; }
    try { const parsed = JSON.parse(plText); setBusy('pl'); setFeedback(null);
      const r = await callMacro<PlResult>('profitLoss', { artifact: { data: parsed } });
      if (r.ok && r.result) { setPlResult(r.result); pipe.publish('accounting.pl', r.result, { label: `P&L net $${r.result.netIncome.toLocaleString()}` }); ok(`Net $${r.result.netIncome.toLocaleString()}.`); } else err(r.error ?? 'pl failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid PL JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAging() {
    if (!agingText.trim()) { err('Paste AR aging JSON first.'); return; }
    try { const parsed = JSON.parse(agingText); setBusy('aging'); setFeedback(null);
      const r = await callMacro<AgingResult>('invoiceAging', { artifact: { data: parsed } });
      if (r.ok && r.result) { setAgingResult(r.result); pipe.publish('accounting.aging', r.result, { label: `AR $${r.result.totalOutstanding.toLocaleString()}` }); ok(`$${r.result.totalOutstanding.toLocaleString()} outstanding · ${r.result.avgDaysOutstanding}d avg.`); } else err(r.error ?? 'aging failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid aging JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actVar() {
    if (!varText.trim()) { err('Paste variance JSON first.'); return; }
    try { const parsed = JSON.parse(varText); setBusy('var'); setFeedback(null);
      const r = await callMacro<VarResult>('budgetVariance', { artifact: { data: parsed } });
      if (r.ok && r.result) { setVarResult(r.result); pipe.publish('accounting.var', r.result, { label: `Variance ${r.result.totalVariance >= 0 ? '+' : ''}$${r.result.totalVariance.toLocaleString()}` }); ok(`Variance ${r.result.totalVariance >= 0 ? '+' : ''}$${r.result.totalVariance.toLocaleString()}.`); } else err(r.error ?? 'var failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid variance JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Books — ${plResult?.period ?? 'period'}`, tags: ['accounting', 'books', plResult?.period].filter((t): t is string => !!t), source: 'accounting:books:mint', meta: { visibility: 'private', consent: { allowCitations: false }, books: { tb: tbResult, pl: plResult, aging: agingResult, var: varResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('accounting.mintedDtuId', id, { label: `Books DTU ${id.slice(0, 8)}…` }); ok(`Books DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📊 Books`, '',
      tbResult ? `TB: ${tbResult.balanced ? '✓ balanced' : `⚠ off by $${tbResult.difference}`} · D $${tbResult.totalDebits?.toLocaleString()} / C $${tbResult.totalCredits?.toLocaleString()}` : '',
      plResult ? `P&L ${plResult.period}: rev $${plResult.revenue.toLocaleString()} - exp $${plResult.expenses.toLocaleString()} = net $${plResult.netIncome.toLocaleString()}${plResult.grossMargin != null ? ` (margin ${plResult.grossMargin}%)` : ''}` : '',
      agingResult ? `AR aging: $${agingResult.totalOutstanding.toLocaleString()} out · $${agingResult.totalOverdue.toLocaleString()} overdue · ${agingResult.avgDaysOutstanding}d avg` : '',
      varResult ? `Budget variance: ${varResult.totalVariance >= 0 ? '+' : ''}$${varResult.totalVariance.toLocaleString()} (${varResult.status})` : '',
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
    if (!plResult) { err('Run P&L first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `P&L summary — ${plResult.period}`, tags: ['accounting', 'pl', 'public'], source: 'accounting:pl:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, pl: plResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('accounting.publishedDtuId', id, { label: `Public P&L ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `CFO brief. ${plResult ? `Net income $${plResult.netIncome.toLocaleString()} on $${plResult.revenue.toLocaleString()} revenue${plResult.grossMargin != null ? ` (${plResult.grossMargin}% margin)` : ''}.` : ''} ${agingResult ? `AR outstanding $${agingResult.totalOutstanding.toLocaleString()}, overdue $${agingResult.totalOverdue.toLocaleString()}, ${agingResult.avgDaysOutstanding}d avg.` : ''} ${varResult ? `Budget variance ${varResult.totalVariance >= 0 ? '+' : ''}$${varResult.totalVariance.toLocaleString()} (${varResult.status}).` : ''} Identify single biggest cash-flow lever this month + one cost to address. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2);
        setAgentReply(text); pipe.publish('accounting.agentReply', text, { label: 'CFO brief' });
        ok('Brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'tb' as ActionId, label: 'Trial bal', desc: 'trialBalance', icon: Scale, accent: '#3b82f6', handler: actTb },
    { id: 'pl' as ActionId, label: 'P&L', desc: 'profitLoss', icon: TrendingUp, accent: '#22c55e', handler: actPl },
    { id: 'aging' as ActionId, label: 'AR aging', desc: 'invoiceAging', icon: FileText, accent: '#f59e0b', handler: actAging },
    { id: 'var' as ActionId, label: 'Variance', desc: 'budgetVariance', icon: Calculator, accent: '#a855f7', handler: actVar },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private books DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send to CFO', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon P&L card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: cash lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Calculator className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Accounting bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">TB · P&L · AR aging · variance</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">TB JSON</label>
          <textarea value={tbText} onChange={(e) => setTbText(e.target.value)} rows={5} placeholder='{"entries":[{"account":"Cash","debit":45000,"credit":0}, ...]}' className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">P&L JSON</label>
          <textarea value={plText} onChange={(e) => setPlText(e.target.value)} rows={5} placeholder='{"period":"Q1 2026","transactions":[{"category":"...","type":"revenue|expense","amount":N}, ...]}' className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">AR aging JSON</label>
          <textarea value={agingText} onChange={(e) => setAgingText(e.target.value)} rows={5} placeholder='{"invoices":[{"invoiceId":"INV-1","customer":"...","amount":N,"dueDate":"YYYY-MM-DD"}, ...]}' className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Variance JSON</label>
          <textarea value={varText} onChange={(e) => setVarText(e.target.value)} rows={5} placeholder='{"lines":[{"category":"...","planned":N,"actual":N}, ...]}' className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
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
        {tbResult && (
          <div className={cn('rounded-md border p-2.5', tbResult.balanced ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Trial balance</div>
            <div className={cn('text-2xl font-bold', tbResult.balanced ? 'text-emerald-300' : 'text-red-300')}>{tbResult.balanced ? '✓' : '⚠'}<span className="text-xs text-zinc-400"> {tbResult.balanced ? 'balanced' : 'off by $' + tbResult.difference}</span></div>
            <div className="text-[10px] text-zinc-500">D ${tbResult.totalDebits?.toLocaleString()} · C ${tbResult.totalCredits?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">{tbResult.accountCount} accounts</div>
          </div>
        )}
        {plResult && (
          <div className={cn('rounded-md border p-2.5', plResult.netIncome >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">P&L · {plResult.period}</div>
            <div className={cn('text-2xl font-bold', plResult.netIncome >= 0 ? 'text-emerald-300' : 'text-red-300')}>${plResult.netIncome.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">rev ${plResult.revenue.toLocaleString()} - exp ${plResult.expenses.toLocaleString()}</div>
            {plResult.grossMargin != null && <div className="text-[10px] text-zinc-500">margin {plResult.grossMargin}%</div>}
          </div>
        )}
        {agingResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">AR aging</div>
            <div className="text-2xl font-bold text-amber-300">${agingResult.totalOutstanding.toLocaleString()}</div>
            <div className="text-[10px] text-red-300">overdue ${agingResult.totalOverdue.toLocaleString()} · {agingResult.avgDaysOutstanding}d avg</div>
            {Object.entries(agingResult.buckets).map(([k, b]) => <div key={k} className={cn('text-[10px] mt-0.5', k === '90+' ? 'text-red-300' : k === '61-90' ? 'text-orange-300' : k === '31-60' ? 'text-amber-300' : 'text-zinc-300')}><span className="font-mono">{k}d</span>: ${b.total.toLocaleString()} ({b.invoices.length})</div>)}
          </div>
        )}
        {varResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', varResult.totalVariance >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Variance · {varResult.status}</div>
            <div className={cn('text-2xl font-bold', varResult.totalVariance >= 0 ? 'text-emerald-300' : 'text-red-300')}>{varResult.totalVariance >= 0 ? '+' : ''}${varResult.totalVariance.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">${varResult.totalActual.toLocaleString()} / ${varResult.totalPlanned.toLocaleString()}</div>
            {varResult.lines.slice(0, 4).map((l, i) => <div key={i} className={cn('text-[10px] mt-0.5', l.variance < 0 ? 'text-red-300' : 'text-emerald-300')}><span className="font-mono">{l.category}</span> {l.variancePercent >= 0 ? '+' : ''}{l.variancePercent}%</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> CFO brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
