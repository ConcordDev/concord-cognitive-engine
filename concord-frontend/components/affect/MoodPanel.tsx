'use client';

/**
 * MoodPanel — Daylio-parity check-in surface (macros live in MoodTracker).
 */

import { MoodTracker } from '@/components/affect/MoodTracker';
import { ds } from '@/lib/design-system';

export function MoodPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Mood</h2>
        <p className={ds.textMuted}>
          Check-ins, streaks, activity correlation, scale — all from your own entries.
        </p>
      </div>
      <MoodTracker />
    </div>
  );
}
