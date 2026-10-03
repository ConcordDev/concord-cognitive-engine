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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

type Workbench = 'practice' | 'analyzer' | 'docket' | 'qa' | 'caselaw';

const WORKBENCH_TABS: {
  id: Workbench;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  key: string;
  hint: string;
}[] = [
  { id: 'practice', title: 'Your practice', label: 'Practice', icon: Briefcase, key: 'P', hint: 'Matters, billing, trust, documents' },
  { id: 'analyzer', title: 'What a contract risks', label: 'Analyzer', icon: Brain, key: 'Y', hint: 'AI contract risk-flagging' },
  { id: 'docket', title: 'What is on the docket', label: 'Docket', icon: Gavel, key: 'K', hint: 'Quick case log + deadlines' },
  { id: 'qa', title: 'Ask the research desk', label: 'Q&A', icon: MessageSquare, key: 'Q', hint: 'Jurisdiction-aware research' },
  { id: 'caselaw', title: 'What the courts held', label: 'Case Law', icon: Search, key: 'L', hint: 'CourtListener opinion search' },
];

export default function LegalLensPage() {
  useLensNav('legal');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('legal');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [workbench, setWorkbench] = useState<Workbench>('practice');
  const current = WORKBENCH_TABS.find((t) => t.id === workbench)!;

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
      <div data-lens-theme="legal" className="relative min-h-full space-y-5 px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Legal</p>
            <h1 className="mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{workbench === 'practice' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <DepthBadge lensId="legal" size="sm" />
            <DTUExportButton domain="legal" data={{}} compact />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-[13px] leading-relaxed text-amber-200/90">
            This tool assists with legal organization and practice management. It does not
            constitute legal advice. Always consult qualified legal counsel for legal decisions.
          </p>
        </div>

        <ShellPreview lensId="legal" defaultOpen={false} />

        <nav
          className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
          aria-label="Legal workbench"
        >
          {WORKBENCH_TABS.map((tab) => {
            const on = workbench === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setWorkbench(tab.id)}
                title={tab.hint}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{tab.key}</kbd>
              </button>
            );
          })}
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

        {workbench !== 'qa' && (
          <button
            type="button"
            onClick={() => setWorkbench('qa')}
            title="Ask a legal research question (Q)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <MessageSquare className="h-4 w-4" />
            Ask a question
          </button>
        )}
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
