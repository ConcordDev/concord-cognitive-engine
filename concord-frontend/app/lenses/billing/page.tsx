'use client';

import { useState } from 'react';
import { BarChart3, History, CreditCard, Layers, Landmark } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { BillingWorkbench, type BillingView } from '@/components/billing/BillingWorkbench';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { cn } from '@/lib/utils';

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
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState<BillingView>('overview');

  useLensCommand(
    TABS.map((t) => ({
      id: `goto-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setView(t.id),
    })),
    { lensId: 'billing' },
  );

  return (
    <LensShell lensId="billing" asMain={false}>
      <FirstRunTour lensId="billing" />
      <div data-lens-theme="billing" className="p-6 max-w-6xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white">Billing</h1>
              <DepthBadge lensId="billing" size="sm" />
            </div>
            <p className="text-sm text-white/45 mt-0.5">
              Balance, invoices, plans, and platform economy — Stripe-shaped, real numbers.
            </p>
          </div>
        </header>

        <nav
          aria-label="Billing"
          className="flex gap-1 border-b border-lattice-border overflow-x-auto"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = view === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap',
                  active
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-gray-400 hover:text-white',
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                <kbd className="hidden md:inline font-mono text-[10px] text-white/30">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <BillingWorkbench tab={view} />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="billing" sinceDays={7} limit={6} hideWhenEmpty />
      </div>
    </LensShell>
  );
}
