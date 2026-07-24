'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DataUtilities — real, purpose-built forms over the four custom.js
 * pure-compute macros (evaluateSchema / templateRender / validateData /
 * transformData). These are genuine Retool/Airtable-class utilities for
 * whoever is building a canvas above (schema design, mail-merge templating,
 * validation rule authoring, field transforms) — wired directly via
 * lensRun, never through the unrelated generic lens-config artifact store.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Trash2, Play, Loader2, ListTree, FileCode2, ShieldCheck, Shuffle,
} from 'lucide-react';

type Tab = 'schema' | 'template' | 'validate' | 'transform';

interface SchemaField { name: string; type: string; required: boolean }
interface KV { key: string; value: string }
interface Rule { field: string; kind: 'required' | 'minLength' | 'maxLength' | 'min' | 'max' | 'pattern'; value: string }
interface TransformStep { field: string; operation: 'uppercase' | 'lowercase' | 'trim' | 'round' | 'rename' | 'default'; extra: string }

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'date'];
const RULE_KINDS: Rule['kind'][] = ['required', 'minLength', 'maxLength', 'min', 'max', 'pattern'];
const OPS: TransformStep['operation'][] = ['uppercase', 'lowercase', 'trim', 'round', 'rename', 'default'];

function kvToObject(pairs: KV[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    if (!p.key.trim()) continue;
    const n = Number(p.value);
    out[p.key.trim()] = p.value.trim() !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(p.value.trim()) ? n : p.value;
  }
  return out;
}

export function DataUtilities() {
  const [tab, setTab] = useState<Tab>('schema');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ListTree className="w-4 h-4 text-neon-purple" /> Data Utilities
        </h3>
        <p className="text-xs text-zinc-400 mt-1">
          Design a schema, render a merge template, author validation rules, or transform a record —
          real forms driving the real compute macros, no JSON paste.
        </p>
      </div>
      <div className="flex gap-1 border-b border-zinc-800">
        {([
          ['schema', 'Schema Designer', ListTree],
          ['template', 'Template Renderer', FileCode2],
          ['validate', 'Validation Rules', ShieldCheck],
          ['transform', 'Data Transform', Shuffle],
        ] as [Tab, string, typeof ListTree][]).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${tab === id ? 'text-neon-purple border-b-2 border-neon-purple' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === 'schema' && <SchemaTab />}
      {tab === 'template' && <TemplateTab />}
      {tab === 'validate' && <ValidateTab />}
      {tab === 'transform' && <TransformTab />}
    </div>
  );
}

function SchemaTab() {
  const [fields, setFields] = useState<SchemaField[]>([{ name: '', type: 'string', required: false }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    const schema = fields.filter((f) => f.name.trim());
    if (schema.length === 0) return;
    setBusy(true);
    const r = await lensRun('custom', 'evaluateSchema', { schema });
    setBusy(false);
    setResult(r.data.ok ? r.data.result : { error: r.data.error });
  };

  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={f.name} onChange={(e) => setFields((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="field name" className="in flex-1" />
          <select value={f.type} onChange={(e) => setFields((p) => p.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="in w-28">
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[11px] text-zinc-400 shrink-0">
            <input type="checkbox" checked={f.required} onChange={(e) => setFields((p) => p.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} /> required
          </label>
          <button onClick={() => setFields((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove field${f.name.trim() ? ` "${f.name.trim()}"` : ''}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button onClick={() => setFields((p) => [...p, { name: '', type: 'string', required: false }])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add field</button>
        <button onClick={run} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />} Evaluate Schema</button>
      </div>
      {result && (result.error ? <p className="text-xs text-rose-400">{result.error}</p> : (
        <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs space-y-2">
          <div className="flex flex-wrap gap-3">
            <Stat label="Total" value={result.totalFields} />
            <Stat label="Valid" value={result.validFields} tone="good" />
            <Stat label="Required" value={result.requiredCount} />
            <span className={`rounded px-2 py-0.5 ${result.schemaValid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{result.schemaValid ? 'schema valid' : 'schema invalid'}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(result.fields || []).map((f: any) => (
              <span key={f.name} className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5">{f.name} <span className="text-zinc-500">{f.type}</span> {f.valid ? <span className="text-emerald-400">✓</span> : <span className="text-rose-400">✗</span>}</span>
            ))}
          </div>
        </div>
      ))}
      <InStyle />
    </div>
  );
}

function TemplateTab() {
  const [template, setTemplate] = useState('Hi {{name}}, your {{item}} shipped on {{date}}.');
  const [vars, setVars] = useState<KV[]>([{ key: 'name', value: 'Alex' }, { key: 'item', value: 'order #4471' }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    if (!template.trim()) return;
    setBusy(true);
    const r = await lensRun('custom', 'templateRender', { template, variables: kvToObject(vars) });
    setBusy(false);
    setResult(r.data.ok ? r.data.result : { error: r.data.error });
  };

  return (
    <div className="space-y-3">
      <label className="block text-[11px] text-zinc-400">
        Template (use <code className="text-zinc-300">{'{{variable}}'}</code> placeholders)
        <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={3} className="in w-full mt-1 font-mono" />
      </label>
      {vars.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={v.key} onChange={(e) => setVars((p) => p.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="variable" className="in w-40" />
          <input value={v.value} onChange={(e) => setVars((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className="in flex-1" />
          <button onClick={() => setVars((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove variable${v.key.trim() ? ` "${v.key.trim()}"` : ''}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button onClick={() => setVars((p) => [...p, { key: '', value: '' }])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add variable</button>
        <button onClick={run} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />} Render</button>
      </div>
      {result && (result.error ? <p className="text-xs text-rose-400">{result.error}</p> : (
        <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs space-y-2">
          <span className={`rounded px-2 py-0.5 ${result.complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{result.complete ? 'complete' : 'missing variables'}</span>
          <p className="whitespace-pre-wrap text-zinc-200 bg-zinc-900/60 rounded p-2">{result.rendered}</p>
          {(result.variablesMissing || []).length > 0 && <p className="text-rose-400">missing: {result.variablesMissing.join(', ')}</p>}
        </div>
      ))}
      <InStyle />
    </div>
  );
}

function ValidateTab() {
  const [rules, setRules] = useState<Rule[]>([{ field: 'email', kind: 'required', value: '' }]);
  const [values, setValues] = useState<KV[]>([{ key: 'email', value: '' }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    const validationRules = rules.filter((r) => r.field.trim()).map((r) => {
      const base: Record<string, unknown> = { field: r.field.trim(), type: r.kind };
      if (r.kind === 'required') base.required = true;
      else if (r.kind === 'minLength' || r.kind === 'maxLength' || r.kind === 'min' || r.kind === 'max') base[r.kind] = Number(r.value) || 0;
      else if (r.kind === 'pattern') base.pattern = r.value;
      return base;
    });
    if (validationRules.length === 0) return;
    setBusy(true);
    const r = await lensRun('custom', 'validateData', { values: kvToObject(values), validationRules });
    setBusy(false);
    setResult(r.data.ok ? r.data.result : { error: r.data.error });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Rules</p>
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <input value={r.field} onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} placeholder="field" className="in w-32" />
            <select value={r.kind} onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, kind: e.target.value as Rule['kind'] } : x))} className="in w-28">
              {RULE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {r.kind !== 'required' && (
              <input value={r.value} onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder={r.kind === 'pattern' ? 'regex' : 'number'} className="in flex-1" />
            )}
            <button onClick={() => setRules((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove rule${r.field.trim() ? ` for "${r.field.trim()}"` : ''}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </div>
        ))}
        <button onClick={() => setRules((p) => [...p, { field: '', kind: 'required', value: '' }])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add rule</button>
      </div>
      <div>
        <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Data to test</p>
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <input value={v.key} onChange={(e) => setValues((p) => p.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="field" className="in w-32" />
            <input value={v.value} onChange={(e) => setValues((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className="in flex-1" />
            <button onClick={() => setValues((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove value${v.key.trim() ? ` "${v.key.trim()}"` : ''}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </div>
        ))}
        <button onClick={() => setValues((p) => [...p, { key: '', value: '' }])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add value</button>
      </div>
      <button onClick={run} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />} Validate</button>
      {result && (result.error ? <p className="text-xs text-rose-400">{result.error}</p> : (
        <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs space-y-2">
          <div className="flex flex-wrap gap-3">
            <Stat label="Rules" value={result.totalRules} />
            <Stat label="Passed" value={result.passed} tone="good" />
            <Stat label="Failed" value={result.failed} tone={result.failed > 0 ? 'bad' : 'good'} />
            <span className={`rounded px-2 py-0.5 ${result.valid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{result.valid ? 'all valid' : 'has failures'}</span>
          </div>
          <div className="space-y-1">
            {(result.results || []).map((res: any, i: number) => (
              <div key={i} className={`flex justify-between rounded px-2 py-1 ${res.passed ? 'bg-emerald-500/5' : 'bg-rose-500/10'}`}>
                <span className="text-zinc-300 font-mono">{res.field}</span>
                <span className={res.passed ? 'text-emerald-400' : 'text-rose-400'}>{res.passed ? 'OK' : res.reason}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <InStyle />
    </div>
  );
}

function TransformTab() {
  const [input, setInput] = useState<KV[]>([{ key: 'name', value: '  concord  ' }]);
  const [steps, setSteps] = useState<TransformStep[]>([{ field: 'name', operation: 'trim', extra: '' }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    const transforms = steps.filter((s) => s.field.trim()).map((s) => {
      const base: Record<string, unknown> = { field: s.field.trim(), operation: s.operation };
      if (s.operation === 'rename') base.newName = s.extra.trim();
      if (s.operation === 'default') base.defaultValue = s.extra;
      return base;
    });
    if (transforms.length === 0) return;
    setBusy(true);
    const r = await lensRun('custom', 'transformData', { input: kvToObject(input), transforms });
    setBusy(false);
    setResult(r.data.ok ? r.data.result : { error: r.data.error });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Input record</p>
        {input.map((v, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <input value={v.key} onChange={(e) => setInput((p) => p.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="field" className="in w-32" />
            <input value={v.value} onChange={(e) => setInput((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className="in flex-1" />
            <button onClick={() => setInput((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove input field${v.key.trim() ? ` "${v.key.trim()}"` : ''}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </div>
        ))}
        <button onClick={() => setInput((p) => [...p, { key: '', value: '' }])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add field</button>
      </div>
      <div>
        <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Transform steps</p>
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <input value={s.field} onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} placeholder="field" className="in w-32" />
            <select value={s.operation} onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? { ...x, operation: e.target.value as TransformStep['operation'] } : x))} className="in w-28">
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {(s.operation === 'rename' || s.operation === 'default') && (
              <input value={s.extra} onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? { ...x, extra: e.target.value } : x))} placeholder={s.operation === 'rename' ? 'new name' : 'default value'} className="in flex-1" />
            )}
            <button onClick={() => setSteps((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove transform step${s.field.trim() ? ` for "${s.field.trim()}"` : ''}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </div>
        ))}
        <button onClick={() => setSteps((p) => [...p, { field: '', operation: 'trim', extra: '' }])} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add step</button>
      </div>
      <button onClick={run} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />} Transform</button>
      {result && (result.error ? <p className="text-xs text-rose-400">{result.error}</p> : (
        <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs space-y-2">
          <p className="text-zinc-400">Transforms applied: <span className="text-neon-cyan font-bold">{result.transformsApplied}</span></p>
          <div className="space-y-1">
            {(result.log || []).map((entry: string, i: number) => <p key={i} className="font-mono text-zinc-300 bg-zinc-900/60 rounded px-2 py-1">{entry}</p>)}
          </div>
          <div className="rounded bg-zinc-900/60 p-2">
            {Object.entries(result.output || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-zinc-400 font-mono">{k}</span><span className="text-zinc-200">{String(v)}</span></div>
            ))}
          </div>
        </div>
      ))}
      <InStyle />
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: unknown; tone?: 'neutral' | 'good' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-400' : tone === 'good' ? 'text-emerald-400' : 'text-neon-purple';
  return (
    <span className="rounded border border-zinc-800 bg-black/40 px-2 py-1">
      <span className={`font-bold ${color}`}>{value == null ? '—' : String(value)}</span> <span className="text-zinc-400">{label}</span>
    </span>
  );
}

function InStyle() {
  return (
    <style jsx global>{`
      .in { background: rgba(0,0,0,0.4); border: 1px solid rgb(39 39 42); border-radius: 0.375rem; padding: 0.3rem 0.5rem; font-size: 0.75rem; color: white; }
      .in:focus { outline: none; border-color: rgb(168 85 247 / 0.5); }
    `}</style>
  );
}
