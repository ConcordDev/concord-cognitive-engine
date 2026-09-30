'use client';

/**
 * StudioPanel — Bubble/Glide-shaped no-code builder (AppBuilderStudio).
 * Extracted from former app-maker/page.tsx stacked section.
 */

import { Layout } from 'lucide-react';
import { AppBuilderStudio } from '@/components/app-maker/AppBuilderStudio';

export function StudioPanel() {
  return (
    <div className="panel p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Layout className="w-4 h-4 text-neon-cyan" />
        No-Code Builder Studio
      </h3>
      <AppBuilderStudio />
    </div>
  );
}

export default StudioPanel;
