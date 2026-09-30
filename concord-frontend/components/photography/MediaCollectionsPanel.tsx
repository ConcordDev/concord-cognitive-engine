'use client';

import { Layers } from 'lucide-react';

/** Media-gallery collections stub — Lightroom albums live under Catalog. */
export function MediaCollectionsPanel({ photoCount }: { photoCount: number }) {
  return (
    <div className="text-center py-16 text-gray-400">
      <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm mb-2">Photo Collections</p>
      <p className="text-xs text-gray-400">Organize your photos into themed collections and albums.</p>
      <div className="mt-4 text-xs text-gray-400">{photoCount} photos in library</div>
    </div>
  );
}
