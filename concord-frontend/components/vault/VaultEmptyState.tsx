'use client';

/**
 * THE DAY-ONE SCREEN.
 *
 * TheVault opens with zero admitted records — by design (`docs/THEVAULT_SPEC.md`
 * §3) and by the platform's hard zero-demo-content invariant. So this is not a
 * fallback for a rare edge case; it is the ONLY screen anyone sees on the first
 * day, and for as long as the first admission takes. It has to carry the entire
 * product on its own.
 *
 * Which is why it does not say "No items". An empty room with a "no items"
 * notice communicates ABSENCE — that something should be here and isn't, that
 * the archive failed to load, that you arrived too early. Everything about the
 * product says the opposite: the gate IS the product, and an empty vault is the
 * gate working. So this screen communicates a STANDARD instead:
 *
 *   1. It states the fact plainly and without apology ("The archive is empty"),
 *      in the display serif, letterpressed, at full weight — the same
 *      typographic treatment a record's own name gets. The emptiness is not
 *      demoted to small gray text; it is the wall label of the room you are in.
 *   2. It explains why that is correct, in one serif paragraph at reading
 *      measure — admission requires a human curator to argue for it in writing,
 *      and nobody has made that argument yet.
 *   3. It shows the SIX AXES admission is judged on. This is the honest answer
 *      to the only question a first visitor actually has ("what would be in
 *      here?"), and it is the one thing that can be shown truthfully when there
 *      are no records: the rubric is the archive's authored standard, not data
 *      about anything. Nothing here is a stand-in for a record.
 *   4. It closes on the documentation gate — the axis that can veto alone —
 *      because that sentence is the whole thesis in nine words.
 *
 * What is deliberately NOT here: no "be the first!" call to action, no fake
 * counter at zero dressed as a stat, no ghost/skeleton records suggesting what
 * a record would look like, no sample creator, no waitlist theatre. The real
 * curator roster is rendered by the page above this block when the backend
 * actually has one, and renders as nothing when it does not.
 */

import React from 'react';

import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';

/**
 * The admission rubric, verbatim from the locked brief (`docs/THEVAULT_SPEC.md`
 * §5). Authored standard, not fetched content — it describes how a decision is
 * made, and it is identical whether the archive holds nothing or everything.
 */
const ADMISSION_RUBRIC: ReadonlyArray<{ axis: string; question: string }> = [
  { axis: 'Originality', question: 'Did this contribute something new?' },
  { axis: 'Craft', question: 'Is there clear evidence of skill?' },
  { axis: 'Influence', question: 'Has this impacted people — even a small community?' },
  { axis: 'Cultural relevance', question: 'Does it document an important story?' },
  { axis: 'Longevity potential', question: 'Will this still matter in years?' },
  { axis: 'Documentation', question: 'Can we explain why it belongs?' },
];

export interface VaultEmptyStateProps {
  /**
   * `'archive'` — nothing has ever been admitted (the day-one screen).
   * `'filtered'` — the archive holds records, but none under the current
   * narrowing. A genuinely different fact, so it gets genuinely different
   * words rather than the founding placard shown out of context.
   */
  kind?: 'archive' | 'filtered';
  /** Human-readable description of the active narrowing, e.g. "Music". */
  filterLabel?: string | null;
  /** Real handler — clears the narrowing and re-runs `vault.browse`. */
  onClearFilter?: () => void;
}

export function VaultEmptyState({ kind = 'archive', filterLabel, onClearFilter }: VaultEmptyStateProps) {
  if (kind === 'filtered') {
    return (
      <section
        className="vault-reveal mx-auto max-w-2xl px-4 py-20 text-center sm:px-8 sm:py-24"
        data-testid="vault-empty-filtered"
      >
        <p className={vault.label}>Nothing under this heading</p>
        <p className={cn(vault.subtitle, 'vault-letterpress mt-4')}>
          {filterLabel ? `Nothing has been admitted under ${filterLabel} yet.` : 'Nothing has been admitted here yet.'}
        </p>
        <p className={cn(vault.bodySm, 'mx-auto mt-4 max-w-[52ch]')}>
          The archive holds work under other headings. Admission is per-work and never quota-filled, so a
          heading stays empty until something under it earns a place.
        </p>
        {onClearFilter ? (
          <button type="button" onClick={onClearFilter} className={cn(vault.button, 'mt-8')}>
            Show the whole archive
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="vault-reveal mx-auto max-w-3xl px-4 py-20 sm:px-8 sm:py-28"
      data-testid="vault-empty-archive"
    >
      <div className="vault-plate rounded-sm px-6 py-12 sm:px-14 sm:py-16">
        <p className={vault.label}>The archive</p>

        <h2 className={cn(vault.title, 'vault-letterpress-deep mt-5')}>The archive is empty.</h2>

        <p className={cn(vault.body, 'mt-8 max-w-[58ch]')}>
          Nothing has been admitted yet. That is not a gap in the archive — it is the archive, honestly.
          A work enters TheVault only when a named human curator has argued for it in writing, and no one
          has made that argument yet.
        </p>

        <hr className={cn(vault.divider, 'my-12')} />

        <h3 className={vault.label}>What admission is judged on</h3>
        <p className={cn(vault.caption, 'mt-3 max-w-[58ch]')}>
          Evidence, not popularity. A work that changed the practice of forty people scores higher here
          than one with large passive reach and no traceable effect.
        </p>

        <dl className="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2">
          {ADMISSION_RUBRIC.map(({ axis, question }) => (
            <div key={axis}>
              <dt className={cn(vault.sectionTitle, 'vault-letterpress')}>{axis}</dt>
              <dd className={cn(vault.bodySm, 'mt-1 max-w-[34ch]')}>{question}</dd>
            </div>
          ))}
        </dl>

        <hr className={cn(vault.divider, 'my-12')} />

        <h3 className={vault.label}>How things get in</h3>
        <p className={cn(vault.bodySm, 'mt-3 max-w-[58ch]')}>
          Open submission, closed admission. Anyone may submit their own work, nominate someone else&rsquo;s,
          or be found by a curator — all three arrive at the same gate, and none of them receives an
          advantage over the others. TheVault decides.
        </p>

        <p className={cn(vault.body, 'mt-10 max-w-[46ch] border-l-2 border-vault-brass pl-6')}>
          If we can&rsquo;t explain it, it shouldn&rsquo;t be admitted.
        </p>
      </div>
    </section>
  );
}

export default VaultEmptyState;
