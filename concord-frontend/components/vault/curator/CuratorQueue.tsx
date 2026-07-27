'use client';

/**
 * TheVault — the curator's review room.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MOUNT CONTRACT
 * ───────────────────────────────────────────────────────────────────────────
 *   import { CuratorQueue } from '@/components/vault/curator';
 *   <CuratorQueue />                       // no required props
 *   <CuratorQueue onChange={refetch} />    // optional: fires after any real
 *                                          // state change (review opened,
 *                                          // work admitted, work declined)
 *
 * Self-contained: it resolves its own data from the `vault.*` macros and the
 * authenticated session, and it holds no state the host page needs to own. It
 * renders its own `vault-surface vault-paper` island, so it is correct both
 * standalone and nested inside a page that already established the wall.
 *
 * ── Why this is a workbench and not a feed ────────────────────────────────
 * The brief refuses the infinite feed outright, and refuses vanity metrics
 * outright. So: a drawer of submissions on the left, one submission open on the
 * right, and everything a curator needs to judge that one against the six axes
 * in a single view. Nothing here counts views, plays, or popularity, because
 * the Influence axis is judged on documented effect and a counter would quietly
 * replace the rubric.
 *
 * ── The gate is real, and it is the backend's ─────────────────────────────
 * `curatorQueue()` refuses a non-curator with `not_a_curator` before returning
 * a single row, and it is the ONLY read path in `server/domains/vault.js` that
 * can return a declined submission. This component never filters declines out
 * client-side — it could not, because the public reads never hand them over.
 * What it does do is label the private views as private, so a curator is never
 * unsure which of the two audiences they are looking at.
 *
 * ── Keyboard ──────────────────────────────────────────────────────────────
 * The whole queue works without a mouse, and says so on screen rather than
 * hiding it in source: ↑ ↓ move through the drawer, Enter opens the selected
 * submission for review, ⌘/Ctrl + Enter admits from the composer, Esc closes
 * the decline sheet and the induction room.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vault } from '@/lib/vault/tokens';
import { CuratorStatementComposer, clearStatementDraft } from './CuratorStatementComposer';
import { DeclineDialog } from './DeclineDialog';
import { InductionMoment } from './InductionMoment';
import { MachineEvidencePanel } from './MachineEvidencePanel';
import {
  CURATOR_ROLE_LABEL,
  WORK_KIND_LABEL,
  formatVaultDate,
  refusalCopy,
  runVaultMacro,
  type VaultAdmission,
  type VaultCuratorRow,
  type VaultCuratorsResult,
  type VaultQueueResult,
  type VaultQueueSubmission,
} from './vault-curator-client';

export interface CuratorQueueProps {
  /** Fires after any real, server-confirmed state change. Optional. */
  onChange?: () => void;
}

type DrawerView = 'awaiting' | 'admitted' | 'declined' | 'withdrawn';

const VIEWS: ReadonlyArray<{ id: DrawerView; label: string; statuses: string[]; private?: true }> = [
  { id: 'awaiting', label: 'Awaiting judgment', statuses: ['submitted', 'under_review'], private: true },
  { id: 'admitted', label: 'Admitted', statuses: ['admitted'] },
  { id: 'declined', label: 'Declined', statuses: ['declined'], private: true },
  { id: 'withdrawn', label: 'Withdrawn', statuses: ['withdrawn'], private: true },
];

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  admitted: 'Admitted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

/* ── small presentational helpers ─────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={`${vault.label} mb-1`}>{label}</p>
      <div className={vault.bodySm}>{children}</div>
    </div>
  );
}

function PrivacyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-sans text-xs leading-5 text-vault-gray">{children}</p>
  );
}

/* ── the queue ────────────────────────────────────────────────────────────── */

export function CuratorQueue({ onChange }: CuratorQueueProps = {}) {
  const [view, setView] = useState<DrawerView>('awaiting');
  const [submissions, setSubmissions] = useState<VaultQueueSubmission[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueRefusal, setQueueRefusal] = useState<string | null>(null);

  const [curators, setCurators] = useState<VaultCuratorRow[] | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [admitRefusal, setAdmitRefusal] = useState<string | null>(null);
  const [declineRefusal, setDeclineRefusal] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [ceremony, setCeremony] = useState<
    { admission: VaultAdmission; title: string; workKind: string } | null
  >(null);

  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const statuses = useMemo(() => VIEWS.find((v) => v.id === view)?.statuses ?? [], [view]);

  const load = useCallback(async () => {
    setLoading(true);
    setQueueRefusal(null);
    const r = await runVaultMacro<VaultQueueResult>('queue', { status: statuses, limit: 200 });
    if (!r.ok) {
      setSubmissions(null);
      setQueueRefusal(r.reason);
      setLoading(false);
      return;
    }
    setSubmissions(r.result?.submissions ?? []);
    setLoading(false);
  }, [statuses]);

  useEffect(() => { void load(); }, [load]);

  // Public read — who vouches for this archive. Empty is honest: TheVault
  // opens with no curators until a real person installs the founding one.
  useEffect(() => {
    let live = true;
    runVaultMacro<VaultCuratorsResult>('curators', {}).then((r) => {
      if (!live) return;
      setCurators(r.ok ? (r.result?.curators ?? []) : null);
    });
    return () => { live = false; };
  }, []);

  const selected = useMemo(
    () => submissions?.find((s) => s.id === selectedId) ?? null,
    [submissions, selectedId],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setAdmitRefusal(null);
    setDeclineRefusal(null);
    setNotice(null);
  }, []);

  /* ── drawer keyboard navigation ─────────────────────────────────────────── */
  const onDrawerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      const rows = submissions ?? [];
      if (rows.length === 0) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const at = rows.findIndex((s) => s.id === selectedId);
      const next =
        e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, at < 0 ? 0 : at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
      const target = rows[next];
      if (!target) return;
      select(target.id);
      itemRefs.current[target.id]?.focus();
    },
    [select, selectedId, submissions],
  );

  /* ── actions ────────────────────────────────────────────────────────────── */

  const openReview = useCallback(async (submissionId: string) => {
    setBusy(true);
    setNotice(null);
    const r = await runVaultMacro('open_review', { submissionId });
    setBusy(false);
    if (!r.ok) { setAdmitRefusal(r.reason); return; }
    await load();
    onChange?.();
  }, [load, onChange]);

  const admit = useCallback(async (statement: string) => {
    if (!selected) return;
    setBusy(true);
    setAdmitRefusal(null);
    const r = await runVaultMacro<VaultAdmission>('admit', {
      submissionId: selected.id,
      curatorStatement: statement,
      // Passthrough of what the row already carries — this surface never
      // assembles, edits, or invents machine evidence.
      machineEvidence: selected.machineEvidence ?? null,
    });
    setBusy(false);
    if (!r.ok || !r.result) { setAdmitRefusal(r.reason); return; }
    clearStatementDraft(selected.id);
    setCeremony({ admission: r.result, title: selected.title, workKind: selected.workKind });
  }, [selected]);

  const closeCeremony = useCallback(async () => {
    setCeremony(null);
    setSelectedId(null);
    await load();
    onChange?.();
  }, [load, onChange]);

  const decline = useCallback(async (reason: string) => {
    if (!selected) return;
    setBusy(true);
    setDeclineRefusal(null);
    const r = await runVaultMacro('decline', { submissionId: selected.id, reason });
    setBusy(false);
    if (!r.ok) { setDeclineRefusal(r.reason); return; }
    clearStatementDraft(selected.id);
    setDeclineOpen(false);
    setSelectedId(null);
    setNotice('Declined privately. The reason was recorded for you and for the person who submitted it, and goes nowhere else.');
    await load();
    onChange?.();
  }, [load, onChange, selected]);

  /* ── the not-a-curator surface ──────────────────────────────────────────── */
  if (queueRefusal === 'not_a_curator' || queueRefusal === 'curator_retired' || queueRefusal === 'transport_auth_required') {
    return (
      <div className="vault-surface vault-paper p-8">
        <div className="mx-auto max-w-2xl">
          <section className="vault-plate vault-paper vault-paper-card vault-reveal rounded-sm p-6">
            <p className={`${vault.label} mb-3`}>Curator workbench</p>
            <h1 className={`${vault.subtitle} mb-3`}>This room is closed.</h1>
            <p className={vault.bodySm}>{refusalCopy(queueRefusal)}</p>
            <p className="mt-3 font-sans text-sm leading-6 text-vault-graphite">
              Work under consideration has no public view, and neither does work that was declined.
              Open submission, closed admission — the queue is not a leaderboard, and a queue position
              is not a signal.
            </p>
          </section>
          <CuratorRoster curators={curators} />
        </div>
      </div>
    );
  }

  return (
    <div className="vault-surface vault-paper p-6 md:p-8">
      <header className="mb-8 border-b border-vault-rule pb-6">
        <p className={`${vault.label} mb-2`}>Curator workbench</p>
        <h1 className={`${vault.title} vault-letterpress-deep`}>The review room</h1>
        <p className={`${vault.bodySm} mt-3 max-w-2xl`}>
          Open submission, closed admission. Every work here is judged on evidence against six axes,
          and admitted only with a written statement that a person signs their name to.
        </p>
        <p className="mt-3 font-sans text-xs leading-5 text-vault-gray">
          <span className="font-medium">↑ ↓</span> move through the drawer ·{' '}
          <span className="font-medium">Enter</span> open a submission ·{' '}
          <span className="font-medium">⌘ / Ctrl + Enter</span> admit ·{' '}
          <span className="font-medium">Esc</span> close
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* ── the drawer ───────────────────────────────────────────────────── */}
        <div>
          <nav aria-label="Queue views" className="mb-4 flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-current={view === v.id ? 'true' : undefined}
                onClick={() => { setView(v.id); setSelectedId(null); setNotice(null); }}
                className={[
                  'rounded-sm border px-3 py-1.5 font-sans text-xs font-medium',
                  view === v.id
                    ? 'border-vault-brass bg-vault-brass text-vault-paper'
                    : 'border-vault-rule bg-transparent text-vault-graphite hover:bg-vault-sunk',
                ].join(' ')}
              >
                {v.label}
              </button>
            ))}
          </nav>

          {VIEWS.find((v) => v.id === view)?.private ? (
            <PrivacyNote>
              Curator-scoped. This list has no public counterpart and is never published, counted, or
              aggregated.
            </PrivacyNote>
          ) : (
            <PrivacyNote>
              Admitted records are the archive&rsquo;s only public surface.
            </PrivacyNote>
          )}

          <div className="mt-4">
            {loading ? (
              <p data-testid="vault-queue-loading" className={vault.bodySm}>
                Opening the drawer…
              </p>
            ) : queueRefusal ? (
              <div
                role="alert"
                data-testid="vault-queue-error"
                className="rounded-sm border border-vault-brassLine bg-vault-sunk p-4"
              >
                <p className={vault.bodySm}>{refusalCopy(queueRefusal)}</p>
                <button type="button" onClick={() => void load()} className={`${vault.button} mt-3`}>
                  Try again
                </button>
              </div>
            ) : (submissions?.length ?? 0) === 0 ? (
              <p data-testid="vault-queue-empty" className={vault.bodySm}>
                {view === 'awaiting'
                  ? 'Nothing is awaiting judgment. TheVault opens empty — submissions arrive in this drawer.'
                  : view === 'admitted'
                    ? 'No work has been admitted yet. The first admission is a real event.'
                    : view === 'declined'
                      ? 'Nothing has been declined.'
                      : 'Nothing has been withdrawn.'}
              </p>
            ) : (
              <ul
                role="list"
                onKeyDown={onDrawerKeyDown}
                className="vault-drawer m-0 list-none space-y-2 p-0"
                data-testid="vault-queue-list"
              >
                {(submissions ?? []).map((s) => {
                  const active = s.id === selectedId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        ref={(el) => { itemRefs.current[s.id] = el; }}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => select(s.id)}
                        className={[
                          'w-full rounded-sm border px-4 py-3 text-left',
                          active
                            ? 'border-vault-brassLine bg-vault-card vault-emboss'
                            : 'border-vault-rule bg-transparent hover:bg-vault-sunk',
                        ].join(' ')}
                      >
                        <span className="block font-vault text-base leading-6 text-vault-ink">{s.title}</span>
                        <span className="mt-1 block font-sans text-xs text-vault-gray">
                          {WORK_KIND_LABEL[s.workKind] || s.workKind} · {STATUS_LABEL[s.status] || s.status}
                          {formatVaultDate(s.submittedAt) ? ` · ${formatVaultDate(s.submittedAt)}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <CuratorRoster curators={curators} />
        </div>

        {/* ── the workbench ────────────────────────────────────────────────── */}
        <div>
          {notice ? (
            <p
              role="status"
              data-testid="vault-notice"
              className="mb-6 rounded-sm border border-vault-rule bg-vault-sunk px-4 py-3 font-sans text-sm leading-6 text-vault-graphite"
            >
              {notice}
            </p>
          ) : null}

          {!selected ? (
            <div className="vault-plate vault-paper vault-paper-card rounded-sm p-6">
              <p className={`${vault.label} mb-3`}>No submission open</p>
              <p className={vault.bodySm}>
                Choose a work from the drawer. One submission at a time — a judgment is made about one
                object, not scanned across a list.
              </p>
            </div>
          ) : (
            <div className="vault-reveal space-y-6">
              {/* Wall label: what is being judged. */}
              <section className="vault-plate vault-paper vault-paper-card rounded-sm p-6">
                <p className={`${vault.label} mb-3`}>{STATUS_LABEL[selected.status] || selected.status}</p>
                <h2 className={`${vault.subtitle} vault-letterpress`}>{selected.title}</h2>
                <p className={`${vault.attribution} mt-2`}>
                  {WORK_KIND_LABEL[selected.workKind] || selected.workKind}
                  {formatVaultDate(selected.submittedAt) ? ` · submitted ${formatVaultDate(selected.submittedAt)}` : ''}
                </p>

                <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Submitted by">{selected.submitterId}</Field>
                  {selected.reviewOpenedBy ? (
                    <Field label="Review opened by">{selected.reviewOpenedBy}</Field>
                  ) : null}
                </div>

                {selected.description ? (
                  <div className="mt-5">
                    <p className={`${vault.label} mb-1`}>Submitter&rsquo;s account</p>
                    <p className={vault.body}>{selected.description}</p>
                  </div>
                ) : (
                  <p className="mt-5 font-sans text-sm leading-6 text-vault-gray">
                    The submitter left no written account. Documentation is a gate, not a score — a work
                    that cannot be explained is not admitted.
                  </p>
                )}

                {selected.lineage.length > 0 ? (
                  <div className="mt-5">
                    <p className={`${vault.label} mb-1`}>Declared sources</p>
                    <ul className="m-0 list-none space-y-1 p-0">
                      {selected.lineage.map((p) => (
                        <li key={p} className="font-sans text-xs font-medium tabular-nums tracking-[0.04em] text-vault-graphite break-all">
                          {p}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 font-sans text-xs leading-5 text-vault-gray">
                      Each source is cited through the real royalty cascade at the moment of admission.
                    </p>
                  </div>
                ) : null}

                {selected.status === 'submitted' ? (
                  <div className="mt-6 border-t border-vault-rule pt-5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openReview(selected.id)}
                      className={vault.button}
                      data-testid="vault-open-review"
                    >
                      {busy ? 'Opening…' : 'Take up for review'}
                    </button>
                    <p className="mt-2 font-sans text-xs leading-5 text-vault-gray">
                      Puts your name on the review. It confers nothing on the work — a curator-discovered
                      piece gets no advantage over a self-submission.
                    </p>
                  </div>
                ) : null}
              </section>

              {/* Machine evidence — recessed, sans, no brass, no path out. */}
              <MachineEvidencePanel machineEvidence={selected.machineEvidence} id="vault-machine-evidence" />

              {/* The act, or the record of the act already made. */}
              {selected.status === 'submitted' || selected.status === 'under_review' ? (
                <CuratorStatementComposer
                  submission={selected}
                  busy={busy}
                  refusal={admitRefusal}
                  onAdmit={(s) => void admit(s)}
                  onDecline={() => { setDeclineRefusal(null); setDeclineOpen(true); }}
                />
              ) : (
                <DecisionRecord submission={selected} />
              )}
            </div>
          )}
        </div>
      </div>

      {declineOpen && selected ? (
        <DeclineDialog
          submission={selected}
          busy={busy}
          refusal={declineRefusal}
          onConfirm={(r) => void decline(r)}
          onCancel={() => setDeclineOpen(false)}
        />
      ) : null}

      {ceremony ? (
        <InductionMoment
          admission={ceremony.admission}
          title={ceremony.title}
          workKind={ceremony.workKind}
          onClose={() => void closeCeremony()}
        />
      ) : null}
    </div>
  );
}

/* ── terminal-state record ────────────────────────────────────────────────── */

function DecisionRecord({ submission }: { submission: VaultQueueSubmission }) {
  if (submission.status === 'admitted') {
    return (
      <section className="vault-plate vault-paper vault-paper-card rounded-sm p-6" data-vault-authorship="human">
        <p className={`${vault.label} mb-3`}>The admission</p>
        <h3 className={`${vault.sectionTitle} mb-3`}>Accepted into TheVault because…</h3>
        <p className={vault.body}>{submission.curatorStatement}</p>
        <p className={`${vault.bodySm} mt-4`}>
          — {submission.admittedBy}
          {submission.admittedByRole ? `, ${CURATOR_ROLE_LABEL[submission.admittedByRole] || submission.admittedByRole}` : ''}
        </p>
        {submission.recordDtuId ? (
          <p className={`${vault.accession} mt-4 break-all`}>Record {submission.recordDtuId}</p>
        ) : null}
        <p className="mt-4 font-sans text-xs leading-5 text-vault-gray">
          Written once and permanent. Attribution is not reassignable, and an admitted record cannot be
          withdrawn.
        </p>
      </section>
    );
  }

  if (submission.status === 'declined') {
    return (
      <section className="vault-plate vault-paper vault-paper-card rounded-sm p-6">
        <p className={`${vault.label} mb-3`}>Private decision</p>
        <h3 className={`${vault.sectionTitle} mb-3`}>Declined</h3>
        {submission.declineReason ? (
          <p className={vault.body}>{submission.declineReason}</p>
        ) : (
          <p className={vault.bodySm}>No reason is recorded on this row.</p>
        )}
        <p className={`${vault.bodySm} mt-4`}>
          {submission.declinedBy ? `— ${submission.declinedBy}` : null}
          {formatVaultDate(submission.declinedAt) ? `, ${formatVaultDate(submission.declinedAt)}` : ''}
        </p>
        <p className="mt-4 font-sans text-xs leading-5 text-vault-gray">
          Visible to the curators and to the person who submitted the work. It is never published,
          counted, or aggregated — there is no public reject rate, because a published decline is a
          punishment. Re-submission is welcome when there is new evidence.
        </p>
      </section>
    );
  }

  return (
    <section className="vault-plate vault-paper vault-paper-card rounded-sm p-6">
      <p className={`${vault.label} mb-3`}>Withdrawn</p>
      <p className={vault.bodySm}>
        The submitter withdrew this work before a decision was made. Nothing was admitted and nothing
        was declined.
      </p>
    </section>
  );
}

/* ── roster ───────────────────────────────────────────────────────────────── */

function CuratorRoster({ curators }: { curators: VaultCuratorRow[] | null }) {
  if (curators === null) return null;
  return (
    <section aria-labelledby="vault-roster-heading" className="mt-8 border-t border-vault-rule pt-5">
      <h2 id="vault-roster-heading" className={`${vault.label} mb-3`}>
        Curators of record
      </h2>
      {curators.length === 0 ? (
        <p className={vault.bodySm}>TheVault has no curators yet.</p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {curators.map((c) => (
            <li key={c.curator_id}>
              <p className="font-vault text-sm leading-5 text-vault-ink">{c.display_name}</p>
              <p className="font-sans text-xs text-vault-gray">
                {CURATOR_ROLE_LABEL[c.role] || c.role}
                {c.active ? '' : ' · retired'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default CuratorQueue;
