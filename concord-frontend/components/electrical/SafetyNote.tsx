'use client';

/**
 * The lens's safety limitation copy (F2) — defined once, placed at every
 * surface that issues a code verdict (NEC bench, panel schedule,
 * inspection checklists). Review 5's full first pass found NO disclaimer
 * anywhere on a lens that brands on the NEC and prints PASS/FAIL
 * verdicts; this note is the limitation at the operational claim.
 */
export function SafetyNote() {
  return (
    <p className="rounded border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/80">
      Planning aid only. These calculations and code checks support licensed work —
      they are not a substitute for the NEC as adopted by your authority having
      jurisdiction, or for a licensed electrician&rsquo;s judgment. Verify before you
      cut, drill, or energize.
    </p>
  );
}
