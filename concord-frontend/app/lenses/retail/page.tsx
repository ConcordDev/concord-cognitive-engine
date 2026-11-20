'use client';

/**
 * /lenses/retail — Retail & Commerce.
 *
 * The lens is one app (components/retail/app/RetailApp): a section rail
 * and the Register as the default working surface, under the platform's
 * shared left bar and top bar only. Every view reads and writes through
 * registered retail.* macros (server/domains/retail.js) — no seeded or
 * client-invented data. See docs/lens-specs/retail-capability-map.md.
 */

import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { RetailApp } from '@/components/retail/app/RetailApp';

export default function RetailLensPage() {
  useLensNav('retail');
  return (
    <LensShell lensId="retail" asMain={false} className="h-full">
      <RetailApp />
    </LensShell>
  );
}
