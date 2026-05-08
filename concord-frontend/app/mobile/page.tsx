'use client';

/**
 * /mobile — web-side mobile companion shell.
 *
 * Distinct from the concord-mobile/ React Native app. This is the
 * responsive web companion for users without the native install:
 * truncated lens grid, simplified controls, optimised for phone-sized
 * viewports.
 *
 * Component renders self-contained — no props. Backend integration
 * happens via the standard apiHelpers from any nested fetches.
 */

import { Smartphone } from 'lucide-react';
import dynamic from 'next/dynamic';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';

const MobileCompanion = dynamic(
  () => import('@/components/world-lens/MobileCompanion'),
  { ssr: false },
);

export default function MobilePage() {
  return (
    <UtilityPageShell
      icon={Smartphone}
      title="Mobile Companion"
      subtitle="Web-side responsive shell · Distinct from the native concord-mobile app"
    >
      <MobileCompanion />
    </UtilityPageShell>
  );
}
