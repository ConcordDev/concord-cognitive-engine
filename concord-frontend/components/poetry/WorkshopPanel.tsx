'use client';

/**
 * WorkshopPanel — share poems + line-level peer critique.
 */

import { PoetryWorkshop } from '@/components/poetry/PoetryWorkshop';
import { useLensDTUs } from '@/hooks/useLensDTUs';

export function WorkshopPanel() {
  const { contextDTUs } = useLensDTUs({ lens: 'poetry' });
  return (
    <div className="space-y-3">
      <PoetryWorkshop />
      <p className="text-xs text-gray-400">Poetry DTUs in context: {contextDTUs.length}</p>
    </div>
  );
}
