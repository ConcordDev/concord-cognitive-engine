'use client';

import { MetricsDashboardPanel } from '@/components/federation/MetricsDashboardPanel';
import { TrustHistoryPanel } from '@/components/federation/TrustHistoryPanel';

export function MetricsHubPanel() {
  return (
    <div className="space-y-4">
      <MetricsDashboardPanel />
      <TrustHistoryPanel />
    </div>
  );
}
