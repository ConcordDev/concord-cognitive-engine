'use client';

/**
 * PlaybookPanel — predefined response checklist for a crisis type.
 * Calls crisis.playbook to load steps and crisis.playbook_step to toggle
 * completion. Progress is persisted per-user on the backend.
 */

import { useEffect, useState, useCallback } from 'react';
import { ClipboardCheck, Loader2, CheckSquare, Square } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Step {
  id: string;
  order: number;
  label: string;
  done: boolean;
}
interface PlaybookResult {
  playbookKey: string;
  title: string;
  steps: Step[];
  completed: number;
  total: number;
  progressPct: number;
}

export function PlaybookPanel({
  crisisId,
  crisisType,
}: {
  crisisId: string;
  crisisType: string;
}) {
  const [pb, setPb] = useState<PlaybookResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<PlaybookResult>('crisis', 'playbook', { crisisType, crisisId });
    if (r.data?.ok && r.data.result) setPb(r.data.result);
    setLoading(false);
  }, [crisisId, crisisType]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (step: Step) => {
    setBusy(step.id);
    const r = await lensRun('crisis', 'playbook_step', {
      crisisId, stepId: step.id, done: !step.done,
    });
    if (r.data?.ok) await load();
    setBusy(null);
  }, [crisisId, load]);

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-rose-300" />
          <h3 className="text-sm font-semibold text-white">
            {pb?.title || 'Response playbook'}
          </h3>
        </div>
        {pb && (
          <span className="font-mono text-[11px] text-zinc-400">
            {pb.completed}/{pb.total}
          </span>
        )}
      </header>

      {pb && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pb.progressPct}%` }}
          />
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading playbook…
        </div>
      )}

      {!loading && pb && (
        <ul className="space-y-1.5">
          {pb.steps.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => toggle(s)}
                className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left text-sm transition disabled:opacity-50 ${
                  s.done
                    ? 'border-emerald-600/30 bg-emerald-900/15 text-emerald-200'
                    : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                }`}
              >
                {s.done
                  ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  : <Square className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />}
                <span className={s.done ? 'line-through opacity-70' : ''}>
                  <span className="mr-1.5 font-mono text-[10px] opacity-50">{s.order}.</span>
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
