'use client';

/**
 * Billing: north-star chrome over the real billing workbench (balance,
 * transactions, plans, subscriptions, platform economy).
 */

import { useState } from 'react';
import { BarChart3, History, CreditCard, Layers, Landmark } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { BillingWorkbench, type BillingView } from '@/components/billing/BillingWorkbench';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

const TABS: { id: BillingView; label: string; title: string; icon: typeof BarChart3; keys: string }[] = [
  { id: 'overview', label: 'Overview', title: 'Where your money stands', icon: BarChart3, keys: 'g o' },
  { id: 'transactions', label: 'Transactions', title: 'Every charge and credit', icon: History, keys: 'g t' },
  { id: 'subscriptions', label: 'Plans', title: 'Pick the plan that fits', icon: CreditCard, keys: 'g s' },
  { id: 'billing', label: 'Subscriptions', title: 'What you are subscribed to', icon: Layers, keys: 'g b' },
  { id: 'economy', label: 'Economy', title: 'How the platform economy moves', icon: Landmark, keys: 'g e' },
];

export default function BillingPage() {
  useLensNav('billing');
  useLensIdentity('billing');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<BillingView>('overview');

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

  const current = TABS.find((t) => t.id === view)!;

  return (
    <LensShell lensId="billing" asMain={false}>
      <FirstRunTour lensId="billing" />
      <DepthBadge lensId="billing" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="billing"
        crumb="Billing"
        title={`${current.title}${view === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Balance, invoices, plans and the platform economy, from real ledger numbers."
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
