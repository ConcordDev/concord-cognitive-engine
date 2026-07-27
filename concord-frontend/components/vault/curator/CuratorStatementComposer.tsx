'use client';

/**
 * TheVault — the act of admission.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE LARGEST THING ON THE WORKBENCH
 * ───────────────────────────────────────────────────────────────────────────
 * `curator_statement` is, as far as this codebase goes, unique: verified in
 * docs/THEVAULT_SPEC.md §7.2 and restated in migration 396's header, every
 * other governance table in Concord records only a *reject* reason. The
 * platform has always written down why something was turned away and never why
 * something was let in. This one field inverts that.
 *
 * It also cannot be regenerated. A detector finding re-derives from the next
 * sweep; a curator's sentence about why a work mattered re-derives from
 * nothing. So writing it is treated here as the central act of the interface —
 * a sheet of certificate stock with a prompt already letterpressed onto it —
 * and not as a validation-gated field inside a confirm dialog.
 *
 * Three rules this surface holds to:
 *
 *   · The prompt is rendered as text on the page, not as placeholder chrome.
 *     "Accepted into TheVault because…" is the first half of the sentence the
 *     curator is finishing, so it stays visible while they write.
 *
 *   · The minimum length is shown as a floor being cleared, never as a
 *     rejection after the fact. `MIN_CURATOR_STATEMENT_CHARS` is deliberately
 *     low in the backend precisely so it does not second-guess a terse
 *     curator, and the copy says so.
 *
 *   · The machine-evidence check runs live, as a courtesy. The backend remains
 *     the authority (`curator_statement_is_machine_evidence`); this just means
 *     a curator learns it while writing rather than by being refused.
 *
 * The six axes appear as a writing scaffold, honestly labelled: TheVault stores
 * no axis scores — there is no column for one, by design — so the toggles are
 * a local aid for the person writing and say plainly that nothing about them is
 * recorded. Documentation is marked as what the brief calls it: a gate, not a
 * score.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vault } from '@/lib/vault/tokens';
import {
  ADMISSION_AXES,
  MIN_CURATOR_STATEMENT_CHARS,
  refusalCopy,
  statementEchoesMachineEvidence,
  type VaultQueueSubmission,
} from './vault-curator-client';

export interface CuratorStatementComposerProps {
  submission: VaultQueueSubmission;
  /** In flight — the admission is being sealed against the server. */
  busy?: boolean;
  /** The backend's own refusal code from the last attempt, or null. */
  refusal?: string | null;
  /** Invoked with the statement exactly as typed (trimmed). */
  onAdmit: (statement: string) => void;
  /** Opens the decline path. Rendered as a quiet sibling, never a primary. */
  onDecline: () => void;
}

const draftKey = (id: string) => `vault:curator:draft:${id}`;

function readDraft(id: string): string {
  if (typeof window === 'undefined') return '';
  try { return window.localStorage.getItem(draftKey(id)) || ''; } catch { return ''; }
}

function writeDraft(id: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(draftKey(id), value);
    else window.localStorage.removeItem(draftKey(id));
  } catch { /* a full or blocked store must never break the composer */ }
}

/** Clear a submission's saved draft — called by the queue once it is admitted. */
export function clearStatementDraft(id: string) {
  writeDraft(id, '');
}

export function CuratorStatementComposer({
  submission,
  busy = false,
  refusal = null,
  onAdmit,
  onDecline,
}: CuratorStatementComposerProps) {
  const [statement, setStatement] = useState<string>(() => readDraft(submission.id));
  const [considered, setConsidered] = useState<Set<string>>(new Set());
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // Switching submissions swaps in that submission's own unfinished sentence.
  useEffect(() => {
    setStatement(readDraft(submission.id));
    setConsidered(new Set());
  }, [submission.id]);

  useEffect(() => {
    writeDraft(submission.id, statement);
  }, [submission.id, statement]);

  const trimmed = statement.trim();
  const written = trimmed.length;
  const clearsFloor = written >= MIN_CURATOR_STATEMENT_CHARS;

  const echoesEvidence = useMemo(
    () => (submission.machineEvidence == null ? false : statementEchoesMachineEvidence(submission.machineEvidence, trimmed)),
    [submission.machineEvidence, trimmed],
  );

  const canAdmit = clearsFloor && !echoesEvidence && !busy;

  const submit = useCallback(() => {
    if (!canAdmit) return;
    onAdmit(trimmed);
  }, [canAdmit, onAdmit, trimmed]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const toggleAxis = useCallback((axisId: string) => {
    setConsidered((prev) => {
      const next = new Set(prev);
      if (next.has(axisId)) next.delete(axisId); else next.add(axisId);
      return next;
    });
    fieldRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="vault-admission-heading"
      data-vault-authorship="human"
      className="vault-plate vault-paper vault-paper-card rounded-sm p-6"
    >
      <p className={`${vault.label} mb-3`}>The admission</p>

      {/* The prompt. Half a sentence, letterpressed into the sheet. */}
      <h2
        id="vault-admission-heading"
        className={`${vault.subtitle} vault-letterpress-deep mb-1`}
      >
        Accepted into TheVault because…
      </h2>
      <p className="font-sans text-sm leading-6 text-vault-graphite mb-5">
        Your words, attributed to you, kept for as long as the archive stands. Nothing in TheVault can
        write this line but you.
      </p>

      {/* ── The six axes, as a scaffold for the sentence ──────────────────── */}
      <fieldset className="mb-5 border-0 p-0 m-0">
        <legend className={`${vault.label} mb-2 p-0`}>What the archive judges on</legend>
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {ADMISSION_AXES.map((axis) => {
            const marked = considered.has(axis.id);
            return (
              <li key={axis.id}>
                <button
                  type="button"
                  aria-pressed={marked}
                  onClick={() => toggleAxis(axis.id)}
                  className={[
                    'w-full rounded-sm border px-3 py-2 text-left',
                    marked
                      ? 'border-vault-brassLine bg-vault-sunk'
                      : 'border-vault-rule bg-transparent hover:bg-vault-sunk',
                  ].join(' ')}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-sans text-sm font-medium text-vault-ink">{axis.name}</span>
                    {axis.gate ? (
                      <span className="font-sans text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-vault-brass">
                        Gate
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block font-sans text-xs leading-5 text-vault-gray">
                    {axis.question}
                  </span>
                  {axis.caveat ? (
                    <span className="mt-1 block font-sans text-xs leading-5 text-vault-gray">
                      {axis.caveat}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 font-sans text-xs leading-5 text-vault-gray">
          Marking an axis is a note to yourself while you write. TheVault stores no scores — there is no
          column for one. The record carries your sentence and nothing else.
        </p>
      </fieldset>

      {/* ── The sheet ─────────────────────────────────────────────────────── */}
      <label htmlFor="vault-curator-statement" className={`${vault.label} mb-2 block`}>
        Curator statement
      </label>
      <textarea
        id="vault-curator-statement"
        ref={fieldRef}
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
        onKeyDown={onKeyDown}
        rows={10}
        spellCheck
        aria-describedby="vault-statement-floor vault-statement-attribution"
        aria-invalid={echoesEvidence || undefined}
        className="w-full resize-y rounded-sm border border-vault-rule bg-vault-card px-4 py-3 font-vault text-base leading-[1.75rem] text-vault-ink placeholder:text-vault-gray vault-deboss"
        placeholder="…"
      />

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <p
          id="vault-statement-floor"
          className={[
            'font-sans text-xs font-medium tabular-nums tracking-[0.04em]',
            clearsFloor ? 'text-vault-brass' : 'text-vault-gray',
          ].join(' ')}
        >
          {written} written · {MIN_CURATOR_STATEMENT_CHARS} minimum
        </p>
        <p className="font-sans text-xs leading-5 text-vault-gray">
          The floor rejects a placeholder, not a terse curator.
        </p>
      </div>

      {echoesEvidence ? (
        <p
          role="alert"
          data-testid="vault-echo-warning"
          className="mt-3 rounded-sm border border-vault-brassLine bg-vault-sunk px-3 py-2 font-sans text-sm leading-6 text-vault-ink"
        >
          This reproduces text from the machine-assembled evidence below. The archive will refuse it —
          assembled evidence can inform a judgment, it can never be one.
        </p>
      ) : null}

      {refusal ? (
        <p
          role="alert"
          data-testid="vault-admit-refusal"
          className="mt-3 rounded-sm border border-vault-brassLine bg-vault-sunk px-3 py-2 font-sans text-sm leading-6 text-vault-ink"
        >
          {refusalCopy(refusal)}
        </p>
      ) : null}

      {/* ── Attribution, stated before the act, not after ─────────────────── */}
      <p id="vault-statement-attribution" className="mt-4 font-sans text-xs leading-5 text-vault-gray">
        Written once and attributed to you permanently. Attribution cannot be reassigned — a guest
        curator&rsquo;s induction stays the guest&rsquo;s, and nobody else&rsquo;s.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-vault-rule pt-5">
        <button
          type="button"
          onClick={submit}
          disabled={!canAdmit}
          className={vault.buttonAccent}
          data-testid="vault-admit-button"
        >
          {busy ? 'Sealing…' : 'Admit into TheVault'}
        </button>
        <kbd className="font-sans text-xs font-medium tracking-[0.04em] text-vault-gray">
          ⌘ / Ctrl + Enter
        </kbd>
        <span className="flex-1" />
        <button type="button" onClick={onDecline} disabled={busy} className={vault.button}>
          Decline privately…
        </button>
      </div>
    </section>
  );
}

export default CuratorStatementComposer;
