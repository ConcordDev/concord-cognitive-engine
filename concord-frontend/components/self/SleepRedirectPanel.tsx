'use client';

import { Moon } from 'lucide-react';
import { CrossLensCTA } from './CrossLensCTA';

/** Sleep — no dedicated substrate; points at overview ledger + wellness. */
export function SleepRedirectPanel({ onLogSleep }: { onLogSleep: () => void }) {
  return (
    <CrossLensCTA
      icon={Moon}
      body="Sleep is tracked as the “sleep_hours” metric in your own ledger. Log a night on the Overview tab and it flows into your trends, goals, and streaks. For guided rest, the Wellness lens has soundscapes and routines."
      onClick={onLogSleep}
      cta="Log sleep on Overview"
      secondaryHref="/lenses/wellness"
      secondaryCta="Wellness lens"
    />
  );
}
