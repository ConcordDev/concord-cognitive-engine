'use client';

/**
 * THE VAULT RECORD — the core object.
 *
 * Not a card. Not a tile. Not a slab. A DRAWER, and the difference is
 * structural rather than decorative:
 *
 *   · A card floats. This does not — the record has no shadow, no radius and
 *     no background of its own. It is a row inside one continuous cabinet
 *     body (`VaultCabinet` owns the plate, the hairlines between drawers, and
 *     the single shadow around the whole piece of furniture). Cards repeat as
 *     separate objects on a background; drawers share edges.
 *   · A card shows everything at once so you can scan a grid of them. A
 *     drawer has a FACE and an INTERIOR: the face is the index card on the
 *     front (accession, work, discipline, acceptance date) and the interior
 *     is hidden until pulled.
 *   · A drawer has a PULL. The brass bar on the right of the face is that
 *     affordance, and it responds to hover / focus / open with color only —
 *     it never moves, because the brief's motion rule is stillness.
 *   · Only one drawer is open at a time. Opening this one shuts the last one,
 *     the way a cabinet physically behaves, which is also what makes browsing
 *     feel like walking a room rather than scrolling a feed.
 *   · The interior is RECESSED — `vault-paper-sunk` + `vault-deboss`, the
 *     token whose stated role is "drawer interior" — and it wipes down under
 *     a clip-path edge (`vault-drawer`, 520ms) instead of sliding in as a
 *     block. Content is revealed by the opening, not animated into place.
 *
 * The interior reads in the museum wall-label order the spec fixes (§4.4):
 * Work → Creator → Date → Curator statement → … → Relationships. The curator
 * statement sits ABOVE the supporting material: the label tells you why it
 * belongs before it shows you its workings.
 *
 * Fields with no substrate render NOTHING (see `types.ts` for the field-by-
 * field audit). No evidence block, no timeline, no media frame, and no
 * preservation badge — the public read carries none of them, and an empty
 * section captioned "—" would read as a measured absence rather than a
 * missing backend.
 */

import React, { useId } from 'react';

import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';
import { CuratorStatement } from './CuratorStatement';
import { accessionOrdinal, formatAdmissionDate, formatDiscipline } from './format';
import type { VaultCabinetEntry } from './types';

export interface VaultRecordProps {
  entry: VaultCabinetEntry;
  /** 1-based position in the cabinet — a place indicator, never a metric. */
  ordinal: number;
  open: boolean;
  /** Keyboard cursor is on this drawer (j / k). */
  selected: boolean;
  onToggle: () => void;
  /** Re-dispatch the real `vault.record` read for a drawer that failed to load. */
  onRetry?: () => void;
  onSelectCurator?: (curatorId: string) => void;
  curatorFilter?: string | null;
}

export function VaultRecord({
  entry,
  ordinal,
  open,
  selected,
  onToggle,
  onRetry,
  onSelectCurator,
  curatorFilter,
}: VaultRecordProps) {
  const reactId = useId();
  const faceId = `vault-drawer-face-${reactId}`;
  const panelId = `vault-drawer-panel-${reactId}`;

  const record = entry.record;
  const discipline = formatDiscipline(record?.workKind);
  const acceptedOn = formatAdmissionDate(record?.admittedAt);
  const lineage = Array.isArray(record?.lineage) ? record.lineage : [];

  // A drawer whose body is still being read has a face but no title yet. The
  // face says so plainly instead of showing a fabricated placeholder name.
  const faceTitle = record?.title?.trim() || (entry.state === 'error' ? 'Record unavailable' : 'Reading record…');

  return (
    <li
      className={cn(
        'relative border-l-2 transition-colors',
        selected ? 'border-vault-brass' : 'border-transparent',
      )}
      data-testid="vault-record"
      data-record-id={entry.id}
      data-open={open ? 'true' : 'false'}
    >
      <h3 className="m-0">
        <button
          type="button"
          id={faceId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            'group grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-1 px-4 py-5 text-left transition-colors sm:gap-x-8 sm:px-8 sm:py-6',
            open ? 'bg-vault-sunk' : 'hover:bg-vault-sunk',
          )}
        >
          <span className={cn(vault.accession, 'pt-[0.35rem]')}>{accessionOrdinal(ordinal)}</span>

          <span className="min-w-0">
            <span className={cn(vault.subtitle, 'vault-letterpress block truncate')}>{faceTitle}</span>
            {discipline || acceptedOn ? (
              <span className={cn(vault.attribution, 'mt-1 block')}>
                {discipline}
                {discipline && acceptedOn ? ' · ' : ''}
                {acceptedOn ? `Accepted ${acceptedOn}` : ''}
              </span>
            ) : null}
          </span>

          {/* The pull. Decorative geometry, so it is hidden from the
              accessibility tree — the button's own aria-expanded is what
              announces the drawer's state. Color-only response: no movement. */}
          <span
            aria-hidden="true"
            className={cn(
              'mt-[0.6rem] h-[3px] w-8 rounded-full transition-colors sm:w-12',
              open ? 'bg-vault-brass' : 'bg-vault-rule group-hover:bg-vault-brassLine',
            )}
          />
        </button>
      </h3>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={faceId}
          aria-busy={entry.state === 'loading' ? true : undefined}
          className="vault-paper vault-paper-sunk vault-deboss vault-drawer px-4 py-8 sm:px-8 sm:py-10"
          data-testid="vault-record-interior"
        >
          <div className="mx-auto max-w-3xl">
            {entry.state === 'loading' && !record ? (
              <p className={vault.caption}>Reading this record from the register…</p>
            ) : null}

            {entry.state === 'error' && !record ? (
              <div role="alert" className="flex flex-wrap items-center gap-4">
                <p className={cn(vault.bodySm, 'm-0')}>
                  This record could not be read. {entry.error || 'The register did not answer.'}
                </p>
                {onRetry ? (
                  <button type="button" onClick={onRetry} className={vault.button}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}

            {record ? (
              <div className="space-y-10">
                {/* Work */}
                <header>
                  {discipline ? <p className={vault.label}>{discipline}</p> : null}
                  <p className={cn(vault.title, 'vault-letterpress-deep mt-3 max-w-[24ch]')}>{record.title}</p>
                </header>

                {/* Creator + date. `submitterId` is the ONLY identity the
                    public read carries, and the spec's three entry paths mean
                    the submitter is not reliably the creator — so it is
                    labelled for what it is and never relabelled "Creator". */}
                <dl className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <dt className={vault.label}>Submitted by</dt>
                    <dd className={cn(vault.attribution, 'mt-2 break-words')}>{record.submitterId}</dd>
                  </div>
                  {acceptedOn ? (
                    <div>
                      <dt className={vault.label}>Accepted</dt>
                      <dd className={cn(vault.accession, 'mt-2')}>{acceptedOn}</dd>
                    </div>
                  ) : null}
                </dl>

                {/* The sacred artifact. Above the supporting material, always. */}
                <CuratorStatement
                  statement={record.curatorStatement}
                  curatorId={record.curatorId}
                  curatorRole={record.curatorRole}
                  onSelectCurator={onSelectCurator}
                  curatorFilterActive={!!curatorFilter && curatorFilter === record.curatorId}
                />

                {record.description?.trim() ? (
                  <section>
                    <h4 className={vault.label}>Description</h4>
                    <p className={cn(vault.bodySm, 'mt-3 max-w-[62ch] whitespace-pre-line')}>
                      {record.description.trim()}
                    </p>
                    <p className={cn(vault.caption, 'mt-3')}>As given in the submission.</p>
                  </section>
                ) : null}

                {lineage.length > 0 ? (
                  <section>
                    <h4 className={vault.label}>Cited lineage</h4>
                    <p className={cn(vault.caption, 'mt-2 max-w-[62ch]')}>
                      Works this record declares it derives from. Each citation is registered against the
                      source, so the cited creator is credited.
                    </p>
                    <ul className="mt-3 list-none space-y-2 p-0">
                      {lineage.map((parentId) => (
                        <li key={parentId} className={cn(vault.accession, 'break-all')}>
                          {parentId}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {record.recordDtuId ? (
                  <footer className="vault-hairline-t flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-5">
                    <span className={vault.label}>Record</span>
                    <span className={cn(vault.accession, 'break-all')}>{record.recordDtuId}</span>
                  </footer>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default VaultRecord;
