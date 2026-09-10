'use client';

/**
 * PackagesPanel — NPM package search (external reference).
 * Former accordion under app-maker/page.tsx; now a first-class view.
 */

import { NpmPackageSearch } from '@/components/app-maker/NpmPackageSearch';

export function PackagesPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="text-sm font-semibold text-white mb-3">NPM package search (external reference)</h3>
      <NpmPackageSearch />
    </section>
  );
}

export default PackagesPanel;
