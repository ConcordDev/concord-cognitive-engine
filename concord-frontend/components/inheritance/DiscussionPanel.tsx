'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EstateChatter } from '@/components/inheritance/EstateChatter';

export function DiscussionPanel() {
  const [showEstateChatter, setShowEstateChatter] = useState(false);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <button
        type="button"
        onClick={() => setShowEstateChatter(v => !v)}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
      >
        <span>Estate planning discussion (external reference)</span>
        {showEstateChatter ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {showEstateChatter && (
        <div className="mt-3">
          <EstateChatter />
        </div>
      )}
    </section>
  );
}
