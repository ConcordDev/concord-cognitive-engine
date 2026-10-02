'use client';

import { NorthGate } from '@/components/lens/NorthStarChrome';
import CouncilChamber from '@/components/council/CouncilChamber';
import { TheQuestion } from '@/components/council/TheQuestion';

export function CouncilDesk() {
  return <CouncilChamber />;
}

export default function CouncilPage() {
  return (
    <NorthGate
      backLabel="Council"
      desk={<CouncilDesk />}
      star={(openDesk) => <TheQuestion onOpenDesk={openDesk} />}
    />
  );
}
