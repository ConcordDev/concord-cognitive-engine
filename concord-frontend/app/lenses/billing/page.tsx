'use client';

/**
 * Billing: north-star chrome over the real billing workbench (balance,
 * transactions, plans, subscriptions, platform economy).
 */

import { useState } from 'react';
import { BarChart3, History, CreditCard, Layers, Landmark } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { BillingWorkbench, type BillingView } from '@/components/billing/BillingWorkbench';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';

const TABS: { id: BillingView; label: string; icon: typeof BarChart3; keys: string }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3, keys: 'g o' },
  { id: 'transactions', label: 'Transactions', icon: History, keys: 'g t' },
  { id: 'subscriptions', label: 'Plans', icon: CreditCard, keys: 'g s' },
  { id: 'billing', label: 'Subscriptions', icon: Layers, keys: 'g b' },
  { id: 'economy', label: 'Economy', icon: Landmark, keys: 'g e' },
];

export default function BillingPage() {
  useLensNav('billing');
  useLensIdentity('billing');
  // FIX-billing-014: the active tab persists through the shared lens
  // UI-state store — the view used to live in a bare useState, so any
  // remount dropped the user back to Overview mid-work.
  const { restore, persist } = useLensStatePersistence('billing');
  const [initialView] = useState<BillingView>(() => {
    const saved = restore()?.view;
    return TABS.some((t) => t.id === saved) ? (saved as BillingView) : 'overview';
  });
  const [view, setViewState] = useState<BillingView>(initialView);
  const setView = (v: BillingView) => {
    setViewState(v);
    persist({ ...(restore() ?? {}), view: v });
  };

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `goto-${t.id}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => setView(t.id),
      })),
      { id: 'billing-plans', keys: 'n', description: 'Browse plans', category: 'actions' as const, action: () => setView('subscriptions') },
    ],
    { lensId: 'billing' },
  );


  return (
    <LensShell lensId="billing" asMain={false}>

      <DepthBadge lensId="billing" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="billing"
        crumb="Billing"
        subtitle="Concord Coin balance and the platform economy, from the real ledger. Plans and invoices are the billing records you keep."
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys }))}
        activeTab={view}
        onTab={(id) => setView(id as BillingView)}
        tabsLabel="Billing views"
        cta={{ label: 'Browse plans', icon: CreditCard, onClick: () => setView('subscriptions'), title: 'Browse plans (N)' }}
      >
        <BillingWorkbench tab={view} />
      </NorthStarFrame>
    </LensShell>
  );
}
