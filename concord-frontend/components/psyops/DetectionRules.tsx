'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { PsyopsRule } from './types';

export function DetectionRules({
  rules,
  onChange,
}: {
  rules: PsyopsRule[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (signal: string, patch: Record<string, unknown>) => {
    setBusy(signal);
    const r = await lensRun('psyops', 'rules_update', { signal, ...patch });
    setBusy(null);
    if (r.data?.ok) onChange();
  };

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <SlidersHorizontal className="h-4 w-4 text-rose-400" /> Detection rules
      </h2>
      <p className="text-[11px] text-zinc-400">
        Each rule sets the σ threshold at which a signal scan files an alert, and the σ above which it escalates to critical.
      </p>
      {rules.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-3">No rules loaded.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.signal}
              className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{rule.label}</p>
                  <p className="font-mono text-[10px] text-zinc-400">{rule.signal}</p>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={busy === rule.signal}
                    onChange={(e) => void update(rule.signal, { enabled: e.target.checked })}
                    className="accent-rose-500"
                  />
                  enabled
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-[11px] text-zinc-400">
                  Alert σ
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.1}
                    defaultValue={rule.sigma}
                    disabled={busy === rule.signal}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== rule.sigma) void update(rule.signal, { sigma: v });
                    }}
                    className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </label>
                <label className="text-[11px] text-zinc-400">
                  Critical σ
                  <input
                    type="number"
                    min={0.5}
                    max={12}
                    step={0.1}
                    defaultValue={rule.critical}
                    disabled={busy === rule.signal}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== rule.critical) void update(rule.signal, { critical: v });
                    }}
                    className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
