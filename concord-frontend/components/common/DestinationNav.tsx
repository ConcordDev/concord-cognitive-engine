'use client';

/**
 * DestinationNav — workspace tab bar for a destination, mirroring CoreLensNav.
 *
 * The grouped lenses aren't sidebar-tree expansion — they're INTEGRATED INTO THE
 * WORKSPACE: a horizontal tab bar at the top of the destination page showing the
 * destination as the primary tab and its grouped (absorbed) lenses as secondary
 * tabs. Clicking a tab navigates to that lens while keeping you in the workspace.
 *
 * Grouped ids that don't resolve to a real lens, or are already absorbed by a
 * core lens (handled by CoreLensNav), are skipped so there's no broken/duplicate tab.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getLensById, getParentCoreLens } from '@/lib/lens-registry';
import { getDestinationById } from '@/lib/destinations';
import { cn } from '@/lib/utils';

export function DestinationNav({ destinationId }: { destinationId: string }) {
  const pathname = usePathname();
  const dest = getDestinationById(destinationId);
  if (!dest) return null;

  const DestIcon = dest.icon;
  const members = (dest.absorbs ?? [])
    .filter((id) => !getParentCoreLens(id)) // core-absorbed lenses live under CoreLensNav
    .map((id) => getLensById(id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  // Nothing grouped → the destination's own page is the whole workspace; no tab bar.
  if (members.length === 0) return null;

  const tabs = [
    { id: dest.id, label: dest.name, path: `/lenses/${dest.id}`, icon: DestIcon },
    ...members.map((lens) => ({
      id: lens.id,
      label: lens.tabLabel || lens.name,
      path: lens.path,
      icon: lens.icon,
    })),
  ];

  return (
    <nav
      className="flex gap-1 border-b border-lattice-border px-4 overflow-x-auto no-scrollbar"
      aria-label={`${dest.name} workspace navigation`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = pathname === tab.path;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
              isActive
                ? 'text-neon-cyan border-neon-cyan'
                : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600',
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default DestinationNav;
