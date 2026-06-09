'use client';

/**
 * ImportParityWorkbench — Flatfile / Airbyte-class import surface.
 * Covers the full parity backlog: schema inference, in-grid error correction,
 * custom transform rules, saved templates, connector library, scheduled /
 * incremental imports, and import rollback. Every value is real user input or
 * computed by the importdomain backend — no seed data.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Wand2, Grid3x3, FunctionSquare, Bookmark, Plug, CalendarClock, Undo2,
  Loader2, Check, AlertTriangle, Plus, Trash2, Play, Power, RefreshCw,
} from 'lucide-react';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function parseRows(text: string): Row[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // JSON array first.
  if (trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      return Array.isArray(j) ? (j as Row[]) : [];
    } catch {
      return [];
    }
  }
  // Otherwise treat as CSV.
  const lines = trimmed.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const obj: Row = {};
    headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i].trim() : ''; });
    return obj;
  });
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const TABS = [
  { id: 'schema', label: 'Schema Inference', icon: Wand2 },
  { id: 'correct', label: 'Error Correction', icon: Grid3x3 },
  { id: 'rules', label: 'Transform Rules', icon: FunctionSquare },
  { id: 'templates', label: 'Templates', icon: Bookmark },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'schedules', label: 'Scheduled Sync', icon: CalendarClock },
  { id: 'rollback', label: 'Rollback', icon: Undo2 },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function ImportParityWorkbench() {
  const [tab, setTab] = useState<TabId>('schema');

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-cyan-500/15 pb-3">
        <Plug className="h-5 w-5 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Import Workbench</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Flatfile / Airbyte parity
        </span>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'schema' && <SchemaInferencePanel />}
      {tab === 'correct' && <ErrorCorrectionPanel />}
      {tab === 'rules' && <TransformRulesPanel />}
      {tab === 'templates' && <TemplatesPanel />}
      {tab === 'connectors' && <ConnectorsPanel />}
      {tab === 'schedules' && <SchedulesPanel />}
      {tab === 'rollback' && <RollbackPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable raw-data input
// ---------------------------------------------------------------------------
function DataInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-400">
        Paste rows — JSON array or CSV
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={'[{"name":"Ada","age":37}, ...]\n\nor\n\nname,age\nAda,37'}
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-400"
      />
    </div>
  );
}

function SubmitBtn({ busy, label, onClick, disabled }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-red-500/25 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-300">
      <AlertTriangle className="h-3.5 w-3.5" /> {msg}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">{msg}</div>;
}

// ===========================================================================
// 1. Schema inference + auto-suggest target fields
// ===========================================================================
interface InferredField {
  source: string;
  suggestedTarget: string;
  inferredType: string;
  semanticHint: string | null;
  confidence: number;
  nullable: boolean;
  nullRate: number;
  required: boolean;
  uniqueSamples: unknown[];
}

function SchemaInferencePanel() {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fields, setFields] = useState<InferredField[] | null>(null);
  const [rowCount, setRowCount] = useState(0);

  const run = useCallback(async () => {
    const rows = parseRows(raw);
    if (rows.length === 0) { setErr('Could not parse any rows. Provide a JSON array or CSV.'); return; }
    setBusy(true); setErr(''); setFields(null);
    const r = await lensRun('import', 'inferSchema', { rows });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { fields: InferredField[]; rowCount: number; message?: string };
      if (res.message) { setErr(res.message); return; }
      setFields(res.fields);
      setRowCount(res.rowCount);
    } else {
      setErr(r.data?.error || 'Schema inference failed.');
    }
  }, [raw]);

  return (
    <div className="space-y-3">
      <DataInput value={raw} onChange={setRaw} />
      <SubmitBtn busy={busy} label="Infer Schema" onClick={run} />
      {err && <ErrBox msg={err} />}
      {fields && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">{fields.length} columns inferred from {rowCount} rows</p>
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-2.5 py-1.5">Source</th>
                  <th className="px-2.5 py-1.5">Suggested target</th>
                  <th className="px-2.5 py-1.5">Type</th>
                  <th className="px-2.5 py-1.5">Confidence</th>
                  <th className="px-2.5 py-1.5">Nullable</th>
                  <th className="px-2.5 py-1.5">Samples</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.source} className="border-t border-zinc-800/60">
                    <td className="px-2.5 py-1.5 font-mono text-zinc-200">{f.source}</td>
                    <td className="px-2.5 py-1.5 font-mono text-cyan-300">{f.suggestedTarget}</td>
                    <td className="px-2.5 py-1.5">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{f.inferredType}</span>
                      {f.semanticHint && <span className="ml-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">{f.semanticHint}</span>}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className={f.confidence >= 0.8 ? 'text-emerald-400' : f.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'}>
                        {(f.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-zinc-400">{f.nullable ? `yes (${f.nullRate}%)` : 'no'}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[10px] text-zinc-400">{f.uniqueSamples.map(cellStr).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 2. Interactive in-grid error correction
// ===========================================================================
interface SessionRow { rowIndex: number; current: Row; corrected: boolean }
interface CellError { rowIndex: number; field: string; error: string }
interface CorrectionSession {
  id: string;
  name: string;
  schema: Record<string, { type: string; required?: boolean }>;
  rows: SessionRow[];
}
interface SessionValidation { invalidRows: number; validRows: number; cellErrors: CellError[] }
interface SessionSummary { id: string; name: string; rowCount: number; correctedCount: number; invalidRows: number; committed: boolean }

function ErrorCorrectionPanel() {
  const [raw, setRaw] = useState('');
  const [schemaText, setSchemaText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [active, setActive] = useState<CorrectionSession | null>(null);
  const [validation, setValidation] = useState<SessionValidation | null>(null);

  const loadList = useCallback(async () => {
    const r = await lensRun('import', 'listCorrectionSessions', {});
    if (r.data?.ok && r.data.result) setSessions((r.data.result as { sessions: SessionSummary[] }).sessions);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const openSession = useCallback(async (id: string) => {
    setErr('');
    const r = await lensRun('import', 'getCorrectionSession', { id });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { session: CorrectionSession; validation: SessionValidation };
      setActive(res.session);
      setValidation(res.validation);
    } else {
      setErr(r.data?.error || 'Could not open session.');
    }
  }, []);

  const start = useCallback(async () => {
    const rows = parseRows(raw);
    if (rows.length === 0) { setErr('Could not parse rows.'); return; }
    let schema: Record<string, unknown> = {};
    if (schemaText.trim()) {
      try { schema = JSON.parse(schemaText); }
      catch { setErr('Schema must be valid JSON, e.g. {"name":{"type":"string","required":true}}'); return; }
    }
    setBusy(true); setErr('');
    const r = await lensRun('import', 'startCorrectionSession', { rows, schema, name: name || undefined });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      const id = (r.data.result as { session: SessionSummary }).session.id;
      await loadList();
      await openSession(id);
    } else {
      setErr(r.data?.error || 'Could not start session.');
    }
  }, [raw, schemaText, name, loadList, openSession]);

  const editCell = useCallback(async (rowIndex: number, field: string, value: string) => {
    if (!active) return;
    const r = await lensRun('import', 'correctCell', { id: active.id, rowIndex, field, value });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { row: SessionRow; validation: SessionValidation };
      setActive((prev) => prev
        ? { ...prev, rows: prev.rows.map((rr) => (rr.rowIndex === rowIndex ? res.row : rr)) }
        : prev);
      setValidation(res.validation);
    }
  }, [active]);

  const commit = useCallback(async (force: boolean) => {
    if (!active) return;
    setBusy(true); setErr('');
    const r = await lensRun('import', 'commitCorrectionSession', { id: active.id, force });
    setBusy(false);
    if (r.data?.ok) {
      await loadList();
      await openSession(active.id);
    } else {
      setErr(r.data?.error || 'Commit failed.');
    }
  }, [active, loadList, openSession]);

  const fieldsOf = (s: CorrectionSession): string[] => {
    const set = new Set<string>(Object.keys(s.schema));
    s.rows.forEach((r) => Object.keys(r.current).forEach((k) => set.add(k)));
    return Array.from(set);
  };
  const cellHasError = (rowIndex: number, field: string): boolean =>
    !!validation?.cellErrors.some((c) => c.rowIndex === rowIndex && c.field === field);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-1">
        <DataInput value={raw} onChange={setRaw} />
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-400">Schema (optional JSON)</label>
          <textarea
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder='{"name":{"type":"string","required":true}}'
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-400"
          />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Session name (optional)"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400"
        />
        <SubmitBtn busy={busy} label="Start Correction Session" onClick={start} />
        {err && <ErrBox msg={err} />}
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-zinc-400">Sessions</p>
          {sessions.length === 0 && <Empty msg="No correction sessions yet." />}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => openSession(s.id)}
              className={`w-full rounded border px-2.5 py-1.5 text-left text-xs ${
                active?.id === s.id ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-zinc-200">{s.name}</span>
                {s.committed
                  ? <span className="text-emerald-400">committed</span>
                  : <span className={s.invalidRows > 0 ? 'text-red-400' : 'text-yellow-400'}>{s.invalidRows} bad</span>}
              </div>
              <p className="text-[10px] text-zinc-400">{s.rowCount} rows · {s.correctedCount} corrected</p>
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        {!active && <Empty msg="Start or select a session to edit rows in the grid." />}
        {active && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{active.name}</h3>
              {validation && (
                <span className={`text-xs ${validation.invalidRows > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {validation.validRows} valid · {validation.invalidRows} need fixing
                </span>
              )}
            </div>
            <div className="overflow-x-auto rounded border border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-400">
                  <tr>
                    <th className="px-2 py-1.5">#</th>
                    {fieldsOf(active).map((f) => <th key={f} className="px-2 py-1.5">{f}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {active.rows.map((row) => (
                    <tr key={row.rowIndex} className="border-t border-zinc-800/60">
                      <td className="px-2 py-1 text-zinc-400">{row.rowIndex}</td>
                      {fieldsOf(active).map((f) => {
                        const bad = cellHasError(row.rowIndex, f);
                        return (
                          <td key={f} className="px-1 py-0.5">
                            <input
                              value={cellStr(row.current[f])}
                              onChange={(e) => editCell(row.rowIndex, f, e.target.value)}
                              className={`w-full min-w-[80px] rounded bg-zinc-950 px-1.5 py-1 font-mono text-[11px] text-zinc-100 outline-none ${
                                bad ? 'border border-red-500/60' : 'border border-transparent focus:border-cyan-500/40'
                              }`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => commit(false)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" /> Commit
              </button>
              <button
                onClick={() => commit(true)}
                disabled={busy}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-40"
              >
                Force commit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// 3. Custom transform rules editor
// ===========================================================================
type RuleKind = 'find_replace' | 'coerce' | 'formula' | 'set_default' | 'regex_extract';
interface TransformRule {
  field: string;
  kind: RuleKind;
  find?: string;
  replace?: string;
  regex?: boolean;
  to?: string;
  expression?: string;
  value?: string;
  pattern?: string;
}
interface RuleImpact { field: string; kind: string; changed: number }

const RULE_KINDS: { id: RuleKind; label: string }[] = [
  { id: 'find_replace', label: 'Find / Replace' },
  { id: 'coerce', label: 'Type Coerce' },
  { id: 'formula', label: 'Formula' },
  { id: 'set_default', label: 'Set Default' },
  { id: 'regex_extract', label: 'Regex Extract' },
];
const COERCE_TARGETS = ['number', 'string', 'boolean', 'date', 'uppercase', 'lowercase', 'trim'];

function TransformRulesPanel() {
  const [raw, setRaw] = useState('');
  const [rules, setRules] = useState<TransformRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [output, setOutput] = useState<Row[] | null>(null);
  const [impact, setImpact] = useState<RuleImpact[]>([]);

  const addRule = () => setRules((r) => [...r, { field: '', kind: 'coerce', to: 'trim' }]);
  const updateRule = (i: number, patch: Partial<TransformRule>) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, ...patch } : rule)));
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));

  const run = useCallback(async () => {
    const rows = parseRows(raw);
    if (rows.length === 0) { setErr('Could not parse rows.'); return; }
    if (rules.length === 0) { setErr('Add at least one transform rule.'); return; }
    setBusy(true); setErr(''); setOutput(null);
    const r = await lensRun('import', 'applyTransformRules', { rows, rules });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { output: Row[]; ruleImpact: RuleImpact[]; message?: string };
      if (res.message) { setErr(res.message); return; }
      setOutput(res.output);
      setImpact(res.ruleImpact);
    } else {
      setErr(r.data?.error || 'Transform failed.');
    }
  }, [raw, rules]);

  return (
    <div className="space-y-3">
      <DataInput value={raw} onChange={setRaw} />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wider text-zinc-400">Transform rules</p>
          <button onClick={addRule} className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:text-white">
            <Plus className="h-3 w-3" /> Add rule
          </button>
        </div>
        {rules.length === 0 && <Empty msg="No rules yet. Add a rule to coerce types, find/replace, run formulas, or extract via regex." />}
        {rules.map((rule, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950 p-2">
            <input
              value={rule.field}
              onChange={(e) => updateRule(i, { field: e.target.value })}
              placeholder="field"
              className="w-28 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-400"
            />
            <select
              value={rule.kind}
              onChange={(e) => updateRule(i, { kind: e.target.value as RuleKind })}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
            >
              {RULE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            {rule.kind === 'coerce' && (
              <select
                value={rule.to || 'trim'}
                onChange={(e) => updateRule(i, { to: e.target.value })}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              >
                {COERCE_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {rule.kind === 'find_replace' && (
              <>
                <input value={rule.find || ''} onChange={(e) => updateRule(i, { find: e.target.value })} placeholder="find" className="w-24 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-400" />
                <input value={rule.replace || ''} onChange={(e) => updateRule(i, { replace: e.target.value })} placeholder="replace" className="w-24 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-400" />
                <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={!!rule.regex} onChange={(e) => updateRule(i, { regex: e.target.checked })} /> regex
                </label>
              </>
            )}
            {rule.kind === 'formula' && (
              <input value={rule.expression || ''} onChange={(e) => updateRule(i, { expression: e.target.value })} placeholder="{price} * {qty}" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
            )}
            {rule.kind === 'set_default' && (
              <input value={rule.value || ''} onChange={(e) => updateRule(i, { value: e.target.value })} placeholder="default value" className="w-32 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-400" />
            )}
            {rule.kind === 'regex_extract' && (
              <input value={rule.pattern || ''} onChange={(e) => updateRule(i, { pattern: e.target.value })} placeholder="(\\d+)" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
            )}
            <button aria-label="Delete" onClick={() => removeRule(i)} className="text-zinc-400 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <SubmitBtn busy={busy} label="Apply Rules" onClick={run} />
      {err && <ErrBox msg={err} />}
      {output && (
        <div className="space-y-2">
          {impact.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {impact.map((im, i) => (
                <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
                  {im.field || '—'} · {im.kind}: <span className="text-cyan-300">{im.changed}</span> changed
                </span>
              ))}
            </div>
          )}
          <OutputTable rows={output} caption={`${output.length} rows after transform`} />
        </div>
      )}
    </div>
  );
}

function OutputTable({ rows, caption }: { rows: Row[]; caption: string }) {
  if (rows.length === 0) return <Empty msg="No rows." />;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return (
    <div>
      <p className="mb-1 text-xs text-zinc-400">{caption}</p>
      <div className="max-h-80 overflow-auto rounded border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-400">
            <tr>{cols.map((c) => <th key={c} className="px-2.5 py-1.5">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((row, i) => (
              <tr key={i} className="border-t border-zinc-800/60">
                {cols.map((c) => <td key={c} className="px-2.5 py-1 font-mono text-[11px] text-zinc-200">{cellStr(row[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===========================================================================
// 4. Saved import templates / mapping presets
// ===========================================================================
interface Template {
  id: string;
  name: string;
  description: string;
  mappings: { source: string; target: string }[];
  transformRules: unknown[];
  keyFields: string[];
  usageCount: number;
  lastUsedAt?: string;
}

function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mappingsText, setMappingsText] = useState('');
  const [keyFieldsText, setKeyFieldsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [applied, setApplied] = useState<Template | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('import', 'listTemplates', {});
    if (r.data?.ok && r.data.result) setTemplates((r.data.result as { templates: Template[] }).templates);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!name.trim()) { setErr('Template name is required.'); return; }
    const mappings: { source: string; target: string }[] = [];
    mappingsText.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const [source, target] = line.split(/[=>:]+/).map((s) => s.trim());
      if (source && target) mappings.push({ source, target });
    });
    const keyFields = keyFieldsText.split(',').map((s) => s.trim()).filter(Boolean);
    setBusy(true); setErr('');
    const r = await lensRun('import', 'saveTemplate', { name, description, mappings, keyFields });
    setBusy(false);
    if (r.data?.ok) {
      setName(''); setDescription(''); setMappingsText(''); setKeyFieldsText('');
      await load();
    } else {
      setErr(r.data?.error || 'Save failed.');
    }
  }, [name, description, mappingsText, keyFieldsText, load]);

  const apply = useCallback(async (id: string) => {
    const r = await lensRun('import', 'applyTemplate', { id });
    if (r.data?.ok && r.data.result) {
      setApplied((r.data.result as { template: Template }).template);
      await load();
    }
  }, [load]);

  const del = useCallback(async (id: string) => {
    await lensRun('import', 'deleteTemplate', { id });
    if (applied?.id === id) setApplied(null);
    await load();
  }, [applied, load]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">New mapping preset</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        <div>
          <label className="mb-1 block text-[10px] text-zinc-400">Field mappings — one per line, &quot;Source =&gt; target&quot;</label>
          <textarea value={mappingsText} onChange={(e) => setMappingsText(e.target.value)} rows={4} spellCheck={false} placeholder={'First Name => name\nEmail Address => email'} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
        </div>
        <input value={keyFieldsText} onChange={(e) => setKeyFieldsText(e.target.value)} placeholder="Key fields (comma-separated)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        <SubmitBtn busy={busy} label="Save Template" onClick={save} />
        {err && <ErrBox msg={err} />}
      </div>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">Saved templates</p>
        {templates.length === 0 && <Empty msg="No saved templates yet." />}
        {templates.map((t) => (
          <div key={t.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">{t.name}</p>
                {t.description && <p className="text-[10px] text-zinc-400">{t.description}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => apply(t.id)} className="rounded bg-cyan-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-cyan-500">Apply</button>
                <button aria-label="Delete" onClick={() => del(t.id)} className="text-zinc-400 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-zinc-400">
              <span>{t.mappings.length} mappings</span>
              <span>·</span>
              <span>{t.keyFields.length} key fields</span>
              <span>·</span>
              <span>used {t.usageCount}×</span>
            </div>
          </div>
        ))}
        {applied && (
          <div className="rounded border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <p className="text-xs font-medium text-cyan-300">Applied: {applied.name}</p>
            {applied.mappings.length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {applied.mappings.map((m, i) => (
                  <p key={i} className="font-mono text-[10px] text-zinc-300">{m.source} → <span className="text-cyan-300">{m.target}</span></p>
                ))}
              </div>
            ) : <p className="mt-1 text-[10px] text-zinc-400">No field mappings in this template.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// 5. Connector library — Google Sheets, REST APIs, CSV URLs
// ===========================================================================
interface ConnectorCatalogItem { kind: string; label: string; note: string; params: string[] }
interface SavedConnector {
  id: string;
  name: string;
  kind: string;
  config: { sheetId?: string; gid?: string; url?: string; rootPath?: string };
  lastFetchedAt: string | null;
  lastRowCount: number;
}

function ConnectorsPanel() {
  const [catalog, setCatalog] = useState<ConnectorCatalogItem[]>([]);
  const [saved, setSaved] = useState<SavedConnector[]>([]);
  const [kind, setKind] = useState('google_sheets');
  const [name, setName] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [gid, setGid] = useState('');
  const [url, setUrl] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetchBusy, setFetchBusy] = useState('');
  const [err, setErr] = useState('');
  const [fetched, setFetched] = useState<{ rows: Row[]; rowCount: number } | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('import', 'listConnectors', {});
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { catalog: ConnectorCatalogItem[]; saved: SavedConnector[] };
      setCatalog(res.catalog);
      setSaved(res.saved);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!name.trim()) { setErr('Connector name is required.'); return; }
    setBusy(true); setErr('');
    const r = await lensRun('import', 'saveConnector', { name, kind, sheetId, gid, url, rootPath });
    setBusy(false);
    if (r.data?.ok) {
      setName(''); setSheetId(''); setGid(''); setUrl(''); setRootPath('');
      await load();
    } else {
      setErr(r.data?.error || 'Save failed.');
    }
  }, [name, kind, sheetId, gid, url, rootPath, load]);

  const runFetch = useCallback(async (connectorId: string) => {
    setFetchBusy(connectorId); setErr(''); setFetched(null);
    const r = await lensRun('import', 'fetchFromConnector', { connectorId });
    setFetchBusy('');
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { rows: Row[]; rowCount: number };
      setFetched(res);
      await load();
    } else {
      setErr(r.data?.error || 'Fetch failed.');
    }
  }, [load]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">Add a connector</p>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100">
          {catalog.map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}
        </select>
        {catalog.find((c) => c.kind === kind)?.note && (
          <p className="text-[10px] text-zinc-400">{catalog.find((c) => c.kind === kind)?.note}</p>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Connector name" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        {kind === 'google_sheets' && (
          <>
            <input value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="Sheet ID (from the share URL)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
            <input value={gid} onChange={(e) => setGid(e.target.value)} placeholder="gid (tab id, optional — defaults 0)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
          </>
        )}
        {(kind === 'rest_api' || kind === 'csv_url') && (
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (public, keyless endpoint)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
        )}
        {kind === 'rest_api' && (
          <input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="rootPath (e.g. data.items, optional)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
        )}
        <SubmitBtn busy={busy} label="Save Connector" onClick={save} />
        {err && <ErrBox msg={err} />}
      </div>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">Saved connectors</p>
        {saved.length === 0 && <Empty msg="No connectors yet. Add a Google Sheet, REST API, or CSV URL." />}
        {saved.map((c) => (
          <div key={c.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">{c.name}</p>
                <p className="text-[10px] text-zinc-400">{c.kind} {c.lastFetchedAt ? `· last fetch ${new Date(c.lastFetchedAt).toLocaleString()} (${c.lastRowCount} rows)` : '· never fetched'}</p>
              </div>
              <button
                onClick={() => runFetch(c.id)}
                disabled={fetchBusy === c.id}
                className="flex items-center gap-1 rounded bg-cyan-600/80 px-2 py-1 text-[10px] text-white hover:bg-cyan-500 disabled:opacity-40"
              >
                {fetchBusy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Fetch
              </button>
            </div>
          </div>
        ))}
        {fetched && <OutputTable rows={fetched.rows} caption={`${fetched.rowCount} rows fetched from connector`} />}
      </div>
    </div>
  );
}

// ===========================================================================
// 6. Incremental / scheduled imports
// ===========================================================================
interface Schedule {
  id: string;
  name: string;
  cadence: string;
  mode: string;
  keyField: string | null;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  lastRowCount: number;
  lastNewCount: number;
}

function SchedulesPanel() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [mode, setMode] = useState('incremental');
  const [keyField, setKeyField] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [runId, setRunId] = useState('');
  const [runRows, setRunRows] = useState('');
  const [runResult, setRunResult] = useState<{ newCount: number; skippedExisting: number; totalFetched: number } | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('import', 'listSchedules', {});
    if (r.data?.ok && r.data.result) setSchedules((r.data.result as { schedules: Schedule[] }).schedules);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) { setErr('Schedule name is required.'); return; }
    setBusy(true); setErr('');
    const r = await lensRun('import', 'createSchedule', {
      name, cadence, mode, keyField: mode === 'incremental' ? keyField : undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setName(''); setKeyField('');
      await load();
    } else {
      setErr(r.data?.error || 'Create failed.');
    }
  }, [name, cadence, mode, keyField, load]);

  const toggle = useCallback(async (id: string) => {
    await lensRun('import', 'toggleSchedule', { id });
    await load();
  }, [load]);

  const run = useCallback(async () => {
    if (!runId) { setErr('Select a schedule to run.'); return; }
    const rows = parseRows(runRows);
    setBusy(true); setErr(''); setRunResult(null);
    const r = await lensRun('import', 'runSchedule', { id: runId, rows });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { newCount: number; skippedExisting: number; totalFetched: number };
      setRunResult(res);
      await load();
    } else {
      setErr(r.data?.error || 'Run failed.');
    }
  }, [runId, runRows, load]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">New sync schedule</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schedule name" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        <div className="flex gap-2">
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100">
            {['hourly', 'daily', 'weekly', 'manual'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100">
            {['incremental', 'full'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {mode === 'incremental' && (
          <input value={keyField} onChange={(e) => setKeyField(e.target.value)} placeholder="Key field for de-dup (e.g. id)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        )}
        <SubmitBtn busy={busy} label="Create Schedule" onClick={create} />
        {err && <ErrBox msg={err} />}

        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          <p className="text-[11px] uppercase tracking-wider text-zinc-400">Run a sync pass</p>
          <select value={runId} onChange={(e) => setRunId(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100">
            <option value="">Select schedule…</option>
            {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <textarea value={runRows} onChange={(e) => setRunRows(e.target.value)} rows={4} spellCheck={false} placeholder="Fetched rows — JSON array or CSV" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-400" />
          <SubmitBtn busy={busy} label="Run Sync" onClick={run} />
          {runResult && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs text-emerald-300">
              {runResult.totalFetched} fetched · <span className="text-cyan-300">{runResult.newCount} new</span> · {runResult.skippedExisting} already known
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">Schedules</p>
        {schedules.length === 0 && <Empty msg="No sync schedules yet." />}
        {schedules.map((s) => (
          <div key={s.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">{s.name}</p>
                <p className="text-[10px] text-zinc-400">
                  {s.cadence} · {s.mode}{s.keyField ? ` · key=${s.keyField}` : ''} · {s.runCount} runs
                </p>
              </div>
              <button
                onClick={() => toggle(s.id)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
                  s.enabled ? 'bg-emerald-600/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                <Power className="h-3 w-3" /> {s.enabled ? 'enabled' : 'disabled'}
              </button>
            </div>
            {s.lastRunAt && (
              <p className="mt-1 text-[10px] text-zinc-400">
                Last run {new Date(s.lastRunAt).toLocaleString()} — {s.lastNewCount} new of {s.lastRowCount}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// 7. Rollback an import
// ===========================================================================
interface Snapshot {
  id: string;
  label: string;
  source: string;
  rowCount: number;
  status: string;
  createdAt: string;
  rolledBackAt: string | null;
}

function RollbackPanel() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [raw, setRaw] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await lensRun('import', 'listSnapshots', {});
    if (r.data?.ok && r.data.result) setSnapshots((r.data.result as { snapshots: Snapshot[] }).snapshots);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const snapshot = useCallback(async () => {
    const rows = parseRows(raw);
    if (rows.length === 0) { setErr('Could not parse rows to snapshot.'); return; }
    setBusy(true); setErr('');
    const r = await lensRun('import', 'snapshotImport', { rows, label: label || undefined });
    setBusy(false);
    if (r.data?.ok) {
      setRaw(''); setLabel('');
      await load();
    } else {
      setErr(r.data?.error || 'Snapshot failed.');
    }
  }, [raw, label, load]);

  const rollback = useCallback(async (id: string) => {
    setErr('');
    const r = await lensRun('import', 'rollbackImport', { id });
    if (r.data?.ok) await load();
    else setErr(r.data?.error || 'Rollback failed.');
  }, [load]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">Snapshot an import for rollback</p>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Snapshot label (optional)" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400" />
        <DataInput value={raw} onChange={setRaw} />
        <SubmitBtn busy={busy} label="Snapshot Import" onClick={snapshot} />
        {err && <ErrBox msg={err} />}
      </div>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">Import snapshots</p>
        {snapshots.length === 0 && <Empty msg="No import snapshots yet." />}
        {snapshots.map((s) => (
          <div key={s.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">{s.label}</p>
                <p className="text-[10px] text-zinc-400">
                  {s.rowCount} rows · {s.source} · {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              {s.status === 'rolled_back' ? (
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                  rolled back {s.rolledBackAt ? new Date(s.rolledBackAt).toLocaleDateString() : ''}
                </span>
              ) : (
                <button
                  onClick={() => rollback(s.id)}
                  className="flex items-center gap-1 rounded bg-red-600/80 px-2 py-1 text-[10px] text-white hover:bg-red-500"
                >
                  <Undo2 className="h-3 w-3" /> Rollback
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
