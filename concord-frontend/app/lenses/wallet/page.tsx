'use client';

/**
 * Wallet — Cash App home for Concord Coin.
 * One view union: home / activity / pay / cashout / tools.
 * Ledger + Stripe live on /api/economy/*; P2P macros live in WalletParityHub.
 */

import { Suspense, useState, type ComponentType } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import {
  ArrowDownToLine,
  BarChart3,
  History,
  Send,
  Wallet,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WalletBadge } from '@/components/economy/WalletBadge';
import { WalletWidget } from '@/components/wallet/WalletWidget';
import { WalletHomePanel } from '@/components/wallet/WalletHomePanel';
import { WalletActivityPanel } from '@/components/wallet/WalletActivityPanel';
import { WalletPayPanel } from '@/components/wallet/WalletPayPanel';
import { WalletCashOutPanel } from '@/components/wallet/WalletCashOutPanel';
import { WalletToolsPanel } from '@/components/wallet/WalletToolsPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import type { WalletPanelProps, WalletView } from '@/components/wallet/wallet-model';

const TABS: { id: WalletView; label: string; keys: string; icon: typeof Wallet }[] = [
  { id: 'home', label: 'Home', keys: '1', icon: Wallet },
  { id: 'activity', label: 'Activity', keys: '2', icon: History },
  { id: 'pay', label: 'Pay', keys: '3', icon: Send },
  { id: 'cashout', label: 'Cash Out', keys: '4', icon: ArrowDownToLine },
  { id: 'tools', label: 'Tools', keys: '5', icon: BarChart3 },
];

const PANELS: Record<WalletView, ComponentType<WalletPanelProps>> = {
  home: WalletHomePanel,
  activity: WalletActivityPanel,
  pay: WalletPayPanel,
  cashout: WalletCashOutPanel,
  tools: WalletToolsPanel,
};

function WalletPageInner() {
  useLensNav('wallet');
  useLensIdentity('wallet');
  const [active, setActive] = useState<WalletView>('home');

  useLensCommand(
    [
      { id: 'wallet-home', keys: '1', description: 'Home', category: 'navigation', action: () => setActive('home') },
      { id: 'wallet-activity', keys: '2', description: 'Activity', category: 'navigation', action: () => setActive('activity') },
      { id: 'wallet-pay', keys: '3', description: 'Pay', category: 'navigation', action: () => setActive('pay') },
      { id: 'wallet-cashout', keys: '4', description: 'Cash Out', category: 'navigation', action: () => setActive('cashout') },
      { id: 'wallet-tools', keys: '5', description: 'Tools', category: 'navigation', action: () => setActive('tools') },
      { id: 'wallet-buy', keys: 'b', description: 'Add cash', category: 'actions', action: () => setActive('home'), global: true },
      { id: 'wallet-send', keys: 's', description: 'Pay', category: 'actions', action: () => setActive('pay'), global: true },
      { id: 'wallet-withdraw', keys: 'w', description: 'Cash Out', category: 'actions', action: () => setActive('cashout'), global: true },
      { id: 'wallet-search-tx', keys: '/', description: 'Search activity', category: 'navigation', action: () => setActive('activity') },
    ],
    { lensId: 'wallet' },
  );

  const Panel = PANELS[active];

  return (
    <MotionConfig reducedMotion="user">
      <div data-lens-theme="wallet" className={cn(ds.pageContainer, 'max-w-3xl mx-auto')}>
        <header className="flex items-center gap-3 mb-4">
          <Wallet className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
          <h1 className={ds.heading1}>Wallet</h1>
          <WalletBadge />
          <WalletWidget compact className="ml-auto" />
        </header>

        <nav
          className="flex gap-1 border-b border-lattice-border mb-5 overflow-x-auto"
          role="tablist"
          aria-label="Wallet views"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                  on
                    ? 'text-[var(--lens-accent)] border-[var(--lens-accent)]'
                    : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <kbd className="hidden sm:inline text-[10px] font-mono text-gray-500">{tab.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <Panel onNavigate={setActive} />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="wallet" sinceDays={7} limit={6} hideWhenEmpty className="mt-4" />
      </div>
    </MotionConfig>
  );
}

export default function WalletPage() {
  return (
    <LensShell lensId="wallet" asMain={false}>
      <FirstRunTour lensId="wallet" />
      <DepthBadge lensId="wallet" size="sm" className="ml-2" />
      <Suspense
        fallback={
          <div className={cn(ds.pageContainer, 'max-w-3xl mx-auto')}>
            <div className="flex items-center gap-3 mb-6">
              <Wallet className="w-6 h-6 text-gray-400" />
              <h1 className={ds.heading1}>Wallet</h1>
            </div>
            <div className="h-48 bg-lattice-surface border border-lattice-border rounded-2xl animate-pulse" />
          </div>
        }
      >
        <WalletPageInner />
      </Suspense>
    </LensShell>
  );
}
