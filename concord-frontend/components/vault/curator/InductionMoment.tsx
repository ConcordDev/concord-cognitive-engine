'use client';

/**
 * TheVault — the induction moment.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS IS THE PRODUCT
 * ───────────────────────────────────────────────────────────────────────────
 * docs/THEVAULT_SPEC.md §1: what a creator receives is not preservation, it is
 * recognition — and the moment of admission IS the thing. Everything else in
 * this unit exists to make this thirty seconds credible.
 *
 * ── Why black, here and nowhere else ──────────────────────────────────────
 * The brief is unambiguous that the Vault is light: museums aren't black,
 * archives aren't black, paper is light. Black is named exactly once, and it is
 * named as *ceremonial*. So this is the only surface in TheVault that inverts —
 * and the inversion does double duty, because it also inverts the platform's
 * own dark-dominant shell that the rest of the Vault is already exempt from.
 * Wherever you arrived from, this room does not look like it.
 *
 * ── Why it earns "ceremonial" rather than being a toast ───────────────────
 *   · It takes the whole viewport. A notification lives at a corner and lets
 *     you keep working; a ceremony stops the room.
 *   · It arrives in sequence, not at once — a line is drawn across the dark,
 *     then the label, then the name of the work, then the sentence, then the
 *     attribution, then the accession block. Roughly two and a half seconds of
 *     deliberate pacing on the platform's zero-overshoot expo curve. Nothing
 *     bounces, spins, or slides: the only gestures are a hairline being drawn
 *     and type settling six pixels. Silence is part of the experience.
 *   · It is not dismissed by a timer. It closes when the curator closes it.
 *   · The words on the wall are the curator's own, read back from the server's
 *     confirmed response — the ceremony fires on a real admitted row, never on
 *     an optimistic guess. An admission that failed shows no ceremony at all.
 *
 * ── What is deliberately NOT dressed up ───────────────────────────────────
 * The accession block reports the permanence handler's real state. Today
 * `applyAdmissionProtection` returns `{ applied:false, reason:'no_handler_registered' }`
 * because the permanence unit is owned separately, and §10.1 of the spec calls
 * this the hardest unresolved conflict in the whole design — the substrate is
 * built to forget. Printing "PRESERVATION — not applied" in gold leaf at the
 * most emotional moment of the product is uncomfortable, which is exactly why
 * it is there. A ceremony that lies about custody is worth nothing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VAULT_COLOR } from '@/lib/vault/tokens';
import {
  CURATOR_ROLE_LABEL,
  WORK_KIND_LABEL,
  formatVaultDate,
  runVaultMacro,
  type VaultAdmission,
  type VaultPublicRecord,
} from './vault-curator-client';

export interface InductionMomentProps {
  /** The server's confirmed `admit()` response. Nothing here is client-derived. */
  admission: VaultAdmission;
  /** The admitted work's title, carried from the queue row. */
  title: string;
  /** The admitted work's `work_kind`, carried from the queue row. */
  workKind: string;
  onClose: () => void;
}

/** Real OS-level signal, checked once. Ceremony collapses to a still page. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    try {
      setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch { /* a matchMedia-less environment simply gets the full ceremony */ }
  }, []);
  return reduced;
}

/** Milliseconds each stage waits before it settles in. */
const STAGE = { label: 420, title: 700, statement: 1080, attribution: 1500, accession: 1860, close: 2200 };

export function InductionMoment({ admission, title, workKind, onClose }: InductionMomentProps) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sealDrawn, setSealDrawn] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null);

  // The vault door. A single hairline drawn across the dark — the one gesture
  // in the whole surface, and it is a line being drawn, not a thing arriving.
  useEffect(() => {
    if (reduced) { setSealDrawn(true); return; }
    const t = window.setTimeout(() => setSealDrawn(true), 60);
    return () => window.clearTimeout(t);
  }, [reduced]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /*
    The acceptance date is the timestamp the recognition happened (§4.1) and it
    is NOT in `admit()`'s response — the only read that carries `admitted_at` is
    `publicRecord()`. So it is fetched, and it renders only if it arrives. No
    client clock is ever substituted: a date invented here would be a fabricated
    field on the archive's most load-bearing record.
  */
  useEffect(() => {
    let live = true;
    runVaultMacro<{ ok: true; record: VaultPublicRecord }>('record', { submissionId: admission.id })
      .then((r) => {
        if (!live) return;
        const at = r.ok ? r.result?.record?.admittedAt : null;
        if (typeof at === 'number') setAcceptedAt(at);
      });
    return () => { live = false; };
  }, [admission.id]);

  const stage = useMemo(
    () => (ms: number): React.CSSProperties =>
      reduced ? {} : { animationDelay: `${ms}ms` },
    [reduced],
  );
  const anim = reduced ? '' : 'vault-ceremonial';

  const citations = admission.citations || [];
  const citedOk = citations.filter((c) => c.ok).length;
  const protection = admission.protection || { applied: false };
  const acceptedLabel = formatVaultDate(acceptedAt);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Induction into TheVault"
      tabIndex={-1}
      data-testid="vault-induction-moment"
      className="fixed inset-0 z-[100] overflow-y-auto outline-none"
      style={{ backgroundColor: VAULT_COLOR.ceremonial, color: VAULT_COLOR.paper }}
    >
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-20">
        {/* The seal: one hairline drawn across the dark. */}
        <div
          aria-hidden="true"
          style={{
            height: 1,
            backgroundColor: VAULT_COLOR.brassLeaf,
            width: sealDrawn ? '100%' : '0%',
            transition: reduced ? 'none' : 'width 880ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />

        <p
          className={`${anim} mt-10 font-sans text-xs font-semibold uppercase tracking-[0.22em]`}
          style={{ ...stage(STAGE.label), color: VAULT_COLOR.brassLeaf }}
        >
          Admitted to TheVault
        </p>

        <h1
          className={`${anim} mt-5 font-vault text-4xl font-normal tracking-[-0.01em]`}
          style={{ ...stage(STAGE.title), color: VAULT_COLOR.paper }}
        >
          {title}
        </h1>
        <p
          className={`${anim} mt-3 font-sans text-sm`}
          style={{ ...stage(STAGE.title), color: VAULT_COLOR.rule }}
        >
          {WORK_KIND_LABEL[workKind] || workKind}
        </p>

        {/* The sentence. Serif, because it is the record. */}
        <blockquote
          className={`${anim} mt-10 border-0 p-0`}
          style={stage(STAGE.statement)}
          data-testid="vault-induction-statement"
        >
          <p
            className="font-vault text-lg leading-[2rem]"
            style={{ color: VAULT_COLOR.paper }}
          >
            {admission.curatorStatement}
          </p>
        </blockquote>

        <p
          className={`${anim} mt-6 font-vault text-base`}
          style={{ ...stage(STAGE.attribution), color: VAULT_COLOR.paper }}
        >
          — {admission.curatorDisplayName},{' '}
          <span style={{ color: VAULT_COLOR.rule }}>
            {CURATOR_ROLE_LABEL[admission.admittedByRole] || admission.admittedByRole}
          </span>
        </p>

        {/* Accession block: what the archive can actually vouch for. */}
        <div
          className={`${anim} mt-12 pt-6`}
          style={{ ...stage(STAGE.accession), borderTop: `1px solid ${VAULT_COLOR.brassLine}` }}
        >
          <dl className="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="font-sans text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: VAULT_COLOR.brassLine }}>
                Record
              </dt>
              <dd className="m-0 mt-1 font-sans text-xs font-medium tabular-nums tracking-[0.04em] break-all" style={{ color: VAULT_COLOR.rule }}>
                {admission.recordDtuId}
              </dd>
            </div>

            {acceptedLabel ? (
              <div>
                <dt className="font-sans text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: VAULT_COLOR.brassLine }}>
                  Accepted
                </dt>
                <dd className="m-0 mt-1 font-sans text-xs font-medium tabular-nums tracking-[0.04em]" style={{ color: VAULT_COLOR.rule }}>
                  {acceptedLabel}
                </dd>
              </div>
            ) : null}

            <div>
              <dt className="font-sans text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: VAULT_COLOR.brassLine }}>
                Preservation
              </dt>
              <dd className="m-0 mt-1 font-sans text-xs leading-5" style={{ color: VAULT_COLOR.rule }} data-testid="vault-induction-preservation">
                {protection.applied
                  ? 'Permanence flags applied to this record.'
                  : `Permanence flags not applied${protection.reason ? ` (${protection.reason})` : ''}. The archive states what it holds.`}
              </dd>
            </div>

            {citations.length > 0 ? (
              <div>
                <dt className="font-sans text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: VAULT_COLOR.brassLine }}>
                  Lineage
                </dt>
                <dd className="m-0 mt-1 font-sans text-xs leading-5 tabular-nums" style={{ color: VAULT_COLOR.rule }}>
                  {citedOk} of {citations.length} declared {citations.length === 1 ? 'source' : 'sources'} cited
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className={`${anim} mt-12`} style={stage(STAGE.close)}>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-sm px-5 py-2 font-sans text-sm font-medium"
            style={{ border: `1px solid ${VAULT_COLOR.brassLine}`, color: VAULT_COLOR.paper, backgroundColor: 'transparent' }}
          >
            Close
          </button>
          <span className="ml-4 font-sans text-xs" style={{ color: VAULT_COLOR.brassLine }}>
            Esc closes
          </span>
        </div>
      </div>
    </div>
  );
}

export default InductionMoment;
