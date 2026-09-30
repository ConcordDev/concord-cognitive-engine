'use client';

/**
 * ResearchPanel — arXiv quantum physics + QuantumArxiv.
 * Extracted from lenses/quantum/page.tsx.
 */

import { ArxivPanel } from '@/components/research/ArxivPanel';
import { QuantumArxiv } from '@/components/quantum/QuantumArxiv';

export function ResearchPanel() {
  return (
    <div className="space-y-4">
      <ArxivPanel domain="quantum" title="arXiv · Quantum Physics (quant-ph)" />
      <QuantumArxiv />
    </div>
  );
}
