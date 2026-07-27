'use client';

/**
 * TheVault — decline, with dignity.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS SURFACE IS NOT ALLOWED TO BECOME
 * ───────────────────────────────────────────────────────────────────────────
 * A decline is private, permanent, and reasoned (docs/THEVAULT_SPEC.md §6).
 * The backend already makes the privacy structural: `browse()` and
 * `publicRecord()` hard-code `status = 'admitted'` and accept no status
 * argument at all, so there is no parameter a caller could pass to widen
 * either into a rejection list. Migration 396's header goes further — it notes
 * that its indexes deliberately support the curator-scoped queue and nothing
 * that would make a public "rejected" listing cheap, *because there must never
 * be one*.
 *
 * The corresponding UI obligations:
 *
 *   · No ceremony. Admission gets the black room; a decline gets a plain
 *     paper sheet and a quiet close. Dressing up a refusal would make it a
 *     performance, which is the punishment the brief refuses to be in the
 *     business of.
 *
 *   · The reason is written to the submitter, not about them. `decline()`
 *     refuses an empty reason outright (`decline_reason_required`), so the
 *     field is genuinely required — and the copy says who reads it.
 *
 *   · A decline is not a bar. Re-submission with new evidence is allowed, and
 *     the prior decline travels with it as context for the next curator. The
 *     dialog says so, because the person who reads this outcome deserves to
 *     know it before they read the reason.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { vault } from '@/lib/vault/tokens';
import { refusalCopy, type VaultQueueSubmission } from './vault-curator-client';

export interface DeclineDialogProps {
  submission: VaultQueueSubmission;
  busy?: boolean;
  /** Backend refusal code from the last attempt, or null. */
  refusal?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function DeclineDialog({ submission, busy = false, refusal = null, onConfirm, onCancel }: DeclineDialogProps) {
  const [reason, setReason] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const trimmed = reason.trim();
  const confirm = useCallback(() => {
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  }, [busy, onConfirm, trimmed]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(26, 24, 21, 0.42)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-decline-heading"
        className="vault-plate vault-paper vault-paper-card vault-reveal w-full max-w-xl rounded-sm p-6"
      >
        <p className={`${vault.label} mb-3`}>Private decision</p>
        <h2 id="vault-decline-heading" className={`${vault.subtitle} mb-3`}>
          Decline, privately.
        </h2>

        <p className={`${vault.bodySm} mb-2`}>
          <span className="font-vault text-vault-ink">{submission.title}</span> will not enter the archive.
        </p>

        <p className="font-sans text-sm leading-6 text-vault-graphite">
          This decision is recorded for the curators and for the person who submitted the work. It is never
          published, never counted, and never listed. TheVault keeps no public record of what it did not
          admit.
        </p>
        <p className="mt-2 font-sans text-sm leading-6 text-vault-graphite">
          A decline is not a bar. The work may be submitted again when there is new evidence, and this
          reason travels with it as context for whoever reviews it next — so write it to be read.
        </p>

        <label htmlFor="vault-decline-reason" className={`${vault.label} mb-2 mt-5 block`}>
          Reason, addressed to the submitter
        </label>
        <textarea
          id="vault-decline-reason"
          ref={fieldRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-sm border border-vault-rule bg-vault-card px-4 py-3 font-vault text-base leading-[1.75rem] text-vault-ink vault-deboss"
        />

        {refusal ? (
          <p
            role="alert"
            data-testid="vault-decline-refusal"
            className="mt-3 rounded-sm border border-vault-brassLine bg-vault-sunk px-3 py-2 font-sans text-sm leading-6 text-vault-ink"
          >
            {refusalCopy(refusal)}
          </p>
        ) : null}

        <div className="mt-5 flex items-center gap-3 border-t border-vault-rule pt-5">
          <button
            type="button"
            onClick={confirm}
            disabled={!trimmed || busy}
            className={vault.button}
            data-testid="vault-decline-confirm"
          >
            {busy ? 'Recording…' : 'Record decline'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className={vault.button}>
            Cancel
          </button>
          <span className="flex-1" />
          <span className="font-sans text-xs text-vault-gray">Esc closes</span>
        </div>
      </div>
    </div>
  );
}

export default DeclineDialog;
