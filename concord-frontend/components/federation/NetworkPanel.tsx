'use client';

import dynamic from 'next/dynamic';
import { Globe } from 'lucide-react';

const TrustGraphView = dynamic(
  () => import('@/components/federation/TrustGraphView'),
  { ssr: false }
);

export function NetworkPanel() {
  return (
    <section className="rounded-lg border border-white/10 bg-black/60 p-4">
      <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Globe className="w-4 h-4" /> Trust graph
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Each node is an instance; edges show mutual trust. Edge weight tracks
        rolling DTU exchange + verification success rate.
      </p>
      <TrustGraphView />
    </section>
  );
}
