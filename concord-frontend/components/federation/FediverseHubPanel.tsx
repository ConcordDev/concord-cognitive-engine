'use client';

import { FediverseIdentityPanel } from '@/components/federation/FediverseIdentityPanel';
import { CommunesPanel } from '@/components/federation/CommunesPanel';
import { FediverseFeed } from '@/components/federation/FediverseFeed';

export function FediverseHubPanel() {
  return (
    <div className="space-y-4">
      <FediverseIdentityPanel />
      <CommunesPanel />
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Fediverse discussion (external reference)</h2>
        <FediverseFeed />
      </section>
    </div>
  );
}
