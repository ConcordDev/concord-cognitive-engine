'use client';

/**
 * LimitationNotice — the limitation copy at this lens's door (F5).
 *
 * Law Enforcement's instance of the fleet's shared limitation-copy
 * item, ENFORCEMENT register. The filed first pass found an operational
 * police-records console carrying no limitation copy anywhere — no
 * "not an official system", no training/planning framing, no statement
 * of what these records are or are not — on the one lens where a new
 * user most needs those words. The copy follows the in-family form
 * Defense's panels already use (each panel disclaiming its own limits):
 * say what the surface is, say what it is not, and point real-world
 * need at the real-world channel. Kept as one small component so the
 * shared limitation-copy consolidation can lift it unchanged.
 */

import { ShieldAlert } from 'lucide-react';

export function LimitationNotice() {
  return (
    <div
      role="note"
      className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
      <p className="text-[11px] leading-relaxed text-zinc-300">
        <span className="font-semibold text-amber-200">Not an official system.</span>{' '}
        This is a records and training workspace: nothing here is filed with, transmitted to, or
        acted on by any police department, court, or dispatch service, and entries you make carry
        no official standing. If you need to report an emergency, call 911.
      </p>
    </div>
  );
}

export default LimitationNotice;
