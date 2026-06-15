'use client';

/**
 * CodeActionPanel — VS Code-shape developer workbench. Surfaces the
 * code analysis + snippet/snapshot macros plus mint/DM/publish/agent.
 *
 *   1. Complexity  - code.complexityAnalysis (cyclomatic / cognitive)
 *   2. Deps audit  - code.dependencyAudit (count + risk score)
 *   3. Coverage    - code.coverageAnalysis (uncovered lines + density)
 *   4. Snapshot    - code.commit-snapshot (versioned snapshot artifact)
 *   5. Save snippet - code.snippets-save (named snippet stash)
 *   6. Mint        - dtu.create private code-review DTU
 *   7. DM reviewer - send snippet + analysis to reviewer
 *   8. Publish gist - public DTU + flag published
 *   9. Refactor (agent) - chat_agent.do propose 3 refactors
 */

import { useState } from 'react';
import {
  Code, Activity, Box, ShieldCheck, GitCommit, Save,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('code', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'complexity' | 'deps' | 'coverage' | 'snapshot' | 'snippet' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ComplexityResult { cyclomatic?: number; cognitive?: number; lines?: number; functions?: number; risk?: string }
interface DepsResult { total?: number; outdated?: number; security?: number; riskScore?: number }
interface CoverageResult { coveragePct?: number; uncoveredLines?: number; totalLines?: number; band?: string }

export function CodeActionPanel() {
  const [snippetName, setSnippetName] = useState('');
  const [snippetCode, setSnippetCode] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [snapshotMsg, setSnapshotMsg] = useState('');
  const [reviewer, setReviewer] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [complexityResult, setComplexityResult] = useState<ComplexityResult | null>(null);
  const [depsResult, setDepsResult] = useState<DepsResult | null>(null);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [savedSnippetId, setSavedSnippetId] = useState<string | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const ready = snippetCode.trim().length > 0;

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actComplexity() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('complexity'); setFeedback(null);
    try {
      const r = await callMacro<ComplexityResult>('complexityAnalysis', { code: snippetCode, language });
      if (r.ok && r.result) { setComplexityResult(r.result); pipe.publish('code.complexity', r.result, { label: `Cyclomatic ${r.result.cyclomatic ?? '?'}` }); ok(`Cyclomatic: ${r.result.cyclomatic ?? '—'}.`); }
      else err(r.error ?? 'complexity failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDeps() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('deps'); setFeedback(null);
    try {
      const r = await callMacro<DepsResult>('dependencyAudit', { code: snippetCode, language });
      if (r.ok && r.result) { setDepsResult(r.result); pipe.publish('code.deps', r.result, { label: `Deps ${r.result.total ?? 0}` }); ok(`Deps: ${r.result.total ?? 0}, ${r.result.outdated ?? 0} outdated.`); }
      else err(r.error ?? 'deps failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actCoverage() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('coverage'); setFeedback(null);
    try {
      const r = await callMacro<CoverageResult>('coverageAnalysis', { code: snippetCode, language });
      if (r.ok && r.result) { setCoverageResult(r.result); pipe.publish('code.coverage', r.result, { label: `Coverage ${r.result.coveragePct ?? 0}%` }); ok(`Coverage: ${r.result.coveragePct ?? 0}%.`); }
      else err(r.error ?? 'coverage failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actSnapshot() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('snapshot'); setFeedback(null);
    try {
      const r = await callMacro<{ snapshotId?: string }>('commit-snapshot', { code: snippetCode, message: snapshotMsg || 'manual snapshot', language });
      if (r.ok && r.result?.snapshotId) { setSnapshotId(r.result.snapshotId); ok(`Snapshot ${r.result.snapshotId.slice(0, 8)}…`); }
      else err(r.error ?? 'snapshot failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actSnippet() {
    if (!snippetName.trim() || !ready) { err('Snippet name + code required.'); return; }
    setBusy('snippet'); setFeedback(null);
    try {
      const r = await callMacro<{ id?: string }>('snippets-save', { name: snippetName.trim(), code: snippetCode, language });
      if (r.ok && r.result?.id) { setSavedSnippetId(r.result.id); ok(`Snippet saved ${r.result.id.slice(0, 8)}…`); }
      else err(r.error ?? 'snippet save failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Code review — ${snippetName.trim() || `${language} snippet`}`,
          tags: ['code', 'review', language, complexityResult?.risk ?? 'unknown'],
          source: 'code:review:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, codeReview: { language, code: snippetCode.slice(0, 4000), complexity: complexityResult, deps: depsResult, coverage: coverageResult, snapshotId, snippetId: savedSnippetId } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('code.mintedDtuId', id, { label: `Review DTU ${id.slice(0, 8)}…` }); ok(`Review DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!ready) { err('Paste code.'); return; }
    if (!reviewer.trim()) { err('Enter a reviewer.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🔍 Code review request — ${language}`, '',
      complexityResult ? `Complexity: cyclomatic ${complexityResult.cyclomatic} · risk ${complexityResult.risk}` : '',
      coverageResult ? `Coverage: ${coverageResult.coveragePct}% (${coverageResult.band})` : '',
      depsResult ? `Deps: ${depsResult.total} (${depsResult.outdated} outdated)` : '',
      '', '```' + language, snippetCode.slice(0, 2000), '```',
      mintedDtuId ? `\n[Review DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: reviewer.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok(`Sent to ${reviewer.trim()}. 60s to recall.`); setReviewer(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Public gist — ${snippetName.trim() || `${language} snippet`}`,
            tags: ['code', 'gist', 'public', language],
            source: 'code:gist:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, gist: { language, name: snippetName.trim(), code: snippetCode } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('code.publishedDtuId', id, { label: `Public gist ${id.slice(0, 8)}…` }); ok(`Gist published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    if (!ready) { err('Paste code.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Review this ${language} code and propose the 3 highest-leverage refactors.`,
        `Each refactor: 1) the smell (1 sentence), 2) the rewrite (1-2 lines or diff sketch), 3) why it pays off.`,
        complexityResult ? `Context: cyclomatic ${complexityResult.cyclomatic}, risk ${complexityResult.risk}.` : '',
        '', 'Code:', snippetCode.slice(0, 3000),
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('3 refactors ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void }> = [
    { id: 'complexity', label: 'Complexity',  desc: 'Cyclomatic + cognitive + risk band', icon: Activity,    accent: '#06b6d4', handler: actComplexity },
    { id: 'deps',       label: 'Deps audit',  desc: 'Count + outdated + security flags',   icon: Box,         accent: '#8b5cf6', handler: actDeps },
    { id: 'coverage',   label: 'Coverage',    desc: 'Uncovered-line density',              icon: ShieldCheck, accent: '#22c55e', handler: actCoverage },
    { id: 'snapshot',   label: snapshotId      ? 'Snapshotted' : 'Commit',     desc: snapshotId      ? `id ${snapshotId.slice(0, 8)}…`      : 'commit-snapshot versioned',                  icon: GitCommit, accent: '#eab308', handler: actSnapshot },
    { id: 'snippet',    label: savedSnippetId  ? 'Snippet saved' : 'Save snippet', desc: savedSnippetId  ? `id ${savedSnippetId.slice(0, 8)}…`  : 'snippets-save named stash',              icon: Save,      accent: '#f97316', handler: actSnippet },
    { id: 'mint',       label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private review DTU',                         icon: Sparkles,  accent: '#3b82f6', handler: actMint },
    { id: 'dm',         label: 'DM reviewer', desc: 'Send code + analysis to reviewer',   icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',    label: publishedDtuId ? 'Published' : 'Publish gist',  desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public gist DTU + federation',              icon: Globe,     accent: '#15803d', handler: actPublish },
    { id: 'agent',      label: 'Refactor',    desc: 'Agent: 3 highest-leverage refactors', icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Code className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Code review workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={snippetName} onChange={(e) => setSnippetName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Snippet name" />
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
          {['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'ruby', 'c', 'cpp', 'sql'].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input type="text" value={snapshotMsg} onChange={(e) => setSnapshotMsg(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Snapshot message" />
        <input type="text" value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Reviewer user id" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <textarea value={snippetCode} onChange={(e) => setSnippetCode(e.target.value)} rows={10} className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-[12px] text-cyan-100 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400/40 resize-y leading-relaxed" />

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {complexityResult && (
          <div className={cn('rounded-md border p-2.5', complexityResult.risk === 'high' ? 'border-rose-500/40 bg-rose-500/5' : complexityResult.risk === 'medium' ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 capitalize" style={{ color: complexityResult.risk === 'high' ? '#fda4af' : complexityResult.risk === 'medium' ? '#fcd34d' : '#86efac' }}>
              <Activity className="w-3 h-3" /> Complexity {complexityResult.risk}
            </div>
            <div className="text-[11px] text-zinc-300 mt-1 space-y-0.5">
              <div>cyclomatic <span className="font-mono">{complexityResult.cyclomatic}</span></div>
              {complexityResult.cognitive != null && <div>cognitive <span className="font-mono">{complexityResult.cognitive}</span></div>}
              {complexityResult.lines != null && <div>{complexityResult.lines} lines · {complexityResult.functions} fns</div>}
            </div>
          </div>
        )}
        {depsResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><Box className="w-3 h-3" /> Dependencies</div>
            <div className="text-[11px] text-zinc-300 mt-1">{depsResult.total} total · <span className="text-amber-300">{depsResult.outdated} outdated</span> · <span className="text-rose-300">{depsResult.security} security</span></div>
            {depsResult.riskScore != null && <div className="text-[10px] text-zinc-400">risk score {depsResult.riskScore}</div>}
          </div>
        )}
        {coverageResult && (
          <div className={cn('rounded-md border p-2.5', (coverageResult.coveragePct ?? 0) >= 80 ? 'border-emerald-500/40 bg-emerald-500/5' : (coverageResult.coveragePct ?? 0) >= 50 ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 capitalize" style={{ color: (coverageResult.coveragePct ?? 0) >= 80 ? '#86efac' : (coverageResult.coveragePct ?? 0) >= 50 ? '#fcd34d' : '#fda4af' }}>
              <ShieldCheck className="w-3 h-3" /> Coverage {coverageResult.band}
            </div>
            <div className="text-2xl font-bold text-zinc-100 mt-1">{coverageResult.coveragePct}%</div>
            {coverageResult.uncoveredLines != null && <div className="text-[10px] text-zinc-400">{coverageResult.uncoveredLines} uncovered / {coverageResult.totalLines} total</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-96 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Refactor proposals</div>
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
