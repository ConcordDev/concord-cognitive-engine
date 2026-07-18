'use client';

/**
 * Legal Practice Management — Clio/PracticePanther-shape lens.
 *
 * Five bespoke workbenches, each a real, independently-wired surface:
 *   Practice  — ClioSection: full left-rail practice-management app
 *               (dashboard/intake/matters/contacts/calendar/time/
 *               invoices/payments/trust/documents/templates/esign/
 *               reports), all backed by server/domains/legal.js's
 *               Clio-parity state (matters, contacts, timeEntries,
 *               trustAccts, invoices, documents, calendar, etc).
 *   Analyzer  — AI contract risk-flagging (conscious brain, constrained
 *               JSON prompt) via legal.contract-analyze.
 *   Docket    — a lightweight case-log + upcoming-deadline tracker
 *               (legal.case-list / case-add) — deliberately separate
 *               from the full Matters CRM in Practice; a quick docket,
 *               not a case file.
 *   Q&A       — jurisdiction-aware legal research assistant with
 *               required not-legal-advice caveats (legal.legal-question).
 *   Case law  — real CourtListener opinion search, 9M+ federal/state
 *               opinions (law.courtlistener-search).
 *
 * This replaced an older parallel generic-CRUD tab system (Cases/
 * Documents/TimeBilling/Calendar/Contacts/Contracts/Compliance) that
 * stored fabricated-shaped data via the generic per-lens artifact
 * store — fully redundant with, and strictly inferior to, ClioSection's
 * real Clio-parity backend. See docs/lens-specs/legal-capability-map.md
 * for the removal rationale.
 */

import { useState } from 'react';
import {
  Scale,
  Briefcase,
  Search,
  Gavel,
  MessageSquare,
  Brain,
  AlertTriangle,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import LiveFeed from '@/components/lens/LiveFeed';
import { ClioSection } from '@/components/legal/ClioSection';
import ContractAnalyzer from '@/components/legal/ContractAnalyzer';
import CaseTracker from '@/components/legal/CaseTracker';
import LegalQA from '@/components/legal/LegalQA';
import { LegalCaseSearch } from '@/components/legal/LegalCaseSearch';
import { LegalActionPanel } from '@/components/legal/LegalActionPanel';
import { CourtProcedureReference } from '@/components/legal/CourtProcedureReference';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type Workbench = 'practice' | 'analyzer' | 'docket' | 'qa' | 'caselaw';

const WORKBENCH_TABS: {
  id: Workbench;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  key: string;
  hint: string;
}[] = [
  { id: 'practice', label: 'Practice', icon: Briefcase, key: 'P', hint: 'Matters, billing, trust, documents' },
  { id: 'analyzer', label: 'Analyzer', icon: Brain, key: 'Y', hint: 'AI contract risk-flagging' },
  { id: 'docket', label: 'Docket', icon: Gavel, key: 'K', hint: 'Quick case log + deadlines' },
  { id: 'qa', label: 'Q&A', icon: MessageSquare, key: 'Q', hint: 'Jurisdiction-aware research' },
  { id: 'caselaw', label: 'Case Law', icon: Search, key: 'L', hint: 'CourtListener opinion search' },
];

export default function LegalLensPage() {
  useLensNav('legal');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('legal');
  const [workbench, setWorkbench] = useState<Workbench>('practice');

  useLensCommand(
    [
      { id: 'wb-practice', keys: 'p', description: 'Practice management', category: 'navigation', action: () => setWorkbench('practice') },
      { id: 'wb-analyzer', keys: 'y', description: 'Contract analyzer', category: 'navigation', action: () => setWorkbench('analyzer') },
      { id: 'wb-docket', keys: 'k', description: 'Docket tracker', category: 'navigation', action: () => setWorkbench('docket') },
      { id: 'wb-qa', keys: 'q', description: 'Legal Q&A', category: 'navigation', action: () => setWorkbench('qa') },
      { id: 'wb-caselaw', keys: 'l', description: 'Case law search', category: 'navigation', action: () => setWorkbench('caselaw') },
    ],
    { lensId: 'legal' }
  );

  return (
    <LensShell lensId="legal" asMain={false} disableAgentFab={true}>
      <FirstRunTour lensId="legal" />
      <div data-lens-theme="legal" className={ds.pageContainer}>
        {/* Header */}
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Scale className="w-7 h-7 text-amber-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Legal Practice Management</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
                <DepthBadge lensId="legal" size="sm" />
              </div>
              <p className={ds.textMuted}>
                Matters, billing, IOLTA trust accounting, documents, e-signature, and AI-assisted
                research — a Clio-shape practice-management cockpit.
              </p>
            </div>
          </div>
          <DTUExportButton domain="legal" data={{}} compact />
        </header>

        {/* Legal disclaimer */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200">
            This tool assists with legal organization and practice management. It does not
            constitute legal advice. Always consult with qualified legal counsel for legal
            decisions.
          </p>
        </div>

        <ShellPreview lensId="legal" defaultOpen={false} />

        {/* Workbench switcher */}
        <nav
          className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap"
          aria-label="Legal workbench"
        >
          {WORKBENCH_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setWorkbench(tab.id)}
              title={tab.hint}
              aria-current={workbench === tab.id ? 'page' : undefined}
              className={cn(
                ds.btnGhost,
                'whitespace-nowrap',
                workbench === tab.id && 'bg-amber-400/20 text-amber-400'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              <kbd className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-400 font-mono">
                {tab.key}
              </kbd>
            </button>
          ))}
        </nav>

        {/* Workbench content */}
        {workbench === 'practice' && <ClioSection />}
        {workbench === 'analyzer' && <ContractAnalyzer />}
        {workbench === 'docket' && <CaseTracker />}
        {workbench === 'qa' && <LegalQA />}
        {workbench === 'caselaw' && <LegalCaseSearch />}

        {/* Court Wire — live CourtListener + Federal Register opinions feed */}
        <LiveFeed
          articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
          domain="legal"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={10}
        />
        <RealtimeDataPanel
          domain="legal"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />

        {/* Legal workbench: deadlines / renewals / conflicts / audit + mint/DM/publish/agent */}
        <PipingProvider>
          <LegalActionPanel />
        </PipingProvider>

        {/* State intestacy + court-procedure reference (Track D, CURATION) */}
        <CourtProcedureReference />

        {/* Live Web Feed */}
        <LensFeedPanel lensId="legal" />

        <CrossLensRecentsPanel lensId="legal" sinceDays={7} limit={6} hideWhenEmpty />
      </div>

      <LensAgentFab
        lensId="legal"
        lensPrompt="You're inside Concord's Legal lens — matters, documents, contracts, compliance, trust accounting. Prefer expert_mode for cited legal research, run_lens_action for legal.* actions, create_dtu to save analysis."
      />

      {/* Mobile thumb-reachable tab bar — mirrors the workbench switcher. */}
      <MobileTabBar
        tabs={WORKBENCH_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        active={workbench}
        onSelect={(id) => setWorkbench(id as Workbench)}
      />
    </LensShell>
  );
}
