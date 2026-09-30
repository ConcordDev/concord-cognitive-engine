'use client';

/**
 * JournalPanel — decision journal (Brier / ECE / reliability from journalLog substrate).
 */

import { DecisionJournal } from '@/components/metacognition/DecisionJournal';
import { ds } from '@/lib/design-system';

export function JournalPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Decision journal</h2>
        <p className={ds.textMuted}>
          Log a predicted outcome, resolve it, read the real calibration report.
        </p>
      </div>
      <DecisionJournal />
    </div>
  );
}
