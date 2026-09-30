'use client';

/**
 * Trades — one field-service / construction ops app.
 *
 * Reference: ServiceTitan / Jobber / Buildertrend (dense grouped rail).
 * Single `active` union drives every view. Era-1 project desk (jobs /
 * estimates / materials / permits / equipment / clients + sub-views +
 * macros) lives in ProjectDeskPanel. Era-2 ServiceTitan panels and the
 * workbench are first-class tabs — no accordion / floating-drawer soup.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useMemo, useState, type ComponentType } from 'react';
import {
  HardHat,
  Hammer,
  Radio,
  Calendar,
  Users,
  MapPin,
  Route,
  FileText,
  Bookmark,
  Clock,
  Receipt,
  CreditCard,
  Globe,
  RefreshCw,
  BookOpen,
  Bell,
  Star,
  BarChart3,
  Wrench,
  Rss,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import QuoteChart, { type QuoteSnapshot } from '@/components/lens/QuoteChart';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

import ProjectDeskPanel from '@/components/trades/ProjectDeskPanel';
import DispatchBoardPanel from '@/components/trades/DispatchBoardPanel';
import SchedulingCalendarPanel from '@/components/trades/SchedulingCalendarPanel';
import TechniciansPanel from '@/components/trades/TechniciansPanel';
import FieldTrackingPanel from '@/components/trades/FieldTrackingPanel';
import RouteOptimizerPanel from '@/components/trades/RouteOptimizerPanel';
import QuotesPanel from '@/components/trades/QuotesPanel';
import BookingsPanel from '@/components/trades/BookingsPanel';
import TimesheetsPanel from '@/components/trades/TimesheetsPanel';
import InvoicesPanel from '@/components/trades/InvoicesPanel';
import PaymentsPanel from '@/components/trades/PaymentsPanel';
import CustomerPortalPanel from '@/components/trades/CustomerPortalPanel';
import RecurringPlansPanel from '@/components/trades/RecurringPlansPanel';
import PricebookPanel from '@/components/trades/PricebookPanel';
import NotificationsPanel from '@/components/trades/NotificationsPanel';
import ReviewsPanel from '@/components/trades/ReviewsPanel';
import ReportingPanel from '@/components/trades/ReportingPanel';
import WorkbenchPanel from '@/components/trades/WorkbenchPanel';
import { TradesFeed } from '@/components/trades/TradesFeed';

type TradesView =
  | 'project'
  | 'dispatch'
  | 'calendar'
  | 'techs'
  | 'field'
  | 'route'
  | 'quotes'
  | 'bookings'
  | 'timesheets'
  | 'invoices'
  | 'payments'
  | 'portal'
  | 'recurring'
  | 'pricebook'
  | 'reminders'
  | 'reviews'
  | 'reports'
  | 'workbench'
  | 'feed';

const GROUPS: { label: string; items: { id: TradesView; label: string; icon: typeof HardHat }[] }[] = [
  {
    label: 'Project desk',
    items: [
      { id: 'project', label: 'Jobs & artifacts', icon: Hammer },
    ],
  },
  {
    label: 'Field ops',
    items: [
      { id: 'dispatch', label: 'Dispatch', icon: Radio },
      { id: 'calendar', label: 'Calendar', icon: Calendar },
      { id: 'techs', label: 'Technicians', icon: Users },
      { id: 'field', label: 'Field / GPS', icon: MapPin },
      { id: 'route', label: 'Route opt', icon: Route },
      { id: 'bookings', label: 'Bookings', icon: Bookmark },
      { id: 'timesheets', label: 'Timesheets', icon: Clock },
    ],
  },
  {
    label: 'Billing & CRM',
    items: [
      { id: 'quotes', label: 'Quotes', icon: FileText },
      { id: 'invoices', label: 'Invoices', icon: Receipt },
      { id: 'payments', label: 'Payments', icon: CreditCard },
      { id: 'portal', label: 'Portal', icon: Globe },
      { id: 'recurring', label: 'Recurring', icon: RefreshCw },
      { id: 'pricebook', label: 'Pricebook', icon: BookOpen },
    ],
  },
  {
    label: 'Ops intel',
    items: [
      { id: 'reminders', label: 'Reminders', icon: Bell },
      { id: 'reviews', label: 'Reviews', icon: Star },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'workbench', label: 'Workbench', icon: Wrench },
      { id: 'feed', label: 'Feed', icon: Rss },
    ],
  },
];

const PANELS: Record<TradesView, ComponentType> = {
  project: ProjectDeskPanel,
  dispatch: DispatchBoardPanel,
  calendar: SchedulingCalendarPanel,
  techs: TechniciansPanel,
  field: FieldTrackingPanel,
  route: RouteOptimizerPanel,
  quotes: QuotesPanel,
  bookings: BookingsPanel,
  timesheets: TimesheetsPanel,
  invoices: InvoicesPanel,
  payments: PaymentsPanel,
  portal: CustomerPortalPanel,
  recurring: RecurringPlansPanel,
  pricebook: PricebookPanel,
  reminders: NotificationsPanel,
  reviews: ReviewsPanel,
  reports: ReportingPanel,
  workbench: WorkbenchPanel,
  feed: TradesFeed,
};

export default function TradesLensPage() {
  useLensNav('trades');
  useLensIdentity('trades');
  const reduceMotion = useReducedMotion();
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('trades');
  const [active, setActive] = useState<TradesView>('project');
  const [chartSymbol, setChartSymbol] = useState<string>(() => {
    if (typeof window === 'undefined') return '^IXIC';
    return localStorage.getItem('concord_trades_chart_symbol') || '^IXIC';
  });

  const go = useCallback((id: TradesView) => setActive(id), []);
  const handleChangeSymbol = useCallback((s: string) => {
    setChartSymbol(s);
    try { localStorage.setItem('concord_trades_chart_symbol', s); } catch { /* private mode */ }
  }, []);

  useLensCommand(
    [
      { id: 'trades-project', keys: 'j', description: 'Project desk', category: 'navigation', action: () => go('project') },
      { id: 'trades-dispatch', keys: 'd', description: 'Dispatch board', category: 'navigation', action: () => go('dispatch') },
      { id: 'trades-calendar', keys: 'c', description: 'Scheduling calendar', category: 'navigation', action: () => go('calendar') },
      { id: 'trades-techs', keys: 't', description: 'Technicians', category: 'navigation', action: () => go('techs') },
      { id: 'trades-quotes', keys: 'q', description: 'Quotes', category: 'navigation', action: () => go('quotes') },
      { id: 'trades-invoices', keys: 'i', description: 'Invoices', category: 'navigation', action: () => go('invoices') },
      { id: 'trades-workbench', keys: 'w', description: 'Workbench', category: 'navigation', action: () => go('workbench') },
      { id: 'trades-reports', keys: 'r', description: 'Reports', category: 'navigation', action: () => go('reports') },
    ],
    { lensId: 'trades' },
  );

  const Panel = PANELS[active];
  const activeLabel = useMemo(
    () => GROUPS.flatMap((g) => g.items).find((t) => t.id === active)?.label ?? active,
    [active],
  );

  return (
    <LensShell lensId="trades" asMain={false}>
      <FirstRunTour lensId="trades" />
      <DepthBadge lensId="trades" size="sm" className="ml-2" />
      <div data-lens-theme="trades" className={cn(ds.pageContainer, 'lens-trades pb-6')}>
        <a href="#trades-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-teal-500">
          Skip to trades content
        </a>
        <ShellPreview lensId="trades" defaultOpen={true} />

        <header className={cn(ds.sectionHeader, 'gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-teal-500/20 flex items-center justify-center shrink-0">
              <HardHat className="w-5 h-5 text-teal-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Trades & Construction</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={cn(ds.textMuted, 'font-mono text-xs tracking-wide')}>
                {activeLabel} · ServiceTitan density · kbd j / d / c / w
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="trades" data={{}} compact />
          </div>
        </header>

        <QuoteChart
          symbol={chartSymbol}
          quotes={(realtimeData as { quotes?: QuoteSnapshot[] } | null)?.quotes}
          isLive={isLive}
          lastUpdated={lastUpdated}
          onChangeSymbol={handleChangeSymbol}
        />
        <RealtimeDataPanel
          domain="trades"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />

        <div className="grid grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)] gap-4 items-start">
          <nav aria-label="Trades ops" className="lg:sticky lg:top-3 space-y-4">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className={cn(ds.overline, 'px-2 mb-1')}>{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((t) => {
                    const Icon = t.icon;
                    const on = active === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => go(t.id)}
                          className={cn(
                            'w-full text-left px-2 py-1 rounded-sm text-xs font-mono tracking-tight transition-colors flex items-center gap-2',
                            on
                              ? 'bg-teal-500/20 text-white border-l-2 border-teal-400'
                              : 'text-gray-400 hover:text-white hover:bg-lattice-elevated border-l-2 border-transparent',
                          )}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {t.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <main id="trades-main" className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
              >
                <Panel />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <CrossLensRecentsPanel lensId="trades" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
