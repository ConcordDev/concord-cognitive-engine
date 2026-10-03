'use client';

/**
 * Legacy lens: north-star chrome over the real codebase scanner (technical
 * debt, dependency cycles, churn, migration roadmap, cloud-readiness) and the
 * portfolio risk assessment for systems reviewed without source access.
 */

import { useCallback, useState } from 'react';
import { FolderSearch, ClipboardList, ScanSearch } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { CodebaseScanner } from '@/components/legacy/CodebaseScanner';
import { PortfolioAssessment } from '@/components/legacy/PortfolioAssessment';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

type View = 'scan' | 'portfolio';

export default function LegacyLensPage() {
  useLensNav('legacy');
  useLensIdentity('legacy');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('legacy');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('scan');

  const scan = useCallback(() => {
    setView('scan');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="legacy"] textarea, [data-lens-theme="legacy"] input');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      { id: 'view-scan', keys: '1', description: 'Codebase scanner', category: 'navigation' as const, action: () => setView('scan') },
      { id: 'view-portfolio', keys: '2', description: 'Portfolio assessment', category: 'navigation' as const, action: () => setView('portfolio') },
      { id: 'scan-new', keys: 'n', description: 'Scan a codebase', category: 'actions' as const, action: scan },
    ],
    { lensId: 'legacy' },
  );

  return (
    <LensShell lensId="legacy" asMain={false}>
      <FirstRunTour lensId="legacy" />
      <DepthBadge lensId="legacy" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="legacy"
        crumb="Legacy"
        title={view === 'scan' ? `What you inherited${who ? `, ${who}` : ''}` : 'What the portfolio risks'}
        subtitle="Technical debt, dependency graphs, migration roadmaps and cloud-readiness for real, aging systems."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="legacy" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={[
          { id: 'scan', label: 'Codebase scan', icon: FolderSearch, keys: '1', hint: 'Scan source for debt, cycles and roadmap' },
          { id: 'portfolio', label: 'Portfolio risk', icon: ClipboardList, keys: '2', hint: 'Assess systems without source access' },
        ]}
        activeTab={view}
        onTab={(id) => setView(id as View)}
        cta={{ label: 'Scan a codebase', icon: ScanSearch, onClick: scan, title: 'Scan a codebase (N)' }}
      >
        <section key={view} className="rounded-2xl border border-white/10 bg-[#111] p-5">
          {view === 'scan' ? (
            <>
              <p className="mb-4 text-sm text-zinc-500">
                Scan a real codebase to derive technical debt, dependency cycles, churn hotspots, a sequenced
                migration roadmap, rewrite-vs-refactor ROI, and cloud-readiness. Every figure is computed from the
                source you ingest.
              </p>
              <CodebaseScanner />
            </>
          ) : (
            <PortfolioAssessment />
          )}
        </section>

        {realtimeData && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
            <RealtimeDataPanel
              domain="legacy"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          </div>
        )}

        <ConnectiveTissueBar lensId="legacy" />
      </NorthStarFrame>
    </LensShell>
  );
}
