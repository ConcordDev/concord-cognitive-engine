'use client';

import { usePathname } from 'next/navigation';
import { getLensById } from '@/lib/lens-registry';

/** Non-lens routes whose first path segment doesn't read well title-cased. */
const ROUTE_TITLES: Record<string, string> = {
  hub: 'Hub',
  dtu: 'DTU',
};

/**
 * The page title in the Topbar, derived from the URL. It used to read the
 * UI store's `activeLens`, which lenses set on mount but nothing clears — so
 * /hub (or any non-lens page) kept showing the last lens visited.
 */
export function LensTitle() {
  const pathname = usePathname() ?? '';
  const segments = pathname.split('/').filter(Boolean);
  const slug = segments[0] === 'lenses' ? segments[1] : undefined;

  const lensEntry = slug ? getLensById(slug) : null;
  const first = segments[0];
  const displayName =
    lensEntry?.name ||
    (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : null) ||
    (first ? ROUTE_TITLES[first] ?? first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, ' ') : 'Dashboard');

  return (
    <div className="flex items-center gap-2">
      {lensEntry &&
        (() => {
          const LensIcon = lensEntry.icon;
          return <LensIcon className="w-4 h-4 text-gray-400" />;
        })()}
      <h1 className="text-base lg:text-lg font-semibold truncate max-w-[120px] sm:max-w-none">
        {displayName}
      </h1>
    </div>
  );
}
