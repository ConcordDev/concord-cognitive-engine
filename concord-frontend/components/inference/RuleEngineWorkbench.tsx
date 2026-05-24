'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * RuleEngineWorkbench — a Prolog/Drools-style logic rule engine surface for
 * the inference lens. Every value rendered comes from a real `inference`
 * domain macro: kb-add, kb-list, kb-remove, kb-clear, kb-check, kb-query,
 * kb-explain, kb-trace, kb-forward, kb-seed-sample.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';
import {
  BookOpen, Play, Search, Trash2, CheckCircle2, XCircle, AlertTriangle,
  Sparkles, ListTree, HelpCircle, GitBranch, Loader2, RefreshCw, Zap,
} from 'lucide-react';

// ── Macro result shapes ───────────────────────────────────────────────
interface KbFact { id: string; predicate: string; args: string[]; addedAt: string }
interface KbRule {
  id: string; name: string; priority: number; text: string; addedAt: string;
  if: { predicate: string; args: string[]; negated?: boolean }[];
  then: { predicate: string; args: string[] };
}
interface KbListResult {
  facts: KbFact[]; rules: KbRule[]; factCount: number; ruleCount: number;
  predicates: Record<string, number>;
}
interface CheckRow {
  line: string; valid: boolean; error?: string; kind?: string;
  predicate?: string; variables?: string[];
}
interface QueryResult {
  goal: string; proved: boolean; solutionCount: number; answerCount: number;
  answers: Record<string, string>[]; proofTrees: TreeNode[]; nodesExplored: number;
  traceLength: number;
}
interface ExplainResult {
  fact: string; derivable: boolean; why: string;
  how: { conclusion: string; via: string; kind: string }[];
  stepCount?: number; proofTree: TreeNode | null; nodesExplored: number;
}
interface TraceStep {
  step: number; depth: number; indent: string; goal: string;
  kind: string; action: string; result: any;
}
interface TraceResult {
  goal: string; proved: boolean; steps: TraceStep[]; stepCount: number;
  nodesExplored: number; builtins: string[];
}
interface ForwardResult {
  strategy: string; initialFactCount: number; derivedFactCount: number;
  totalFactCount: number; iterations: number; fixedPointReached: boolean;
  derivedFacts: string[]; rulesApplied: string[];
  derivationLog: { iteration: number; fired: string; priority: number; conflictSetSize: number; derived: string; strategy: string }[];
  factsByPredicate: Record<string, number>;
}

type Tab = 'editor' | 'query' | 'explain' | 'trace' | 'forward';

const STRATEGIES: { id: string; label: string; hint: string }[] = [
  { id: 'priority', label: 'Priority', hint: 'Highest rule priority fires first' },
  { id: 'recency', label: 'Recency', hint: 'Most recently added rule fires first' },
  { id: 'specificity', label: 'Specificity', hint: 'Rule with most conditions fires first' },
  { id: 'order', label: 'Insertion order', hint: 'First-added rule fires first' },
];

const TAB_META: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'editor', label: 'Rule Editor & KB', icon: BookOpen },
  { id: 'query', label: 'Query + Proof Tree', icon: Search },
  { id: 'explain', label: 'Why / How', icon: HelpCircle },
  { id: 'trace', label: 'Step Console', icon: ListTree },
  { id: 'forward', label: 'Forward Chain', icon: Zap },
];

export function RuleEngineWorkbench() {
  const [tab, setTab] = useState<Tab>('editor');

  // KB state
  const [kb, setKb] = useState<KbListResult | null>(null);
  const [kbBusy, setKbBusy] = useState(false);

  // Editor state
  const [draft, setDraft] = useState('');
  const [priority, setPriority] = useState(0);
  const [checkRows, setCheckRows] = useState<CheckRow[] | null>(null);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);

  // Query state
  const [goal, setGoal] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);

  // Explain state
  const [explainFact, setExplainFact] = useState('');
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [explainErr, setExplainErr] = useState<string | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);

  // Trace state
  const [traceGoal, setTraceGoal] = useState('');
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const [traceCursor, setTraceCursor] = useState(0);
  const [traceBusy, setTraceBusy] = useState(false);

  // Forward state
  const [strategy, setStrategy] = useState('priority');
  const [forwardResult, setForwardResult] = useState<ForwardResult | null>(null);
  const [forwardErr, setForwardErr] = useState<string | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);

  // ── KB loader ───────────────────────────────────────────────────────
  const loadKb = useCallback(async () => {
    setKbBusy(true);
    const r = await lensRun<KbListResult>('inference', 'kb-list', {});
    if (r.data.ok && r.data.result) setKb(r.data.result);
    setKbBusy(false);
  }, []);

  useEffect(() => {
    loadKb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Editor actions ──────────────────────────────────────────────────
  const handleCheck = useCallback(async () => {
    if (!draft.trim()) return;
    setEditorBusy(true);
    setAddMsg(null);
    const r = await lensRun<{ report: CheckRow[] }>('inference', 'kb-check', { text: draft });
    setCheckRows(r.data.ok && r.data.result ? r.data.result.report : null);
    setEditorBusy(false);
  }, [draft]);

  const handleAdd = useCallback(async () => {
    if (!draft.trim()) return;
    setEditorBusy(true);
    const r = await lensRun<{ addedCount: number; errorCount: number; errors: { line: string; error: string }[] }>(
      'inference', 'kb-add', { text: draft, priority },
    );
    if (r.data.ok && r.data.result) {
      const { addedCount, errorCount, errors } = r.data.result;
      setAddMsg({
        ok: errorCount === 0,
        text: errorCount === 0
          ? `Added ${addedCount} clause${addedCount === 1 ? '' : 's'} to the knowledge base.`
          : `Added ${addedCount}, rejected ${errorCount}: ${errors.map((e) => e.error).join('; ')}`,
      });
      if (addedCount > 0) setDraft('');
      setCheckRows(null);
      await loadKb();
    } else {
      setAddMsg({ ok: false, text: r.data.error || 'kb-add failed' });
    }
    setEditorBusy(false);
  }, [draft, priority, loadKb]);

  const handleSeed = useCallback(async () => {
    setEditorBusy(true);
    await lensRun('inference', 'kb-seed-sample', {});
    setAddMsg({ ok: true, text: 'Seeded the family-relations sample rule set.' });
    await loadKb();
    setEditorBusy(false);
  }, [loadKb]);

  const handleRemove = useCallback(async (id: string) => {
    await lensRun('inference', 'kb-remove', { id });
    await loadKb();
  }, [loadKb]);

  const handleClear = useCallback(async () => {
    await lensRun('inference', 'kb-clear', {});
    setAddMsg(null);
    setCheckRows(null);
    await loadKb();
  }, [loadKb]);

  // ── Query ───────────────────────────────────────────────────────────
  const handleQuery = useCallback(async () => {
    if (!goal.trim()) return;
    setQueryBusy(true);
    setQueryErr(null);
    setQueryResult(null);
    const r = await lensRun<QueryResult>('inference', 'kb-query', { goal });
    if (r.data.ok && r.data.result) setQueryResult(r.data.result);
    else setQueryErr(r.data.error || 'query failed');
    setQueryBusy(false);
  }, [goal]);

  // ── Explain ─────────────────────────────────────────────────────────
  const handleExplain = useCallback(async () => {
    if (!explainFact.trim()) return;
    setExplainBusy(true);
    setExplainErr(null);
    setExplainResult(null);
    const r = await lensRun<ExplainResult>('inference', 'kb-explain', { fact: explainFact });
    if (r.data.ok && r.data.result) setExplainResult(r.data.result);
    else setExplainErr(r.data.error || 'explain failed');
    setExplainBusy(false);
  }, [explainFact]);

  // ── Trace ───────────────────────────────────────────────────────────
  const handleTrace = useCallback(async () => {
    if (!traceGoal.trim()) return;
    setTraceBusy(true);
    setTraceErr(null);
    setTraceResult(null);
    setTraceCursor(0);
    const r = await lensRun<TraceResult>('inference', 'kb-trace', { goal: traceGoal });
    if (r.data.ok && r.data.result) {
      setTraceResult(r.data.result);
      setTraceCursor(1);
    } else {
      setTraceErr(r.data.error || 'trace failed');
    }
    setTraceBusy(false);
  }, [traceGoal]);

  // ── Forward chain ───────────────────────────────────────────────────
  const handleForward = useCallback(async () => {
    setForwardBusy(true);
    setForwardErr(null);
    setForwardResult(null);
    const r = await lensRun<ForwardResult>('inference', 'kb-forward', { strategy });
    if (r.data.ok && r.data.result) {
      setForwardResult(r.data.result);
      await loadKb();
    } else {
      setForwardErr(r.data.error || 'forward chain failed');
    }
    setForwardBusy(false);
  }, [strategy, loadKb]);

  const factCount = kb?.factCount ?? 0;
  const ruleCount = kb?.ruleCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Header + KB stats */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Logic Rule Engine</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            prolog · drools-style
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-400">
            <span className="font-mono text-cyan-300">{factCount}</span> facts
          </span>
          <span className="text-zinc-400">
            <span className="font-mono text-fuchsia-300">{ruleCount}</span> rules
          </span>
          <button
            onClick={loadKb}
            disabled={kbBusy}
            className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-400 hover:text-white disabled:opacity-50"
          >
            {kbBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Reload KB
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5">
        {TAB_META.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Rule Editor & KB Manager ── */}
      {tab === 'editor' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-300">Rule / Fact Editor</h3>
              <span className="font-mono text-[10px] text-zinc-400">
                {`head(a,b).  head(?X) :- body1(?X), not body2(?X).`}
              </span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={'parent(tom,bob).\nancestor(?X,?Y) :- parent(?X,?Y).\nancestor(?X,?Z) :- parent(?X,?Y), ancestor(?Y,?Z).'}
              spellCheck={false}
              className="h-44 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 focus:border-cyan-500/40 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                Priority
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 0)}
                  className="w-16 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 font-mono text-xs text-white"
                />
              </label>
              <button
                onClick={handleCheck}
                disabled={editorBusy || !draft.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Syntax Check
              </button>
              <button
                onClick={handleAdd}
                disabled={editorBusy || !draft.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
              >
                {editorBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Add to KB
              </button>
              <button
                onClick={handleSeed}
                disabled={editorBusy}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" /> Seed Sample
              </button>
            </div>

            {addMsg && (
              <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                addMsg.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/5 text-rose-300'
              }`}>
                {addMsg.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{addMsg.text}</span>
              </div>
            )}

            {checkRows && (
              <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Syntax check report</p>
                {checkRows.map((row, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    {row.valid
                      ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                      : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />}
                    <span className="font-mono text-zinc-300">{row.line}</span>
                    {row.valid ? (
                      <span className="text-zinc-400">
                        {row.kind} · {row.predicate}
                        {row.variables && row.variables.length > 0 && ` · vars: ${row.variables.join(', ')}`}
                      </span>
                    ) : (
                      <span className="text-rose-400">{row.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* KB manager list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-300">Knowledge Base</h3>
              <button
                onClick={handleClear}
                disabled={factCount + ruleCount === 0}
                className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/15 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" /> Clear all
              </button>
            </div>

            {kb && Object.keys(kb.predicates).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(kb.predicates).map(([pred, n]) => (
                  <span key={pred} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                    {pred}/{n}
                  </span>
                ))}
              </div>
            )}

            <div className="max-h-[460px] space-y-3 overflow-y-auto">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Facts ({factCount})</p>
                {factCount === 0 && <p className="text-[11px] text-zinc-400">No facts yet.</p>}
                {kb?.facts.map((f) => (
                  <div key={f.id} className="group flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
                    <span className="font-mono text-[11px] text-emerald-300">
                      {f.predicate}({f.args.join(',')})
                    </span>
                    <button
                      onClick={() => handleRemove(f.id)}
                      className="text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-400"
                      aria-label={`Remove fact ${f.predicate}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Rules ({ruleCount})</p>
                {ruleCount === 0 && <p className="text-[11px] text-zinc-400">No rules yet.</p>}
                {kb?.rules.map((r) => (
                  <div key={r.id} className="group flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] text-fuchsia-300">{r.text}</span>
                      <span className="ml-2 text-[10px] text-zinc-400">
                        {r.name} · prio {r.priority}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemove(r.id)}
                      className="text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-400"
                      aria-label={`Remove rule ${r.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Query + Proof Tree ── */}
      {tab === 'query' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleQuery(); }}
              placeholder="ancestor(tom,?Who)   —  backward-chained SLD query"
              spellCheck={false}
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-cyan-500/40 focus:outline-none"
            />
            <button
              onClick={handleQuery}
              disabled={queryBusy || !goal.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
            >
              {queryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Solve
            </button>
          </div>
          <p className="text-[11px] text-zinc-400">
            Supports negation-as-failure (<span className="font-mono">not pred(...)</span>) and built-ins:
            gt, lt, gte, lte, eq, neq, add, sub, mul, div, length, member.
          </p>

          {queryErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{queryErr}</div>
          )}

          {queryResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Proved" value={queryResult.proved ? 'YES' : 'NO'} tone={queryResult.proved ? 'good' : 'bad'} />
                <Stat label="Answers" value={String(queryResult.answerCount)} />
                <Stat label="Solutions" value={String(queryResult.solutionCount)} />
                <Stat label="Nodes explored" value={String(queryResult.nodesExplored)} />
              </div>

              {queryResult.answers.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Variable bindings</p>
                  <div className="space-y-1">
                    {queryResult.answers.map((ans, i) => (
                      <div key={i} className="flex flex-wrap gap-2 font-mono text-[11px]">
                        {Object.keys(ans).length === 0
                          ? <span className="text-emerald-300">true (ground goal)</span>
                          : Object.entries(ans).map(([v, val]) => (
                            <span key={v} className="rounded bg-zinc-800 px-1.5 py-0.5">
                              <span className="text-cyan-300">{v}</span>
                              <span className="text-zinc-400"> = </span>
                              <span className="text-emerald-300">{val}</span>
                            </span>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
                  Proof tree{queryResult.proofTrees.length > 1 ? ` (${queryResult.proofTrees.length} shown)` : ''}
                </p>
                <TreeDiagram root={queryResult.proofTrees.length > 0 ? queryResult.proofTrees : null} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Explain (why / how) ── */}
      {tab === 'explain' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={explainFact}
              onChange={(e) => setExplainFact(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleExplain(); }}
              placeholder="grandparent(tom,ann)   —  ground fact to explain"
              spellCheck={false}
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-cyan-500/40 focus:outline-none"
            />
            <button
              onClick={handleExplain}
              disabled={explainBusy || !explainFact.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40"
            >
              {explainBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HelpCircle className="h-3.5 w-3.5" />}
              Explain
            </button>
          </div>

          {explainErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{explainErr}</div>
          )}

          {explainResult && (
            <div className="space-y-3">
              <div className={`rounded-lg border px-3 py-2.5 text-xs ${
                explainResult.derivable
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-200'
              }`}>
                <p className="mb-1 text-[10px] uppercase tracking-wider opacity-70">Why</p>
                {explainResult.why}
              </div>

              {explainResult.how.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
                    How — derivation steps ({explainResult.how.length})
                  </p>
                  <ol className="space-y-1">
                    {explainResult.how.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px]">
                        <span className="font-mono text-zinc-600">{i + 1}.</span>
                        <span className="font-mono text-cyan-300">{step.conclusion}</span>
                        <span className="text-zinc-400">via {step.via}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {explainResult.proofTree && (
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Proof tree</p>
                  <TreeDiagram root={explainResult.proofTree} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step-through console ── */}
      {tab === 'trace' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={traceGoal}
              onChange={(e) => setTraceGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTrace(); }}
              placeholder="ancestor(tom,jim)   —  trace SLD resolution step-by-step"
              spellCheck={false}
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-cyan-500/40 focus:outline-none"
            />
            <button
              onClick={handleTrace}
              disabled={traceBusy || !traceGoal.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
            >
              {traceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5" />}
              Trace
            </button>
          </div>

          {traceErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{traceErr}</div>
          )}

          {traceResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Stat label="Result" value={traceResult.proved ? 'PROVED' : 'FAILED'} tone={traceResult.proved ? 'good' : 'bad'} />
                <Stat label="Total steps" value={String(traceResult.stepCount)} />
                <Stat label="Nodes" value={String(traceResult.nodesExplored)} />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setTraceCursor((c) => Math.max(1, c - 1))}
                    disabled={traceCursor <= 1}
                    className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  >
                    ◀ Prev
                  </button>
                  <span className="font-mono text-[11px] text-zinc-400">
                    {traceCursor} / {traceResult.stepCount}
                  </span>
                  <button
                    onClick={() => setTraceCursor((c) => Math.min(traceResult.stepCount, c + 1))}
                    disabled={traceCursor >= traceResult.stepCount}
                    className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  >
                    Next ▶
                  </button>
                  <button
                    onClick={() => setTraceCursor(traceResult.stepCount)}
                    className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  >
                    Run all
                  </button>
                </div>
              </div>

              <div className="max-h-[400px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px]">
                {traceResult.steps.slice(0, traceCursor).map((s) => (
                  <div
                    key={s.step}
                    className={`flex items-baseline gap-2 py-0.5 ${
                      s.step === traceCursor ? 'rounded bg-cyan-500/10' : ''
                    }`}
                  >
                    <span className="w-8 shrink-0 text-right text-zinc-600">{s.step}</span>
                    <span className="text-zinc-300" style={{ paddingLeft: s.depth * 12 }}>
                      <span className={STEP_TONE[s.kind] || 'text-zinc-400'}>[{s.kind}]</span>{' '}
                      <span className="text-cyan-300">{s.goal}</span>{' '}
                      <span className="text-zinc-400">— {s.action}</span>{' '}
                      <span className={s.result === true ? 'text-emerald-400' : s.result === false ? 'text-rose-400' : 'text-amber-400'}>
                        {String(s.result)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Forward chaining + conflict resolution ── */}
      {tab === 'forward' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStrategy(s.id)}
                title={s.hint}
                className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                  strategy === s.id
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                <p className="font-medium">{s.label}</p>
                <p className="mt-0.5 text-[10px] opacity-70">{s.hint}</p>
              </button>
            ))}
          </div>
          <button
            onClick={handleForward}
            disabled={forwardBusy || factCount === 0}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
          >
            {forwardBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Run Forward Chain ({strategy})
          </button>
          {factCount === 0 && (
            <p className="text-[11px] text-amber-400">
              Knowledge base has no facts — add some in the Rule Editor first.
            </p>
          )}

          {forwardErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{forwardErr}</div>
          )}

          {forwardResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Initial facts" value={String(forwardResult.initialFactCount)} />
                <Stat label="Derived" value={String(forwardResult.derivedFactCount)} tone="good" />
                <Stat label="Total facts" value={String(forwardResult.totalFactCount)} />
                <Stat label="Iterations" value={String(forwardResult.iterations)} />
                <Stat
                  label="Fixed point"
                  value={forwardResult.fixedPointReached ? 'YES' : 'NO'}
                  tone={forwardResult.fixedPointReached ? 'good' : 'bad'}
                />
              </div>

              {forwardResult.derivedFacts.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Derived facts</p>
                  <div className="flex flex-wrap gap-1.5">
                    {forwardResult.derivedFacts.map((f, i) => (
                      <span key={i} className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {forwardResult.derivationLog.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
                    Conflict-resolution log — strategy: {forwardResult.strategy}
                  </p>
                  <div className="space-y-0.5 font-mono text-[11px]">
                    {forwardResult.derivationLog.map((d, i) => (
                      <div key={i} className="flex flex-wrap items-baseline gap-2">
                        <span className="w-8 text-right text-zinc-600">#{d.iteration}</span>
                        <span className="text-fuchsia-300">{d.fired}</span>
                        <span className="text-zinc-400">prio {d.priority}</span>
                        <span className="text-zinc-400">conflict-set {d.conflictSetSize}</span>
                        <span className="text-zinc-400">→</span>
                        <span className="text-emerald-300">{d.derived}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STEP_TONE: Record<string, string> = {
  fact: 'text-emerald-400',
  'rule-try': 'text-fuchsia-400',
  builtin: 'text-amber-400',
  negation: 'text-indigo-400',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-cyan-300';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-lg ${color}`}>{value}</div>
    </div>
  );
}
