'use client';


/**
 * SentinelScanConfig — configurable scan scope + custom detection rules.
 * Toggles active scan scopes, sets the auto-triage threshold, manages a
 * rule book (pattern → severity), and evaluates rules against content.
 * Wires sentinel.scan.config.* + sentinel.scan.rule.* + sentinel.scan.evaluate.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Settings2, Loader2, Plus, Trash2, FlaskConical } from 'lucide-react';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

interface ScanRule {
  ruleId: string;
  name: string;
  pattern: string;
  severity: string;
  enabled: boolean;
  createdAt: string;
}
interface ScanConfig {
  scopes: string[];
  activeScopes: string[];
  rules: ScanRule[];
  autoTriageMinSeverity: string;
  updatedAt: string;
}
interface RuleMatch { ruleId: string; name: string; severity: string }

export function SentinelScanConfig() {
  const [config, setConfig] = useState<ScanConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [ruleName, setRuleName] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState<(typeof SEVERITIES)[number]>('medium');

  const [evalContent, setEvalContent] = useState('');
  const [evalResult, setEvalResult] = useState<
    { matches: RuleMatch[]; matchCount: number; rulesEvaluated: number } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('sentinel', 'scan.config.get', {});
    setConfig((r.data?.result as { config?: ScanConfig } | null)?.config ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleScope(scope: string) {
    if (!config) return;
    setBusy(true);
    const next = config.activeScopes.includes(scope)
      ? config.activeScopes.filter((s) => s !== scope)
      : [...config.activeScopes, scope];
    const r = await lensRun('sentinel', 'scan.config.set', { activeScopes: next });
    setConfig((r.data?.result as { config?: ScanConfig } | null)?.config ?? config);
    setBusy(false);
  }

  async function setThreshold(sev: string) {
    setBusy(true);
    const r = await lensRun('sentinel', 'scan.config.set', { autoTriageMinSeverity: sev });
    setConfig((r.data?.result as { config?: ScanConfig } | null)?.config ?? config);
    setBusy(false);
  }

  async function addRule() {
    if (!rulePattern.trim()) return;
    setBusy(true);
    const r = await lensRun('sentinel', 'scan.rule.add', {
      name: ruleName.trim() || undefined,
      pattern: rulePattern.trim(),
      severity: ruleSeverity,
    });
    setConfig((r.data?.result as { config?: ScanConfig } | null)?.config ?? config);
    setRuleName('');
    setRulePattern('');
    setBusy(false);
  }

  async function removeRule(ruleId: string) {
    setBusy(true);
    const r = await lensRun('sentinel', 'scan.rule.remove', { ruleId });
    setConfig((r.data?.result as { config?: ScanConfig } | null)?.config ?? config);
    setBusy(false);
  }

  async function evaluate() {
    if (!evalContent.trim()) return;
    setBusy(true);
    const r = await lensRun('sentinel', 'scan.evaluate', { content: evalContent });
    setEvalResult(
      r.data?.ok
        ? (r.data.result as { matches: RuleMatch[]; matchCount: number; rulesEvaluated: number })
        : { matches: [], matchCount: 0, rulesEvaluated: 0 },
    );
    setBusy(false);
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-3 py-8 text-xs text-blue-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading scan configuration…
      </p>
    );
  }
  if (!config) return <p className="px-3 py-8 text-xs text-blue-700">No scan configuration available.</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
            <Settings2 className="h-4 w-4" /> Scan scope
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {config.scopes.map((scope) => {
              const active = config.activeScopes.includes(scope);
              return (
                <button
                  key={scope}
                  disabled={busy}
                  onClick={() => toggleScope(scope)}
                  className={`rounded px-2.5 py-1 text-xs capitalize transition-colors disabled:opacity-40 ${
                    active ? 'bg-blue-700/60 text-blue-100' : 'bg-blue-950/40 text-blue-500 hover:text-blue-300'
                  }`}
                  aria-pressed={active}
                >
                  {scope}
                </button>
              );
            })}
          </div>
          <p className="mt-3 mb-1.5 text-[10px] uppercase tracking-wider text-blue-700">
            Auto-triage threshold
          </p>
          <div className="flex gap-1.5">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => setThreshold(s)}
                className={`rounded px-2 py-1 text-xs capitalize disabled:opacity-40 ${
                  config.autoTriageMinSeverity === s
                    ? 'bg-blue-700/60 text-blue-100'
                    : 'bg-blue-950/40 text-blue-500 hover:text-blue-300'
                }`}
                aria-pressed={config.autoTriageMinSeverity === s}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-blue-700">
            Updated {new Date(config.updatedAt).toLocaleString()}
          </p>
        </div>

        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-200">New detection rule</h3>
          <div className="space-y-2">
            <input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Rule name (optional)…"
              className="w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
              aria-label="Rule name"
            />
            <input
              value={rulePattern}
              onChange={(e) => setRulePattern(e.target.value)}
              placeholder="Pattern (regex or substring)…"
              className="w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 font-mono text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
              aria-label="Rule pattern"
            />
            <div className="flex gap-2">
              <select
                value={ruleSeverity}
                onChange={(e) => setRuleSeverity(e.target.value as (typeof SEVERITIES)[number])}
                className="rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs capitalize text-blue-100 focus:border-blue-500 focus:outline-none"
                aria-label="Rule severity"
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                disabled={busy || !rulePattern.trim()}
                onClick={addRule}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-200">
            Rule book ({config.rules.length})
          </h3>
          {config.rules.length === 0 ? (
            <p className="py-4 text-center text-xs text-blue-700">No custom rules yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {config.rules.map((r) => (
                <li key={r.ruleId} className="flex items-center gap-2 rounded border border-blue-900/30 bg-black/30 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-rose-900/40 px-1 py-0.5 text-[9px] uppercase text-rose-200">
                    {r.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-blue-100">{r.name}</span>
                    <span className="block truncate font-mono text-[10px] text-blue-600">{r.pattern}</span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => removeRule(r.ruleId)}
                    className="shrink-0 text-blue-700 hover:text-rose-400 disabled:opacity-40"
                    aria-label="Remove rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
            <FlaskConical className="h-4 w-4" /> Test rules against content
          </h3>
          <textarea
            value={evalContent}
            onChange={(e) => setEvalContent(e.target.value)}
            placeholder="Paste content to evaluate against the rule book…"
            className="h-20 w-full rounded border border-blue-900/40 bg-black/40 p-2 font-mono text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
            aria-label="Content to evaluate"
          />
          <button
            disabled={busy || !evalContent.trim()}
            onClick={evaluate}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Evaluate
          </button>
          {evalResult && (
            <div className="mt-3 text-xs">
              <p className="text-blue-400">
                {evalResult.matchCount} match{evalResult.matchCount === 1 ? '' : 'es'} across{' '}
                {evalResult.rulesEvaluated} rule{evalResult.rulesEvaluated === 1 ? '' : 's'}.
              </p>
              {evalResult.matches.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {evalResult.matches.map((m) => (
                    <li key={m.ruleId} className="flex items-center gap-2 rounded border border-rose-700/40 bg-rose-950/20 px-2 py-1">
                      <span className="rounded bg-rose-900/40 px-1 py-0.5 text-[9px] uppercase text-rose-200">
                        {m.severity}
                      </span>
                      <span className="text-blue-100">{m.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
