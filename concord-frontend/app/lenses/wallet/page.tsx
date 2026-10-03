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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = TABS.find((t) => t.id === active)!;
  const titles: Record<WalletView, string> = {
    home: `Your wallet${who ? `, ${who}` : ''}`,
    activity: 'Where your coin went',
    pay: 'Pay someone',
    cashout: 'Cash out your earnings',
    tools: 'Wallet tools',
  };

  return (
    <MotionConfig reducedMotion="user">
      <NorthStarFrame
        lensId="wallet"
        crumb="Wallet"
        title={titles[current.id]}
        subtitle="Concord Coin balance, ledger, peer payments and cash-out"
        actions={
          <>
            <WalletBadge />
            <WalletWidget compact />
          </>
        }
        tabs={TABS}
        activeTab={active}
        onTab={(id) => setActive(id as WalletView)}
        tabsLabel="Wallet views"
        cta={{ label: 'Pay someone', icon: Send, onClick: () => setActive('pay'), title: 'Send Concord Coin (S)' }}
      >
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
      </NorthStarFrame>
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
          <div className="px-8 pt-6">
            <p className="text-[14px] text-zinc-500">Wallet</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Your wallet</h1>
            <div className="h-48 animate-pulse rounded-2xl border border-white/10 bg-[#111]" />
          </div>
        }
      >
        <WalletPageInner />
      </Suspense>
    </LensShell>
  );
}
