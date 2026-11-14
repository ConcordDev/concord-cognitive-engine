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

// FIX-vault-001: edit (before review) and remove (once withdrawn or declined).
const EDIT_REFUSAL_COPY: Record<string, string> = {
  wrong_state: 'A curator has already opened this work for review, so it can no longer be edited.',
  missing_title: 'The work still needs a title.',
  nothing_to_update: 'Nothing changed.',
  not_submitter: 'Only the person who submitted a work can edit it.',
  not_found: 'That submission could not be found.',
};

const REMOVE_REFUSAL_COPY: Record<string, string> = {
  admitted_records_are_permanent: 'An admitted record is permanent and cannot be removed.',
  wrong_state: 'Only a withdrawn or declined work can be removed — withdraw it first.',
  not_submitter: 'Only the person who submitted a work can remove it.',
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
  /** FIX-vault-001: edit a still-`submitted` work. Same resolve contract. */
  onEdit?: (id: string, fields: { title: string; description: string; body: string }) => Promise<string | null>;
  /** FIX-vault-001: remove a withdrawn or declined work. Same resolve contract. */
  onRemove?: (id: string) => Promise<string | null>;
}

export function MySubmissions({ submissions, onWithdraw, onEdit, onRemove }: MySubmissionsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // FIX-vault-001 state: the edit form and the remove confirm.
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBody, setEditBody] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // FIX-vault-002: the list had no search, filter, or sort — with
  // more than a handful of submissions there was no way to find one
  // entry. Client-side controls over the caller's own rows: a text
  // filter (title / description / kind / status), a status filter,
  // and a sort (newest / oldest / title).
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest');
  const visible = submissions
    .filter((s) => statusFilter === 'all' || s.status === statusFilter)
    .filter((s) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [s.title, s.description || '', s.workKind || '', statusLabel(s.status)]
        .join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => (sort === 'title'
      ? a.title.localeCompare(b.title)
      : sort === 'oldest'
        ? (a.submittedAt || 0) - (b.submittedAt || 0)
        : (b.submittedAt || 0) - (a.submittedAt || 0)));

  const selected = submissions.find((s) => s.id === selectedId) || null;
  const kept = selected ? vaultSubmissionKeepRecord(selected) : null;
  const canWithdraw = selected && (selected.status === 'submitted' || selected.status === 'under_review');

  const select = (id: string) => {
    setSelectedId(id);
    setConfirming(false);
    setReason('');
    setError('');
    setEditing(false);
    setConfirmingRemove(false);
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

  const startEdit = () => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditDescription(selected.description || '');
    setEditBody(selected.body || '');
    setError('');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected || !onEdit || busy) return;
    setBusy(true);
    setError('');
    const refusal = await onEdit(selected.id, {
      title: editTitle,
      description: editDescription,
      body: editBody,
    });
    setBusy(false);
    if (refusal) {
      setError(EDIT_REFUSAL_COPY[refusal] || refusal);
      return;
    }
    setEditing(false);
  };

  const remove = async () => {
    if (!selected || !onRemove || busy) return;
    setBusy(true);
    setError('');
    const refusal = await onRemove(selected.id);
    setBusy(false);
    if (refusal) {
      setError(REMOVE_REFUSAL_COPY[refusal] || refusal);
      return;
    }
    setConfirmingRemove(false);
    setSelectedId(null);
  };

  if (submissions.length === 0) return null;

  return (
    <section aria-label="Your submissions" data-testid="vault-my-submissions" className="mt-10">
      <h2 className={vault.sectionTitle}>Your submissions</h2>
      <p className={cn(vault.caption, 'mt-1')}>Only you can see this list, including any reason a curator gave.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Filter your submissions"
          placeholder="Filter by title, kind, or words…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(vault.input, 'min-w-[12rem] flex-1')}
        />
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={vault.input}
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          aria-label="Sort your submissions"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className={vault.input}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option>
        </select>
        <span className={vault.caption} aria-live="polite">
          {visible.length} of {submissions.length}
        </span>
      </div>

      <div className="mt-4 grid gap-6 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <ul className="m-0 list-none space-y-1 p-0" data-testid="vault-my-list">
          {visible.length === 0 && (
            <li className={cn(vault.caption, 'px-1 py-2')}>No submissions match your filter.</li>
          )}
          {visible.map((item) => (
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

              {selected.status === 'submitted' && onEdit ? (
                <div className="mt-5">
                  {editing ? (
                    <div className="space-y-2" data-testid="vault-edit-form">
                      <label className="block">
                        <span className={cn(vault.label, 'mb-1 block')}>Title</span>
                        <input
                          className={vault.input}
                          value={editTitle}
                          maxLength={300}
                          aria-label="Edit submission title"
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className={cn(vault.label, 'mb-1 block')}>Description</span>
                        <textarea
                          className={vault.input}
                          value={editDescription}
                          rows={3}
                          maxLength={4000}
                          aria-label="Edit submission description"
                          onChange={(e) => setEditDescription(e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className={cn(vault.label, 'mb-1 block')}>Body</span>
                        <textarea
                          className={vault.input}
                          value={editBody}
                          rows={6}
                          aria-label="Edit submission body"
                          onChange={(e) => setEditBody(e.target.value)}
                        />
                      </label>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={saveEdit} disabled={busy} className={vault.buttonAccent}>
                          {busy ? 'Saving…' : 'Save changes'}
                        </button>
                        <button type="button" onClick={() => setEditing(false)} disabled={busy} className={vault.button}>
                          Cancel edit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={startEdit} className={vault.button}>
                      Edit this work
                    </button>
                  )}
                </div>
              ) : null}

              {(selected.status === 'withdrawn' || selected.status === 'declined') && onRemove ? (
                <div className="mt-5">
                  {confirmingRemove ? (
                    <div className="flex items-center gap-3" data-testid="vault-remove-confirm">
                      <span className={vault.caption}>Remove this {selected.status} work from your list for good?</span>
                      <button type="button" onClick={remove} disabled={busy} className={vault.buttonAccent}>
                        {busy ? 'Removing…' : 'Remove this work'}
                      </button>
                      <button type="button" onClick={() => setConfirmingRemove(false)} disabled={busy} className={vault.button}>
                        Keep it
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmingRemove(true)} className={vault.button}>
                      Remove
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
