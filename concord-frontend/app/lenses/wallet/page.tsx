'use client';

/**
 * Wallet & Billing Page -- /lenses/wallet
 *
 * Full wallet/billing page with:
 * - Balance card with sparkline
 * - Buy CC section with presets and custom amount
 * - Withdraw section (Connect-gated)
 * - Transaction history with tabbed filtering and infinite scroll
 * - Earnings summary for creators
 */

import { useState, useCallback, useRef, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet,
  Coins,
  CreditCard,
  ArrowDownToLine,
  ArrowUpFromLine,
  TrendingUp,
  DollarSign,
  History,
  Award,
  Gift,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Repeat,
  Loader2,
  Sparkles,
  BarChart3,
  Calendar,
  Send,
  CheckCircle2,
  XCircle,
  Info,
  Clock,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { PurchaseFlow } from '@/components/wallet/PurchaseFlow';
import { WithdrawFlow } from '@/components/wallet/WithdrawFlow';
import { StripeConnectPanel } from '@/components/wallet/StripeConnectPanel';
import { WalletWidget } from '@/components/wallet/WalletWidget';
import { TokenBalance } from '@/components/economy/TokenBalance';
import { TransactionHistory } from '@/components/economy/TransactionHistory';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { BountiesAndFutures } from '@/components/economy/BountiesAndFutures';
import { WalletBadge } from '@/components/economy/WalletBadge';
import { Zap, X as XIcon } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const TRANSACTION_TABS = [
  { id: 'all', label: 'All', icon: History },
  { id: 'purchase', label: 'Purchases', icon: CreditCard },
  { id: 'tip', label: 'Tips', icon: Gift },
  { id: 'withdrawal', label: 'Withdrawals', icon: ArrowDownToLine },
  { id: 'earning', label: 'Earnings', icon: Award },
] as const;

const TX_PAGE_SIZE = 25;

// ── Types ────────────────────────────────────────────────────────────────────

interface BalanceData {
  balance: number;
  totalCredits: number;
  totalDebits: number;
  tokens?: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  fee?: number;
  net?: number;
  from?: string;
  to?: string;
  description?: string;
  status?: string;
  created_at: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

interface TransactionPage {
  transactions?: Transaction[];
  items?: Transaction[];
  history?: Transaction[];
  total?: number;
  hasMore?: boolean;
  nextOffset?: number;
}

interface ConnectStatus {
  connected: boolean;
  stripeAccountId?: string;
  onboardingComplete?: boolean;
}

interface EarningsSummary {
  totalEarned: number;
  tips: number;
  bounties: number;
  sales: number;
  thisMonth: number;
  lastMonth: number;
}

type TabId = (typeof TRANSACTION_TABS)[number]['id'];

// ── Inner component (uses useSearchParams) ───────────────────────────────────

function WalletPageInner() {
  useLensNav('wallet');
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // State
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [showPurchase, setShowPurchase] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { items: walletItems } = useLensData<Record<string, unknown>>('wallet', 'account');
  const runWalletAction = useRunArtifact('wallet');
  const [walletActionResult, setWalletActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [walletActiveAction, setWalletActiveAction] = useState<string | null>(null);

  const handleWalletAction = useCallback(async (action: string) => {
    const id = walletItems[0]?.id;
    if (!id) return;
    setWalletActiveAction(action);
    try {
      const res = await runWalletAction.mutateAsync({ id, action });
      if (res.ok) setWalletActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setWalletActiveAction(null);
    }
  }, [walletItems, runWalletAction]);

  // Check for Stripe return params
  const isStripeReturn =
    searchParams.get('success') === 'true' ||
    searchParams.get('canceled') === 'true';

  // ── Queries ──────────────────────────────────────────────────────────────

  // Balance
  const {
    data: balanceData,
    isLoading: balanceLoading,
  } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () =>
      api.get('/api/economy/balance').then((r) => r.data as BalanceData),
    refetchInterval: 15000,
    retry: false,
  });

  const balance = balanceData?.balance ?? balanceData?.tokens ?? 0;
  const totalCredits = balanceData?.totalCredits ?? 0;
  const totalDebits = balanceData?.totalDebits ?? 0;

  // Stripe Connect status
  const { data: connectStatus } = useQuery({
    queryKey: ['stripe-connect-status'],
    queryFn: () =>
      apiHelpers.economy.connectStatus().then((r) => r.data as ConnectStatus),
    retry: false,
  });

  // Transaction history with infinite scroll
  const {
    data: txPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: txLoading,
  } = useInfiniteQuery({
    queryKey: ['wallet-transactions', activeTab],
    queryFn: ({ pageParam = 0 }) =>
      api
        .get('/api/economy/history', {
          params: {
            type: activeTab === 'all' ? undefined : activeTab,
            limit: TX_PAGE_SIZE,
            offset: pageParam,
          },
        })
        .then((r) => r.data as TransactionPage),
    getNextPageParam: (lastPage, allPages) => {
      const items =
        lastPage.transactions || lastPage.items || lastPage.history || [];
      if (items.length < TX_PAGE_SIZE) return undefined;
      return allPages.reduce(
        (sum, page) =>
          sum +
          (page.transactions || page.items || page.history || []).length,
        0
      );
    },
    initialPageParam: 0,
    retry: false,
  });

  // Flatten all transaction pages
  const transactions = useMemo(() => {
    if (!txPages?.pages) return [];
    return txPages.pages.flatMap(
      (page) => page.transactions || page.items || page.history || []
    );
  }, [txPages]);

  // Withdrawals for status display
  const { data: withdrawalsData } = useQuery({
    queryKey: ['wallet-withdrawals'],
    queryFn: () =>
      apiHelpers.economy.withdrawals()
        .then(
          (r) =>
            r.data as { withdrawals?: Array<{ id: string; amount: number; fee: number; net: number; status: string; created_at: string }>; items?: Array<{ id: string; amount: number; fee: number; net: number; status: string; created_at: string }> }
        ),
    retry: false,
  });

  // Earnings summary (derived from transaction data)
  const earnings = useMemo<EarningsSummary>(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const earningTypes = new Set(['tip', 'earning', 'reward', 'bounty', 'sale', 'credit']);

    let totalEarned = 0;
    let tips = 0;
    let bounties = 0;
    let sales = 0;
    let thisMonth = 0;
    let lastMonth = 0;

    for (const tx of transactions) {
      if (!earningTypes.has(tx.type) || tx.amount <= 0) continue;

      totalEarned += tx.amount;
      const txDate = new Date(tx.created_at || tx.timestamp || '');

      if (tx.type === 'tip') tips += tx.amount;
      if (tx.type === 'bounty') bounties += tx.amount;
      if (tx.type === 'sale') sales += tx.amount;

      if (txDate >= thisMonthStart) thisMonth += tx.amount;
      else if (txDate >= lastMonthStart && txDate < thisMonthStart)
        lastMonth += tx.amount;
    }

    // Also use totalCredits from balance endpoint as a fallback
    if (totalEarned === 0 && totalCredits > 0) {
      totalEarned = totalCredits;
    }

    return { totalEarned, tips, bounties, sales, thisMonth, lastMonth };
  }, [transactions, totalCredits]);

  // ── Infinite Scroll ────────────────────────────────────────────────────────

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        },
        { threshold: 0.1 }
      );

      observerRef.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // ── Sparkline Data ─────────────────────────────────────────────────────────

  const sparklineData = useMemo(() => {
    // Build a simple balance-over-time from recent transactions
    const recent = [...transactions].reverse().slice(0, 20);
    if (recent.length < 2) return null;

    let runningBalance = balance;
    // Walk backwards from current balance to reconstruct history
    const points: number[] = [balance];
    for (const tx of [...transactions].slice(0, 19)) {
      runningBalance -= tx.amount;
      points.unshift(runningBalance);
    }

    return points;
  }, [transactions, balance]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handlePurchaseSuccess = useCallback(
    (_tokens: number) => {
      queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
    },
    [queryClient]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div data-lens-theme="wallet" className={cn(ds.pageContainer, 'max-w-6xl mx-auto')} ref={scrollRef}>
      {/* Page Header */}
      <div className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="text-neon-cyan">
            <Wallet className="w-7 h-7" />
          </div>
          <h1 className={ds.heading1}>Wallet & Billing</h1>
          <WalletBadge />
          <WalletWidget compact className="ml-auto" />
        </div>
      </div>

      <UniversalActions domain="wallet" artifactId={null} compact />

      {/* ── Balance Card ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden bg-gradient-to-br from-lattice-surface via-lattice-surface to-lattice-elevated border border-lattice-border rounded-2xl p-6"
      >
        {/* Background glow effect */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-neon-blue/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-neon-purple/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Balance Display */}
          <div className="space-y-2">
            <p className="text-sm text-gray-400 uppercase tracking-wider">
              CC Balance
            </p>
            <div className="flex items-baseline gap-3">
              {balanceLoading ? (
                <div className="h-10 w-40 bg-lattice-elevated animate-pulse rounded-lg" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Coins className="w-8 h-8 text-neon-green" />
                    <span className="text-4xl font-mono font-bold text-white">
                      {balance.toLocaleString()}
                    </span>
                  </div>
                  <span className="text-lg text-gray-400 font-mono">CC</span>
                </>
              )}
            </div>
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" />
              {balance.toLocaleString()}.00 USD
            </p>
            <TokenBalance />

            {/* Sparkline */}
            {sparklineData && sparklineData.length > 2 && (
              <div className="mt-3">
                <Sparkline data={sparklineData} />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowPurchase(true)}
              className={cn(
                ds.btnBase,
                'px-5 py-3 bg-gradient-to-r from-neon-blue to-neon-purple text-white hover:opacity-90 focus:ring-neon-blue shadow-neon-blue'
              )}
            >
              <CreditCard className="w-5 h-5" />
              Buy CC
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowWithdraw(true)}
              className={cn(
                ds.btnBase,
                'px-5 py-3 bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 focus:ring-neon-green'
              )}
            >
              <ArrowDownToLine className="w-5 h-5" />
              Withdraw
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowTransfer(true)}
              className={cn(
                ds.btnBase,
                'px-5 py-3 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/30 focus:ring-neon-cyan'
              )}
            >
              <Send className="w-5 h-5" />
              Transfer
            </motion.button>
          </div>
        </div>

        {/* Quick Stats Row */}
        <div className="relative mt-6 pt-6 border-t border-lattice-border grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickStat
            label="Total Credits"
            value={totalCredits}
            icon={<ArrowDownRight className="w-4 h-4 text-neon-green" />}
            color="text-neon-green"
          />
          <QuickStat
            label="Total Debits"
            value={totalDebits}
            icon={<ArrowUpRight className="w-4 h-4 text-red-400" />}
            color="text-red-400"
          />
          <QuickStat
            label="This Month"
            value={earnings.thisMonth}
            icon={<Calendar className="w-4 h-4 text-neon-blue" />}
            color="text-neon-blue"
          />
          <QuickStat
            label="Payout Status"
            value={connectStatus?.onboardingComplete ? 'Active' : 'Not Set Up'}
            icon={
              connectStatus?.onboardingComplete ? (
                <Sparkles className="w-4 h-4 text-neon-green" />
              ) : (
                <ArrowUpFromLine className="w-4 h-4 text-gray-500" />
              )
            }
            color={
              connectStatus?.onboardingComplete
                ? 'text-neon-green'
                : 'text-gray-400'
            }
            isText
          />
        </div>
      </motion.div>

      {/* ── Pending Withdrawals Banner ──────────────────────────────────── */}
      <PendingWithdrawalsBanner withdrawalsData={withdrawalsData} />

      {/* ── Main Content Grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Buy + Withdraw */}
        <div className="lg:col-span-1 space-y-6">
          {/* Buy CC Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={ds.panel}
          >
            <PurchaseFlow
              mode="inline"
              onSuccess={handlePurchaseSuccess}
            />
          </motion.div>

          {/* Stripe Connect Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <StripeConnectPanel />
          </motion.div>

          {/* Recent Transactions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={ds.panel}
          >
            <div className="space-y-3">
              <h3 className={ds.heading3}>Recent Activity</h3>
              <TransactionHistory limit={5} />
            </div>
          </motion.div>

          {/* Earnings Summary Card (for creators) */}
          {(earnings.totalEarned > 0 || totalCredits > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className={ds.panel}
            >
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-neon-purple" />
                  <h3 className={ds.heading3}>Earnings Summary</h3>
                </div>

                {/* Total Earned */}
                <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    Total Earned
                  </p>
                  <p className="text-2xl font-mono font-bold text-neon-green mt-1">
                    {earnings.totalEarned.toLocaleString()} CC
                  </p>
                </div>

                {/* Breakdown */}
                <div className="space-y-2">
                  <EarningRow
                    label="Tips Received"
                    amount={earnings.tips}
                    icon={<Gift className="w-4 h-4 text-neon-pink" />}
                  />
                  <EarningRow
                    label="Bounty Rewards"
                    amount={earnings.bounties}
                    icon={<Target className="w-4 h-4 text-amber-400" />}
                  />
                  <EarningRow
                    label="Sales"
                    amount={earnings.sales}
                    icon={<DollarSign className="w-4 h-4 text-neon-green" />}
                  />
                </div>

                {/* Month Comparison */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-lattice-border">
                  <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border">
                    <p className="text-xs text-gray-500">This Month</p>
                    <p className="text-lg font-mono font-bold text-white mt-1">
                      {earnings.thisMonth.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border">
                    <p className="text-xs text-gray-500">Last Month</p>
                    <p className="text-lg font-mono font-bold text-gray-400 mt-1">
                      {earnings.lastMonth.toLocaleString()}
                    </p>
                  </div>
                  {earnings.lastMonth > 0 && (
                    <div className="col-span-2">
                      <MonthComparison
                        thisMonth={earnings.thisMonth}
                        lastMonth={earnings.lastMonth}
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Bounties & Futures */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className={ds.panel}
          >
            <BountiesAndFutures />
          </motion.div>
        </div>

        {/* Right Column: Transaction History */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="lg:col-span-2"
        >
          <div className={cn(ds.panel, 'p-0')}>
            {/* Tab Bar */}
            <div className="flex gap-1 border-b border-lattice-border px-4 pt-4 flex-wrap">
              {TRANSACTION_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                      isActive
                        ? 'text-neon-cyan border-neon-cyan'
                        : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Withdrawals Summary */}
            {activeTab === 'withdrawal' && withdrawalsData && (
              <div className="px-4 pt-4">
                <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border mb-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Recent Withdrawals</p>
                  <div className="space-y-2">
                    {(withdrawalsData.withdrawals || withdrawalsData.items || []).slice(0, 5).map(w => (
                      <div key={w.id} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <ArrowDownToLine className="w-3.5 h-3.5 text-amber-400" />
                          <span className="font-mono text-white">{w.amount.toLocaleString()} CC</span>
                          {w.fee > 0 && <span className="text-xs text-gray-500">(fee: {w.fee})</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${w.status === 'complete' || w.status === 'completed' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                            {w.status}
                          </span>
                          <span className="text-xs text-gray-500">{new Date(w.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                    {(withdrawalsData.withdrawals || withdrawalsData.items || []).length === 0 && (
                      <p className="text-xs text-gray-500">No withdrawals found</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Transaction List */}
            <div className="p-4">
              {txLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 bg-lattice-deep animate-pulse rounded-lg"
                    />
                  ))}
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-12">
                  <History className="w-8 h-8 mx-auto text-gray-600 mb-3" />
                  <p className="text-gray-400">No transactions found</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {activeTab !== 'all'
                      ? 'Try the "All" tab to see all transactions'
                      : 'Your transaction history will appear here'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {transactions.map((tx, i) => (
                    <TransactionRow key={tx.id || i} tx={tx} />
                  ))}

                  {/* Infinite scroll sentinel */}
                  {hasNextPage && (
                    <div ref={loadMoreRef} className="py-4 text-center">
                      {isFetchingNextPage ? (
                        <Loader2 className="w-5 h-5 mx-auto text-neon-blue animate-spin" />
                      ) : (
                        <span className="text-xs text-gray-600">
                          Scroll for more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}

      {/* Stripe Return Handler (shown inline at top when returning) */}
      <AnimatePresence>
        {isStripeReturn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => {
                // Clear params by navigating to clean URL
                window.history.replaceState({}, '', '/lenses/wallet');
              }}
              aria-hidden="true"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl p-6"
            >
              <PurchaseFlow
                mode="inline"
                onSuccess={handlePurchaseSuccess}
                onClose={() => {
                  window.history.replaceState({}, '', '/lenses/wallet');
                  window.location.reload();
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Purchase Modal */}
      <AnimatePresence>
        {showPurchase && (
          <PurchaseFlow
            mode="modal"
            onClose={() => setShowPurchase(false)}
            onSuccess={handlePurchaseSuccess}
          />
        )}
      </AnimatePresence>

      {/* Withdraw Modal */}
      <AnimatePresence>
        {showWithdraw && (
          <WithdrawFlow
            mode="modal"
            onClose={() => setShowWithdraw(false)}
            balance={balance}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
              queryClient.invalidateQueries({
                queryKey: ['wallet-transactions'],
              });
              queryClient.invalidateQueries({
                queryKey: ['wallet-withdrawals'],
              });
              queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
            }}
          />
        )}
      </AnimatePresence>

      {/* Transfer Modal */}
      <AnimatePresence>
        {showTransfer && (
          <TransferFlow
            balance={balance}
            onClose={() => setShowTransfer(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
              queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
              queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
            }}
          />
        )}
      </AnimatePresence>

      {/* Wallet Actions Panel */}
      <div className="p-4 border-t border-lattice-border bg-lattice-surface/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-cyan" />
            Wallet Actions
          </h3>
          {walletActionResult && (
            <button onClick={() => setWalletActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400">
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['portfolioBalance', 'transactionCategorize', 'budgetCheck', 'spendingTrend'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleWalletAction(action)}
              disabled={!walletItems[0]?.id || walletActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {walletActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'portfolioBalance' ? 'Portfolio Balance' : action === 'transactionCategorize' ? 'Categorize Txns' : action === 'budgetCheck' ? 'Budget Check' : 'Spending Trend'}
            </button>
          ))}
        </div>
        {walletActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {walletActionResult.action === 'portfolioBalance' && (() => {
              const r = walletActionResult.result;
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Total Balance: <span className="text-neon-cyan font-bold text-base">{String(r.totalBalance ?? 0)}</span></span>
                    <span className="text-gray-400">Credits: <span className="text-neon-green">{String(r.credits ?? 0)}</span></span>
                    <span className="text-gray-400">Debits: <span className="text-red-400">{String(r.debits ?? 0)}</span></span>
                  </div>
                </div>
              );
            })()}
            {walletActionResult.action === 'transactionCategorize' && (() => {
              const r = walletActionResult.result;
              const categories = r.categories as Record<string, unknown> | undefined;
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Transactions: <span className="text-white">{String(r.totalTransactions ?? 0)}</span></div>
                  {categories && (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {Object.entries(categories).slice(0, 6).map(([cat, count]) => (
                        <div key={cat} className="bg-lattice-elevated px-2 py-1 rounded flex justify-between">
                          <span className="text-gray-400 capitalize">{cat}</span>
                          <span className="text-white">{String(count)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {walletActionResult.action === 'budgetCheck' && (() => {
              const r = walletActionResult.result;
              const withinBudget = r.withinBudget as boolean | undefined;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-400">Status:</span>
                    <span className={`font-semibold px-2 py-0.5 rounded ${withinBudget ? 'bg-neon-green/20 text-neon-green' : 'bg-red-500/20 text-red-400'}`}>
                      {withinBudget ? 'Within Budget' : 'Over Budget'}
                    </span>
                    <span className="text-gray-400">Spent: <span className="text-white">{String(r.totalSpent ?? 0)}</span></span>
                    <span className="text-gray-400">Budget: <span className="text-white">{String(r.budget ?? 0)}</span></span>
                  </div>
                  {!!r.recommendations && Array.isArray(r.recommendations) && (
                    <div className="text-xs text-gray-400">
                      {(r.recommendations as string[]).slice(0, 2).map((rec, i) => <div key={i} className="text-gray-300">• {rec}</div>)}
                    </div>
                  )}
                </div>
              );
            })()}
            {walletActionResult.action === 'spendingTrend' && (() => {
              const r = walletActionResult.result;
              const trend = String(r.trend ?? 'stable');
              const trendColor = trend === 'increasing' ? 'text-red-400' : trend === 'decreasing' ? 'text-neon-green' : 'text-gray-300';
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Trend: <span className={`font-semibold ${trendColor}`}>{trend}</span></span>
                    <span className="text-gray-400">Avg Spend: <span className="text-white">{String(r.avgSpend ?? 0)}</span></span>
                    <span className="text-gray-400">Period: <span className="text-white">{String(r.period ?? '-')}</span></span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Wallet Page (wrapped with Suspense for useSearchParams) ──────────────────

export default function WalletPage() {
  return (
    <Suspense
      fallback={
        <div className={cn(ds.pageContainer, 'max-w-6xl mx-auto')}>
          <div className="flex items-center gap-3 mb-6">
            <Wallet className="w-7 h-7 text-neon-cyan" />
            <h1 className={ds.heading1}>Wallet & Billing</h1>
          </div>
          <div className="h-48 bg-lattice-surface border border-lattice-border rounded-2xl animate-pulse" />
        </div>
      }
    >
      <WalletPageInner />
    </Suspense>
  );
}

// ── Sub-Components ───────────────────────────────────────────────────────────

/** Quick stat cell used in the balance card */
function QuickStat({
  label,
  value,
  icon,
  color,
  isText = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  isText?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="flex items-center gap-2">
        {icon}
        <span className={cn('font-mono font-medium', color)}>
          {isText
            ? value
            : typeof value === 'number'
            ? value.toLocaleString()
            : value}
        </span>
      </div>
    </div>
  );
}

/** Single transaction row */
function TransactionRow({ tx }: { tx: Transaction }) {
  const isPositive = tx.amount > 0;
  const typeIcons: Record<string, React.ReactNode> = {
    purchase: <CreditCard className="w-4 h-4 text-neon-blue" />,
    tip: <Gift className="w-4 h-4 text-neon-pink" />,
    withdrawal: <ArrowDownToLine className="w-4 h-4 text-amber-400" />,
    earning: <Award className="w-4 h-4 text-neon-green" />,
    reward: <Sparkles className="w-4 h-4 text-neon-purple" />,
    credit: <ArrowDownRight className="w-4 h-4 text-neon-green" />,
    debit: <ArrowUpRight className="w-4 h-4 text-red-400" />,
    transfer: <Repeat className="w-4 h-4 text-neon-blue" />,
    bounty: <Target className="w-4 h-4 text-amber-400" />,
    sale: <DollarSign className="w-4 h-4 text-neon-green" />,
    fee: <BarChart3 className="w-4 h-4 text-gray-500" />,
  };

  const statusColors: Record<string, string> = {
    complete: 'text-neon-green',
    completed: 'text-neon-green',
    pending: 'text-amber-400',
    processing: 'text-neon-blue',
    failed: 'text-red-400',
    reversed: 'text-gray-500',
    canceled: 'text-gray-500',
  };

  const dateStr = tx.created_at || tx.timestamp || '';
  const date = dateStr ? new Date(dateStr) : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-lattice-deep/50 transition-colors group"
    >
      {/* Icon */}
      <div className="flex-shrink-0 p-2 rounded-lg bg-lattice-deep border border-lattice-border group-hover:border-lattice-border/80">
        {typeIcons[tx.type] || <Coins className="w-4 h-4 text-gray-400" />}
      </div>

      {/* Description */}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">
          {tx.description || formatTxType(tx.type)}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {date && (
            <span className="text-xs text-gray-500">
              {date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year:
                  date.getFullYear() !== new Date().getFullYear()
                    ? 'numeric'
                    : undefined,
              })}
              {' '}
              {date.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {tx.status && (
            <span
              className={cn(
                'text-xs capitalize',
                statusColors[tx.status] || 'text-gray-500'
              )}
            >
              {tx.status}
            </span>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="flex-shrink-0 text-right">
        <span
          className={cn(
            'text-sm font-mono font-medium',
            isPositive ? 'text-neon-green' : 'text-red-400'
          )}
        >
          {isPositive ? '+' : ''}
          {tx.amount.toLocaleString()} CC
        </span>
        {tx.fee && tx.fee > 0 && (
          <p className="text-xs text-gray-600 font-mono">
            fee: {tx.fee.toLocaleString()}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/** Format transaction type to readable string */
function formatTxType(type: string): string {
  const map: Record<string, string> = {
    purchase: 'Token Purchase',
    tip: 'Tip',
    withdrawal: 'Withdrawal',
    earning: 'Earning',
    reward: 'Reward',
    credit: 'Credit',
    debit: 'Debit',
    transfer: 'Transfer',
    bounty: 'Bounty Reward',
    sale: 'Sale',
    fee: 'Fee',
    TOKEN_PURCHASE: 'Token Purchase',
    WITHDRAWAL: 'Withdrawal',
    TIP: 'Tip',
    FEE: 'Fee',
    TRANSFER: 'Transfer',
  };
  return map[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Earnings breakdown row */
function EarningRow({
  label,
  amount,
  icon,
}: {
  label: string;
  amount: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <span className="text-sm font-mono text-white">
        {amount.toLocaleString()} CC
      </span>
    </div>
  );
}

/** Month-over-month comparison indicator */
function MonthComparison({
  thisMonth,
  lastMonth,
}: {
  thisMonth: number;
  lastMonth: number;
}) {
  if (lastMonth === 0) return null;

  const change = ((thisMonth - lastMonth) / lastMonth) * 100;
  const isUp = change >= 0;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs',
        isUp ? 'text-neon-green' : 'text-red-400'
      )}
    >
      {isUp ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <ArrowDownRight className="w-3 h-3" />
      )}
      <span>
        {isUp ? '+' : ''}
        {change.toFixed(1)}% vs last month
      </span>
    </div>
  );
}

/** Transfer CC to another user */
function TransferFlow({
  balance,
  onClose,
  onSuccess,
}: {
  balance: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'input' | 'confirm' | 'loading' | 'success' | 'error'>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const transferAbortRef = useRef<AbortController | null>(null);

  // Abort in-flight transfer on unmount (e.g. navigation away)
  useEffect(() => {
    return () => { transferAbortRef.current?.abort(); };
  }, []);

  const TRANSFER_FEE_RATE = 0.0146; // 1.46% transfer fee
  const parsedAmount = parseInt(amount, 10) || 0;
  const fee = Math.ceil(parsedAmount * TRANSFER_FEE_RATE * 100) / 100;
  const netAmount = Math.round((parsedAmount - fee) * 100) / 100;
  const isValid = parsedAmount > 0 && parsedAmount <= balance && recipientId.trim().length > 0;

  const handleTransfer = async () => {
    if (!isValid) return;
    transferAbortRef.current?.abort();
    const abortController = new AbortController();
    transferAbortRef.current = abortController;
    setStep('loading');
    try {
      const res = await api.post('/api/economy/transfer', {
        to: recipientId.trim(),
        amount: parsedAmount,
      }, { signal: abortController.signal });
      const data = res.data as { ok?: boolean; error?: string };
      if (data.ok) {
        setStep('success');
        onSuccess();
      } else {
        setErrorMessage(data.error?.replace(/_/g, ' ') || 'Transfer failed');
        setStep('error');
      }
    } catch (err: unknown) {
      setErrorMessage(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error?.replace(/_/g, ' ') ||
        'Transfer failed. Please try again.'
      );
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-lg bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
      >
        {step === 'input' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neon-cyan/20">
                <Send className="w-5 h-5 text-neon-cyan" />
              </div>
              <div>
                <h3 className={ds.heading3}>Transfer CC</h3>
                <p className={ds.textMuted}>Send Concord Coins to another user</p>
              </div>
            </div>

            <div>
              <label className={ds.label}>Recipient User ID</label>
              <input
                type="text"
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                placeholder="Enter user ID"
                className={cn(ds.input, 'font-mono')}
              />
            </div>

            <div>
              <label className={ds.label}>Amount</label>
              <div className="relative">
                <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  className={cn(ds.input, 'pl-10 font-mono')}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Available: {balance.toLocaleString()} CC</p>
            </div>

            {parsedAmount > 0 && isValid && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-2"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Amount</span>
                  <span className="font-mono text-white">{parsedAmount.toLocaleString()} CC</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 flex items-center gap-1">
                    Fee (1.46%)
                    <Info className="w-3 h-3" />
                  </span>
                  <span className="font-mono text-red-400">-{fee.toFixed(2)} CC</span>
                </div>
                <div className="border-t border-lattice-border pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Recipient gets</span>
                    <span className="font-mono text-lg font-bold text-neon-green">{netAmount.toFixed(2)} CC</span>
                  </div>
                </div>
              </motion.div>
            )}

            <button
              onClick={() => setStep('confirm')}
              disabled={!isValid}
              className={cn(
                ds.btnBase,
                'w-full px-6 py-3',
                isValid
                  ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/30'
                  : 'bg-lattice-elevated text-gray-500 cursor-not-allowed'
              )}
            >
              <Send className="w-5 h-5" />
              {isValid ? `Send ${parsedAmount.toLocaleString()} CC` : 'Enter transfer details'}
            </button>

            {/* Stripe integration note */}
            {/* FLAG: Stripe integration required for real deposits/withdrawals */}
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <Info className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className={ds.heading3}>Confirm Transfer</h3>
                <p className={ds.textMuted}>Review before sending</p>
              </div>
            </div>
            <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">To</span>
                <span className="font-mono text-white truncate max-w-[200px]">{recipientId}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Amount</span>
                <span className="font-mono text-white">{parsedAmount.toLocaleString()} CC</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Fee (1.46%)</span>
                <span className="font-mono text-red-400">-{fee.toFixed(2)} CC</span>
              </div>
              <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-white">Net</span>
                <span className="font-mono text-lg font-bold text-neon-green">{netAmount.toFixed(2)} CC</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep('input')} className={cn(ds.btnSecondary, 'flex-1')}>Back</button>
              <button
                onClick={handleTransfer}
                className={cn(ds.btnBase, 'flex-1 px-6 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/30')}
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm
              </button>
            </div>
          </div>
        )}

        {step === 'loading' && (
          <div className="text-center py-12">
            <Loader2 className="w-10 h-10 mx-auto text-neon-cyan animate-spin" />
            <p className="text-gray-400 mt-3">Processing transfer...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center py-8 space-y-4">
            <CheckCircle2 className="w-16 h-16 mx-auto text-neon-green" />
            <h3 className={ds.heading2}>Transfer Complete</h3>
            <p className="text-gray-400">
              <span className="text-neon-green font-mono font-bold">{netAmount.toFixed(2)} CC</span> sent to{' '}
              <span className="text-white font-mono">{recipientId}</span>
            </p>
            <button onClick={onClose} className={cn(ds.btnPrimary, 'mt-4')}>Done</button>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-8 space-y-4">
            <XCircle className="w-16 h-16 mx-auto text-red-400" />
            <h3 className={ds.heading2}>Transfer Failed</h3>
            <p className="text-gray-400">{errorMessage}</p>
            <button onClick={() => setStep('input')} className={cn(ds.btnSecondary, 'mt-4')}>Try Again</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/** Pending withdrawals banner -- shown above the main grid when active withdrawals exist */
function PendingWithdrawalsBanner({
  withdrawalsData,
}: {
  withdrawalsData?: {
    withdrawals?: Array<{ id: string; amount: number; fee: number; net: number; status: string; created_at: string }>;
    items?: Array<{ id: string; amount: number; fee: number; net: number; status: string; created_at: string }>;
  };
}) {
  const allWithdrawals = withdrawalsData?.withdrawals || withdrawalsData?.items || [];
  const pending = allWithdrawals.filter((w) =>
    ['pending', 'approved', 'processing'].includes(w.status)
  );

  if (pending.length === 0) return null;

  const totalPending = pending.reduce((sum, w) => sum + w.amount, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4"
    >
      <div className="flex items-start gap-3">
        <Clock className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">
            {pending.length} pending withdrawal{pending.length !== 1 ? 's' : ''} ({totalPending.toLocaleString()} CC)
          </p>
          <div className="mt-2 space-y-1.5">
            {pending.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white">{w.amount.toLocaleString()} CC</span>
                  {w.fee > 0 && <span className="text-gray-500">(fee: {w.fee})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-xs',
                    w.status === 'processing' ? 'bg-blue-500/10 text-blue-400' :
                    w.status === 'approved' ? 'bg-green-500/10 text-green-400' :
                    'bg-amber-500/10 text-amber-400'
                  )}>
                    {w.status}
                  </span>
                  <span className="text-gray-500">
                    {new Date(w.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Mini sparkline chart for balance history */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;

  const width = 120;
  const height = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  // Determine trend color
  const isUp = data[data.length - 1] >= data[0];

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Area fill */}
      <defs>
        <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={isUp ? '#22c55e' : '#ef4444'}
            stopOpacity="0.3"
          />
          <stop
            offset="100%"
            stopColor={isUp ? '#22c55e' : '#ef4444'}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill="url(#sparkline-fill)"
      />
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? '#22c55e' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - ((data[data.length - 1] - min) / range) * height}
          r="2"
          fill={isUp ? '#22c55e' : '#ef4444'}
        />
      )}
    </svg>
  );
}
