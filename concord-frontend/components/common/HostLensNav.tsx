'use client';

/**
 * HostLensNav — workspace tab bar for a host lens, mirroring DestinationNav.
 *
 * A host lens (lib/lens-hosts LENS_HOSTS) groups other real lenses the way a
 * destination groups its absorbs: a horizontal tab bar at the top of the
 * host page showing the host as the primary tab and its grouped lenses as
 * secondary tabs. Clicking a tab navigates to that lens while keeping you in
 * the workspace.
 *
 * getHostChildren already skips admin-gated ids and ids absorbed by a core
 * lens (handled by CoreLensNav); ids that don't resolve to a real lens are
 * skipped here so there's no broken/duplicate tab.
 */

import { usePathname } from 'next/navigation';
import { getLensById } from '@/lib/lens-registry';
import { getHostChildren } from '@/lib/lens-hosts';
import { WorkspaceTabs } from '@/components/common/WorkspaceTabs';

export function HostLensNav({ hostId }: { hostId: string }) {
  const pathname = usePathname();
  const host = getLensById(hostId);
  if (!host) return null;

  const HostIcon = host.icon;
  const members = getHostChildren(hostId)
    .map((id) => getLensById(id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  // Nothing grouped → the host's own page is the whole workspace; no tab bar.
  if (members.length === 0) return null;

  const tabs = [
    { id: host.id, label: host.name, path: host.path, icon: HostIcon },
    ...members.map((lens) => ({
      id: lens.id,
      label: lens.tabLabel || lens.name,
      path: lens.path,
      icon: lens.icon,
    })),
  ];

  return <WorkspaceTabs tabs={tabs} activePath={pathname} label={`${host.name} workspace navigation`} />;
}

export default HostLensNav;