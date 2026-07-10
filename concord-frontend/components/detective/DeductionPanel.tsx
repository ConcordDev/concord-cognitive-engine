'use client';

/**
 * DeductionPanel — the "lock in" form for one open case.
 *
 * Calls `detective.deduce` (server/domains/detective.js → lockInDeduction)
 * via `useMacroDispatchFeedback`, so the submit button reflects REAL
 * dispatch/running/done/error transitions (not a fake spinner timer).
 *
 * 2-of-3 correct WITH a suspect_match resolves the case — the result
 * panel renders the three real reasons the backend actually credited
 * (`suspect_match` / `weapon_match` / `motive_offered`), never a guess
 * at which ones "should" have matched.
 */

import React, { useEffect } from 'react';
import { FileText, Check, X, AlertTriangle, Gem, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { useLensCommand } from '@/hooks/useLensCommand';

export interface DeductionForm {
  suspectId: string;
  weapon: string;
  motive: string;
}

export interface DeduceResult {
  deductionId: string;
  correctCount: number;
  reasons: string[];
  solved: boolean;
  discovery: { nodeId: string } | null;
}

const REASON_COPY: Record<string, string> = {
  suspect_match: 'Suspect matches',
  weapon_match: 'Weapon / crime kind matches',
  motive_offered: 'Motive offered',
};

const WEAPON_HINTS = ['break_in', 'theft', 'assault', 'murder', 'vandalism', 'trespass'];

export interface DeductionPanelProps {
  crimeId: string;
  form: DeductionForm;
  onChangeForm: (next: DeductionForm) => void;
  disabled?: boolean;
  disabledReason?: string;
  onSolved: (result: DeduceResult) => void;
  onSubmitted?: (result: DeduceResult) => void;
}

export function DeductionPanel({
  crimeId, form, onChangeForm, disabled, disabledReason, onSolved, onSubmitted,
}: DeductionPanelProps) {
  const { status, error, result, dispatch, reset } = useMacroDispatchFeedback<DeduceResult>();
  const busy = status === 'dispatched' || status === 'running';

  // Reset the dispatch/result state whenever the selected case changes so a
  // stale "solved" banner from a previous case never bleeds into a new one.
  useEffect(() => { reset(); }, [crimeId, reset]);

  const canSubmit = !disabled && !busy && form.suspectId.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    const r = await dispatch('detective', 'deduce', {
      crimeId,
      suspectId: form.suspectId.trim(),
      weapon: form.weapon.trim() || undefined,
      motive: form.motive.trim() || undefined,
    });
    if (r) {
      onSubmitted?.(r);
      if (r.solved) onSolved(r);
    }
  };

  // Global (works while focus is in an input) so the ⌘/Ctrl+Enter hint
  // below is a real shortcut, not decorative copy.
  useLensCommand([
    { id: 'submit-deduction', keys: 'mod+enter', description: 'Submit deduction', action: submit, enabled: canSubmit, global: true },
  ], { lensId: 'detective' });

  // `disabled` can flip to true mid-session (this same panel's own submit
  // just solved the case, and the parent silently re-fetched the now-solved
  // crime). Swap out the FORM for the disabled notice, but never swap out
  // the result banner below it — the player just earned that "Case solved"
  // readout and it must not be yanked out from under them.
  const showForm = !disabled || (status === 'done' && !!result);

  return (
    <div>
      <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Lock in</h3>

      {showForm ? (
        <div className="space-y-2">
          <div>
            <label className="sr-only" htmlFor="detective-suspect">Suspect ID</label>
            <input
              id="detective-suspect"
              value={form.suspectId}
              onChange={(e) => onChangeForm({ ...form, suspectId: e.target.value })}
              placeholder="Suspect ID (name evidence at left, or type one)"
              disabled={disabled}
              className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-amber-400/60 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="detective-weapon">Weapon or crime kind</label>
            <input
              id="detective-weapon"
              list="detective-weapon-hints"
              value={form.weapon}
              onChange={(e) => onChangeForm({ ...form, weapon: e.target.value })}
              placeholder="Weapon / crime kind (e.g. 'theft')"
              disabled={disabled}
              className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-amber-400/60 focus:outline-none disabled:opacity-50"
            />
            <datalist id="detective-weapon-hints">
              {WEAPON_HINTS.map((w) => <option key={w} value={w} />)}
            </datalist>
          </div>
          <div>
            <label className="sr-only" htmlFor="detective-motive">Motive</label>
            <input
              id="detective-motive"
              value={form.motive}
              onChange={(e) => onChangeForm({ ...form, motive: e.target.value })}
              placeholder="Motive (freeform)"
              disabled={disabled}
              className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-amber-400/60 focus:outline-none disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            aria-busy={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-amber-500/30 px-3 py-1.5 text-[12px] text-amber-100 transition-colors hover:bg-amber-500/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileText className="h-3.5 w-3.5" aria-hidden="true" />}
            {status === 'dispatched' ? 'Submitting…' : status === 'running' ? 'Weighing evidence…' : 'Submit deduction'}
          </button>
          <p className="text-[10px] text-slate-500">
            <kbd className="rounded bg-slate-800 px-1 py-0.5 font-mono">⌘/Ctrl</kbd>+<kbd className="rounded bg-slate-800 px-1 py-0.5 font-mono">Enter</kbd> submits from anywhere on the board.
          </p>
        </div>
      ) : (
        <div data-testid="deduction-disabled" className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3 text-[12px] text-slate-400">
          {disabledReason || 'This case is not open for new deductions.'}
        </div>
      )}

      {status === 'error' && (
        <div data-testid="submit-error" role="alert" className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[12px] text-rose-200">
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" /> {error || 'Could not submit your deduction.'}
        </div>
      )}

      {result && status === 'done' && (
        <div
          data-testid="deduce-result"
          role="status"
          className={cn(
            'mt-3 rounded border p-2.5 text-[12px]',
            result.solved ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200',
          )}
        >
          <div className="flex items-center gap-1 font-medium">
            {result.solved ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
            {result.solved ? 'Case solved' : 'Not yet'} — {result.correctCount}/3 facts confirmed
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {['suspect_match', 'weapon_match', 'motive_offered'].map((r) => {
              const hit = result.reasons.includes(r);
              return (
                <li key={r} className={cn('flex items-center gap-1 text-[11px]', hit ? '' : 'opacity-40')}>
                  {hit ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                  {REASON_COPY[r]}
                </li>
              );
            })}
          </ul>
          {result.discovery?.nodeId && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-200">
              <Gem className="h-3 w-3" aria-hidden="true" /> An evidence-locker essence node appeared at the crime scene in the world.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default DeductionPanel;
