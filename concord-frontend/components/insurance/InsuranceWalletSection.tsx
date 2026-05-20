'use client';

/**
 * InsuranceWalletSection — insurance policy-wallet 2026-shape workbench.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, FileText, ClipboardList, Archive, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { InsurancePoliciesPanel } from './InsurancePoliciesPanel';
import { InsuranceClaimsPanel } from './InsuranceClaimsPanel';
import { InsuranceVaultPanel } from './InsuranceVaultPanel';

interface Dash {
  activePolicies: number; totalPolicies: number; openClaims: number;
  annualPremium: number; renewalsDue: number; openReminders: number; coveredAssetValue: number;
}
type TabId = 'policies' | 'claims' | 'vault';
const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'policies', label: 'Policies', icon: FileText },
  { id: 'claims', label: 'Claims', icon: ClipboardList },
  { id: 'vault', label: 'Vault', icon: Archive },
];

export function InsuranceWalletSection() {
  const [tab, setTab] = useState<TabId>('policies');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('insurance', 'insurance-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-blue-600/15 to-transparent">
        <ShieldCheck className="w-5 h-5 text-blue-400" />
        <h2 className="text-sm font-bold text-zinc-100">Insurance Wallet</h2>
        <span className="text-[11px] text-zinc-500">Policies, claims, premiums &amp; coverage</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Policies" value={dash.activePolicies} />
          <Stat label="Open claims" value={dash.openClaims} alert={dash.openClaims > 0} />
          <Stat label="Annual premium" value={`$${dash.annualPremium}`} />
          <Stat label="Renewals due" value={dash.renewalsDue} alert={dash.renewalsDue > 0} />
          <Stat label="Reminders" value={dash.openReminders} />
          <Stat label="Assets" value={`$${dash.coveredAssetValue}`} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-blue-500',
                active ? 'bg-zinc-900 text-blue-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'policies' && <InsurancePoliciesPanel onChange={refreshDash} />}
        {tab === 'claims' && <InsuranceClaimsPanel onChange={refreshDash} />}
        {tab === 'vault' && <InsuranceVaultPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-base font-bold', alert ? 'text-amber-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
