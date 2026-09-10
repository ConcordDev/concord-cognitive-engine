'use client';

import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useMemo } from 'react';
import type { PhotoItem } from './photo-types';

export function StatsPanel() {
  const { items: photoItems } = useLensData<PhotoItem>('photography', 'photo', { seed: [] });
  const photos = useMemo(
    () => photoItems.map((i) => ({ ...(i.data as unknown as PhotoItem), id: i.id, title: i.title })),
    [photoItems],
  );
  const { contextDTUs } = useLensDTUs({ lens: 'photography' });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="text-xs text-gray-400 mb-1">Total Photos</div>
        <div className="text-2xl font-bold">{photos.length}</div>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="text-xs text-gray-400 mb-1">Photo DTUs</div>
        <div className="text-2xl font-bold">{contextDTUs.length}</div>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="text-xs text-gray-400 mb-1">Categories</div>
        <div className="text-2xl font-bold">{new Set(photos.flatMap((p) => p.tags || [])).size}</div>
      </div>
    </div>
  );
}
