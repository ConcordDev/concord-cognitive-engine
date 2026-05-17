'use client';

/**
 * LegacyActionPanel — legacy-system audit bench.
 * technicalDebt / migrationReadiness / riskMap (3 macros + remediation roll-up) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { GitBranch, ArrowRight, ShieldAlert, Calculator, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('legacy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'debt' | 'migration' | 'risk' | 'roll' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface DebtModule { name: string; maintainabilityIndex: number; debtScore: number; debtLevel: string; remediationHours: number }
interface DebtResult { modules: DebtModule[]; summary: { totalModules: number; avgDebtScore: number; totalDebtScore: number; totalRemediationHours: number; criticalModules: number; highDebtModules: number; avgMaintainability: number } }
interface MigRow { module: string; readinessScore: number; readinessLevel: string }
interface MigrationResult { moduleReadiness: MigRow[]; migrationOrder: { phase: number; module: string; readiness: number }[]; coupling: { score: number; level: string }; summary: { totalModules: number; avgReadiness: number; readyModules: number; blockedModules: number; totalDataGb: number; externalDependencyCount: number } }
interface RiskRow { component: string; riskScore?: number; severity?: string; busFactor?: number }
interface RiskResult { components?: RiskRow[]; summary?: { totalComponents: number; avgRisk: number; criticalCount: number; busFactor: number } }

const DEFAULT_DEBT = JSON.stringify({ modules: [{ name: 'auth-service', linesOfCode: 4200, cyclomaticComplexity: 28, dependencyCount: 15, dependencyAgeYears: 4, testCoverage: 35, duplicateRatio: 0.12, lastModifiedDaysAgo: 200 }, { name: 'billing-engine', linesOfCode: 8800, cyclomaticComplexity: 42, dependencyCount: 22, dependencyAgeYears: 6, testCoverage: 15, duplicateRatio: 0.22, lastModifiedDaysAgo: 720 }, { name: 'notification', linesOfCode: 1200, cyclomaticComplexity: 8, dependencyCount: 4, dependencyAgeYears: 1, testCoverage: 80, duplicateRatio: 0.02, lastModifiedDaysAgo: 30 }] }, null, 2);
const DEFAULT_MIG = JSON.stringify({ system: { modules: [{ name: 'auth-service', dependencies: ['db', 'redis'], apis: [{ endpoint: '/login', consumers: 12 }, { endpoint: '/whoami', consumers: 8 }], dataStores: [{ type: 'postgres', sizeGb: 12, portable: true }] }, { name: 'billing-engine', dependencies: ['auth-service', 'mainframe-batch'], apis: [{ endpoint: '/invoice', consumers: 4 }], dataStores: [{ type: 'oracle', sizeGb: 300 }] }, { name: 'notification', dependencies: ['auth-service'], apis: [{ endpoint: '/send', consumers: 3 }], dataStores: [{ type: 'redis', sizeGb: 2 }] }] } }, null, 2);
const DEFAULT_RISK = JSON.stringify({ components: [{ name: 'mainframe-batch', criticality: 5, knowledgeHolders: ['alice'], failures: [{ date: '2026-03-12', severity: 4 }, { date: '2026-04-29', severity: 3 }], revenueImpact: 500000 }, { name: 'billing-engine', criticality: 5, knowledgeHolders: ['alice', 'bob'], failures: [{ date: '2026-04-02', severity: 2 }], revenueImpact: 800000 }, { name: 'notification', criticality: 2, knowledgeHolders: ['carol', 'dave', 'eli', 'fern'], failures: [], revenueImpact: 5000 }] }, null, 2);

export function LegacyActionPanel() {
  const [debtText, setDebtText] = useState(DEFAULT_DEBT);
  const [migText, setMigText] = useState(DEFAULT_MIG);
  const [riskText, setRiskText] = useState(DEFAULT_RISK);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [debtResult, setDebtResult] = useState<DebtResult | null>(null);
  const [migResult, setMigResult] = useState<MigrationResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [rollup, setRollup] = useState<{ totalHours: number; weeks: number; estimateCost: number } | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actDebt() {
    try { const parsed = JSON.parse(debtText); setBusy('debt'); setFeedback(null);
      const r = await callMacro<DebtResult>('technicalDebt', { artifact: { data: parsed } });
      if (r.ok && r.result) { setDebtResult(r.result); ok(`Debt ${r.result.summary.totalDebtScore} · ${r.result.summary.totalRemediationHours}h to fix`); } else err(r.error ?? 'debt failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid debt JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMig() {
    try { const parsed = JSON.parse(migText); setBusy('migration'); setFeedback(null);
      const r = await callMacro<MigrationResult>('migrationReadiness', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMigResult(r.result); ok(`Ready ${r.result.summary.readyModules}/${r.result.summary.totalModules} · ${r.result.coupling.level}`); } else err(r.error ?? 'migration failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid mig JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRisk() {
    try { const parsed = JSON.parse(riskText); setBusy('risk'); setFeedback(null);
      const r = await callMacro<RiskResult>('riskMap', { artifact: { data: parsed } });
      if (r.ok && r.result) { setRiskResult(r.result); ok(`${r.result.summary?.criticalCount ?? 0} critical · bus ${r.result.summary?.busFactor ?? '?'}`); } else err(r.error ?? 'risk failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid risk JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRoll() {
    if (!debtResult) { err('Run debt first.'); return; }
    setBusy('roll'); setFeedback(null);
    const totalHours = debtResult.summary.totalRemediationHours;
    const weeks = Math.ceil(totalHours / 40);
    const estimateCost = totalHours * 120;
    setRollup({ totalHours, weeks, estimateCost });
    ok(`${weeks}-week plan · ~$${estimateCost.toLocaleString()} @ $120/h`); setBusy(null);
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Legacy modernization plan`, tags: ['legacy', 'modernization'].filter(Boolean), source: 'legacy:plan:mint', meta: { visibility: 'private', consent: { allowCitations: false }, legacy: { debt: debtResult, migration: migResult, risk: riskResult, rollup } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Plan DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🧱 Legacy audit`, '', debtResult ? `Debt: ${debtResult.summary.totalDebtScore} · ${debtResult.summary.criticalModules} critical · ${debtResult.summary.totalRemediationHours}h to fix` : '', migResult ? `Migration: ${migResult.summary.readyModules}/${migResult.summary.totalModules} ready · ${migResult.coupling.level} (${migResult.coupling.score}%)` : '', riskResult ? `Risk: ${riskResult.summary?.criticalCount ?? 0} critical components · bus factor ${riskResult.summary?.busFactor ?? '?'}` : '', rollup ? `Roll-up: ${rollup.weeks}-week plan, ~$${rollup.estimateCost.toLocaleString()}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!debtResult) { err('Run debt first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Legacy modernization roadmap`, tags: ['legacy', 'roadmap', 'public'], source: 'legacy:roadmap:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, legacy: { debt: debtResult, migration: migResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Legacy modernization architect. ${debtResult ? `Debt: ${debtResult.summary.totalDebtScore} total (${debtResult.summary.criticalModules} critical modules; ~${debtResult.summary.totalRemediationHours}h to fix).` : ''} ${migResult ? `Migration: ${migResult.summary.readyModules}/${migResult.summary.totalModules} ready; coupling ${migResult.coupling.level}.` : ''} ${riskResult ? `Risk: ${riskResult.summary?.criticalCount ?? 0} critical components.` : ''} Recommend the single first migration step + one risk to address. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Architect brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'debt' as ActionId, label: 'Debt', desc: 'technicalDebt (MI)', icon: GitBranch, accent: '#ef4444', handler: actDebt },
    { id: 'migration' as ActionId, label: 'Migration', desc: 'migrationReadiness', icon: ArrowRight, accent: '#3b82f6', handler: actMig },
    { id: 'risk' as ActionId, label: 'Risk', desc: 'riskMap (bus factor)', icon: ShieldAlert, accent: '#f59e0b', handler: actRisk },
    { id: 'roll' as ActionId, label: 'Roll-up', desc: 'Cost + duration', icon: Calculator, accent: '#a855f7', handler: actRoll },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private plan', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send audit', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon roadmap', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Architect', desc: 'Agent: first step', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const LEVEL_COLOR: Record<string, string> = { critical: 'text-red-300', high: 'text-amber-300', moderate: 'text-blue-300', low: 'text-emerald-300', ready: 'text-emerald-300', difficult: 'text-amber-300', blocked: 'text-red-300' };

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <GitBranch className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Legacy modernization bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">debt · migration · risk · roll-up</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Modules JSON</label>
          <textarea value={debtText} onChange={(e) => setDebtText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">System JSON</label>
          <textarea value={migText} onChange={(e) => setMigText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Components JSON</label>
          <textarea value={riskText} onChange={(e) => setRiskText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
        {debtResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Debt · {debtResult.summary.totalDebtScore}</div>
            <div className="text-2xl font-bold text-red-200">{debtResult.summary.totalRemediationHours}<span className="text-xs text-zinc-400">h</span></div>
            <div className="text-[10px] text-zinc-500">{debtResult.summary.criticalModules} critical · MI {debtResult.summary.avgMaintainability}</div>
            {debtResult.modules.slice(0, 5).map((m, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span><strong>{m.name}</strong></span><span className={cn('font-mono text-[9px]', LEVEL_COLOR[m.debtLevel])}>{m.debtScore} · {m.remediationHours}h</span></div>)}
          </div>
        )}
        {migResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Migration</div>
            <div className="text-2xl font-bold text-blue-200">{migResult.summary.readyModules}<span className="text-xs text-zinc-400">/{migResult.summary.totalModules}</span></div>
            <div className="text-[10px] text-zinc-500">{migResult.coupling.level} ({migResult.coupling.score}%) · {migResult.summary.totalDataGb}GB</div>
            {migResult.migrationOrder.slice(0, 5).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>#{p.phase} <strong>{p.module}</strong></span><span className="font-mono text-blue-200">{p.readiness}</span></div>)}
          </div>
        )}
        {riskResult?.summary && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Risk</div>
            <div className="text-2xl font-bold text-amber-200">{riskResult.summary.criticalCount}</div>
            <div className="text-[10px] text-zinc-300">critical · bus factor {riskResult.summary.busFactor} · avg risk {riskResult.summary.avgRisk}</div>
            {(riskResult.components ?? []).slice(0, 5).map((c, i) => <div key={i} className={cn('text-[10px] mt-0.5 flex justify-between', c.severity === 'critical' ? 'text-red-300' : c.severity === 'high' ? 'text-amber-300' : 'text-zinc-300')}><span><strong>{c.component}</strong></span><span className="font-mono text-[9px]">{c.riskScore ?? '?'} · bus {c.busFactor ?? '?'}</span></div>)}
          </div>
        )}
        {rollup && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Roll-up</div>
            <div className="text-2xl font-bold text-purple-200">{rollup.weeks}<span className="text-xs text-zinc-400">wk</span></div>
            <div className="text-[10px] text-zinc-300">{rollup.totalHours}h · ${rollup.estimateCost.toLocaleString()} @ $120/h</div>
            <div className="text-[10px] text-zinc-500 mt-1">Single engineer · serial</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Architect brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
