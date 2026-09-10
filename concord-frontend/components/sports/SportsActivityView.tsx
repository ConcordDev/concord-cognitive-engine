'use client';

import { PipingProvider } from '@/components/panel-polish';
import { ActivityActionPanel } from '@/components/sports/ActivityActionPanel';

export function SportsActivityView() {
  return (
    <PipingProvider>
      <ActivityActionPanel />
    </PipingProvider>
  );
}
