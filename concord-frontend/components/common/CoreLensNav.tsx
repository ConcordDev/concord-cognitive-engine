'use client';

/**
 * CoreLensNav — Sub-tab navigation bar for core lenses.
 *
 * Renders a horizontal tab bar showing the core lens as the primary tab
 * and its absorbed lenses as secondary tabs. Clicking a tab navigates
 * to that lens's route while keeping the user within the core workspace.
 */

import { usePathname } from 'next/navigation';
import {
  getAbsorbedLenses,
  getCoreLensConfig,
  type CoreLensId,
} from '@/lib/lens-registry';
import { WorkspaceTabs } from '@/components/common/WorkspaceTabs';

interface CoreLensNavProps {
  /** Which core lens this nav belongs to */
  coreLensId: CoreLensId;
}

export function CoreLensNav({ coreLensId }: CoreLensNavProps) {
  const pathname = usePathname();
  const config = getCoreLensConfig(coreLensId);
  const absorbed = getAbsorbedLenses(coreLensId);

  if (!config || absorbed.length === 0) return null;

  const CoreIcon = config.icon;

  const tabs = [
    { id: config.id, label: config.name, path: config.path, icon: CoreIcon },
    ...absorbed.map((lens) => ({
      id: lens.id,
      label: lens.tabLabel || lens.name,
      path: lens.path,
      icon: lens.icon,
    })),
  ];

  return <WorkspaceTabs tabs={tabs} activePath={pathname} label={`${config.name} workspace navigation`} />;
}
