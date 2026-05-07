'use client';

import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { motion } from 'framer-motion';
import {
  Coins, Check, Zap, Crown,
  ArrowRight, Sparkles, ShieldCheck, TrendingUp,
  Download, BarChart3, Receipt, DollarSign,
  CreditCard, History, Wallet, ChevronDown, Layers,
  Loader2, XCircle, AlertTriangle,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenPackage {
  id: string;
  tokens: number;
  price: number;
  bonus: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balance_after?: number;
  description?: string;
  source?: string;
  created_at?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function BillingPage() {
  useLensNav('billing');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('billing');
  const queryClient = useQueryClient();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'subscriptions'>('overview');
  const [txFilter, setTxFilter] = useState<'all' | 'purchase' | 'usage' | 'credit'>('all');
  const [showFeatures, setShowFeatures] = useState(true);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  // ---- Backend action hooks ----
  const runAction = useRunArtifact('billing');
  const { items: billingItems } = useLensData<Record<string, unknown>>('billing', 'invoice', { seed: [] });

  const handleBillingAction = async (action: string) => {
    const targetId = billingItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  // ---- API Queries ----

  // Economy config
  const {
    data: config,
    isError: configError,
    error: configErrorObj,
    refetch: refetchConfig,
  } = useQuery({
    queryKey: ['economy-config'],
    queryFn: async () => {
      try {
        const r = await apiHelpers.economy.config();
        return r.data;
      } catch (err) {
        console.error('economy.config failed:', err);
        throw err;
      }
    },
    retry: 2,
    staleTime: 60000,
  });

  // Wallet balance
  const {
    data: wallet,
    isLoading: walletLoading,
    isError: walletError,
    error: walletErrorObj,
    refetch: refetchWallet,
  } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      try {
        const r = await apiHelpers.economy.balance();
        return r.data;
      } catch (err) {
        console.error('economy.balance failed:', err);
        throw err;
      }
    },
    retry: 2,
    staleTime: 15000,
  });

  // Transaction history
  const {
    data: historyData,
    isLoading: historyLoading,
  } = useQuery({
    queryKey: ['economy-history', txFilter],
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = { limit: 100 };
        if (txFilter !== 'all') params.type = txFilter;
        const r = await apiHelpers.economy.history(params as { type?: string; limit?: number });
        return r.data;
      } catch (err) {
        console.error('economy.history failed:', err);
        return { transactions: [] };
      }
    },
    staleTime: 15000,
  });

  // Purchase tokens
  const purchaseMutation = useMutation({
    mutationFn: async (packageId: string) => {
      const tokens = Number(packageId) || 100;
      const res = await apiHelpers.economy.createCheckout(tokens);
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      } else {
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        queryClient.invalidateQueries({ queryKey: ['economy-history'] });
      }
    },
    onError: (err) => {
      console.error('Purchase failed:', err instanceof Error ? err.message : err);
    },
  });

  // Subscribe
  const subscribeMutation = useMutation({
    mutationFn: async (tier: string) => {
      const amount = tier === 'pro' ? 1000 : tier === 'teams' ? 5000 : 100;
      const res = await apiHelpers.economy.buy({ amount, source: `subscription-${tier}` });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      } else {
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        queryClient.invalidateQueries({ queryKey: ['economy-config'] });
        queryClient.invalidateQueries({ queryKey: ['economy-history'] });
      }
    },
    onError: (err) => {
      console.error('Subscription failed:', err instanceof Error ? err.message : err);
    },
  });

  const tokenPackages: TokenPackage[] = config?.tokenPackages || [];
  const transactions: Transaction[] = useMemo(() => historyData?.transactions || [], [historyData]);

  // Usage data for the last 7 days (derived from transactions)
  const usageByDay = useMemo(() => {
    const days: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { weekday: 'short' });
      const spent = transactions
        .filter((t) => {
          const tDate = t.created_at ? t.created_at.slice(0, 10) : '';
          return tDate === key && (t.type === 'usage' || t.type === 'spend' || t.type === 'debit');
        })
        .reduce((s, t) => s + Math.abs(t.amount || 0), 0);
      days.push({ label, value: spent });
    }
    return days;
  }, [transactions]);

  const maxUsage = Math.max(...usageByDay.map((d) => d.value), 1);

  // Top consumers (group usage by source/description)
  const topConsumers = useMemo(() => {
    const map = new Map<string, number>();
    transactions
      .filter((t) => t.type === 'usage' || t.type === 'spend' || t.type === 'debit')
      .forEach((t) => {
        const key = t.source || t.description || 'Other';
        map.set(key, (map.get(key) || 0) + Math.abs(t.amount || 0));
      });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [transactions]);

  // CSV Export
  const handleExportCSV = useCallback(() => {
    const headers = ['Date', 'Type', 'Amount', 'Balance After', 'Description'];
    const rows = transactions.map((t) => [
      t.created_at || '',
      t.type || '',
      String(t.amount || 0),
      String(t.balance_after ?? ''),
      (t.description || t.source || '').replace(/,/g, ';'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `concord-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transactions]);

  // Error
  if (configError || walletError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={configErrorObj?.message || walletErrorObj?.message}
          onRetry={() => { refetchConfig(); refetchWallet(); }}
        />
      </div>
    );
  }

  return (
    <div data-lens-theme="billing" className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Billing & Tokens</h1>
          <p className="text-gray-400">Manage your subscription, tokens, and transaction history</p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="billing" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { icon: Coins, color: 'bg-neon-cyan/20', iconColor: 'text-neon-cyan', label: 'Token Balance', value: walletLoading ? '...' : `${(wallet?.balance || 0).toLocaleString()} CT` },
          { icon: Crown, color: 'bg-neon-purple/20', iconColor: 'text-neon-purple', label: 'Current Tier', value: walletLoading ? '...' : (wallet?.tier || 'free'), capitalize: true },
          { icon: Zap, color: 'bg-neon-green/20', iconColor: 'text-neon-green', label: 'Daily Ingest', value: walletLoading ? '...' : (wallet?.ingestStatus?.limit === -1 ? 'Unlimited' : `${wallet?.ingestStatus?.remaining || 0}/${wallet?.ingestStatus?.limit || 10}`) },
          { icon: Receipt, color: 'bg-amber-500/20', iconColor: 'text-amber-400', label: 'Transactions', value: `${transactions.length}` },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="bg-lattice-surface border border-lattice-border rounded-xl p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center`}>
                <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
              </div>
              <div>
                <p className="text-sm text-gray-400">{stat.label}</p>
                <p className={`text-2xl font-bold text-white ${stat.capitalize ? 'capitalize' : ''}`}>{stat.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Invoice Status Badges Overview */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-neon-cyan" /> Transaction Breakdown</h3>
        <div className="flex flex-wrap gap-3">
          {(() => {
            const typeMap = new Map<string, number>();
            transactions.forEach(t => typeMap.set(t.type || 'other', (typeMap.get(t.type || 'other') || 0) + 1));
            const badgeColors: Record<string, string> = { purchase: 'bg-green-500/20 text-green-400', credit: 'bg-cyan-500/20 text-cyan-400', usage: 'bg-pink-500/20 text-pink-400', spend: 'bg-pink-500/20 text-pink-400', debit: 'bg-red-500/20 text-red-400' };
            return Array.from(typeMap.entries()).map(([type, count]) => (
              <span key={type} className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${badgeColors[type] || 'bg-gray-500/20 text-gray-400'}`}>
                {type}: {count}
              </span>
            ));
          })()}
        </div>
      </motion.div>

      {/* Revenue Chart Placeholder */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-400" /> 7-Day Token Flow</h3>
        <div className="flex items-end justify-between gap-1 h-24">
          {usageByDay.map((day, i) => {
            const income = transactions.filter(t => {
              const tDate = t.created_at ? t.created_at.slice(0, 10) : '';
              const d = new Date(); d.setDate(d.getDate() - (6 - i));
              return tDate === d.toISOString().slice(0, 10) && (t.type === 'purchase' || t.type === 'credit');
            }).reduce((s, t) => s + Math.abs(t.amount || 0), 0);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full flex flex-col items-center gap-0.5" style={{ height: '80px' }}>
                  {income > 0 && <div className="w-full bg-green-500/60 rounded-t" style={{ height: `${Math.min(income / Math.max(maxUsage, 1) * 100, 100)}%`, minHeight: '4px' }} />}
                  {day.value > 0 && <div className="w-full bg-pink-500/60 rounded-t" style={{ height: `${Math.min(day.value / Math.max(maxUsage, 1) * 100, 100)}%`, minHeight: '4px' }} />}
                </div>
                <span className="text-[10px] text-gray-500">{day.label}</span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500/60" />Income</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pink-500/60" />Spending</span>
        </div>
      </motion.div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-lattice-border">
        {([
          { key: 'overview' as const, label: 'Usage Overview', icon: BarChart3 },
          { key: 'transactions' as const, label: 'Transactions', icon: History },
          { key: 'subscriptions' as const, label: 'Plans & Tokens', icon: CreditCard },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === key
                ? 'border-neon-cyan text-neon-cyan'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ============ USAGE OVERVIEW TAB ============ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Usage Chart - Last 7 Days */}
          <div className="panel p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-neon-cyan" />
              Token Usage - Last 7 Days
            </h3>
            <div className="flex items-end justify-between gap-2 h-40">
              {usageByDay.map((day, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{day.value > 0 ? day.value : ''}</span>
                  <div className="w-full bg-lattice-deep rounded-t flex items-end justify-center" style={{ height: '120px' }}>
                    <div
                      className="w-full bg-neon-cyan/60 rounded-t transition-all hover:bg-neon-cyan/80"
                      style={{ height: `${maxUsage > 0 ? (day.value / maxUsage) * 100 : 0}%`, minHeight: day.value > 0 ? '4px' : '0px' }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{day.label}</span>
                </div>
              ))}
            </div>
            {usageByDay.every((d) => d.value === 0) && (
              <p className="text-sm text-gray-500 text-center mt-4">No usage recorded in the last 7 days.</p>
            )}
          </div>

          {/* Top Consumers */}
          <div className="panel p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-neon-green" />
              Top Token Consumers
            </h3>
            {topConsumers.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No usage data available yet.</p>
            ) : (
              <div className="space-y-3">
                {topConsumers.map(([source, amount], i) => {
                  const pct = Math.round((amount / Math.max(topConsumers[0][1], 1)) * 100);
                  return (
                    <div key={source} className="flex items-center gap-3">
                      <span className="w-6 text-xs text-gray-500 text-right">{i + 1}.</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="capitalize">{source.replace(/[-_]/g, ' ')}</span>
                          <span className="text-gray-400">{amount} CT</span>
                        </div>
                        <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                          <div className="h-full bg-neon-green rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ TRANSACTIONS TAB ============ */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filter + Export bar */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {(['all', 'purchase', 'usage', 'credit'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setTxFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                    txFilter === f
                      ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                      : 'bg-lattice-surface text-gray-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const resp = await apiHelpers.economy.createTaxSummary({ year: new Date().getFullYear() });
                    alert(`Tax Summary DTU created: ${(resp.data as Record<string, unknown>)?.dtuId || 'success'}`);
                  } catch (e) { console.error('[Billing] Failed to create tax summary:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to create tax summary' }); }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                Tax Summary DTU
              </button>
              <button
                onClick={handleExportCSV}
                disabled={transactions.length === 0}
                className="btn-neon flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Transaction List */}
          <div className="panel">
            {historyLoading ? (
              <div className="p-8 text-center text-gray-400 animate-pulse">Loading transactions...</div>
            ) : transactions.length === 0 ? (
              <div className="p-8 text-center">
                <Wallet className="w-8 h-8 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No transactions found.</p>
              </div>
            ) : (
              <div className="divide-y divide-lattice-border">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs text-gray-500 font-medium uppercase">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2 text-right">Amount</div>
                  <div className="col-span-2 text-right">Balance</div>
                  <div className="col-span-3">Description</div>
                </div>
                {transactions.map((tx) => {
                  const isPositive = tx.amount > 0;
                  const typeColors: Record<string, string> = {
                    purchase: 'bg-neon-green/20 text-neon-green',
                    credit: 'bg-neon-cyan/20 text-neon-cyan',
                    usage: 'bg-neon-pink/20 text-neon-pink',
                    spend: 'bg-neon-pink/20 text-neon-pink',
                    debit: 'bg-neon-pink/20 text-neon-pink',
                    transfer: 'bg-neon-purple/20 text-neon-purple',
                  };
                  return (
                    <div key={tx.id} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm hover:bg-lattice-elevated/50 transition-colors">
                      <div className="col-span-3 text-gray-400">
                        {tx.created_at
                          ? new Date(tx.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '-'}
                      </div>
                      <div className="col-span-2">
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${typeColors[tx.type] || 'bg-gray-500/20 text-gray-400'}`}>
                          {tx.type}
                        </span>
                      </div>
                      <div className={`col-span-2 text-right font-medium ${isPositive ? 'text-neon-green' : 'text-neon-pink'}`}>
                        {isPositive ? '+' : ''}{tx.amount} CT
                      </div>
                      <div className="col-span-2 text-right text-gray-400">
                        {tx.balance_after != null ? `${tx.balance_after} CT` : '-'}
                      </div>
                      <div className="col-span-3 text-gray-500 truncate">
                        {tx.description || tx.source || '-'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ SUBSCRIPTIONS & TOKENS TAB ============ */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-8">
          {/* Subscription Tiers */}
          <div>
            <h2 className="text-xl font-semibold text-white mb-4">Subscription Plans</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Free Tier */}
              <TierCard
                name="Free"
                price={0}
                features={[
                  'All 62 lenses',
                  'Unlimited DTUs',
                  'Marketplace access',
                  '10 pages/day ingest',
                  '100 tokens/month',
                ]}
                current={wallet?.tier === 'free'}
                onSelect={() => subscribeMutation.mutate('free')}
                disabled={wallet?.tier === 'free'}
              />

              {/* Pro Tier */}
              <TierCard
                name="Pro"
                price={12}
                features={[
                  'Everything in Free',
                  'Unlimited ingest',
                  'Cloud sync',
                  'Priority support',
                  '2,000 tokens/month',
                ]}
                current={wallet?.tier === 'pro'}
                popular={true}
                onSelect={() => subscribeMutation.mutate('pro')}
                loading={subscribeMutation.isPending}
                disabled={!config?.stripeEnabled}
              />

              {/* Teams Tier */}
              <TierCard
                name="Teams"
                price={29}
                priceNote="/seat"
                features={[
                  'Everything in Pro',
                  'Team collaboration',
                  'Shared vaults',
                  'Analytics dashboard',
                  '5,000 tokens/month',
                ]}
                current={wallet?.tier === 'teams'}
                onSelect={() => subscribeMutation.mutate('teams')}
                loading={subscribeMutation.isPending}
                disabled={!config?.stripeEnabled}
              />
            </div>
          </div>

          {/* Token Packages */}
          <div>
            <h2 className="text-xl font-semibold text-white mb-2">Buy Tokens</h2>
            <p className="text-gray-400 text-sm mb-4">
              Concord Tokens (CT) are used for marketplace purchases and premium features.
              <span className="text-neon-cyan"> 1.46% fee</span> supports platform development.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {tokenPackages.map((pkg: TokenPackage) => (
                <div
                  key={pkg.id}
                  className={`relative bg-lattice-surface border rounded-xl p-6 cursor-pointer transition-all ${
                    selectedPackage === pkg.id
                      ? 'border-neon-cyan shadow-lg shadow-neon-cyan/20'
                      : 'border-lattice-border hover:border-gray-600'
                  }`}
                  onClick={() => setSelectedPackage(pkg.id)}
                >
                  {pkg.bonus > 0 && (
                    <div className="absolute -top-2 -right-2 px-2 py-1 bg-neon-green text-white text-xs font-bold rounded-full">
                      +{Math.round(pkg.bonus * 100)}%
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-4">
                    <Coins className="w-8 h-8 text-neon-cyan" />
                    <div>
                      <p className="text-2xl font-bold text-white">{pkg.tokens.toLocaleString()}</p>
                      <p className="text-sm text-gray-400">tokens</p>
                    </div>
                  </div>

                  <p className="text-3xl font-bold text-white mb-4">
                    ${(pkg.price / 100).toFixed(2)}
                  </p>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      purchaseMutation.mutate(pkg.id);
                    }}
                    disabled={purchaseMutation.isPending || !config?.stripeEnabled}
                    className="w-full py-2 bg-neon-cyan/20 border border-neon-cyan/50 rounded-lg text-neon-cyan font-medium hover:bg-neon-cyan/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {purchaseMutation.isPending ? 'Processing...' : 'Buy Now'}
                  </button>
                </div>
              ))}
            </div>

            {!config?.stripeEnabled && (
              <p className="text-yellow-500 text-sm mt-4">
                Payment system is not configured. Contact support to enable purchases.
              </p>
            )}
          </div>

          {/* Economic Info */}
          <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-neon-green" />
              How the Economy Works
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div>
                <h3 className="font-semibold text-white mb-2">Marketplace Fees</h3>
                <ul className="space-y-1 text-gray-400">
                  <li>* 4% marketplace fee on sales</li>
                  <li>* 70% goes to the creator</li>
                  <li>* 20% goes to referenced DTUs (royalties)</li>
                  <li>* 10% goes to Concord treasury</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-white mb-2">Royalty Wheel</h3>
                <ul className="space-y-1 text-gray-400">
                  <li>* Gen 1 references: 30% of royalty pool</li>
                  <li>* Gen 2 references: 20%</li>
                  <li>* Gen 3 references: 10%</li>
                  <li>* Deeper generations: 1-5%</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 p-4 bg-sovereignty-locked/10 border border-sovereignty-locked/30 rounded-lg">
              <div className="flex items-center gap-2 text-sovereignty-locked font-medium mb-1">
                <ShieldCheck className="w-4 h-4" />
                Self-Hosted = Always Free
              </div>
              <p className="text-sm text-gray-400">
                Running Concord on your own infrastructure is and always will be 100% free.
                All features, no limits, full sovereignty.
              </p>
            </div>
          </div>
        </div>
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      {/* ============ BILLING ACTIONS PANEL ============ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-lattice-surface border border-lattice-border rounded-xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-neon-cyan" />
            Billing Intelligence Actions
          </h2>
          {!billingItems[0] && (
            <span className="text-xs px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              No invoice artifact — create one to enable actions
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Invoice Calculation */}
          <button
            onClick={() => handleBillingAction('invoiceCalculation')}
            disabled={!billingItems[0] || isRunning !== null}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-medium hover:bg-neon-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning === 'invoiceCalculation' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Receipt className="w-4 h-4" />
            )}
            Invoice Calculation
          </button>

          {/* Revenue Recognition */}
          <button
            onClick={() => handleBillingAction('revenueRecognition')}
            disabled={!billingItems[0] || isRunning !== null}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-neon-green/10 border border-neon-green/30 text-neon-green font-medium hover:bg-neon-green/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning === 'revenueRecognition' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <TrendingUp className="w-4 h-4" />
            )}
            Revenue Recognition
          </button>

          {/* Churn Prediction */}
          <button
            onClick={() => handleBillingAction('churnPrediction')}
            disabled={!billingItems[0] || isRunning !== null}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning === 'churnPrediction' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            Churn Prediction
          </button>
        </div>

        {/* Result Display */}
        {actionResult && (
          <div className="mt-4 bg-lattice-deep rounded-xl p-5 border border-lattice-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">
                {actionResult.currency !== undefined
                  ? 'Invoice Calculation Result'
                  : actionResult.recognitionDate !== undefined
                  ? 'Revenue Recognition Result'
                  : actionResult.churnThreshold !== undefined
                  ? 'Churn Prediction Result'
                  : 'Action Result'}
              </h3>
              <button
                onClick={() => setActionResult(null)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            {/* ---- Invoice Calculation ---- */}
            {actionResult.currency !== undefined && (
              <div className="space-y-4">
                {actionResult.message ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                        <p className="text-xs text-gray-400 mb-1">Subtotal</p>
                        <p className="text-lg font-bold text-white">
                          {(actionResult.currency as string)}&nbsp;
                          {((actionResult.subtotal as number) || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                        <p className="text-xs text-gray-400 mb-1">Discount</p>
                        <p className="text-lg font-bold text-neon-cyan">
                          −{((actionResult.discounts as Record<string, unknown>)?.totalDiscount as number || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <p className="text-xs text-gray-400 mb-1">Tax ({((actionResult.tax as Record<string, unknown>)?.ratePct as number || 0)}%)</p>
                        <p className="text-lg font-bold text-amber-400">
                          +{((actionResult.tax as Record<string, unknown>)?.taxAmount as number || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-neon-green/10 border border-neon-green/30">
                        <p className="text-xs text-gray-400 mb-1">Total</p>
                        <p className="text-lg font-bold text-neon-green">
                          {(actionResult.currency as string)}&nbsp;
                          {((actionResult.total as number) || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {Array.isArray(actionResult.lineItems) && (actionResult.lineItems as Array<Record<string, unknown>>).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Line Items</p>
                        <div className="divide-y divide-lattice-border rounded-lg overflow-hidden border border-lattice-border">
                          {(actionResult.lineItems as Array<Record<string, unknown>>).map((item, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-lattice-elevated/40 transition-colors">
                              <span className="text-gray-300 flex-1 truncate">{item.description as string || `Line ${item.lineNumber}`}</span>
                              <span className="text-gray-400 text-xs ml-3">{item.quantity as number} × {(item.unitPrice as number).toFixed(2)}</span>
                              <span className="text-white font-medium ml-4">{(item.lineTotal as number).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ---- Revenue Recognition ---- */}
            {actionResult.recognitionDate !== undefined && (
              <div className="space-y-4">
                {actionResult.message ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                        <p className="text-xs text-gray-400 mb-1">Contracts</p>
                        <p className="text-lg font-bold text-white">{actionResult.contractCount as number || 0}</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                        <p className="text-xs text-gray-400 mb-1">Total Value</p>
                        <p className="text-lg font-bold text-neon-cyan">
                          ${((actionResult.totalContractValue as number) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-neon-green/10 border border-neon-green/30">
                        <p className="text-xs text-gray-400 mb-1">Recognized</p>
                        <p className="text-lg font-bold text-neon-green">
                          ${((actionResult.totalRecognizedRevenue as number) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <p className="text-xs text-gray-400 mb-1">Deferred</p>
                        <p className="text-lg font-bold text-amber-400">
                          ${((actionResult.totalDeferredRevenue as number) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <TrendingUp className="w-4 h-4 text-neon-green flex-shrink-0" />
                      Recognition rate as of {actionResult.recognitionDate as string}:&nbsp;
                      <span className="text-neon-green font-semibold">{actionResult.recognitionRate as number}%</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ---- Churn Prediction ---- */}
            {actionResult.churnThreshold !== undefined && (
              <div className="space-y-4">
                {actionResult.message ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                        <p className="text-xs text-gray-400 mb-1">Customers</p>
                        <p className="text-lg font-bold text-white">{actionResult.totalCustomers as number || 0}</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-xs text-gray-400 mb-1">At Risk</p>
                        <p className="text-lg font-bold text-red-400">
                          {actionResult.atRiskCount as number || 0}
                          <span className="text-sm font-normal text-gray-400 ml-1">({actionResult.atRiskPct as number || 0}%)</span>
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 col-span-2">
                        <p className="text-xs text-gray-400 mb-1">Est. At-Risk Annual Revenue</p>
                        <p className="text-lg font-bold text-amber-400">
                          ${((actionResult.estimatedAtRiskAnnualRevenue as number) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                    {(() => {
                      const dist = actionResult.riskDistribution as Record<string, number> | undefined;
                      if (!dist) return null;
                      const riskLevels = [
                        { label: 'High', key: 'high', color: 'bg-red-500', textColor: 'text-red-400' },
                        { label: 'Medium', key: 'medium', color: 'bg-amber-500', textColor: 'text-amber-400' },
                        { label: 'Low', key: 'low', color: 'bg-yellow-500', textColor: 'text-yellow-400' },
                        { label: 'Very Low', key: 'veryLow', color: 'bg-green-500', textColor: 'text-green-400' },
                      ];
                      const total = Object.values(dist).reduce((s, v) => s + v, 0) || 1;
                      return (
                        <div>
                          <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Risk Distribution</p>
                          <div className="flex gap-1 h-3 rounded-full overflow-hidden mb-2">
                            {riskLevels.map(r => (
                              dist[r.key] > 0 && (
                                <div
                                  key={r.key}
                                  className={`${r.color} opacity-70`}
                                  style={{ width: `${(dist[r.key] / total) * 100}%` }}
                                  title={`${r.label}: ${dist[r.key]}`}
                                />
                              )
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs">
                            {riskLevels.map(r => (
                              <span key={r.key} className={`${r.textColor} flex items-center gap-1`}>
                                <span className={`w-2 h-2 rounded-full ${r.color} opacity-70 inline-block`} />
                                {r.label}: {dist[r.key] || 0}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {Array.isArray(actionResult.predictions) && (actionResult.predictions as Array<Record<string, unknown>>).filter(p => p.isAtRisk).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 font-semibold uppercase mb-2">At-Risk Customers</p>
                        <div className="space-y-2">
                          {(actionResult.predictions as Array<Record<string, unknown>>)
                            .filter(p => p.isAtRisk)
                            .slice(0, 5)
                            .map((pred, i) => {
                              const prob = pred.churnProbability as number;
                              const risk = pred.churnRisk as string;
                              const riskColor = risk === 'high' ? 'text-red-400' : 'text-amber-400';
                              const barColor = risk === 'high' ? 'bg-red-500' : 'bg-amber-500';
                              return (
                                <div key={i} className="flex items-center gap-3 text-sm">
                                  <span className="text-gray-300 flex-1 truncate">{pred.customerName as string || pred.customerId as string}</span>
                                  <div className="w-24 h-1.5 bg-lattice-elevated rounded-full overflow-hidden">
                                    <div className={`h-full ${barColor} opacity-70 rounded-full`} style={{ width: `${prob * 100}%` }} />
                                  </div>
                                  <span className={`text-xs font-semibold ${riskColor} w-14 text-right`}>
                                    {Math.round(prob * 100)}% {risk}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="billing" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier Card Component
// ---------------------------------------------------------------------------

function TierCard({
  name,
  price,
  priceNote,
  features,
  current,
  popular,
  onSelect,
  loading,
  disabled,
}: {
  name: string;
  price: number;
  priceNote?: string;
  features: string[];
  current?: boolean;
  popular?: boolean;
  onSelect: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`relative bg-lattice-surface border rounded-xl p-6 ${
        popular ? 'border-neon-purple shadow-lg shadow-neon-purple/20' : 'border-lattice-border'
      } ${current ? 'ring-2 ring-neon-green' : ''}`}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-neon-purple text-white text-xs font-bold rounded-full flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Popular
        </div>
      )}

      {current && (
        <div className="absolute -top-3 right-4 px-3 py-1 bg-neon-green text-white text-xs font-bold rounded-full">
          Current
        </div>
      )}

      <h3 className="text-xl font-bold text-white mb-2">{name}</h3>

      <div className="mb-4">
        <span className="text-4xl font-bold text-white">${price}</span>
        <span className="text-gray-400">/mo{priceNote}</span>
      </div>

      <ul className="space-y-2 mb-6">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
            <Check className="w-4 h-4 text-neon-green flex-shrink-0" />
            {feature}
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        disabled={current || loading || disabled}
        className={`w-full py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
          current
            ? 'bg-neon-green/20 text-neon-green cursor-default'
            : popular
            ? 'bg-neon-purple text-white hover:bg-neon-purple/80'
            : 'bg-lattice-elevated text-white hover:bg-lattice-border'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {current ? (
          <>
            <Check className="w-4 h-4" />
            Current Plan
          </>
        ) : loading ? (
          'Processing...'
        ) : (
          <>
            {price === 0 ? 'Get Started' : 'Upgrade'}
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}
