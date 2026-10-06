'use client';

/**
 * ParameterPanel — the study's editable inputs (dimensions, load, support,
 * material). Edits change the inputs only; the result is recomputed by the
 * solver when the study is run.
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { DIM_LABELS, SUPPORT_LABELS, type BeamDims, type BeamSupport } from '@/lib/conkay/workspace-commands';
import type { Material, StudyInputs } from './useConKayWorkspace';

export interface ParameterPanelHandle {
  focus: (key: keyof BeamDims) => void;
}

interface Props {
  inputs: StudyInputs;
  materials: Material[];
  onChange: (next: StudyInputs) => void;
}

const DIM_ORDER: Array<keyof BeamDims> = ['length', 'height', 'flangeWidth', 'flangeThickness', 'webThickness'];

function NumberField({
  id, label, title, unit, value, onCommit, inputRef,
}: {
  id: string; label: string; title: string; unit: string; value: number;
  onCommit: (v: number) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const [text, setText] = useState(String(value));
  // Follow outside changes (a chat edit, opening a model) — the
  // "adjust state while rendering" pattern, not an effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(String(value)); }
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 py-0.5">
      <span className="min-w-0 truncate text-xs text-slate-300" title={title}>
        <span className="font-mono text-sky-200">{label}</span> <span className="text-[10px] text-slate-500">{title}</span>
      </span>
      <span className="flex items-center gap-1">
        <input
          id={id}
          ref={inputRef}
          aria-label={`${label} ${title}`}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
          className="w-16 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-sky-400/60 focus:outline-none"
        />
        <span className="w-6 text-[10px] text-slate-500">{unit}</span>
      </span>
    </label>
  );
}

export const ParameterPanel = forwardRef<ParameterPanelHandle, Props>(function ParameterPanel({ inputs, materials, onChange }, ref) {
  const fields = useRef<Partial<Record<keyof BeamDims, HTMLInputElement | null>>>({});
  useImperativeHandle(ref, () => ({
    focus: (key) => { const el = fields.current[key]; if (el) { el.focus(); el.select(); } },
  }), []);

  const setDim = (k: keyof BeamDims, v: number) => onChange({ ...inputs, dims: { ...inputs.dims, [k]: v } });

  return (
    <div className="space-y-2">
      <div>
        {DIM_ORDER.map((k) => (
          <NumberField
            key={k}
            id={`conkay-dim-${k}`}
            label={DIM_LABELS[k].symbol}
            title={DIM_LABELS[k].name}
            unit="mm"
            value={inputs.dims[k]}
            onCommit={(v) => setDim(k, v)}
            inputRef={(el) => { fields.current[k] = el; }}
          />
        ))}
        <NumberField
          id="conkay-load"
          label="P"
          title="point load"
          unit="kN"
          value={Math.round((inputs.loadN / 1000) * 1000) / 1000}
          onCommit={(v) => onChange({ ...inputs, loadN: v * 1000 })}
        />
      </div>
      <label className="block">
        <span className="sr-only">Support</span>
        <select
          value={inputs.support}
          onChange={(e) => onChange({ ...inputs, support: e.target.value as BeamSupport })}
          aria-label="Support"
          className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-400/60 focus:outline-none"
        >
          {(Object.keys(SUPPORT_LABELS) as BeamSupport[]).map((s) => <option key={s} value={s}>{SUPPORT_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="sr-only">Material</span>
        <select
          value={inputs.materialId}
          onChange={(e) => onChange({ ...inputs, materialId: e.target.value })}
          aria-label="Material"
          className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-400/60 focus:outline-none"
        >
          {materials.length === 0 && <option value={inputs.materialId}>{inputs.materialId}</option>}
          {materials.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
    </div>
  );
});
