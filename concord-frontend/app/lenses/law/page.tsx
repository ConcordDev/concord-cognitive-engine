'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // LAW & CONTRACTS — rebuild (Frontend Rebuild Program, Wave 2)
 * ─────────────────────────────────────────────────────────────────────────
 * Research-tool identity for case-law/patent research (CourtListener +
 * USPTO PatentsView, real external data, always-on source attribution,
 * one-click pull → DTU → cite) + a real Ironclad/LegalZoom-shape
 * contract-lifecycle workbench, grouped into a designed workspace instead
 * of a wall of auto-generated macro buttons.
 *
 * Honest-by-construction — every number on screen traces to a REAL macro:
 *   • case-law search      → law.courtlistener-search (CourtListener v4 API)
 *   • docket/filing search → law.recap-docket-search / law.recap-docket-documents
 *                            (CourtListener RECAP Archive — real federal
 *                            docket search, separately scoped from case-law
 *                            opinions; every filing discloses free-in-RECAP
 *                            vs PACER-purchase-required vs unknown, never
 *                            faked as fetched)
 *   • patent search        → law.uspto-patent-search  (USPTO PatentsView;
 *                            previously ZERO frontend callers — first surface)
 *   • recent opinions feed → law.feed                 (pull → DTU)
 *   • community Q&A        → law.stackexchange.com    (real external feed)
 *   • saved search alerts   → law.search-alert-*       (real persistence +
 *                            honest on-demand "what's new since last check"
 *                            diff, re-running the SAME courtlistener-search /
 *                            recap-docket-search handlers above — no
 *                            background scheduler, no push/email; checked
 *                            only when the user clicks "Check now")
 *   • contracts             → law.contract-* / law.clause-* / law.approval-* /
 *                            law.obligation-* / law.playbook-* / law.repository-search
 *                            (real STATE-backed contract-lifecycle substrate)
 *   • case files             → per-user lens artifacts (real, persisted)
 *   • case analysis + deadlines → law.caseAnalysis / law.deadlineTracker,
 *                            run over the REAL case-file list above (not a
 *                            hand-authored JSON artifact)
 *   • legal text search     → law.statuteLookup, run over text you paste
 *                            (Concord ships no licensed statute database —
 *                            disclosed inline, never faked as a live corpus)
 *   • billing calculator    → law.billingCalculator, an ad-hoc calculator
 *                            over session-only entries (disclosed as such)
 *   • compliance screener   → law.check-compliance (real 4-rule keyword
 *                            check server-side; previously ZERO frontend
 *                            callers — the old page reimplemented 3 of its
 *                            4 rules client-side with no macro call at all)
 *   • framework coverage    → law.analyze (real per-framework keyword
 *                            coverage/risk scoring; previously ZERO
 *                            frontend callers — the old page's 4
 *                            "legalFrameworks" tiles were a hardcoded
 *                            array with a permanently-fixed status,
 *                            unconnected to this real macro)
 *
 * REMOVED (fabrication + dead chrome the old page shipped): 4 hardcoded
 * "legalFrameworks" with permanently-fixed "compliant"/"review" status
 * (a static array presented as live compliance state — no macro, no
 * computation, always the same answer — replaced by the real
 * FrameworkCoverage panel above); useRealtimeLens('law') +
 * LiveIndicator + RealtimeDataPanel (no realtime source is registered for
 * the `law` domain — DOMAIN_EVENTS in useRealtimeLens.ts has no `law` key,
 * only `legal` — so isLive was permanently false and latestData
 * permanently null: decorative dead chrome, not a real live feed).
 * RETIRED generic scaffold: the generated action-bar / auto-action-strip /
 * recent-mine footer trio, the auto-discovered-macro button wall + generic
 * capabilities-list body, the cross-lens-recents panel, the session rail,
 * the connective-tissue bar, and the raw 4-button "Legal Analysis" strip
 * (required a separate JSON artifact id — replaced by CaseAnalytics running
 * the same macros over real, already-persisted case files).
 *
 * Full capability map: docs/lens-specs/law-capability-map.md
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useRef, useState } from 'react';
import { BookOpen, FileText, Briefcase, BarChart3, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { DensityToggle } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

// Reused, already-real bespoke components.
import { LegalCaseSearch } from '@/components/legal/LegalCaseSearch';
import { LawContracts, type LawContractsHandle } from '@/components/law/LawContracts';
import { ContractPlaybooks } from '@/components/law/ContractPlaybooks';
import { ObligationTracker } from '@/components/law/ObligationTracker';
import { ContractRepositorySearch } from '@/components/law/ContractRepositorySearch';
import { LawFeed } from '@/components/law/LawFeed';
import { SearchAlertsPanel } from '@/components/law/SearchAlertsPanel';

// New bespoke components built for this rebuild.
import { PatentSearch } from '@/components/law/PatentSearch';
import { RecapDocketSearch } from '@/components/law/RecapDocketSearch';
import { CaseFiles } from '@/components/law/CaseFiles';
import { CaseAnalytics } from '@/components/law/CaseAnalytics';
import { LegalTextSearch } from '@/components/law/LegalTextSearch';
import { BillingCalculator } from '@/components/law/BillingCalculator';
import { ComplianceScreener } from '@/components/law/ComplianceScreener';
import { FrameworkCoverage } from '@/components/law/FrameworkCoverage';
import type { CaseFileSummary } from '@/components/law/case-types';

type GroupId = 'research' | 'contracts' | 'cases' | 'analytics';

const GROUPS: { id: GroupId; label: string; hotkey: string; title: string; hint: string; icon: typeof BookOpen }[] = [
  { id: 'research', label: 'Research', hotkey: '1', title: 'What the record says', hint: 'Case law, dockets, patents and alerts', icon: BookOpen },
  { id: 'contracts', label: 'Contracts', hotkey: '2', title: 'Where every contract stands', hint: 'Contract lifecycle, playbooks and obligations', icon: FileText },
  { id: 'cases', label: 'Case Files', hotkey: '3', title: 'Your matters', hint: 'Case files and deadlines', icon: Briefcase },
  { id: 'analytics', label: 'Analytics & Tools', hotkey: '4', title: 'Numbers behind the work', hint: 'Case analytics, text search, billing and compliance', icon: BarChart3 },
];

function Panel({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-white/10 bg-[#111] p-4', className)}>
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {right}
      </header>
      <div>{children}</div>
    </section>
  );
}

export default function LawLensPage() {
  useLensNav('law');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [group, setGroup] = useState<GroupId>('research');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [contractList, setContractList] = useState<{ id: string; title: string }[]>([]);
  const [caseSummaries, setCaseSummaries] = useState<CaseFileSummary[]>([]);
  const contractsRef = useRef<LawContractsHandle>(null);

  const onContractsChange = useCallback((c: { id: string; title: string }[]) => setContractList(c), []);
  const onCasesChange = useCallback((c: CaseFileSummary[]) => setCaseSummaries(c), []);

  useLensCommand(
    [
      ...GROUPS.map((g) => ({
        id: `group-${g.id}`,
        keys: g.hotkey,
        description: `Go to ${g.label}`,
        category: 'navigation' as const,
        action: () => setGroup(g.id),
      })),
    ],
    { lensId: 'law' }
  );

  const searchCaseLaw = useCallback(() => {
    setGroup('research');
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector<HTMLInputElement>('input[type="text"], input:not([type]), input[type="search"]')?.focus();
    });
  }, []);

  const current = GROUPS.find((g) => g.id === group)!;

  const renderGroup = () => {
    switch (group) {
      case 'research':
        return (
          <div className="space-y-4">
            <Panel title="Case law — CourtListener (9M+ opinions)">
              <LegalCaseSearch />
            </Panel>
            <Panel title="Dockets &amp; filings — CourtListener RECAP Archive">
              <RecapDocketSearch />
            </Panel>
            <Panel title="Patent search — USPTO PatentsView">
              <PatentSearch />
            </Panel>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <LensFeedButton domain="law" label="Recent court opinions → DTU" />
                <div className="mt-3">
                  <LensFeedPanel lensId="law" limit={15} />
                </div>
              </div>
              <Panel title="Community Q&A — law.stackexchange.com">
                <LawFeed />
              </Panel>
            </div>
            <SearchAlertsPanel />
          </div>
        );
      case 'contracts':
        return (
          <div className="space-y-4">
            <LawContracts ref={contractsRef} onContractsChange={onContractsChange} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ContractPlaybooks
                onApplied={(id) => {
                  void contractsRef.current?.refresh();
                  if (id) void contractsRef.current?.open(id);
                  showToast('success', 'Contract created from playbook');
                }}
              />
              <ObligationTracker contracts={contractList} />
            </div>
            <ContractRepositorySearch onOpen={(id) => { void contractsRef.current?.open(id); }} />
          </div>
        );
      case 'cases':
        return <CaseFiles onCasesChange={onCasesChange} />;
      case 'analytics':
        return (
          <div className="space-y-4">
            <CaseAnalytics cases={caseSummaries} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LegalTextSearch />
              <BillingCalculator />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ComplianceScreener />
              <FrameworkCoverage />
            </div>
          </div>
        );
      default:
        // Unreachable given GroupId's closed union + the switch above
        // covers every member, but if a future group is ever added
        // without a matching case, this keeps the user looking at an
        // honest message instead of a blank screen.
        return (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-400">
            No panel is wired for this view yet.
          </div>
        );
    }
  };

  return (
    <LensShell lensId="law" asMain={false}>
      <FirstRunTour lensId="law" />
      <DepthBadge lensId="law" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="law"
        crumb="Law & Contracts"
        title={`${current.title}${group === 'research' && who ? `, ${who}` : ''}`}
        subtitle="Case-law and patent research from real public sources, the contract lifecycle, and case-file tooling."
        actions={
          <>
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="law" data={{ contracts: contractList, cases: caseSummaries }} compact />
          </>
        }
        tabs={GROUPS.map((g) => ({
          id: g.id,
          label: g.id === 'cases' && caseSummaries.length > 0 ? `${g.label} (${caseSummaries.length})`
            : g.id === 'contracts' && contractList.length > 0 ? `${g.label} (${contractList.length})`
            : g.label,
          icon: g.icon,
          keys: g.hotkey,
          hint: g.hint,
        }))}
        activeTab={group}
        onTab={(id) => setGroup(id as GroupId)}
        tabsLabel="Law views"
        cta={{ label: 'Search case law', icon: Search, onClick: searchCaseLaw, title: 'Jump to case-law search' }}
      >
        <div ref={bodyRef}>{renderGroup()}</div>
      </NorthStarFrame>
    </LensShell>
  );
}
