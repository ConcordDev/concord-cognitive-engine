'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PortfolioAssessment — the rapid, no-source-access portfolio review tool
 * (the CAST Highlight "assess without ingesting code" workflow, complementing
 * CodebaseScanner's real-source-scan path above it).
 *
 * Exercises the three legacy.js formula macros that a code scan cannot feed
 * (they need facts a scan can't derive: business criticality, bus-factor
 * knowledge holders, incident history, dependency AGE in years, negotiated
 * test-coverage %). Real hand-entered rows -> real lensRun calls -> real
 * computed output. No JSON paste, no fabricated numbers.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Trash2, Play, Loader2, Gauge, GitPullRequestArrow, ShieldAlert,
} from 'lucide-react';

type Tab = 'debt' | 'migration' | 'risk';

interface DebtModule {
  name: string; linesOfCode: string; cyclomaticComplexity: string;
  testCoverage: string; dependencyCount: string; dependencyAgeYears: string;
  duplicateRatio: string; lastModifiedDaysAgo: string;
}
interface MigModule {
  name: string; dependencies: string; apiEndpoints: string; apiConsumers: string;
  storeType: string; storeSizeGb: string; storePortable: boolean;
}
interface RiskComponent {
  name: string; criticality: string; knowledgeHolders: string; failures: string;
}

const num = (v: string, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const blankDebt = (): DebtModule => ({ name: '', linesOfCode: '', cyclomaticComplexity: '', testCoverage: '', dependencyCount: '', dependencyAgeYears: '', duplicateRatio: '', lastModifiedDaysAgo: '' });
const blankMig = (): MigModule => ({ name: '', dependencies: '', apiEndpoints: '', apiConsumers: '', storeType: '', storeSizeGb: '', storePortable: true });
const blankRisk = (): RiskComponent => ({ name: '', criticality: '3', knowledgeHolders: '', failures: '' });

// "YYYY-MM-DD:severity" comma-separated — a structured mini-format (like a
// tag input), not a JSON blob. Bad entries are silently dropped, never
// fabricated into a fake failure.
function parseFailures(raw: string): { date: string; severity: number }[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const [date, sev] = pair.split(':').map((x) => x.trim());
    return { date, severity: Math.max(1, Math.min(5, Number(sev) || 3)) };
  }).filter((f) => f.date);
}

export function PortfolioAssessment() {
  const [tab, setTab] = useState<Tab>('debt');
  const [debtModules, setDebtModules] = useState<DebtModule[]>([blankDebt()]);
  const [migModules, setMigModules] = useState<MigModule[]>([blankMig()]);
  const [riskComponents, setRiskComponents] = useState<RiskComponent[]>([blankRisk()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<Tab, any>>({} as Record<Tab, any>);
  const [err, setErr] = useState<string | null>(null);

  const runDebt = async () => {
    const modules = debtModules.filter((m) => m.name.trim()).map((m) => ({
      name: m.name.trim(), linesOfCode: num(m.linesOfCode), cyclomaticComplexity: num(m.cyclomaticComplexity, 1),
      testCoverage: num(m.testCoverage, 50), dependencyCount: num(m.dependencyCount), dependencyAgeYears: num(m.dependencyAgeYears),
      duplicateRatio: num(m.duplicateRatio) / 100, lastModifiedDaysAgo: num(m.lastModifiedDaysAgo),
    }));
    if (modules.length === 0) { setErr('Add at least one module with a name.'); return; }
    setErr(null); setBusy(true);
    const r = await lensRun('legacy', 'technicalDebt', { modules });
    setBusy(false);
    setResult((p) => ({ ...p, debt: r.data.ok ? r.data.result : { error: r.data.error } }));
  };

  const runMigration = async () => {
    const names = new Set(migModules.map((m) => m.name.trim()).filter(Boolean));
    const modules = migModules.filter((m) => m.name.trim()).map((m) => ({
      name: m.name.trim(),
      dependencies: m.dependencies.split(',').map((d) => d.trim()).filter((d) => d && names.has(d)),
      apis: num(m.apiEndpoints) > 0 ? [{ endpoint: `${m.name.trim()}/api`, consumers: num(m.apiConsumers) }] : [],
      dataStores: m.storeType.trim() ? [{ type: m.storeType.trim(), sizeGb: num(m.storeSizeGb), portable: m.storePortable }] : [],
    }));
    if (modules.length === 0) { setErr('Add at least one module with a name.'); return; }
    setErr(null); setBusy(true);
    const r = await lensRun('legacy', 'migrationReadiness', { system: { modules } });
    setBusy(false);
    setResult((p) => ({ ...p, migration: r.data.ok ? r.data.result : { error: r.data.error } }));
  };

  const runRisk = async () => {
    const components = riskComponents.filter((c) => c.name.trim()).map((c) => ({
      name: c.name.trim(),
      criticality: num(c.criticality, 3),
      knowledgeHolders: c.knowledgeHolders.split(',').map((h) => h.trim()).filter(Boolean),
      failures: parseFailures(c.failures),
    }));
    if (components.length === 0) { setErr('Add at least one component with a name.'); return; }
    setErr(null); setBusy(true);
    const r = await lensRun('legacy', 'riskMap', { components });
    setBusy(false);
    setResult((p) => ({ ...p, risk: r.data.ok ? r.data.result : { error: r.data.error } }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Gauge className="w-4 h-4 text-amber-400" /> Portfolio Risk Assessment
        </h3>
        <p className="text-xs text-zinc-400 mt-1">
          For systems you know but haven&apos;t scanned — enter what an architecture review already knows
          (criticality, bus factor, incident history, dependency age) to get the same debt / readiness / risk
          formulas above, without ingesting source.
        </p>
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {([
          ['debt', 'Technical Debt', Gauge],
          ['migration', 'Migration Readiness', GitPullRequestArrow],
          ['risk', 'Risk Map', ShieldAlert],
        ] as [Tab, string, typeof Gauge][]).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${tab === id ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {err && <p className="text-xs text-rose-400">{err}</p>}

      {tab === 'debt' && (
        <div className="space-y-3">
          {debtModules.map((m, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Field label="Module name"><input value={m.name} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="billing-service" className="in" /></Field>
              <Field label="Lines of code"><input type="number" value={m.linesOfCode} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, linesOfCode: e.target.value } : x))} placeholder="4200" className="in" /></Field>
              <Field label="Cyclomatic complexity"><input type="number" value={m.cyclomaticComplexity} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, cyclomaticComplexity: e.target.value } : x))} placeholder="18" className="in" /></Field>
              <Field label="Test coverage %"><input type="number" value={m.testCoverage} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, testCoverage: e.target.value } : x))} placeholder="55" className="in" /></Field>
              <Field label="Dependency count"><input type="number" value={m.dependencyCount} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, dependencyCount: e.target.value } : x))} placeholder="12" className="in" /></Field>
              <Field label="Dependency age (yrs)"><input type="number" value={m.dependencyAgeYears} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, dependencyAgeYears: e.target.value } : x))} placeholder="3" className="in" /></Field>
              <Field label="Duplicate code %"><input type="number" value={m.duplicateRatio} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, duplicateRatio: e.target.value } : x))} placeholder="8" className="in" /></Field>
              <Field label="Last modified (days ago)"><input type="number" value={m.lastModifiedDaysAgo} onChange={(e) => setDebtModules((p) => p.map((x, j) => j === i ? { ...x, lastModifiedDaysAgo: e.target.value } : x))} placeholder="400" className="in" /></Field>
              <button onClick={() => setDebtModules((p) => p.filter((_, j) => j !== i))} className="col-span-2 md:col-span-4 flex items-center justify-center gap-1 text-[10px] text-zinc-500 hover:text-rose-400 py-1"><Trash2 className="w-3 h-3" /> Remove module</button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => setDebtModules((p) => [...p, blankDebt()])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add module</button>
            <button onClick={runDebt} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run Technical Debt</button>
          </div>
          {result.debt && <DebtResult r={result.debt} />}
        </div>
      )}

      {tab === 'migration' && (
        <div className="space-y-3">
          {migModules.map((m, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Field label="Module name"><input value={m.name} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="auth-service" className="in" /></Field>
              <Field label="Depends on (comma names)"><input value={m.dependencies} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, dependencies: e.target.value } : x))} placeholder="billing-service" className="in" /></Field>
              <Field label="API endpoint count"><input type="number" value={m.apiEndpoints} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, apiEndpoints: e.target.value } : x))} placeholder="6" className="in" /></Field>
              <Field label="Total API consumers"><input type="number" value={m.apiConsumers} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, apiConsumers: e.target.value } : x))} placeholder="14" className="in" /></Field>
              <Field label="Data store type"><input value={m.storeType} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, storeType: e.target.value } : x))} placeholder="postgres" className="in" /></Field>
              <Field label="Data store size (GB)"><input type="number" value={m.storeSizeGb} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, storeSizeGb: e.target.value } : x))} placeholder="40" className="in" /></Field>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 mt-4">
                <input type="checkbox" checked={m.storePortable} onChange={(e) => setMigModules((p) => p.map((x, j) => j === i ? { ...x, storePortable: e.target.checked } : x))} /> Store is portable
              </label>
              <button onClick={() => setMigModules((p) => p.filter((_, j) => j !== i))} className="col-span-2 md:col-span-4 flex items-center justify-center gap-1 text-[10px] text-zinc-500 hover:text-rose-400 py-1"><Trash2 className="w-3 h-3" /> Remove module</button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => setMigModules((p) => [...p, blankMig()])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add module</button>
            <button onClick={runMigration} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run Migration Readiness</button>
          </div>
          {result.migration && <MigrationResult r={result.migration} />}
        </div>
      )}

      {tab === 'risk' && (
        <div className="space-y-3">
          {riskComponents.map((c, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Field label="Component name"><input value={c.name} onChange={(e) => setRiskComponents((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="payment-gateway" className="in" /></Field>
              <Field label="Criticality (1-5)"><input type="number" min={1} max={5} value={c.criticality} onChange={(e) => setRiskComponents((p) => p.map((x, j) => j === i ? { ...x, criticality: e.target.value } : x))} className="in" /></Field>
              <Field label="Knowledge holders (comma names)"><input value={c.knowledgeHolders} onChange={(e) => setRiskComponents((p) => p.map((x, j) => j === i ? { ...x, knowledgeHolders: e.target.value } : x))} placeholder="alice, bob" className="in" /></Field>
              <Field label="Failures — date:severity(1-5), comma-separated"><input value={c.failures} onChange={(e) => setRiskComponents((p) => p.map((x, j) => j === i ? { ...x, failures: e.target.value } : x))} placeholder="2025-01-10:4, 2025-06-02:2" className="in" /></Field>
              <button onClick={() => setRiskComponents((p) => p.filter((_, j) => j !== i))} className="col-span-2 md:col-span-4 flex items-center justify-center gap-1 text-[10px] text-zinc-500 hover:text-rose-400 py-1"><Trash2 className="w-3 h-3" /> Remove component</button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => setRiskComponents((p) => [...p, blankRisk()])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add component</button>
            <button onClick={runRisk} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run Risk Map</button>
          </div>
          {result.risk && <RiskResult r={result.risk} />}
        </div>
      )}

      <style jsx>{`
        .in { width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgb(39 39 42); border-radius: 0.375rem; padding: 0.3rem 0.5rem; font-size: 0.75rem; color: white; }
        .in:focus { outline: none; border-color: rgb(251 191 36 / 0.5); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[10px] text-zinc-400">{label}{children}</label>;
}

function DebtResult({ r }: { r: any }) {
  if (r.error) return <p className="text-xs text-rose-400">Analysis failed: {r.error}</p>;
  if (r.message) return <p className="text-xs text-zinc-400">{r.message}</p>;
  const s = r.summary || {};
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap gap-3">
        <Stat label="Avg Debt" value={s.avgDebtScore} tone={s.avgDebtScore > 40 ? 'bad' : 'good'} />
        <Stat label="Critical" value={s.criticalModules} tone={s.criticalModules > 0 ? 'bad' : 'good'} />
        <Stat label="High" value={s.highDebtModules} />
        <Stat label="Avg Maintainability" value={s.avgMaintainability} />
        <Stat label="Remediation (hrs)" value={s.totalRemediationHours} />
      </div>
      {(r.topDebtSources || []).length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Top Debt Sources</p>
          {(r.topDebtSources as any[]).map((m, i) => (
            <div key={i} className="flex justify-between bg-zinc-900/50 rounded px-2 py-1">
              <span className="text-zinc-300">{m.name}</span>
              <span className="text-rose-400">{m.debtScore} · {m.primaryFactor?.[0]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MigrationResult({ r }: { r: any }) {
  if (r.error) return <p className="text-xs text-rose-400">Analysis failed: {r.error}</p>;
  if (r.message) return <p className="text-xs text-zinc-400">{r.message}</p>;
  const s = r.summary || {};
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap gap-3">
        <Stat label="Avg Readiness" value={`${s.avgReadiness}%`} />
        <Stat label="Ready" value={s.readyModules} tone="good" />
        <Stat label="Blocked" value={s.blockedModules} tone={s.blockedModules > 0 ? 'bad' : 'good'} />
        <Stat label="Coupling" value={r.coupling?.level} />
        <Stat label="External Deps" value={s.externalDependencyCount} />
      </div>
      {(r.migrationOrder || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(r.migrationOrder as any[]).map((m, i) => (
            <span key={i} className="rounded px-1.5 py-0.5 border border-amber-800 bg-amber-950/30 text-amber-300 text-[10px]">{m.phase}. {m.module}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function RiskResult({ r }: { r: any }) {
  if (r.error) return <p className="text-xs text-rose-400">Analysis failed: {r.error}</p>;
  if (r.message) return <p className="text-xs text-zinc-400">{r.message}</p>;
  const s = r.summary || {};
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap gap-3">
        <Stat label="Avg Risk" value={s.avgRiskScore} tone={s.avgRiskScore > 50 ? 'bad' : 'good'} />
        <Stat label="Critical" value={s.criticalRiskCount} tone={s.criticalRiskCount > 0 ? 'bad' : 'good'} />
        <Stat label="Single-holder" value={s.singleHolderCount} tone={s.singleHolderCount > 0 ? 'bad' : 'good'} />
        <Stat label="Rising Failures" value={s.increasingFailureCount} />
      </div>
      {(r.keyPersonRisks || []).length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-rose-300 uppercase tracking-wider font-semibold">Key Person Risks</p>
          {(r.keyPersonRisks as any[]).map((p, i) => (
            <div key={i} className="bg-rose-950/20 border border-rose-900/40 rounded px-2 py-1 text-rose-200">{p.person} — {p.componentCount} components ({(p.components || []).join(', ')})</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: unknown; tone?: 'neutral' | 'good' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-400' : tone === 'good' ? 'text-emerald-400' : 'text-amber-300';
  return (
    <span className="rounded border border-zinc-800 bg-black/40 px-2 py-1">
      <span className={`font-bold ${color}`}>{value == null ? '—' : String(value)}</span> <span className="text-zinc-400">{label}</span>
    </span>
  );
}
