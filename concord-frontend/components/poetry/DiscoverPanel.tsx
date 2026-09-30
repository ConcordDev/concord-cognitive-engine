'use client';

/**
 * DiscoverPanel — poem-a-day, themed collections, PoetryDB browse + search.
 */

import { PoetryDiscovery } from '@/components/poetry/PoetryDiscovery';
import { PoetryDbPanel } from '@/components/poetry/PoetryDbPanel';
import { PoetryDbSearch } from '@/components/poetry/PoetryDbSearch';

export function DiscoverPanel() {
  return (
    <div className="space-y-4">
      <PoetryDiscovery />
      <PoetryDbPanel />
      <PoetryDbSearch />
    </div>
  );
}
