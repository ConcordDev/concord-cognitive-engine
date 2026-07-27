'use client';

/**
 * The curator statement — the sacred artifact of TheVault.
 *
 * "Accepted into TheVault because…". Every other field on a record is
 * metadata; this is the only one that is an ARGUMENT, written by a named
 * human, and it is the thing the entire gate's credibility rests on
 * (`docs/THEVAULT_SPEC.md` §5: a generated statement voids the record).
 *
 * So it is typeset as a wall label, not as a UI string:
 *   · the Vault SERIF at reading size with opened leading (`vault.body`),
 *     not the metadata sans everything else on the record uses
 *   · a hard measure of ~62ch — the museum-label line length, so it reads
 *     as prose rather than as a field value stretched across a container
 *   · real room around it: it is the only element on the record that gets
 *     plate padding, and it is the only element that carries the brass
 *   · the single brass rule in the whole record sits on its left edge.
 *     Sparing is the point — if everything is gold, nothing feels important.
 *
 * Hierarchy here comes from SPACE and MEASURE, not from size or color: the
 * statement is not the largest text on the record (the work's name is), it is
 * the text with the most room and the only serif paragraph.
 *
 * Honest by construction: with no statement there is no artifact, so the
 * component renders nothing rather than an empty quotation frame.
 */

import React from 'react';

import { vault } from '@/lib/vault/tokens';
import { formatCuratorRole } from './format';

export interface CuratorStatementProps {
  /** `record.curatorStatement`. Absent/blank → the component renders nothing. */
  statement: string | null | undefined;
  /** `record.curatorId` — the human who made and signed this call. */
  curatorId?: string | null;
  /** `record.curatorRole` — `founding_curator` | `guest_curator`. */
  curatorRole?: string | null;
  /**
   * Real handler, wired to a real `vault.browse({ curatorId })` round trip in
   * the page. Omitted → the attribution renders as plain text, never as a
   * dead control.
   */
  onSelectCurator?: (curatorId: string) => void;
  /** True when the cabinet is already filtered to this curator. */
  curatorFilterActive?: boolean;
}

export function CuratorStatement({
  statement,
  curatorId,
  curatorRole,
  onSelectCurator,
  curatorFilterActive = false,
}: CuratorStatementProps) {
  const text = typeof statement === 'string' ? statement.trim() : '';
  if (!text) return null;

  const role = formatCuratorRole(curatorRole);
  const attributedTo = typeof curatorId === 'string' ? curatorId.trim() : '';

  return (
    <figure
      className="vault-paper vault-paper-card border-l-2 border-vault-brass py-6 pl-5 pr-4 sm:py-8 sm:pl-8 sm:pr-8"
      data-testid="vault-curator-statement"
    >
      <figcaption className={`${vault.label} mb-4`}>Accepted into TheVault because</figcaption>

      <blockquote className={`${vault.body} max-w-[62ch] whitespace-pre-line`}>{text}</blockquote>

      {attributedTo ? (
        <figcaption className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={vault.attribution} data-testid="vault-statement-attribution">
            Written and signed by {attributedTo}
            {role ? `, ${role}` : ''}
          </span>
          {onSelectCurator ? (
            <button
              type="button"
              onClick={() => onSelectCurator(attributedTo)}
              aria-pressed={curatorFilterActive}
              className={`${vault.caption} underline decoration-vault-brassLine underline-offset-4 transition-colors hover:text-vault-brass ${
                curatorFilterActive ? 'text-vault-brass' : ''
              }`}
            >
              {curatorFilterActive ? 'Showing only this curator' : 'Show this curator’s admissions'}
            </button>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

export default CuratorStatement;
