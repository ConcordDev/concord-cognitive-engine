'use client';

/**
 * DebugActionPanel — SRE / log-triage bench.
 * logAnalysis / errorCluster / performanceProfile / stackTraceAnalysis +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Terminal, Bug, Zap, FileCode, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('debug', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'logs' | 'errors' | 'perf' | 'stack' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface LogResult { totalLines?: number; byLevel?: Record<string, number>; topErrors?: { message: string; count: number }[]; errorRate?: number; timeRange?: string }
interface ErrorResult { totalErrors?: number; clusters?: { signature: string; count: number; severity: string; sample: string }[]; uniqueErrors?: number; mostFrequent?: string }
interface PerfResult { p50?: number; p95?: number; p99?: number; avg?: number; slowestEndpoints?: { endpoint: string; avgMs: number; p99: number }[]; bottlenecks?: string[]; recommendation?: string }
interface StackResult { topFrame?: string; rootCause?: string; depthCount?: number; commonModule?: string; impactedComponents?: string[]; fixHints?: string[] }

const DEFAULT_LOGS = JSON.stringify({ logs: [...Array.from({ length: 12 }).map((_, i) => ({ level: 'INFO', message: `User ${i} logged in`, timestamp: `2026-05-17T10:${String(i).padStart(2, '0')}:00Z` })), { level: 'ERROR', message: 'Database connection timeout', timestamp: '2026-05-17T10:14:32Z' }, { level: 'ERROR', message: 'Database connection timeout', timestamp: '2026-05-17T10:15:01Z' }, { level: 'ERROR', message: 'Database connection timeout', timestamp: '2026-05-17T10:15:45Z' }, { level: 'WARN', message: 'Slow query detected (>2s)', timestamp: '2026-05-17T10:18:00Z' }, { level: 'ERROR', message: 'NullPointerException at UserService.findById', timestamp: '2026-05-17T10:22:00Z' }] }, null, 2);
const DEFAULT_ERRORS = JSON.stringify({ errors: [{ message: 'TimeoutError: Database connection timed out after 5000ms', stack: 'at Database.connect (db.js:42)', count: 28 }, { message: 'TimeoutError: Database connection timed out after 5000ms', stack: 'at Database.connect (db.js:42)', count: 12 }, { message: 'NullPointerException: cannot read property "id" of undefined', stack: 'at UserService.findById (user.js:88)', count: 7 }, { message: 'ValidationError: email is required', stack: 'at validate (form.js:23)', count: 45 }] }, null, 2);
const DEFAULT_PERF = JSON.stringify({ requests: [{ endpoint: '/api/dashboard', durationMs: 480 }, { endpoint: '/api/dashboard', durationMs: 520 }, { endpoint: '/api/dashboard', durationMs: 1850 }, { endpoint: '/api/users', durationMs: 80 }, { endpoint: '/api/users', durationMs: 75 }, { endpoint: '/api/search', durationMs: 3200 }, { endpoint: '/api/search', durationMs: 2900 }, { endpoint: '/api/search', durationMs: 3100 }, { endpoint: '/api/login', durationMs: 200 }] }, null, 2);
const DEFAULT_STACK = JSON.stringify({ stackTrace: `TypeError: Cannot read property 'name' of undefined
    at UserController.profile (/app/src/controllers/user.js:128:23)
    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:137:13)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:112:3)
    at /app/src/middleware/auth.js:42:9
    at processTicksAndRejections (node:internal/process/task_queues.js:96:5)` }, null, 2);

export function DebugActionPanel() {
  const [logsText, setLogsText] = useState(DEFAULT_LOGS);
  const [errorsText, setErrorsText] = useState(DEFAULT_ERRORS);
  const [perfText, setPerfText] = useState(DEFAULT_PERF);
  const [stackText, setStackText] = useState(DEFAULT_STACK);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [logResult, setLogResult] = useState<LogResult | null>(null);
  const [errorResult, setErrorResult] = useState<ErrorResult | null>(null);
  const [perfResult, setPerfResult] = useState<PerfResult | null>(null);
  const [stackResult, setStackResult] = useState<StackResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actLogs() {
    try { const parsed = JSON.parse(logsText); setBusy('logs'); setFeedback(null);
      const r = await callMacro<LogResult>('logAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setLogResult(r.result); ok(`${r.result.totalLines ?? 0} lines · error rate ${(r.result.errorRate ?? 0).toFixed?.(1)}%`); } else err(r.error ?? 'logs failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid logs JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actErrors() {
    try { const parsed = JSON.parse(errorsText); setBusy('errors'); setFeedback(null);
      const r = await callMacro<ErrorResult>('errorCluster', { artifact: { data: parsed } });
      if (r.ok && r.result) { setErrorResult(r.result); ok(`${r.result.uniqueErrors ?? 0} clusters · most freq: ${r.result.mostFrequent ?? '?'}`); } else err(r.error ?? 'errors failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid errors JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPerf() {
    try { const parsed = JSON.parse(perfText); setBusy('perf'); setFeedback(null);
      const r = await callMacro<PerfResult>('performanceProfile', { artifact: { data: parsed } });
      if (r.ok && r.result) { setPerfResult(r.result); ok(`p99 ${r.result.p99 ?? '?'}ms · avg ${r.result.avg ?? '?'}ms`); } else err(r.error ?? 'perf failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid perf JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actStack() {
    try { const parsed = JSON.parse(stackText); setBusy('stack'); setFeedback(null);
      const r = await callMacro<StackResult>('stackTraceAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setStackResult(r.result); ok(`Root: ${r.result.rootCause ?? '?'} · depth ${r.result.depthCount ?? '?'}`); } else err(r.error ?? 'stack failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid stack JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Debug session`, tags: ['debug', errorResult?.mostFrequent].filter((t): t is string => !!t), source: 'debug:session:mint', meta: { visibility: 'private', consent: { allowCitations: false }, debug: { logs: logResult, errors: errorResult, perf: perfResult, stack: stackResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Debug DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🐛 Debug session`, '', logResult ? `Logs: ${logResult.totalLines ?? 0} lines · error rate ${(logResult.errorRate ?? 0).toFixed?.(1)}%${logResult.topErrors?.[0] ? ` · top: ${logResult.topErrors[0].message.slice(0, 60)} (×${logResult.topErrors[0].count})` : ''}` : '', errorResult ? `Clusters: ${errorResult.uniqueErrors ?? 0} unique · ${errorResult.totalErrors ?? 0} total · most freq: ${errorResult.mostFrequent ?? '?'}` : '', perfResult ? `Perf: p50 ${perfResult.p50 ?? '?'}ms · p95 ${perfResult.p95 ?? '?'}ms · p99 ${perfResult.p99 ?? '?'}ms${perfResult.bottlenecks?.length ? ` · bottlenecks: ${perfResult.bottlenecks.slice(0, 2).join(', ')}` : ''}` : '', stackResult ? `Stack: root ${stackResult.rootCause ?? '?'} at ${stackResult.topFrame ?? '?'} (depth ${stackResult.depthCount ?? '?'})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!errorResult && !perfResult) { err('Errors or perf first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Incident report`, tags: ['debug', 'incident', 'public'], source: 'debug:incident:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, debug: { errors: errorResult, perf: perfResult, stack: stackResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `On-call SRE brief. ${logResult ? `Logs: ${logResult.totalLines ?? 0} lines, error rate ${(logResult.errorRate ?? 0).toFixed?.(1)}%.` : ''} ${errorResult ? `${errorResult.uniqueErrors ?? 0} unique error clusters; most frequent: ${errorResult.mostFrequent ?? 'n/a'}.` : ''} ${perfResult ? `Perf: p99 ${perfResult.p99 ?? '?'}ms; bottlenecks: ${perfResult.bottlenecks?.slice(0, 2).join(', ') ?? 'n/a'}.` : ''} ${stackResult ? `Stack: root cause ${stackResult.rootCause ?? '?'}; ${stackResult.fixHints?.[0] ?? 'no hint'}.` : ''} Identify the single most-urgent fix + one observability gap. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('SRE brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'logs' as ActionId, label: 'Logs', desc: 'logAnalysis', icon: Terminal, accent: '#3b82f6', handler: actLogs },
    { id: 'errors' as ActionId, label: 'Errors', desc: 'errorCluster', icon: Bug, accent: '#ef4444', handler: actErrors },
    { id: 'perf' as ActionId, label: 'Perf', desc: 'performanceProfile (p50/95/99)', icon: Zap, accent: '#f59e0b', handler: actPerf },
    { id: 'stack' as ActionId, label: 'Stack', desc: 'stackTraceAnalysis', icon: FileCode, accent: '#a855f7', handler: actStack },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private session', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send session', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon incident', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'SRE', desc: 'Agent: top fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const SEV_COLOR: Record<string, string> = { critical: 'text-red-500', high: 'text-red-300', medium: 'text-amber-300', low: 'text-blue-300' };

  return (
    <div className="rounded-lg border border-red-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-red-500/10 pb-2">
        <Bug className="h-4 w-4 text-red-400" />
        <h3 className="text-sm font-semibold text-white">Debug / SRE bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">logs · errors · perf · stack</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Logs JSON</label>
          <textarea value={logsText} onChange={(e) => setLogsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Errors JSON</label>
          <textarea value={errorsText} onChange={(e) => setErrorsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Perf requests JSON</label>
          <textarea value={perfText} onChange={(e) => setPerfText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Stack trace JSON</label>
          <textarea value={stackText} onChange={(e) => setStackText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
        {logResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Logs</div>
            <div className="text-2xl font-bold text-blue-200">{logResult.totalLines ?? 0}</div>
            <div className="text-[10px] text-zinc-500">{logResult.timeRange ?? ''} · error rate {(logResult.errorRate ?? 0).toFixed?.(1)}%</div>
            {logResult.byLevel && Object.entries(logResult.byLevel).map(([k, v], i) => <div key={i} className={cn('text-[10px] mt-0.5 flex justify-between', k === 'ERROR' ? 'text-red-300' : k === 'WARN' ? 'text-amber-300' : 'text-zinc-300')}><span>{k}</span><span className="font-mono">{v}</span></div>)}
            {logResult.topErrors?.slice(0, 3).map((e, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5 truncate">⚠ {e.message.slice(0, 50)} ×{e.count}</div>)}
          </div>
        )}
        {errorResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Errors</div>
            <div className="text-2xl font-bold text-red-200">{errorResult.uniqueErrors ?? 0}</div>
            <div className="text-[10px] text-zinc-500">{errorResult.totalErrors ?? 0} total · most: {errorResult.mostFrequent ?? '?'}</div>
            {errorResult.clusters?.slice(0, 4).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1"><span className={cn('font-mono text-[9px]', SEV_COLOR[c.severity])}>[{c.severity}×{c.count}]</span> {c.sample.slice(0, 60)}</div>)}
          </div>
        )}
        {perfResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Perf</div>
            <div className="text-2xl font-bold text-amber-200">{perfResult.p99 ?? '?'}<span className="text-xs text-zinc-400">ms p99</span></div>
            <div className="text-[10px] text-zinc-500">p50 {perfResult.p50 ?? '?'} · p95 {perfResult.p95 ?? '?'} · avg {perfResult.avg ?? '?'}</div>
            {perfResult.slowestEndpoints?.slice(0, 4).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate">{s.endpoint}</span><span className="font-mono text-amber-200">{s.p99}ms</span></div>)}
            {perfResult.bottlenecks?.slice(0, 2).map((b, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {b}</div>)}
            {perfResult.recommendation && <div className="text-[10px] text-amber-200 mt-1 italic">{perfResult.recommendation}</div>}
          </div>
        )}
        {stackResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Stack · depth {stackResult.depthCount ?? '?'}</div>
            <div className="text-[10px] text-zinc-200 font-mono">Top: {stackResult.topFrame ?? '?'}</div>
            <div className="text-[10px] text-red-300 mt-1">Root: {stackResult.rootCause ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">Module: {stackResult.commonModule ?? '?'}</div>
            {stackResult.impactedComponents?.slice(0, 3).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">⬢ {c}</div>)}
            {stackResult.fixHints?.slice(0, 3).map((h, i) => <div key={i} className="text-[10px] text-purple-200 mt-0.5">→ {h}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> On-call SRE</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
