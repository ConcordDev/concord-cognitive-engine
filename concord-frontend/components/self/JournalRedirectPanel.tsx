'use client';

import { BookOpen } from 'lucide-react';
import { CrossLensCTA } from './CrossLensCTA';

/** Journal — no journal macro domain; Mental Health owns reflective journaling. */
export function JournalRedirectPanel() {
  return (
    <CrossLensCTA
      icon={BookOpen}
      body="Reflective journaling lives in the Mental Health lens, where entries become private DTUs you can revisit. Your “journal_entries” count still flows into your self ledger as a metric."
      href="/lenses/mental-health"
      cta="Open the Mental Health lens"
    />
  );
}
