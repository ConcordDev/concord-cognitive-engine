'use client';

/**
 * MySubmissions — the signed-in submitter's own work and where each piece stands.
 *
 * Source: `vault.my_submissions`, which only ever returns the caller's rows. That
 * is also the only read that carries a decline reason, addressed to the person
 * whose work it was; no public view (browse / record) ever returns one, and this
 * component is the only place the page renders it, labelled private.
 *
 * Withdrawal is the submitter's alone and is offered while the work is still
 * `submitted` or `under_review`. An admitted record is permanent, so it offers none.
 * The server decides; a refusal (`wrong_state`, `admitted_records_are_permanent`) is
 * shown as the server said it.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';
import { KeepRecordActions } from '@/components/lens/KeepRecordActions';
import { vaultSubmissionKeepRecord } from '@/components/lens/recordKeep';

export interface MySubmission {
  id: string;
  title: string;
  status: string;
  workKind?: string;
  description?: string;
  body?: string;
  submittedAt?: number;
  curatorStatement?: string;
  declineReason?: string;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  admitted: 'Admitted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

const WITHDRAW_REFUSAL_COPY: Record<string, string> = {
  admitted_records_are_permanent: 'An admitted record is permanent and cannot be withdrawn.',
  wrong_state: 'This work is no longer waiting, so it cannot be withdrawn.',
  not_submitter: 'Only the person who submitted a work can withdraw it.',
  not_found: 'That submission could not be found.',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface MySubmissionsProps {
  submissions: MySubmission[];
  /** Resolves with null on success or the refusal reason. */
  onWithdraw: (id: string, reason: string) => Promise<string | null>;
}

export function MySubmissions({ submissions, onWithdraw }: MySubmissionsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = submissions.find((s) => s.id === selectedId) || null;
  const kept = selected ? vaultSubmissionKeepRecord(selected) : null;
  const canWithdraw = selected && (selected.status === 'submitted' || selected.status === 'under_review');

  const select = (id: string) => {
    setSelectedId(id);
    setConfirming(false);
    setReason('');
    setError('');
  };

  const withdraw = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    const refusal = await onWithdraw(selected.id, reason.trim());
    setBusy(false);
    if (refusal) {
      setError(WITHDRAW_REFUSAL_COPY[refusal] || refusal);
      return;
    }
    setConfirming(false);
    setReason('');
  };

  if (submissions.length === 0) return null;

  return (
    <section aria-label="Your submissions" data-testid="vault-my-submissions" className="mt-10">
      <h2 className={vault.sectionTitle}>Your submissions</h2>
      <p className={cn(vault.caption, 'mt-1')}>Only you can see this list, including any reason a curator gave.</p>

      <div className="mt-4 grid gap-6 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <ul className="m-0 list-none space-y-1 p-0" data-testid="vault-my-list">
          {submissions.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === selectedId}
                onClick={() => select(item.id)}
                className={cn(
                  'w-full rounded-sm border px-3 py-2 text-left',
                  item.id === selectedId ? 'border-vault-brassLine bg-vault-card' : 'border-vault-rule hover:bg-vault-card',
                )}
              >
                <span className="block font-vault text-[1.05rem] text-vault-ink">{item.title}</span>
                <span className={cn(vault.caption, 'mt-0.5 block')}>{statusLabel(item.status)}</span>
              </button>
            </li>
          ))}
        </ul>

        <div aria-live="polite">
          {selected ? (
            <article data-testid="vault-my-detail" className={vault.plate}>
              <h3 className="font-vault text-[1.5rem] leading-tight text-vault-ink">{selected.title}</h3>
              <p className={cn(vault.caption, 'mt-1')} data-testid="vault-my-status">
                {statusLabel(selected.status)}
                {selected.workKind ? ` · ${formatKind(selected.workKind)}` : ''}
              </p>

              {selected.description ? <p className={cn(vault.body, 'mt-4 whitespace-pre-wrap')}>{selected.description}</p> : null}
              {selected.body ? (
                <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm text-vault-graphite">{selected.body}</pre>
              ) : null}

              {selected.status === 'declined' && selected.declineReason ? (
                <div className="mt-5 border-t border-vault-rule pt-4" data-testid="vault-decline-reason">
                  <p className={vault.label}>From the curator · private to you</p>
                  <p className={cn(vault.bodySm, 'mt-1 whitespace-pre-wrap')}>{selected.declineReason}</p>
                </div>
              ) : null}
              {selected.status === 'admitted' && selected.curatorStatement ? (
                <div className="mt-5 border-t border-vault-rule pt-4">
                  <p className={vault.label}>Curator statement</p>
                  <p className={cn(vault.bodySm, 'mt-1 whitespace-pre-wrap')}>{selected.curatorStatement}</p>
                </div>
              ) : null}

              {canWithdraw ? (
                <div className="mt-5">
                  {confirming ? (
                    <div className="space-y-2" data-testid="vault-withdraw-confirm">
                      <label className="block">
                        <span className={cn(vault.label, 'mb-1 block')}>Reason (optional)</span>
                        <input
                          className={vault.input}
                          value={reason}
                          maxLength={500}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={withdraw} disabled={busy} className={vault.buttonAccent}>
                          {busy ? 'Withdrawing…' : 'Withdraw this work'}
                        </button>
                        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={vault.button}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirming(true)} className={vault.button}>
                      Withdraw
                    </button>
                  )}
                </div>
              ) : null}

              {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}

              <div className="mt-5">
                <KeepRecordActions key={kept?.body} record={kept} />
              </div>
            </article>
          ) : (
            <p className={vault.caption}>Choose one of your works.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default MySubmissions;
