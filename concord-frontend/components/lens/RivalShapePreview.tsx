'use client';

/**
 * RivalShapePreview — drop-in collapsible preview that renders the
 * lens's rival-shape shell with seed data. Lenses mount one:
 *
 *   <RivalShapePreview lensId="code" />
 *
 * The preview ships seed data so the rival silhouette is visible
 * end-to-end without wiring real data first. Real-data wiring lands
 * per-lens in subsequent passes; this surface confirms each shell
 * mounts and renders.
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

import { VSCodeShell } from '@/components/code/VSCodeShell';
import { WalletShell } from '@/components/crypto/WalletShell';
import { DocsShell } from '@/components/legal/DocsShell';
import { InboxShell } from '@/components/message/InboxShell';
import { WhiteboardCanvas } from '@/components/whiteboard/WhiteboardCanvas';
import { EHRShell } from '@/components/healthcare/EHRShell';
import { FinanceShell } from '@/components/finance/FinanceShell';
import { RealtorShell } from '@/components/realestate/RealtorShell';
import { ShopifyShell } from '@/components/retail/ShopifyShell';
import { ClassroomShell } from '@/components/education/ClassroomShell';
import { DispatchShell } from '@/components/trades/DispatchShell';
import { TmsShell } from '@/components/logistics/TmsShell';
import { AgFarmShell } from '@/components/agriculture/AgFarmShell';

type SupportedLens = 'code' | 'crypto' | 'legal' | 'message' | 'whiteboard' | 'healthcare' | 'finance' | 'realestate' | 'retail' | 'education' | 'trades' | 'logistics' | 'agriculture';

const RIVAL_LABELS: Record<SupportedLens, string> = {
  code: 'VS Code shape',
  crypto: 'Coinbase / Phantom shape',
  legal: 'Notion / Word shape',
  message: 'Gmail shape',
  whiteboard: 'tldraw / Miro shape',
  healthcare: 'Epic EHR shape',
  finance: 'Robinhood / Monarch shape',
  realestate: 'Zillow / Redfin shape',
  retail: 'Shopify admin shape',
  education: 'Khan / Coursera shape',
  trades: 'ServiceTitan / Jobber shape',
  logistics: 'Project44 / SAP TMS shape',
  agriculture: 'John Deere / FieldView shape',
};

export interface RivalShapePreviewProps {
  lensId: string;
  /** Default closed; pass true to expand on mount. */
  defaultOpen?: boolean;
  className?: string;
}

export function RivalShapePreview({ lensId, defaultOpen = false, className }: RivalShapePreviewProps) {
  const [open, setOpen] = useState(defaultOpen);
  const supported = (['code', 'crypto', 'legal', 'message', 'whiteboard', 'healthcare', 'finance', 'realestate', 'retail', 'education', 'trades', 'logistics', 'agriculture'] as const).includes(lensId as SupportedLens);
  if (!supported) return null;
  const label = RIVAL_LABELS[lensId as SupportedLens];

  return (
    <section
      className={cn(
        'mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden',
        className
      )}
      aria-labelledby={`rival-preview-${lensId}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-amber-500/10"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-4 h-4 text-amber-300" /> : <ChevronRight className="w-4 h-4 text-amber-300" />}
        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
        <span id={`rival-preview-${lensId}`} className="text-sm font-medium text-amber-200">
          Rival-shape preview · {label}
        </span>
        <span className="ml-auto text-[11px] text-amber-300/70">
          seed data; real-data wiring per-lens
        </span>
      </button>
      {open && (
        <div className="border-t border-amber-500/20 bg-black/30">
          <PreviewBody lensId={lensId as SupportedLens} />
        </div>
      )}
    </section>
  );
}

function PreviewBody({ lensId }: { lensId: SupportedLens }) {
  switch (lensId) {
    case 'code': return <CodePreview />;
    case 'crypto': return <CryptoPreview />;
    case 'legal': return <LegalPreview />;
    case 'message': return <MessagePreview />;
    case 'whiteboard': return <WhiteboardPreview />;
    case 'healthcare': return <HealthcarePreview />;
    case 'finance': return <FinancePreview />;
    case 'realestate': return <RealEstatePreview />;
    case 'retail': return <RetailPreview />;
    case 'education': return <EducationPreview />;
    case 'trades': return <TradesPreview />;
    case 'logistics': return <LogisticsPreview />;
    case 'agriculture': return <AgriculturePreview />;
  }
}

function CodePreview() {
  return (
    <div className="h-[480px]">
      <VSCodeShell
        files={[
          {
            id: 'src', name: 'src', kind: 'folder',
            children: [
              { id: 'app.tsx', name: 'app.tsx', kind: 'file', modified: true },
              { id: 'lib', name: 'lib', kind: 'folder', children: [
                { id: 'dtu.ts', name: 'dtu.ts', kind: 'file' },
                { id: 'royalty.ts', name: 'royalty.ts', kind: 'file' },
              ]},
              { id: 'styles.css', name: 'styles.css', kind: 'file' },
            ],
          },
          { id: 'pkg', name: 'package.json', kind: 'file' },
          { id: 'readme', name: 'README.md', kind: 'file' },
        ]}
        openTabs={[
          { id: 'app.tsx', label: 'app.tsx', modified: true },
          { id: 'dtu.ts', label: 'dtu.ts' },
        ]}
        activeTabId="app.tsx"
        statusBar={{ branch: 'main', errors: 0, warnings: 2, language: 'TypeScript', cursor: 'Ln 42, Col 18' }}
      >
        <pre className="p-4 text-xs text-[#d4d4d4]">{`// app.tsx
import { Concord } from '@/lib/dtu';

export default function App() {
  return <Concord />;
}
`}</pre>
      </VSCodeShell>
    </div>
  );
}

function CryptoPreview() {
  return (
    <WalletShell
      totalFiat={4287.93}
      totalDeltaPct={3.42}
      assets={[
        { id: 'cc', symbol: 'CC', name: 'Concord Coin', amount: 1245, fiatValue: 1245, changePct: 1.2 },
        { id: 'btc', symbol: 'BTC', name: 'Bitcoin', amount: 0.025, fiatValue: 1612.5, changePct: 4.8 },
        { id: 'eth', symbol: 'ETH', name: 'Ethereum', amount: 0.42, fiatValue: 1180.4, changePct: -1.3 },
        { id: 'sol', symbol: 'SOL', name: 'Solana', amount: 1.5, fiatValue: 250, changePct: 8.1 },
      ]}
      txs={[
        { id: 't1', kind: 'receive', asset: 'CC', amount: 95, fiatValue: 95, counterparty: 'royalty cascade', timestamp: new Date(Date.now() - 3600_000).toISOString() },
        { id: 't2', kind: 'send', asset: 'CC', amount: 25, fiatValue: 25, counterparty: 'marketplace', timestamp: new Date(Date.now() - 7200_000).toISOString() },
        { id: 't3', kind: 'reward', asset: 'CC', amount: 50, fiatValue: 50, counterparty: 'world event', timestamp: new Date(Date.now() - 86400_000).toISOString() },
        { id: 't4', kind: 'swap', asset: 'BTC→ETH', amount: 0.005, fiatValue: 320, timestamp: new Date(Date.now() - 172800_000).toISOString() },
      ]}
    />
  );
}

function LegalPreview() {
  return (
    <div className="h-[520px]">
      <DocsShell
        tree={[
          { id: 'contracts', title: 'Contracts', kind: 'folder', emoji: '📁',
            children: [
              { id: 'msa', title: 'Master Service Agreement', kind: 'doc', emoji: '📄' },
              { id: 'sow', title: 'SOW — Q3 build', kind: 'doc', emoji: '📄' },
            ],
          },
          { id: 'policies', title: 'Policies', kind: 'folder', emoji: '📁',
            children: [
              { id: 'privacy', title: 'Privacy', kind: 'doc', emoji: '🔒' },
              { id: 'tos', title: 'Terms of Service', kind: 'doc', emoji: '📜' },
            ],
          },
        ]}
        activeDocId="msa"
        title="Master Service Agreement"
        outline={[
          { id: 'h1', level: 1, text: '1. Definitions' },
          { id: 'h2', level: 1, text: '2. Scope of Work' },
          { id: 'h3', level: 2, text: '2.1 Deliverables' },
          { id: 'h4', level: 2, text: '2.2 Timeline' },
          { id: 'h5', level: 1, text: '3. Royalties (95/5)' },
          { id: 'h6', level: 1, text: '4. Termination' },
        ]}
        comments={[
          { id: 'c1', author: 'Counsel', body: 'Confirm royalty cascade depth in §3.', timestamp: new Date(Date.now() - 3600_000).toISOString() },
        ]}
      >
        <p>This Master Service Agreement (the &quot;<strong>Agreement</strong>&quot;) is entered into…</p>
        <h2>1. Definitions</h2>
        <p>For purposes of this Agreement, the terms below shall mean…</p>
        <h2>2. Scope of Work</h2>
        <p>The Provider shall deliver…</p>
      </DocsShell>
    </div>
  );
}

function MessagePreview() {
  return (
    <div className="h-[520px]">
      <InboxShell
        labels={[
          { id: 'inbox', label: 'Inbox', count: 24, icon: 'inbox' },
          { id: 'starred', label: 'Starred', count: 3, icon: 'starred' },
          { id: 'snoozed', label: 'Snoozed', count: 1, icon: 'snoozed' },
          { id: 'sent', label: 'Sent', icon: 'sent' },
          { id: 'archive', label: 'Archive', icon: 'archive' },
          { id: 'trash', label: 'Trash', icon: 'trash' },
        ]}
        activeLabelId="inbox"
        threads={[
          { id: 't1', from: 'Aria Voss', subject: 'Royalty cascade — gen 3 hit', snippet: 'Your fighting style "Stance Against the Cold" earned 12 CC from a 3rd-gen derivative…', timestamp: new Date().toISOString(), unread: true, labels: ['royalty'] },
          { id: 't2', from: 'Concord', subject: 'Initiative: morning context', snippet: 'You logged off after authoring 2 NPCs. Want me to draft an arc that ties them together?', timestamp: new Date(Date.now() - 7200_000).toISOString(), starred: true, labels: ['concord'] },
          { id: 't3', from: 'Mira', subject: 'Twilight Commune — co-author?', snippet: 'I love what you started. Want to take it from gen 2?', timestamp: new Date(Date.now() - 86400_000).toISOString(), labels: ['collab'] },
          { id: 't4', from: 'Marketplace', subject: 'Dome-Buckler Stance sold (50 CC)', snippet: 'Vex purchased your style. 95% to you, royalty cascade armed.', timestamp: new Date(Date.now() - 172800_000).toISOString(), hasAttachment: true },
        ]}
        activeThreadId="t1"
      >
        <header className="mb-4">
          <h1 className="text-xl font-semibold">Royalty cascade — gen 3 hit</h1>
          <div className="text-sm text-gray-500 mt-1">From Aria Voss · just now</div>
        </header>
        <p>Your fighting style <em>Stance Against the Cold</em> just earned 12 CC from a third-generation derivative. The cascade is working.</p>
        <p>Original creator share: <strong>12 CC</strong> (5.25% rate at gen 3, halving from 21% × 2³).</p>
      </InboxShell>
    </div>
  );
}

function WhiteboardPreview() {
  return (
    <div className="h-[480px] relative">
      <WhiteboardCanvas
        initialShapes={[
          { id: 'r1', kind: 'rect', x: 100, y: 80, w: 160, h: 90, color: '#7dd3fc' },
          { id: 's1', kind: 'sticky', x: 320, y: 60, w: 140, h: 80, text: 'Cook → Eat → Fight → Commune', color: '#fef08a' },
          { id: 's2', kind: 'sticky', x: 100, y: 220, w: 140, h: 80, text: 'Royalty cascades forever', color: '#bbf7d0' },
        ]}
      />
    </div>
  );
}

function HealthcarePreview() {
  return (
    <div className="h-[600px]">
      <EHRShell
        patient={{
          id: 'pt1', name: 'Concord Test Patient', age: 34, sex: 'F', mrn: 'MRN-0042',
          allergies: ['Penicillin'],
          alerts: ['Active fall risk'],
          pcp: 'Dr. Sael',
          insurance: 'Concord Cooperative Health',
        }}
        vitals={{ bp: '118/76', hr: 72, tempF: 98.4, spo2: 98, resp: 16, takenAt: new Date().toISOString() }}
        encounters={[
          { id: 'e1', date: new Date().toISOString(), reason: 'Annual physical', provider: 'Dr. Sael' },
          { id: 'e2', date: new Date(Date.now() - 30 * 86400_000).toISOString(), reason: 'Follow-up: knee', provider: 'Dr. Orin' },
          { id: 'e3', date: new Date(Date.now() - 90 * 86400_000).toISOString(), reason: 'Initial consult', provider: 'Dr. Sael' },
        ]}
        activeEncounterId="e1"
      >
        <h2 className="text-lg font-semibold mb-3">Annual physical · today</h2>
        <p className="text-sm">No acute concerns. Vitals stable. Continue current regimen. Re-eval in 12 months.</p>
        <h3 className="text-sm font-semibold mt-4 mb-2">Active medications</h3>
        <ul className="text-sm space-y-1">
          <li>· Lisinopril 10mg PO daily</li>
          <li>· Vitamin D3 2000 IU PO daily</li>
        </ul>
      </EHRShell>
    </div>
  );
}

function FinancePreview() {
  const today = Date.now();
  const sparkData = Array.from({ length: 60 }, (_, i) => 100000 + Math.sin(i * 0.15) * 4000 + Math.cos(i * 0.07) * 2500 + i * 200);
  return (
    <FinanceShell
      netWorth={142850.32}
      netWorthDelta={2483.12}
      netWorthDeltaPct={1.77}
      range="1M"
      sparkline={sparkData}
      buyingPower={18420}
      budgetUsedPct={62}
      holdings={[
        { id: 'vti', symbol: 'VTI', name: 'Vanguard Total Stock', kind: 'etf', shares: 245, price: 248.32, value: 60838, changePct: 1.42, sparkline: [240, 242, 241, 244, 246, 245, 248] },
        { id: 'vxus', symbol: 'VXUS', name: 'Vanguard Total Intl', kind: 'etf', shares: 180, price: 62.18, value: 11192, changePct: -0.32, sparkline: [63, 62.8, 62.5, 62.1, 62.3, 62.0, 62.18] },
        { id: 'aapl', symbol: 'AAPL', name: 'Apple Inc', kind: 'stock', shares: 50, price: 218.42, value: 10921, changePct: 2.18, sparkline: [210, 212, 215, 213, 216, 217, 218.42] },
        { id: 'cc', symbol: 'CC', name: 'Concord Coin', kind: 'cc', shares: 12480, price: 1.04, value: 12979, changePct: 4.62, sparkline: [0.95, 0.98, 0.99, 1.01, 1.0, 1.03, 1.04] },
        { id: 'btc', symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', shares: 0.18, price: 87420, value: 15736, changePct: -1.84, sparkline: [89000, 88500, 88200, 87900, 87800, 87600, 87420] },
      ]}
      watchlist={[
        { id: 'nvda', symbol: 'NVDA', name: 'NVIDIA', price: 142.18, changePct: 3.42 },
        { id: 'msft', symbol: 'MSFT', name: 'Microsoft', price: 422.50, changePct: 0.84 },
        { id: 'tsla', symbol: 'TSLA', name: 'Tesla', price: 218.32, changePct: -2.14 },
        { id: 'spy', symbol: 'SPY', name: 'S&P 500', price: 582.12, changePct: 0.62 },
      ]}
      activity={[
        { id: 'a1', kind: 'royalty', label: 'DTU cascade gen 3', amount: 24.50, asset: 'CC', timestamp: new Date(today - 3600_000).toISOString() },
        { id: 'a2', kind: 'buy', label: 'DCA monthly', amount: 500, asset: 'VTI', timestamp: new Date(today - 86400_000).toISOString() },
        { id: 'a3', kind: 'dividend', label: 'Quarterly distribution', amount: 142.18, asset: 'SCHD', timestamp: new Date(today - 172800_000).toISOString() },
        { id: 'a4', kind: 'deposit', label: 'Payroll', amount: 4250, timestamp: new Date(today - 259200_000).toISOString() },
        { id: 'a5', kind: 'sell', label: 'Tax-loss harvest', amount: 1840, asset: 'META', timestamp: new Date(today - 432000_000).toISOString() },
      ]}
    />
  );
}

function RealEstatePreview() {
  const [q, setQ] = React.useState('3 bed condo under $750k in Austin');
  const today = Date.now();
  return (
    <RealtorShell
      query={q}
      onQueryChange={setQ}
      filterChips={['3+ bed', 'Condo', '< $750K', 'Austin', 'Pool', 'Garage']}
      totalCount={148}
      medianPrice={612000}
      favouriteCount={7}
      upcomingTourCount={2}
      listings={[
        { id: 'l1', address: '2401 East 6th St #12', city: 'Austin', state: 'TX', zip: '78702', price: 545000, beds: 2, baths: 2, sqft: 1240, status: 'for_sale', daysOnMarket: 3, hotScore: 82, favourited: true },
        { id: 'l2', address: '4112 Bull Creek Rd', city: 'Austin', state: 'TX', zip: '78731', price: 725000, beds: 3, baths: 2, sqft: 1820, status: 'for_sale', daysOnMarket: 12, hotScore: 58 },
        { id: 'l3', address: '8201 Mesa Dr', city: 'Austin', state: 'TX', zip: '78759', price: 689000, beds: 3, baths: 2, sqft: 1560, status: 'pending', daysOnMarket: 28, hotScore: 45 },
        { id: 'l4', address: '6815 Burnet Ln', city: 'Austin', state: 'TX', zip: '78757', price: 612000, beds: 3, baths: 2, sqft: 1480, status: 'for_sale', daysOnMarket: 5, hotScore: 71, favourited: true },
        { id: 'l5', address: '1100 South Lamar #205', city: 'Austin', state: 'TX', zip: '78704', price: 489000, beds: 1, baths: 1, sqft: 820, status: 'for_sale', daysOnMarket: 1, hotScore: 88 },
      ]}
      activity={[
        { id: 'a1', kind: 'price_drop', label: '4112 Bull Creek dropped $15K', timestamp: new Date(today - 3600_000).toISOString() },
        { id: 'a2', kind: 'tour', label: 'Tour confirmed for 2401 East 6th St', timestamp: new Date(today - 7200_000).toISOString() },
        { id: 'a3', kind: 'favourite', label: 'Saved 6815 Burnet Ln', timestamp: new Date(today - 86400_000).toISOString() },
        { id: 'a4', kind: 'message', label: 'Agent Jane Doe replied to your inquiry', timestamp: new Date(today - 172800_000).toISOString() },
        { id: 'a5', kind: 'open_house', label: 'Open house this Saturday · 8201 Mesa Dr', timestamp: new Date(today - 259200_000).toISOString() },
      ]}
    />
  );
}

function RetailPreview() {
  const [nav, setNav] = React.useState<React.ComponentProps<typeof ShopifyShell>['activeNav']>('home');
  const today = Date.now();
  return (
    <ShopifyShell
      activeNav={nav}
      onNavChange={setNav}
      storeName="Concord Coffee Co."
      revenueToday={2840.50}
      ordersToday={37}
      conversionRate={3.42}
      visitors={1842}
      revenue7dSeries={[1840, 2230, 1980, 2640, 2120, 3010, 2840]}
      recentOrders={[
        { id: 'o1', number: 'ORD-01042', customer: 'Aria Voss', total: 124.50, status: 'paid', itemCount: 3, timestamp: new Date(today - 600_000).toISOString() },
        { id: 'o2', number: 'ORD-01041', customer: 'Mira Solé', total: 89.00, status: 'fulfilled', itemCount: 2, timestamp: new Date(today - 3600_000).toISOString() },
        { id: 'o3', number: 'ORD-01040', customer: 'Vex Quinn', total: 312.40, status: 'paid', itemCount: 7, timestamp: new Date(today - 7200_000).toISOString() },
        { id: 'o4', number: 'ORD-01039', customer: 'Guest', total: 42.80, status: 'pending', itemCount: 1, timestamp: new Date(today - 14400_000).toISOString() },
        { id: 'o5', number: 'ORD-01038', customer: 'Dr Sael', total: 198.25, status: 'fulfilled', itemCount: 4, timestamp: new Date(today - 28800_000).toISOString() },
        { id: 'o6', number: 'ORD-01037', customer: 'Orin Kade', total: 76.00, status: 'refunded', itemCount: 2, timestamp: new Date(today - 43200_000).toISOString() },
      ]}
    />
  );
}

function EducationPreview() {
  return (
    <ClassroomShell
      streak={12}
      energyPoints={42850}
      level={7}
      pointsToday={185}
      dailyGoalPoints={300}
      proficientSkills={34}
      totalSkills={89}
      certificates={4}
      enrolledCourses={[
        { id: 'c1', title: 'Linear Algebra: From Vectors to Tensors', instructor: 'Dr Sael · Concord U', progressPct: 62, totalLessons: 24, completedLessons: 15, category: 'math' },
        { id: 'c2', title: 'Intro to Machine Learning', instructor: 'Andrew Ng · Coursera', progressPct: 28, totalLessons: 18, completedLessons: 5, category: 'data' },
        { id: 'c3', title: 'Writing Compelling Fiction', instructor: 'Mira Solé', progressPct: 88, totalLessons: 12, completedLessons: 11, category: 'humanities' },
      ]}
      recommendedCourses={[
        { id: 'r1', title: 'Statistics for Data Science', instructor: 'Dr Orin · MIT OCW', progressPct: 0, totalLessons: 32, completedLessons: 0, category: 'data' },
        { id: 'r2', title: 'Calculus Foundations', instructor: 'Khan Academy', progressPct: 0, totalLessons: 48, completedLessons: 0, category: 'math' },
      ]}
    />
  );
}

function TradesPreview() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <DispatchShell
      date={today}
      jobsToday={11}
      techsTotal={6}
      techsOnJob={4}
      revenueToday={4280}
      avgRating={4.7}
      rows={[
        { tech: { id: 't1', name: 'Mike Plumber', status: 'on_site' }, jobs: [
          { id: 'j1', customerName: 'Aria V.', description: 'Leak repair', hour: 9, status: 'on_site', priority: 'high' },
          { id: 'j2', customerName: 'Concord Cafe', description: 'Drain clear', hour: 13, status: 'dispatched', priority: 'normal' },
        ]},
        { tech: { id: 't2', name: 'Sam Electrician', status: 'on_route' }, jobs: [
          { id: 'j3', customerName: 'Vex Quinn', description: 'Panel upgrade', hour: 10, status: 'dispatched', priority: 'normal' },
          { id: 'j4', customerName: 'Mira S.', description: 'EV charger', hour: 14, status: 'unassigned', priority: 'low' },
        ]},
        { tech: { id: 't3', name: 'Jane HVAC', status: 'available' }, jobs: [
          { id: 'j5', customerName: 'Orin K.', description: 'AC service', hour: 11, status: 'dispatched', priority: 'high' },
        ]},
        { tech: { id: 't4', name: 'Carl Roofer', status: 'on_site' }, jobs: [
          { id: 'j6', customerName: 'Dr Sael', description: 'Storm damage', hour: 8, status: 'on_site', priority: 'emergency' },
          { id: 'j7', customerName: 'Acme Corp', description: 'Inspection', hour: 15, status: 'dispatched', priority: 'normal' },
        ]},
        { tech: { id: 't5', name: 'Pat Painter', status: 'break' }, jobs: [] },
        { tech: { id: 't6', name: 'Sky Glazier', status: 'off' }, jobs: [] },
      ]}
      unassigned={[
        { id: 'u1', customerName: 'Walk-in client', description: 'Quote request', hour: 16, status: 'unassigned', priority: 'low' },
        { id: 'u2', customerName: 'Returning cust', description: 'Yearly service', hour: 17, status: 'unassigned', priority: 'normal' },
      ]}
      pendingBookings={[
        { id: 'b1', customerName: 'Sara M.', serviceType: 'Plumbing', preferredDate: '2026-05-20' },
        { id: 'b2', customerName: 'Joe T.', serviceType: 'HVAC tune-up', preferredDate: null },
      ]}
      pendingQuotes={[
        { id: 'q1', title: 'Bathroom remodel', total: 8400, status: 'sent' },
        { id: 'q2', title: 'Roof repair', total: 2150, status: 'sent' },
        { id: 'q3', title: 'Panel upgrade', total: 3600, status: 'sent' },
      ]}
    />
  );
}

function LogisticsPreview() {
  return (
    <TmsShell
      totalShipments={142}
      inTransit={38}
      onTimePct={96}
      exceptions={3}
      deliveredToday={24}
      shipments={[
        { id: 's1', trackingNumber: '1ZAB12345678', origin: 'Austin, TX', destination: 'Boston, MA', mode: 'parcel', carrierCode: 'FDX', status: 'in_transit', estimatedDelivery: null },
        { id: 's2', trackingNumber: '1ZCD23456789', origin: 'Dallas, TX', destination: 'Atlanta, GA', mode: 'ftl', carrierCode: 'KNX', status: 'out_for_delivery', estimatedDelivery: null },
        { id: 's3', trackingNumber: '1ZEF34567890', origin: 'LA, CA', destination: 'Phoenix, AZ', mode: 'ltl', carrierCode: 'XPO', status: 'in_transit', estimatedDelivery: null },
        { id: 's4', trackingNumber: '1ZGH45678901', origin: 'Shanghai', destination: 'Long Beach, CA', mode: 'ocean', carrierCode: 'MSC', status: 'in_transit', estimatedDelivery: null },
        { id: 's5', trackingNumber: '1ZIJ56789012', origin: 'Chicago, IL', destination: 'Denver, CO', mode: 'parcel', carrierCode: 'UPS', status: 'delivered', estimatedDelivery: null },
        { id: 's6', trackingNumber: '1ZKL67890123', origin: 'Memphis, TN', destination: 'Seattle, WA', mode: 'air', carrierCode: 'FDX', status: 'exception', estimatedDelivery: null },
      ]}
      vehicles={[
        { id: 'v1', number: 'T-101', status: 'in_use', kind: 'tractor' },
        { id: 'v2', number: 'T-102', status: 'available', kind: 'box_truck' },
        { id: 'v3', number: 'T-103', status: 'in_use', kind: 'tractor' },
        { id: 'v4', number: 'V-201', status: 'maintenance', kind: 'van' },
        { id: 'v5', number: 'TR-301', status: 'in_use', kind: 'trailer' },
      ]}
      appointments={[
        { id: 'a1', dockName: 'Dock 3', date: new Date().toISOString().slice(0, 10), startTime: '08:00', truckNumber: 'T-101', kind: 'delivery', status: 'scheduled' },
        { id: 'a2', dockName: 'Dock 5', date: new Date().toISOString().slice(0, 10), startTime: '10:30', truckNumber: 'T-103', kind: 'pickup', status: 'scheduled' },
        { id: 'a3', dockName: 'Dock 1', date: new Date().toISOString().slice(0, 10), startTime: '13:15', truckNumber: 'KNX-44', kind: 'delivery', status: 'scheduled' },
        { id: 'a4', dockName: 'Dock 7', date: new Date().toISOString().slice(0, 10), startTime: '15:00', truckNumber: 'XPO-12', kind: 'pickup', status: 'scheduled' },
      ]}
    />
  );
}

function AgriculturePreview() {
  return (
    <AgFarmShell
      totalFields={12}
      totalAcres={1840}
      equipmentCount={8}
      equipmentWorking={5}
      seasonYieldBushels={284000}
      avgYieldPerAcre={205}
      grainStored={142000}
      grainCapacity={200000}
      grainUtilizationPct={71}
      fields={[
        { id: 'f1', name: 'North 80', acreage: 80, currentCrop: 'corn' },
        { id: 'f2', name: 'South 120', acreage: 120, currentCrop: 'soybeans' },
        { id: 'f3', name: 'River Bend', acreage: 200, currentCrop: 'corn' },
        { id: 'f4', name: 'Hilltop', acreage: 160, currentCrop: 'wheat' },
        { id: 'f5', name: 'Bottom 40', acreage: 40, currentCrop: 'alfalfa' },
        { id: 'f6', name: 'West Quarter', acreage: 160, currentCrop: 'corn' },
      ]}
      equipment={[
        { id: 'e1', name: '8R 410', kind: 'tractor', status: 'working', fuelLevelPct: 78 },
        { id: 'e2', name: 'S7 800', kind: 'combine', status: 'working', fuelLevelPct: 92 },
        { id: 'e3', name: 'DB60 planter', kind: 'planter', status: 'idle', fuelLevelPct: 100 },
        { id: 'e4', name: 'R4060 sprayer', kind: 'sprayer', status: 'working', fuelLevelPct: 64 },
        { id: 'e5', name: '8R 310', kind: 'tractor', status: 'working', fuelLevelPct: 18 },
        { id: 'e6', name: 'DJI Agras', kind: 'drone', status: 'idle', fuelLevelPct: 100 },
      ]}
      workOrders={[
        { id: 'w1', operation: 'Apply UAN-32 sidedress', kind: 'fertilize', status: 'scheduled', scheduledFor: new Date().toISOString().slice(0, 10) },
        { id: 'w2', operation: 'Scout for tar spot', kind: 'scouting', status: 'scheduled', scheduledFor: new Date().toISOString().slice(0, 10) },
        { id: 'w3', operation: 'Harvest South 120 beans', kind: 'harvest', status: 'completed', scheduledFor: null },
        { id: 'w4', operation: 'Tank-mix burndown', kind: 'spraying', status: 'scheduled', scheduledFor: null },
      ]}
    />
  );
}

export default RivalShapePreview;
