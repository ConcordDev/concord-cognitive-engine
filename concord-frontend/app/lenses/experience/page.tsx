'use client';

/**
 * /lenses/experience — UX Research Suite + verifiable career portfolio.
 *
 * The domain's own header comment (`server/domains/experience.js:3`) scopes
 * it as "UX-research suite, category leader: Maze / UserTesting" — the 27
 * stateful research macros (usability tests, click/heatmap studies, card
 * sorts, surveys, participant panel, highlight reels, prototype analytics)
 * live in `UXResearchSuite`, and the 4 artifact-bound analytical macros
 * (journeyMap / usabilityScore / heuristicEval / personaBuilder) live in
 * `AnalysisTools`.
 *
 * A second, separate macro cluster — endorse / analyze / generate_resume /
 * compare_versions / validate_claims, registered directly in
 * `server/server.js:40710-40763` rather than in the domain file (so the
 * static unsurfaced-macro scanner can't see it) — backs the "verifiable
 * portfolio" feature the lens manifest declares
 * (`concord-frontend/lib/lenses/manifest.ts`, domain: 'experience'). It
 * lives in `CareerPortfolio`.
 *
 * REMOVED (2026 Wave-3 rebuild): a ~950-line "Creative Portfolio" scaffold
 * (Portfolio/Skills/History/Insights tabs) that fetched generic
 * `useLensData('experience', 'portfolio'|'skill'|'history', { seed: [] })`
 * lists with zero creation UI anywhere on the page — permanently empty in
 * production (auto-seed is dev-only, `lib/hooks/use-lens-data.ts:88`), plus
 * a hardcoded blank `PROFILE` constant rendered as if it were real user
 * data. `CareerPortfolio` replaces it with a real single-artifact flow that
 * actually creates, edits, and calls the 5 real macros above.
 */

import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DesignSystemAtlas } from '@/components/experience/DesignSystemAtlas';
import { UXResearchSuite } from '@/components/experience/UXResearchSuite';
import { AnalysisTools } from '@/components/experience/AnalysisTools';
import { CareerPortfolio } from '@/components/experience/CareerPortfolio';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type SectionId = 'portfolio' | 'tools' | 'research' | 'atlas';

export default function ExperienceLensPage() {
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('experience');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [section, setSection] = useState<SectionId>('portfolio');

  useLensCommand([
    { id: 'sec-portfolio', keys: '1', description: 'Portfolio', category: 'navigation', action: () => setSection('portfolio') },
    { id: 'sec-tools', keys: '2', description: 'Analysis tools', category: 'navigation', action: () => setSection('tools') },
    { id: 'sec-research', keys: '3', description: 'UX research suite', category: 'navigation', action: () => setSection('research') },
    { id: 'sec-atlas', keys: '4', description: 'Design system atlas', category: 'navigation', action: () => setSection('atlas') },
  ], { lensId: 'experience' });

  const SECTIONS: { id: SectionId; label: string }[] = [
    { id: 'portfolio', label: 'Portfolio' },
    { id: 'tools', label: 'Analysis Tools' },
    { id: 'research', label: 'UX Research Suite' },
    { id: 'atlas', label: 'Design System Atlas' },
  ];

  return (
    <LensShell lensId="experience" asMain={false}>
      <FirstRunTour lensId="experience" />
      <DepthBadge lensId="experience" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="experience"
        crumb="Experience"
        title={`Your craft, on the record${who ? `, ${who}` : ''}`}
        subtitle="UX research suite and a verifiable career portfolio"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="experience" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={SECTIONS.map((x, i) => ({ id: x.id, label: x.label, keys: String(i + 1) }))}
        activeTab={section}
        onTab={(id) => setSection(id as SectionId)}
        tabsLabel="Experience sections"
        cta={{ label: 'Add to portfolio', icon: Plus, onClick: () => setSection('portfolio'), title: 'Open the career portfolio' }}
      >
        {/* ========== Section Content ========== */}
        {section === 'portfolio' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <CareerPortfolio />
          </section>
        )}
        {section === 'tools' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <AnalysisTools />
          </section>
        )}
        {section === 'research' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <UXResearchSuite />
          </section>
        )}
        {section === 'atlas' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <DesignSystemAtlas />
          </section>
        )}

        {realtimeData && (
          <RealtimeDataPanel domain="experience" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
