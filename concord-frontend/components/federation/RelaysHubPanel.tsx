'use client';

import { RelayPanel } from '@/components/federation/RelayPanel';
import { SyncPolicyPanel } from '@/components/federation/SyncPolicyPanel';

export function RelaysHubPanel() {
  return (
    <div className="space-y-4">
      <RelayPanel />
      <SyncPolicyPanel />
    </div>
  );
}
