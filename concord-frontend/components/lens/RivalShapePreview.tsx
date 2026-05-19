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

type SupportedLens = 'code' | 'crypto' | 'legal' | 'message' | 'whiteboard' | 'healthcare' | 'finance';

const RIVAL_LABELS: Record<SupportedLens, string> = {
  code: 'VS Code shape',
  crypto: 'Coinbase / Phantom shape',
  legal: 'Notion / Word shape',
  message: 'Gmail shape',
  whiteboard: 'tldraw / Miro shape',
  healthcare: 'Epic EHR shape',
  finance: 'Robinhood / Monarch shape',
};

export interface RivalShapePreviewProps {
  lensId: string;
  /** Default closed; pass true to expand on mount. */
  defaultOpen?: boolean;
  className?: string;
}

export function RivalShapePreview({ lensId, defaultOpen = false, className }: RivalShapePreviewProps) {
  const [open, setOpen] = useState(defaultOpen);
  const supported = (['code', 'crypto', 'legal', 'message', 'whiteboard', 'healthcare', 'finance'] as const).includes(lensId as SupportedLens);
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

export default RivalShapePreview;
