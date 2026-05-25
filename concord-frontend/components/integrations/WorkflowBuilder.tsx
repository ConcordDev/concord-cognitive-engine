'use client';

// Visual trigger -> action workflow ("Zap") builder. Multi-step editor with
// conditional filters, branching paths, formatter/transform and code steps,
// field-level data mapping, and scheduled/polling triggers. Persisted via the
// integrations domain macros (zapSave / zapList / scheduleSet).

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Plus, Trash2, ArrowDown, Filter, GitBranch, Wand2, Code, Clock,
  Send, Loader2, Save, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface ZapStep {
  kind: 'action' | 'filter' | 'path' | 'formatter' | 'code' | 'delay';
  connectorId?: string;
  actionId?: string;
  fieldMap?: Record<string, string>;
  condition?: string;
  branches?: Array<{ label?: string; condition: string; steps: ZapStep[] }>;
  op?: string;
  inputPath?: string;
  outputKey?: string;
  config?: Record<string, unknown>;
  expression?: string;
  seconds?: number;
}

export interface ZapTrigger { event: string; connectorId?: string }

export interface Zap {
  id?: string;
  name: string;
  trigger: ZapTrigger;
  steps: ZapStep[];
  enabled?: boolean;
  schedule?: { kind: string; intervalSeconds?: number; timeOfDay?: string; dayOfWeek?: number; nextFireAt?: string };
}

const TRIGGER_EVENTS = [
  'dtu.created', 'dtu.updated', 'webhook.received', 'schedule.cron',
  'lens.alert', 'integration.error', 'manual',
];

const FORMATTER_OPS = ['uppercase', 'lowercase', 'trim', 'capitalize', 'default', 'number',
  'round', 'split', 'join', 'replace', 'truncate', 'iso_date', 'json_parse', 'json_stringify'];

const STEP_META: Record<ZapStep['kind'], { label: string; icon: React.ReactNode; tone: string }> = {
  action: { label: 'Action', icon: <Send className="w-3.5 h-3.5" />, tone: 'text-neon-green' },
  filter: { label: 'Filter', icon: <Filter className="w-3.5 h-3.5" />, tone: 'text-yellow-400' },
  path: { label: 'Paths / Branch', icon: <GitBranch className="w-3.5 h-3.5" />, tone: 'text-neon-purple' },
  formatter: { label: 'Formatter', icon: <Wand2 className="w-3.5 h-3.5" />, tone: 'text-neon-cyan' },
  code: { label: 'Code', icon: <Code className="w-3.5 h-3.5" />, tone: 'text-blue-400' },
  delay: { label: 'Delay', icon: <Clock className="w-3.5 h-3.5" />, tone: 'text-gray-400' },
};

function blankStep(kind: ZapStep['kind']): ZapStep {
  switch (kind) {
    case 'action': return { kind, actionId: 'create_dtu', fieldMap: {} };
    case 'filter': return { kind, condition: '' };
    case 'path': return { kind, branches: [{ label: 'Path A', condition: '', steps: [] }] };
    case 'formatter': return { kind, op: 'uppercase', inputPath: 'data', outputKey: 'formatted', config: {} };
    case 'code': return { kind, expression: '', outputKey: 'computed' };
    case 'delay': return { kind, seconds: 60 };
  }
}

export function WorkflowBuilder({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Zap | null;
  onSaved: (zap: Zap) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState<ZapTrigger>(initial?.trigger ?? { event: 'dtu.created' });
  const [steps, setSteps] = useState<ZapStep[]>(initial?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<ZapStep>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const remove = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) { setError('Workflow name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await lensRun<{ zap: Zap }>('integrations', 'zapSave', {
        id: initial?.id,
        name: name.trim(),
        trigger,
        steps,
        enabled: initial?.enabled ?? true,
      });
      if (r.data.ok === false || !r.data.result?.zap) {
        setError(r.data.error || 'Save failed');
      } else {
        onSaved(r.data.result.zap);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel p-5 border-l-4 border-neon-purple space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-purple" />
          {initial?.id ? 'Edit Workflow' : 'New Workflow'}
        </h3>
        <button onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Workflow name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. New issue -> Slack alert"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
        />
      </div>

      {/* Trigger */}
      <div className="rounded-lg border border-neon-green/30 bg-neon-green/[0.04] p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-neon-green">
          <Zap className="w-3.5 h-3.5" /> TRIGGER
        </div>
        <select
          value={trigger.event}
          onChange={(e) => setTrigger({ ...trigger, event: e.target.value })}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
        >
          {TRIGGER_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i}>
            <div className="flex justify-center"><ArrowDown className="w-4 h-4 text-gray-600" /></div>
            <StepCard
              step={step}
              index={i}
              total={steps.length}
              onChange={(patch) => update(i, patch)}
              onRemove={() => remove(i)}
              onMove={(d) => move(i, d)}
            />
          </div>
        ))}
      </div>

      {/* Add-step palette */}
      <div className="flex justify-center"><ArrowDown className="w-4 h-4 text-gray-600" /></div>
      <div className="flex flex-wrap gap-2 justify-center">
        {(Object.keys(STEP_META) as ZapStep['kind'][]).map((k) => (
          <button
            key={k}
            onClick={() => setSteps((s) => [...s, blankStep(k)])}
            className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
          >
            <Plus className="w-3 h-3" />
            <span className={STEP_META[k].tone}>{STEP_META[k].icon}</span>
            {STEP_META[k].label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-1.5">{error}</p>}

      <div className="flex gap-3 justify-end pt-2 border-t border-lattice-border">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          className="btn-primary text-sm flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {saving ? 'Saving...' : 'Save Workflow'}
        </button>
      </div>
    </motion.div>
  );
}

function StepCard({
  step, index, total, onChange, onRemove, onMove,
}: {
  step: ZapStep;
  index: number;
  total: number;
  onChange: (patch: Partial<ZapStep>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = STEP_META[step.kind];
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 text-xs font-semibold ${meta.tone}`}>
          {meta.icon} {meta.label} <span className="text-gray-400">· step {index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up"
            className="text-gray-400 hover:text-white disabled:opacity-30">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down"
            className="text-gray-400 hover:text-white disabled:opacity-30">
            <ChevronDown className="w-4 h-4" />
          </button>
          <button onClick={onRemove} aria-label="Remove step" className="text-gray-400 hover:text-red-400">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {step.kind === 'action' && <ActionEditor step={step} onChange={onChange} />}
      {step.kind === 'filter' && (
        <input
          type="text"
          value={step.condition ?? ''}
          onChange={(e) => onChange({ condition: e.target.value })}
          placeholder='data.priority >= 3 && data.tag contains "urgent"'
          className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono"
        />
      )}
      {step.kind === 'path' && <PathEditor step={step} onChange={onChange} />}
      {step.kind === 'formatter' && (
        <div className="grid grid-cols-3 gap-2">
          <select value={step.op ?? 'uppercase'} onChange={(e) => onChange({ op: e.target.value })}
            className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs">
            {FORMATTER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input type="text" value={step.inputPath ?? ''} onChange={(e) => onChange({ inputPath: e.target.value })}
            placeholder="input path" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
          <input type="text" value={step.outputKey ?? ''} onChange={(e) => onChange({ outputKey: e.target.value })}
            placeholder="output key" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
        </div>
      )}
      {step.kind === 'code' && (
        <div className="space-y-1">
          <input type="text" value={step.expression ?? ''} onChange={(e) => onChange({ expression: e.target.value })}
            placeholder='concat($.data.first, " ", $.data.last)'
            className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
          <p className="text-[10px] text-gray-400">Intrinsics: concat / sum / len / upper / lower · paths with $.</p>
        </div>
      )}
      {step.kind === 'delay' && (
        <div className="flex items-center gap-2">
          <input type="number" value={step.seconds ?? 60} onChange={(e) => onChange({ seconds: Number(e.target.value) })}
            className="w-24 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs" />
          <span className="text-xs text-gray-400">seconds</span>
        </div>
      )}
    </div>
  );
}

function ActionEditor({ step, onChange }: { step: ZapStep; onChange: (p: Partial<ZapStep>) => void }) {
  const fm = step.fieldMap ?? {};
  const entries = Object.entries(fm);
  const setEntry = (oldK: string, newK: string, v: string) => {
    const next: Record<string, string> = {};
    for (const [k, val] of Object.entries(fm)) {
      if (k === oldK) { if (newK) next[newK] = v; } else next[k] = val;
    }
    onChange({ fieldMap: next });
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input type="text" value={step.connectorId ?? ''} onChange={(e) => onChange({ connectorId: e.target.value })}
          placeholder="connector id (e.g. slack)" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs" />
        <input type="text" value={step.actionId ?? ''} onChange={(e) => onChange({ actionId: e.target.value })}
          placeholder="action id (e.g. post_message)" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs" />
      </div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">Field mapping</div>
      {entries.map(([k, v], idx) => (
        <div key={idx} className="grid grid-cols-2 gap-2">
          <input type="text" defaultValue={k} onBlur={(e) => setEntry(k, e.target.value, v)}
            placeholder="destination field" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
          <input type="text" value={v} onChange={(e) => setEntry(k, k, e.target.value)}
            placeholder='$.data.title or literal' className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
        </div>
      ))}
      <button
        onClick={() => onChange({ fieldMap: { ...fm, [`field${entries.length + 1}`]: '' } })}
        className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> Add field
      </button>
    </div>
  );
}

function PathEditor({ step, onChange }: { step: ZapStep; onChange: (p: Partial<ZapStep>) => void }) {
  const branches = step.branches ?? [];
  return (
    <div className="space-y-2">
      {branches.map((b, i) => (
        <div key={i} className="rounded border border-neon-purple/25 bg-neon-purple/[0.04] p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input type="text" value={b.label ?? ''} onChange={(e) => {
              const next = [...branches]; next[i] = { ...b, label: e.target.value }; onChange({ branches: next });
            }} placeholder={`Path ${String.fromCharCode(65 + i)}`}
              className="flex-1 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" />
            {branches.length > 1 && (
              <button aria-label="Remove path" onClick={() => onChange({ branches: branches.filter((_, j) => j !== i) })}
                className="text-gray-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
          <input type="text" value={b.condition} onChange={(e) => {
            const next = [...branches]; next[i] = { ...b, condition: e.target.value }; onChange({ branches: next });
          }} placeholder='data.amount > 100 (blank = catch-all)'
            className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
        </div>
      ))}
      <button
        onClick={() => onChange({ branches: [...branches, { label: `Path ${String.fromCharCode(65 + branches.length)}`, condition: '', steps: [] }] })}
        className="text-xs text-neon-purple hover:underline flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> Add path
      </button>
    </div>
  );
}
