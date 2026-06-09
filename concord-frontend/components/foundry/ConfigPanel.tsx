'use client';

/**
 * Foundry — ConfigPanel.
 *
 * Renders a registry-schema-driven config form for one selected
 * system. Every field type in the System Registry's configSchema
 * (enum / number / bool / text / range) maps to a control here. The
 * panel is fully driven by the schema the backend hands back — adding
 * a config field to a system server-side makes it appear here with no
 * frontend change.
 */

import type { SystemEntry, ConfigField } from '@/lib/foundry/api';
import { AlertTriangle, Link2, Ban } from 'lucide-react';

interface ConfigPanelProps {
  system: SystemEntry;
  config: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}

function FieldControl({
  field,
  desc,
  value,
  onChange,
}: {
  field: string;
  desc: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `cfg-${field}`;
  switch (desc.type) {
    case 'enum':
      return (
        <select
          id={id}
          value={String(value ?? desc.default)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {(desc.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="range"
            min={desc.min}
            max={desc.max}
            step={desc.step ?? 1}
            value={Number(value ?? desc.default)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-sky-500"
          />
          <span className="w-14 shrink-0 text-right font-mono text-xs text-sky-300">
            {Number(value ?? desc.default)}
          </span>
        </div>
      );
    case 'bool':
      return (
        <button aria-label="Toggle"
          id={id}
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
            value ? 'bg-sky-500' : 'bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              value ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </button>
      );
    case 'text':
      return (
        <input
          id={id}
          type="text"
          value={String(value ?? desc.default ?? '')}
          maxLength={desc.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      );
    case 'range': {
      const [lo, hi] = Array.isArray(value) ? (value as number[]) : (desc.default as number[]);
      return (
        <div className="flex items-center gap-2">
          <input
            type="number" min={desc.min} max={desc.max} value={lo}
            onChange={(e) => onChange([Number(e.target.value), hi])}
            className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="number" min={desc.min} max={desc.max} value={hi}
            onChange={(e) => onChange([lo, Number(e.target.value)])}
            className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      );
    }
    default:
      return null;
  }
}

export function ConfigPanel({ system, config, onChange }: ConfigPanelProps) {
  const fields = Object.entries(system.configSchema);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-slate-100">{system.displayName}</h3>
          {system.status === 'stub' && (
            <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              coming soon
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{system.description}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
            scope: {system.worldScope}
          </span>
          {system.dependsOn.map((d) => (
            <span key={d} className="flex items-center gap-0.5 rounded bg-sky-950/60 px-1.5 py-0.5 text-sky-300">
              <Link2 className="h-2.5 w-2.5" /> needs {d}
            </span>
          ))}
          {system.conflictsWith.map((c) => (
            <span key={c} className="flex items-center gap-0.5 rounded bg-red-950/60 px-1.5 py-0.5 text-red-300">
              <Ban className="h-2.5 w-2.5" /> conflicts {c}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {system.status === 'stub' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-700/40 bg-amber-950/30 px-2.5 py-2 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This system isn&apos;t built yet — it stays in your worldspec and starts working
              automatically once it ships. Configure it now; it just won&apos;t activate on publish.
            </span>
          </div>
        )}
        {fields.length === 0 && (
          <p className="text-xs text-slate-400">This system has no configuration.</p>
        )}
        {fields.map(([field, desc]) => (
          <div key={field}>
            <label htmlFor={`cfg-${field}`} className="mb-1 block text-xs font-medium text-slate-300">
              {desc.label}
            </label>
            <FieldControl
              field={field}
              desc={desc}
              value={config[field]}
              onChange={(v) => onChange(field, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ConfigPanel;
