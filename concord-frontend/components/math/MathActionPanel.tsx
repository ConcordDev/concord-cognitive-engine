'use client';

/**
 * MathActionPanel — math workbench. Surfaces
 * statisticalAnalysis / matrixOperations / polynomialAnalysis /
 * regressionFit + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Sigma, Calculator, Grid3x3, FunctionSquare, TrendingUp,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('math', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'stats' | 'matrix' | 'poly' | 'regress' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface StatsResult { count?: number; mean?: number; median?: number; stdDev?: number; min?: number; max?: number; q1?: number; q3?: number }
interface MatrixResult { result?: number[][]; determinant?: number; rank?: number }
interface PolyResult { roots?: number[]; derivative?: string; degree?: number }
interface RegressResult { coefficients?: number[]; rSquared?: number; equation?: string }

export function MathActionPanel() {
  const [problem, setProblem] = useState('');
  const [dataset, setDataset] = useState('');
  const [matrixA, setMatrixA] = useState('');
  const [matrixOp, setMatrixOp] = useState<'determinant' | 'transpose' | 'inverse'>('determinant');
  const [polyCoef, setPolyCoef] = useState('');
  const [regressX, setRegressX] = useState('');
  const [regressY, setRegressY] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [statsResult, setStatsResult] = useState<StatsResult | null>(null);
  const [matrixResult, setMatrixResult] = useState<MatrixResult | null>(null);
  const [polyResult, setPolyResult] = useState<PolyResult | null>(null);
  const [regressResult, setRegressResult] = useState<RegressResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

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

  function parseList(s: string) { return s.split(/[,\s]+/).map(x => parseFloat(x)).filter(x => !isNaN(x)); }
  function parseMatrix(s: string) { return s.split('\n').map(l => l.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x))); }

  async function actStats() {
    const data = parseList(dataset); if (!data.length) { err('Add numeric dataset.'); return; }
    setBusy('stats'); setFeedback(null);
    try { const r = await callMacro<StatsResult>('statisticalAnalysis', { data }); if (r.ok && r.result) { setStatsResult(r.result); pipe.publish('math.stats', r.result, { label: `n=${r.result.count} μ=${r.result.mean?.toFixed(2)}` }); ok(`μ=${r.result.mean?.toFixed(2)}, σ=${r.result.stdDev?.toFixed(2)}.`); } else err(r.error ?? 'stats failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMatrix() {
    const m = parseMatrix(matrixA); if (!m.length) { err('Add matrix rows.'); return; }
    setBusy('matrix'); setFeedback(null);
    try { const r = await callMacro<MatrixResult>('matrixOperations', { matrix: m, operation: matrixOp }); if (r.ok && r.result) { setMatrixResult(r.result); pipe.publish('math.matrix', r.result, { label: matrixOp }); ok(`${matrixOp} computed.`); } else err(r.error ?? 'matrix failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPoly() {
    const c = parseList(polyCoef); if (c.length < 2) { err('Add polynomial coefficients (highest power first).'); return; }
    setBusy('poly'); setFeedback(null);
    try { const r = await callMacro<PolyResult>('polynomialAnalysis', { coefficients: c }); if (r.ok && r.result) { setPolyResult(r.result); pipe.publish('math.poly', r.result, { label: `deg ${r.result.degree}` }); ok(`Degree ${r.result.degree}, ${r.result.roots?.length ?? 0} roots.`); } else err(r.error ?? 'poly failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRegress() {
    const x = parseList(regressX); const y = parseList(regressY);
    if (x.length !== y.length || x.length < 2) { err('X and Y must be same length, ≥2 points.'); return; }
    setBusy('regress'); setFeedback(null);
    try { const r = await callMacro<RegressResult>('regressionFit', { x, y, type: 'linear' }); if (r.ok && r.result) { setRegressResult(r.result); pipe.publish('math.regression', r.result, { label: `R²=${r.result.rSquared?.toFixed(3)}` }); ok(`R² = ${r.result.rSquared?.toFixed(4)}.`); } else err(r.error ?? 'regression failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Math — ${problem.trim() || 'analysis'}`, tags: ['math', 'analysis'], source: 'math:analysis:mint', meta: { visibility: 'private', consent: { allowCitations: false }, math: { problem, stats: statsResult, matrix: matrixResult, poly: polyResult, regress: regressResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('math.mintedDtuId', id, { label: `analysis ${id.slice(0, 8)}` }); ok(`Math DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`Σ Math brief: ${problem || 'analysis'}`, '', statsResult ? `Stats: μ=${statsResult.mean?.toFixed(2)} σ=${statsResult.stdDev?.toFixed(2)} (n=${statsResult.count})` : '', regressResult ? `Regression: ${regressResult.equation} (R²=${regressResult.rSquared?.toFixed(4)})` : '', polyResult ? `Polynomial: deg ${polyResult.degree}, roots ${polyResult.roots?.map(r => r.toFixed(3)).join(', ')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Public derivation — ${problem.trim() || 'analysis'}`, tags: ['math', 'public', 'derivation'], source: 'math:derivation:publish', meta: { visibility: 'public', consent: { allowCitations: true }, derivation: { problem, stats: statsResult, regression: regressResult, poly: polyResult } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('math.publishedDtuId', id, { label: `derivation ${id.slice(0, 8)}` }); ok(`Derivation published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    if (!problem.trim()) { err('Problem statement required.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Math problem: "${problem}". ${statsResult ? `Stats: mean ${statsResult.mean}, σ ${statsResult.stdDev}.` : ''} ${regressResult ? `Regression: ${regressResult.equation} R²=${regressResult.rSquared}.` : ''} Provide a step-by-step solution path. Plain text, numbered steps.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Steps ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'stats' as ActionId, label: 'Stats', desc: 'statisticalAnalysis μ, σ, quartiles', icon: Calculator, accent: '#06b6d4', handler: actStats },
    { id: 'matrix' as ActionId, label: 'Matrix', desc: 'matrixOperations det / transpose / inverse', icon: Grid3x3, accent: '#8b5cf6', handler: actMatrix },
    { id: 'poly' as ActionId, label: 'Poly', desc: 'polynomialAnalysis roots + derivative', icon: FunctionSquare, accent: '#22c55e', handler: actPoly },
    { id: 'regress' as ActionId, label: 'Regress', desc: 'regressionFit R² + equation', icon: TrendingUp, accent: '#f97316', handler: actRegress },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private analysis DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send analysis brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public derivation + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Steps', desc: 'Agent: step-by-step solution path', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <Sigma className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Math workbench</h3>
      </header>

      <input type="text" value={problem} onChange={(e) => setProblem(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Problem statement (for mint / agent)" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Dataset (comma/space-separated)</label><textarea value={dataset} onChange={(e) => setDataset(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-indigo-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Polynomial coef (high→low)</label><textarea value={polyCoef} onChange={(e) => setPolyCoef(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-indigo-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Matrix A (rows / lines)</label><textarea value={matrixA} onChange={(e) => setMatrixA(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-indigo-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/40 resize-none" /></div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Matrix op</label>
          <select value={matrixOp} onChange={(e) => setMatrixOp(e.target.value as typeof matrixOp)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
            {(['determinant', 'transpose', 'inverse'] as const).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Regression X</label><textarea value={regressX} onChange={(e) => setRegressX(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-indigo-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Regression Y</label><textarea value={regressY} onChange={(e) => setRegressY(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-indigo-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/40 resize-none" /></div>
      </div>

      <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />

      <div className="flex items-center gap-2 flex-wrap">
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
        {statsResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Stats (n={statsResult.count})</div>
            <div className="grid grid-cols-3 gap-2 mt-1 text-[11px] text-zinc-300">
              <div>μ <span className="font-mono text-cyan-300">{statsResult.mean?.toFixed(2)}</span></div>
              <div>med <span className="font-mono text-cyan-300">{statsResult.median}</span></div>
              <div>σ <span className="font-mono text-cyan-300">{statsResult.stdDev?.toFixed(2)}</span></div>
              <div>min <span className="font-mono">{statsResult.min}</span></div>
              <div>max <span className="font-mono">{statsResult.max}</span></div>
              <div>IQR <span className="font-mono">{statsResult.q1}–{statsResult.q3}</span></div>
            </div>
          </div>
        )}
        {matrixResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Matrix · {matrixOp}</div>
            {matrixResult.determinant != null && <div className="text-2xl font-bold text-purple-300">det = {matrixResult.determinant.toFixed(3)}</div>}
            {matrixResult.rank != null && <div className="text-[10px] text-zinc-400">rank {matrixResult.rank}</div>}
            {matrixResult.result && Array.isArray(matrixResult.result[0]) && (
              <pre className="text-[10px] text-purple-200 font-mono mt-1 overflow-x-auto">{matrixResult.result.map(row => '[' + row.map(c => c.toFixed(2)).join(', ') + ']').join('\n')}</pre>
            )}
          </div>
        )}
        {polyResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Polynomial · deg {polyResult.degree}</div>
            {polyResult.roots && <div className="text-[11px] text-zinc-300">Roots: {polyResult.roots.map(r => r.toFixed(3)).join(', ')}</div>}
            {polyResult.derivative && <div className="text-[11px] text-zinc-300 font-mono">f'(x) = {polyResult.derivative}</div>}
          </div>
        )}
        {regressResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Regression</div>
            <div className="text-sm font-mono text-orange-200">{regressResult.equation}</div>
            <div className="text-[11px] text-zinc-300">R² = <span className="font-mono text-orange-300">{regressResult.rSquared?.toFixed(4)}</span></div>
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Solution steps</div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
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
