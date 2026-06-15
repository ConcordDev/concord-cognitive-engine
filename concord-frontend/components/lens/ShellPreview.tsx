'use client';

/**
 * ShellPreview — collapsible accordion that renders the lens's
 * full-shell view hydrated with the signed-in user's REAL data
 * (per the "everything must be real" directive — no seed/fake data).
 *
 *   <ShellPreview lensId="finance" />
 *
 * Each *Preview fetches via `/api/lens/run` on mount. When the user
 * has no data yet, the shell renders in its empty state. There is no
 * synthetic seed populated client-side.
 */

import React, { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';

import { WalletShell } from '@/components/crypto/WalletShell';
import { WhiteboardCanvas } from '@/components/whiteboard/WhiteboardCanvas';
import { FinanceShell } from '@/components/finance/FinanceShell';
import { RealtorShell } from '@/components/realestate/RealtorShell';
import { StorefrontShell } from '@/components/retail/StorefrontShell';
import { ClassroomShell } from '@/components/education/ClassroomShell';
import { DispatchShell } from '@/components/trades/DispatchShell';
import { TmsShell } from '@/components/logistics/TmsShell';
import { AgFarmShell } from '@/components/agriculture/AgFarmShell';
import { DawShell } from '@/components/studio/DawShell';
import { AvShell } from '@/components/aviation/AvShell';
import { CityGovShell } from '@/components/government/CityGovShell';
import { ClimateShell } from '@/components/environment/ClimateShell';

type SupportedLens = 'code' | 'crypto' | 'legal' | 'message' | 'whiteboard' | 'healthcare' | 'finance' | 'realestate' | 'retail' | 'education' | 'trades' | 'logistics' | 'agriculture' | 'studio' | 'aviation' | 'government' | 'environment';

// Clean, product-facing section titles (no competitor names, no "preview" framing
// — this ships to prod and must not read like a demo).
const SHELL_TITLES: Record<SupportedLens, string> = {
  code: 'Workbench',
  crypto: 'Wallet',
  legal: 'Documents',
  message: 'Inbox',
  whiteboard: 'Canvas',
  healthcare: 'Patient Workbench',
  finance: 'Portfolio',
  realestate: 'Listings',
  retail: 'Storefront',
  education: 'Classroom',
  trades: 'Dispatch Board',
  logistics: 'Shipments',
  agriculture: 'Farm Operations',
  studio: 'Studio',
  aviation: 'Flight Deck',
  government: 'City Services',
  environment: 'Emissions',
};

export interface ShellPreviewProps {
  lensId: string;
  defaultOpen?: boolean;
  className?: string;
}

export function ShellPreview({ lensId, defaultOpen = true, className }: ShellPreviewProps) {
  const [open, setOpen] = useState(defaultOpen);
  const supported = (['code', 'crypto', 'legal', 'message', 'whiteboard', 'healthcare', 'finance', 'realestate', 'retail', 'education', 'trades', 'logistics', 'agriculture', 'studio', 'aviation', 'government', 'environment'] as const).includes(lensId as SupportedLens);
  if (!supported) return null;
  const label = SHELL_TITLES[lensId as SupportedLens];

  return (
    <section
      className={cn('mt-4 rounded-lg border border-lattice-border bg-lattice-surface/40 overflow-hidden', className)}
      aria-labelledby={`shell-${lensId}`}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-lattice-elevated/50"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <span id={`shell-${lensId}`} className="text-sm font-medium text-gray-200">
          {label}
        </span>
      </button>
      {open && (
        <div className="border-t border-lattice-border bg-black/20">
          <PreviewBody lensId={lensId as SupportedLens} />
        </div>
      )}
    </section>
  );
}

function PreviewBody({ lensId }: { lensId: SupportedLens }) {
  switch (lensId) {
    case 'code': return <EmptyShellPlaceholder label="Open the workbench below to load your repository." />;
    case 'crypto': return <CryptoPreview />;
    case 'legal': return <EmptyShellPlaceholder label="Docs — author or open a contract from the workbench below." />;
    case 'message': return <EmptyShellPlaceholder label="Inbox — incoming messages and royalty notifications will appear here." />;
    case 'whiteboard': return <div className="h-[320px]"><WhiteboardCanvas initialShapes={[]} /></div>;
    case 'healthcare': return <EmptyShellPlaceholder label="EHR — open a patient record from the workbench below." />;
    case 'finance': return <FinancePreview />;
    case 'realestate': return <RealEstatePreview />;
    case 'retail': return <RetailPreview />;
    case 'education': return <EducationPreview />;
    case 'trades': return <TradesPreview />;
    case 'logistics': return <LogisticsPreview />;
    case 'agriculture': return <AgriculturePreview />;
    case 'studio': return <StudioPreview />;
    case 'aviation': return <AviationPreview />;
    case 'government': return <GovernmentPreview />;
    case 'environment': return <EnvironmentPreview />;
  }
}

function EmptyShellPlaceholder({ label }: { label: string }) {
  return (
    <div className="p-6 text-center text-xs text-amber-200/80">
      {label}
    </div>
  );
}

function PreviewLoading() {
  return (
    <div className="p-8 flex items-center justify-center text-xs text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading your data…
    </div>
  );
}

/* ── Crypto: hydrate from existing wallet macros if present ────── */

function CryptoPreview() {
  const [data, setData] = useState<{ assets: Array<{ id: string; symbol: string; name: string; amount: number; fiatValue: number; changePct?: number }>; txs: Array<{ id: string; kind: 'send' | 'receive' | 'swap' | 'reward' | 'fee'; asset: string; amount: number; fiatValue?: number; counterparty?: string; timestamp: string }>; totalFiat: number; totalDeltaPct: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const w = await lensRun({ domain: 'crypto', action: 'wallet-list', input: {} }).catch(() => null);
        const items = (w?.data?.result?.wallets || w?.data?.result?.assets || []) as Array<{ id?: string; symbol?: string; name?: string; balance?: number; usdValue?: number }>;
        const assets = items.map(it => ({
          id: String(it.id || it.symbol || ''),
          symbol: String(it.symbol || '').toUpperCase(),
          name: String(it.name || it.symbol || ''),
          amount: Number(it.balance) || 0,
          fiatValue: Number(it.usdValue) || 0,
        }));
        const totalFiat = assets.reduce((s, a) => s + a.fiatValue, 0);
        setData({ assets, txs: [], totalFiat, totalDeltaPct: 0 });
      } catch { setData({ assets: [], txs: [], totalFiat: 0, totalDeltaPct: 0 }); }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return <WalletShell totalFiat={data?.totalFiat || 0} totalDeltaPct={data?.totalDeltaPct} assets={data?.assets || []} txs={data?.txs || []} />;
}

/* ── Finance: hydrate from dashboard-summary + holdings + dividends ── */

function FinancePreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [holdings, setHoldings] = useState<Array<Record<string, unknown>>>([]);
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'ALL'>('1M');
  useEffect(() => {
    (async () => {
      try {
        const [s, h] = await Promise.all([
          lensRun({ domain: 'finance', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'finance', action: 'holdings-list', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setHoldings((h?.data?.result?.holdings || []) as Array<Record<string, unknown>>);
        setActivity(((s?.data?.result as { upcomingBills?: Array<Record<string, unknown>> })?.upcomingBills || []));
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  const netWorth = (d?.netWorth as number) || 0;
  const delta = (d?.delta as number) || 0;
  const deltaPct = (d?.deltaPct as number) || 0;
  const buyingPower = (d?.buyingPower as number) || 0;
  const budgetUsedPct = (d?.budgetUsedPct as number) ?? undefined;
  return (
    <FinanceShell
      netWorth={netWorth}
      netWorthDelta={delta}
      netWorthDeltaPct={deltaPct}
      range={range}
      onRangeChange={setRange}
      buyingPower={buyingPower}
      budgetUsedPct={budgetUsedPct}
      holdings={holdings.map(h => ({
        id: String(h.id || ''),
        symbol: String(h.symbol || ''),
        name: String(h.name || h.symbol || ''),
        kind: ((h.assetClass as string) || 'stock').includes('equity') ? 'stock' : ((h.assetClass as string) || 'cash') as 'stock' | 'etf' | 'crypto' | 'cash' | 'cc' | 'dtu',
        shares: Number(h.shares) || 0,
        price: Number(h.price) || 0,
        value: Number(h.value) || 0,
        changePct: 0,
      }))}
      watchlist={[]}
      activity={activity.map((a, i) => ({
        id: String(a.id || `a${i}`),
        kind: 'budget' as const,
        label: String(a.name || 'Upcoming bill'),
        amount: Number(a.amount) || 0,
        timestamp: String(a.lastPaidAt || new Date().toISOString()),
      }))}
    />
  );
}

/* ── Real estate: hydrate from dashboard-summary + listings ────── */

function RealEstatePreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [listings, setListings] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const [s, l] = await Promise.all([
          lensRun({ domain: 'realestate', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'realestate', action: 'listings-list', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setListings((l?.data?.result?.listings || []) as Array<Record<string, unknown>>);
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return (
    <RealtorShell
      query={query}
      onQueryChange={setQuery}
      totalCount={(d?.totalListings as number) || 0}
      medianPrice={(d?.medianListPrice as number) || undefined}
      favouriteCount={(d?.favouriteCount as number) || 0}
      upcomingTourCount={(d?.upcomingTourCount as number) || 0}
      listings={listings.map(l => ({
        id: String(l.id || ''),
        address: String(l.address || ''),
        city: String(l.city || ''),
        state: String(l.state || ''),
        zip: String(l.zip || ''),
        price: Number(l.price) || 0,
        beds: Number(l.beds) || 0,
        baths: Number(l.baths) || 0,
        sqft: Number(l.sqft) || 0,
        status: ((l.status as string) || 'for_sale') as 'for_sale' | 'pending' | 'sold' | 'off_market',
        daysOnMarket: Number(l.daysOnMarket) || 0,
        lat: l.lat != null ? Number(l.lat) : undefined,
        lng: l.lng != null ? Number(l.lng) : undefined,
      }))}
      activity={[]}
    />
  );
}

/* ── Retail: hydrate from analytics-summary + orders + customers ─ */

function RetailPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<number[]>([]);
  const [nav, setNav] = useState<'home' | 'orders' | 'products' | 'customers' | 'analytics' | 'discounts' | 'shipping' | 'settings'>('home');
  useEffect(() => {
    (async () => {
      try {
        const [s, o, r] = await Promise.all([
          lensRun({ domain: 'retail', action: 'analytics-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'retail', action: 'orders-list', input: {} }).catch(() => null),
          lensRun({ domain: 'retail', action: 'analytics-revenue-by-day', input: { days: 7 } }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setOrders(((o?.data?.result?.orders || []) as Array<Record<string, unknown>>).slice(0, 8));
        setSeries(((r?.data?.result?.series || []) as Array<{ revenue: number }>).map(p => Number(p.revenue) || 0));
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return (
    <StorefrontShell
      activeNav={nav}
      onNavChange={(n) => n && setNav(n)}
      storeName="My Concord Store"
      revenueToday={(d?.revenueToday as number) || 0}
      ordersToday={(d?.ordersToday as number) || 0}
      conversionRate={undefined}
      visitors={undefined}
      revenue7dSeries={series}
      recentOrders={orders.map(o => ({
        id: String(o.id || ''),
        number: String(o.number || ''),
        customer: undefined,
        total: Number(o.total) || 0,
        status: (((o.status as string) || 'paid') === 'paid' ? 'paid' : 'pending') as 'paid' | 'pending' | 'refunded' | 'fulfilled',
        itemCount: Array.isArray(o.lines) ? (o.lines as unknown[]).length : 0,
        timestamp: String(o.completedAt || new Date().toISOString()),
      }))}
    />
  );
}

/* ── Education: hydrate from dashboard-summary + enrollments ───── */

function EducationPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [enrollments, setEnrollments] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const [s, e] = await Promise.all([
          lensRun({ domain: 'education', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'education', action: 'enrollments-list', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setEnrollments((e?.data?.result?.enrollments || []) as Array<Record<string, unknown>>);
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  const courses = enrollments.map(e => {
    const course = (e.course as Record<string, unknown>) || {};
    return {
      id: String(course.id || e.courseId || ''),
      title: String(course.title || 'Course'),
      instructor: String(course.instructor || course.institution || ''),
      progressPct: Number(e.progressPct) || 0,
      totalLessons: Number(e.totalLessons) || 0,
      completedLessons: Number(e.completedLessons) || 0,
      category: String(course.category || ''),
    };
  });
  return (
    <ClassroomShell
      streak={(d?.streak as number) || 0}
      energyPoints={(d?.totalPoints as number) || 0}
      level={(d?.level as number) || 1}
      pointsToday={(d?.pointsToday as number) || 0}
      proficientSkills={(d?.proficientSkills as number) || 0}
      totalSkills={(d?.totalSkills as number) || 0}
      certificates={(d?.certificates as number) || 0}
      enrolledCourses={courses}
      recommendedCourses={[]}
    />
  );
}

/* ── Trades: hydrate from dashboard-summary + dispatch-board ───── */

function TradesPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [board, setBoard] = useState<{ rows: Array<{ tech: { id: string; name: string; status: 'available' | 'on_route' | 'on_site' | 'break' | 'off' }; jobs: Array<{ id: string; customerName: string; description: string; scheduledFor?: string }> }>; unassigned: Array<{ id: string; customerName: string; description: string; priority?: string }> } | null>(null);
  const [bookings, setBookings] = useState<Array<{ id: string; customerName: string; serviceType: string; preferredDate: string | null }>>([]);
  const [quotes, setQuotes] = useState<Array<{ id: string; title: string; total: number; status: string }>>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    (async () => {
      try {
        const [s, b, bk, q] = await Promise.all([
          lensRun({ domain: 'trades', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'trades', action: 'dispatch-board', input: { date: today } }).catch(() => null),
          lensRun({ domain: 'trades', action: 'bookings-list', input: {} }).catch(() => null),
          lensRun({ domain: 'trades', action: 'quotes-list', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setBoard((b?.data?.result as typeof board) || { rows: [], unassigned: [] });
        setBookings(((bk?.data?.result?.bookings || []) as Array<{ id: string; customerName: string; serviceType: string; preferredDate: string | null; status: string }>).filter(x => x.status === 'pending').slice(0, 5));
        setQuotes(((q?.data?.result?.quotes || []) as Array<{ id: string; title: string; total: number; status: string }>).filter(x => x.status === 'sent').slice(0, 5));
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, [today]);
  if (loading) return <PreviewLoading />;
  return (
    <DispatchShell
      date={today}
      jobsToday={(d?.jobsToday as number) || 0}
      techsTotal={(d?.techsTotal as number) || 0}
      techsOnJob={(d?.techsOnJob as number) || 0}
      revenueToday={(d?.totalRevenue as number) || 0}
      avgRating={(d?.avgRating as number) || 0}
      rows={(board?.rows || []).map(r => ({
        tech: { id: r.tech.id, name: r.tech.name, status: r.tech.status },
        jobs: r.jobs.map(j => ({ id: j.id, customerName: j.customerName, description: j.description, hour: j.scheduledFor ? new Date(j.scheduledFor).getHours() : 9, status: 'dispatched', priority: 'normal' as const })),
      }))}
      unassigned={(board?.unassigned || []).map(j => ({ id: j.id, customerName: j.customerName, description: j.description, hour: 9, status: 'unassigned', priority: 'normal' as const }))}
      pendingBookings={bookings}
      pendingQuotes={quotes}
    />
  );
}

/* ── Logistics: hydrate from dashboard-summary + shipments + fleet ── */

function LogisticsPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [shipments, setShipments] = useState<Array<Record<string, unknown>>>([]);
  const [vehicles, setVehicles] = useState<Array<Record<string, unknown>>>([]);
  const [appts, setAppts] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    (async () => {
      try {
        const [s, sh, v, a] = await Promise.all([
          lensRun({ domain: 'logistics', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'logistics', action: 'shipments-list', input: {} }).catch(() => null),
          lensRun({ domain: 'logistics', action: 'fleet-vehicles-list', input: {} }).catch(() => null),
          lensRun({ domain: 'logistics', action: 'dock-appointments-list', input: { date: today } }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        const items = (sh?.data?.result?.shipments || sh?.data?.result?.items || []) as Array<Record<string, unknown>>;
        setShipments(items.slice(0, 10));
        setVehicles((v?.data?.result?.vehicles || []) as Array<Record<string, unknown>>);
        setAppts((a?.data?.result?.appointments || []) as Array<Record<string, unknown>>);
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, [today]);
  if (loading) return <PreviewLoading />;
  return (
    <TmsShell
      totalShipments={(d?.totalShipments as number) || 0}
      inTransit={(d?.inTransit as number) || 0}
      onTimePct={(d?.onTimePct as number) || 0}
      exceptions={(d?.exceptions as number) || 0}
      deliveredToday={(d?.deliveredToday as number) || 0}
      shipments={shipments.map(s => ({
        id: String(s.id || ''),
        trackingNumber: String(s.trackingNumber || ''),
        origin: String(s.origin || ''),
        destination: String(s.destination || ''),
        mode: ((s.mode as string) || 'parcel') as 'parcel' | 'ltl' | 'ftl' | 'ocean' | 'air' | 'intermodal' | 'drayage',
        status: ((s.status as string) || 'label_created') as 'label_created' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned',
        estimatedDelivery: (s.estimatedDelivery as string) || null,
      }))}
      vehicles={vehicles.map(v => ({ id: String(v.id || ''), number: String(v.number || ''), status: String(v.status || 'available'), kind: String(v.kind || 'box_truck') }))}
      appointments={appts.map(a => ({ id: String(a.id || ''), dockName: String(a.dockName || ''), date: String(a.date || ''), startTime: String(a.startTime || ''), truckNumber: String(a.truckNumber || ''), kind: ((a.kind as string) || 'delivery') as 'pickup' | 'delivery', status: String(a.status || 'scheduled') }))}
    />
  );
}

/* ── Agriculture: hydrate from dashboard-summary + fields + equipment ── */

function AgriculturePreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [fields, setFields] = useState<Array<Record<string, unknown>>>([]);
  const [equipment, setEquipment] = useState<Array<Record<string, unknown>>>([]);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const [s, f, eq, wo] = await Promise.all([
          lensRun({ domain: 'agriculture', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'agriculture', action: 'field-list', input: {} }).catch(() => null),
          lensRun({ domain: 'agriculture', action: 'equipment-list', input: {} }).catch(() => null),
          lensRun({ domain: 'agriculture', action: 'work-orders-list', input: { status: 'scheduled' } }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setFields((f?.data?.result?.fields || []) as Array<Record<string, unknown>>);
        setEquipment((eq?.data?.result?.equipment || []) as Array<Record<string, unknown>>);
        setOrders(((wo?.data?.result?.orders || []) as Array<Record<string, unknown>>).slice(0, 8));
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return (
    <AgFarmShell
      totalFields={(d?.totalFields as number) || 0}
      totalAcres={(d?.totalAcres as number) || 0}
      equipmentCount={(d?.equipmentCount as number) || 0}
      equipmentWorking={(d?.equipmentWorking as number) || 0}
      seasonYieldBushels={(d?.seasonYieldBushels as number) || 0}
      avgYieldPerAcre={(d?.avgYieldPerAcre as number) || 0}
      grainStored={(d?.grainStored as number) || 0}
      grainCapacity={(d?.grainCapacity as number) || 0}
      grainUtilizationPct={(d?.grainUtilizationPct as number) || 0}
      fields={fields.map(f => ({ id: String(f.id || ''), name: String(f.name || ''), acreage: Number(f.acreage ?? f.acres) || 0, currentCrop: (f.currentCrop as string) || (f.crop as string) || '' }))}
      equipment={equipment.map(e => ({ id: String(e.id || ''), name: String(e.name || ''), kind: String(e.kind || 'tractor'), status: ((e.status as string) || 'idle') as 'idle' | 'working' | 'transporting' | 'maintenance' | 'offline', fuelLevelPct: Number(e.fuelLevelPct) || 0 }))}
      workOrders={orders.map(o => ({ id: String(o.id || ''), operation: String(o.operation || ''), kind: String(o.kind || ''), status: String(o.status || 'scheduled'), scheduledFor: (o.scheduledFor as string) || null }))}
    />
  );
}

/* ── Studio: hydrate from dashboard-summary + project + clips + scenes ── */

function StudioPreview() {
  const [, setD] = useState<Record<string, unknown> | null>(null);
  const [proj, setProj] = useState<Record<string, unknown> | null>(null);
  const [clips, setClips] = useState<Array<Record<string, unknown>>>([]);
  const [scenes, setScenes] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setPlaying] = useState(false);
  const [isRecording, setRecording] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const s = await lensRun({ domain: 'studio', action: 'dashboard-summary', input: {} }).catch(() => null);
        const summary = (s?.data?.result as Record<string, unknown>) || {};
        setD(summary);
        const latest = summary.latestProject as Record<string, unknown> | null;
        if (latest && latest.id) {
          const projectId = String(latest.id);
          setProj(latest);
          const [c, sc] = await Promise.all([
            lensRun({ domain: 'studio', action: 'clips-list', input: { projectId } }).catch(() => null),
            lensRun({ domain: 'studio', action: 'scenes-list', input: { projectId } }).catch(() => null),
          ]);
          setClips((c?.data?.result?.clips || []) as Array<Record<string, unknown>>);
          setScenes((sc?.data?.result?.scenes || []) as Array<Record<string, unknown>>);
        }
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  const tracks = ((proj?.tracks as Array<Record<string, unknown>>) || []).map(t => ({
    id: String(t.id || ''),
    name: String(t.name || ''),
    kind: ((t.kind as string) || 'audio') as 'audio' | 'midi' | 'drum' | 'aux' | 'bus' | 'master',
    colour: (t.colour as string) || '#22d3ee',
    muted: Boolean(t.muted),
    solo: Boolean(t.solo),
    armed: Boolean(t.armed),
  }));
  return (
    <DawShell
      projectName={(proj?.name as string) || '(no project yet)'}
      bpm={(proj?.bpm as number) || 120}
      timeSignatureNum={(proj?.timeSignatureNum as number) || 4}
      timeSignatureDen={(proj?.timeSignatureDen as number) || 4}
      isPlaying={isPlaying}
      isRecording={isRecording}
      positionBeats={0}
      onPlay={() => setPlaying(p => !p)}
      onRecord={() => setRecording(r => !r)}
      tracks={tracks}
      clips={clips.map(c => ({
        id: String(c.id || ''),
        trackId: String(c.trackId || ''),
        name: String(c.name || ''),
        kind: ((c.kind as string) || 'midi') as 'audio' | 'midi' | 'drum',
        startBeats: Number(c.startBeats) || 0,
        lengthBeats: Number(c.lengthBeats) || 4,
        colour: (c.colour as string) || '#22d3ee',
        muted: Boolean(c.muted),
      }))}
      scenes={scenes.map(s => ({ id: String(s.id || ''), name: String(s.name || '') }))}
    />
  );
}

/* ── Aviation: hydrate from dashboard-summary + aircraft + tracks + currency ── */

function AviationPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [aircraft, setAircraft] = useState<Array<Record<string, unknown>>>([]);
  const [tracks, setTracks] = useState<Array<Record<string, unknown>>>([]);
  const [currency, setCurrency] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const [s, ac, tr, cur] = await Promise.all([
          lensRun({ domain: 'aviation', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'aviation', action: 'aircraft-list', input: {} }).catch(() => null),
          lensRun({ domain: 'aviation', action: 'track-logs-list', input: {} }).catch(() => null),
          lensRun({ domain: 'aviation', action: 'currency-status', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setAircraft((ac?.data?.result?.aircraft || []) as Array<Record<string, unknown>>);
        setTracks(((tr?.data?.result?.tracks || []) as Array<Record<string, unknown>>).slice(0, 8));
        setCurrency((cur?.data?.result as Record<string, unknown>) || null);
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return (
    <AvShell
      totalHours={(d?.totalHours as number) || 0}
      hours30d={(d?.hours30d as number) || 0}
      aircraftCount={(d?.aircraftCount as number) || 0}
      activeTracks={(d?.activeTracks as number) || 0}
      totalFlights={(d?.totalFlights as number) || 0}
      aircraft={aircraft.map(a => ({ id: String(a.id || ''), tail: String(a.tail || ''), make: String(a.make || ''), model: String(a.model || ''), hobbsHours: Number(a.hobbsHours) || 0, cruiseKts: Number(a.cruiseKts) || 0, fuelBurnGph: Number(a.fuelBurnGph) || 0 }))}
      tracks={tracks.map(t => ({ id: String(t.id || ''), tail: t.tail as string, from: t.from as string, to: t.to as string, endedAt: t.endedAt as string, totalDistanceNm: Number(t.totalDistanceNm) || 0 }))}
      currency={currency ? (currency as never) : undefined}
    />
  );
}

/* ── Government: hydrate from dashboard-summary + 311 + permits + assets ── */

function GovernmentPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [permits, setPermits] = useState<Array<Record<string, unknown>>>([]);
  const [assets, setAssets] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const [s, sr, pm, ast] = await Promise.all([
          lensRun({ domain: 'government', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'government', action: 'service-requests-list', input: {} }).catch(() => null),
          lensRun({ domain: 'government', action: 'permits-list', input: {} }).catch(() => null),
          lensRun({ domain: 'government', action: 'assets-list', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        setRequests(((sr?.data?.result?.requests || []) as Array<Record<string, unknown>>).slice(0, 8));
        setPermits(((pm?.data?.result?.permits || []) as Array<Record<string, unknown>>).slice(0, 8));
        setAssets(((ast?.data?.result?.assets || []) as Array<Record<string, unknown>>).slice(0, 8));
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return (
    <CityGovShell
      totalServiceRequests={(d?.totalServiceRequests as number) || 0}
      openRequests={(d?.openRequests as number) || 0}
      closed30d={(d?.closed30d as number) || 0}
      avgResolutionDays={(d?.avgResolutionDays as number) || 0}
      permitCount={(d?.permitCount as number) || 0}
      scheduledInspections={(d?.scheduledInspections as number) || 0}
      departmentCount={(d?.departmentCount as number) || 0}
      assetCount={(d?.assetCount as number) || 0}
      brokenAssets={(d?.brokenAssets as number) || 0}
      requests={requests.map(r => ({
        id: String(r.id || ''),
        referenceNumber: String(r.referenceNumber || ''),
        category: String(r.category || ''),
        description: String(r.description || ''),
        status: String(r.status || ''),
        priority: ((r.priority as string) || 'medium') as 'low' | 'medium' | 'high' | 'urgent',
        assignedDepartmentName: (r.assignedDepartmentName as string) || null,
        createdAt: String(r.createdAt || new Date().toISOString()),
        lat: Number(r.lat) || undefined,
        lng: Number(r.lng) || undefined,
      }))}
      permits={permits.map(p => ({
        id: String(p.id || ''),
        recordNumber: String(p.recordNumber || ''),
        kind: String(p.kind || ''),
        applicantName: String(p.applicantName || ''),
        status: String(p.status || ''),
        feeUsd: Number(p.feeUsd) || 0,
      }))}
      assets={assets.map(a => ({
        id: String(a.id || ''),
        kind: String(a.kind || ''),
        label: String(a.label || ''),
        condition: ((a.condition as string) || 'good') as 'good' | 'fair' | 'poor' | 'broken',
      }))}
    />
  );
}

/* ── Environment: hydrate from dashboard-summary + targets + activities ── */

function EnvironmentPreview() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [targets, setTargets] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([
          lensRun({ domain: 'environment', action: 'dashboard-summary', input: {} }).catch(() => null),
          lensRun({ domain: 'environment', action: 'targets-list', input: {} }).catch(() => null),
        ]);
        setD((s?.data?.result as Record<string, unknown>) || {});
        const list = (t?.data?.result?.targets || []) as Array<Record<string, unknown>>;
        const enriched: Array<Record<string, unknown>> = [];
        for (const tgt of list.slice(0, 3)) {
          const p = await lensRun({ domain: 'environment', action: 'targets-progress', input: { id: tgt.id } }).catch(() => null);
          const prog = p?.data?.result as { reductionAchievedPct?: number; expectedReductionPct?: number; onTrack?: boolean } | undefined;
          enriched.push({ ...tgt, achievedPct: prog?.reductionAchievedPct || 0, expectedPct: prog?.expectedReductionPct || 0, onTrack: prog?.onTrack || false });
        }
        setTargets(enriched);
      } catch { /* empty state */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <PreviewLoading />;
  return (
    <ClimateShell
      currentYear={String(d?.currentYear || new Date().getFullYear())}
      ytdTotalCo2eTonnes={(d?.ytdTotalCo2eTonnes as number) || 0}
      ytdScope1={(d?.ytdScope1 as number) || 0}
      ytdScope2={(d?.ytdScope2 as number) || 0}
      ytdScope3={(d?.ytdScope3 as number) || 0}
      lastYearTotal={(d?.lastYearTotal as number) || 0}
      yoyPct={(d?.yoyPct as number) || 0}
      activityCount={(d?.activityCount as number) || 0}
      supplierCount={(d?.supplierCount as number) || 0}
      supplierResponseRate={(d?.supplierResponseRate as number) || 0}
      supplierReportedTonnes={(d?.supplierReportedTonnes as number) || 0}
      activeTargets={(d?.activeTargets as number) || 0}
      activeProjects={(d?.activeProjects as number) || 0}
      recsRetiredMwh={(d?.recsRetiredMwh as number) || 0}
      offsetsRetiredTonnes={(d?.offsetsRetiredTonnes as number) || 0}
      netEmissionsTonnes={(d?.netEmissionsTonnes as number) || 0}
      topTargets={targets.map(t => ({
        id: String(t.id || ''),
        name: String(t.name || ''),
        baseYear: Number(t.baseYear) || 2020,
        targetYear: Number(t.targetYear) || 2030,
        reductionPct: Number(t.reductionPct) || 0,
        onTrack: Boolean(t.onTrack),
        achievedPct: Number(t.achievedPct) || 0,
        expectedPct: Number(t.expectedPct) || 0,
      }))}
    />
  );
}

export default ShellPreview;
