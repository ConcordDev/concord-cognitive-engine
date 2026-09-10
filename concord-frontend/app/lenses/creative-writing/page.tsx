'use client';

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DatamusePanel } from '@/components/linguistics/DatamusePanel';
import { GutendexSearch } from '@/components/creative-writing/GutendexSearch';
import { CreativeWritingSection } from '@/components/creative-writing/CreativeWritingSection';
import { useLensNav } from '@/hooks/useLensNav';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// Note: the "My Works" generic CRUD system (works/editor/prompts/workshop
// tabs backed by useLensData against a client-invented `work`/`prompt`
// artifact type) that used to live on this page was removed 2026-07 —
// it was a disconnected shadow app: none of its actions reached any of
// the 56 real `creative-writing` macros (project-*/chapter-*/scene-*/
// character-*/thread-*/snapshot-*), and it duplicated the real Scrivener
// + Dabble + Plottr-shape manuscript studio below (CreativeWritingSection)
// with a second, fake, unconnected editor. See
// docs/lens-specs/creative-writing-capability-map.md for the audit.
export default function CreativeWritingPage() {
  useLensNav('creative-writing');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('creative-writing');
  const [desk, setDesk] = useState<'studio' | 'gutenberg'>('studio');

  return (
    <LensShell lensId="creative-writing" asMain={false}>
      <FirstRunTour lensId="creative-writing" />
      <div data-lens-theme="creative-writing" className="min-h-screen px-4 sm:px-6 pt-3 pb-8 space-y-5 max-w-7xl mx-auto">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-pink-500" />
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">Creative Writing</h1>
              <p className="text-xs text-zinc-400">Manuscript studio, research and workshop for long-form writing</p>
            </div>
            <DepthBadge lensId="creative-writing" size="sm" />
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          </div>
          <DTUExportButton domain="creative-writing" data={realtimeData || {}} compact />
        </header>

        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} compact />

        <CreativeWritingSection />

        <DatamusePanel domain="creative-writing" />

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setDesk(d => d === 'gutenberg' ? 'studio' : 'gutenberg')}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>{desk === 'gutenberg' ? 'Back to studio' : 'Project Gutenberg'}</span>
          </button>
          {desk === 'gutenberg' && (
            <div className="mt-3">
              <GutendexSearch />
            </div>
          )}
        </section>
          <CrossLensRecentsPanel lensId="creative-writing" sinceDays={7} limit={6} hideWhenEmpty />
      </div>
    </LensShell>
  );
}
