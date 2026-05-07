'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState, useCallback } from 'react';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Coins, TrendingUp, Lock, RefreshCw, ArrowRightLeft,
  Wallet, Loader2, Plus, Send, ArrowDownLeft, ArrowUpRight,
  Eye, EyeOff, Copy, Check, X, Settings, BarChart3, Layers, ChevronDown,
  ShieldCheck, TrendingDown, ArrowUp, ArrowDown, XCircle
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { AnimatePresence, motion } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { ErrorState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useUIStore } from '@/store/ui';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChainData {
  chainId: string;
  name: string;
  symbol: string;
  balance: number;
  price: number;
}

interface TransactionData {
  type: 'earn' | 'spend' | 'transfer';
  amount: number;
  symbol: string;
  description: string;
  timestamp: string;
  to?: string;
  from?: string;
}

interface WalletData {
  name: string;
  address: string;
  chainId: string;
  isDefault: boolean;
}

interface Allocation {
  token: string;
  weight: number;
}

interface TransactionCheck {
  field: string;
  valid: boolean;
}

interface GasRecommendation {
  maxFeeGwei: number;
  priorityFeeGwei: number;
  waitBlocks: number;
}

interface DetectedPattern {
  type: string;
  risk: string;
  hops?: number;
  occurrences?: number;
  count?: number;
  largest?: string;
}

interface ActionResultData extends Record<string, unknown> {
  result?: Record<string, unknown>;
  error?: string;
  message?: string;
  totalValue?: number;
  allocations?: Allocation[];
  totalUnrealizedPnl?: number;
  concentrationRisk?: string;
  hhi?: number;
  stablecoinExposure?: number;
  checks?: TransactionCheck[];
  valid?: boolean;
  network?: string;
  maxGasCostEth?: number;
  warnings?: string[];
  recommendations?: Record<string, GasRecommendation>;
  gasLimit?: number;
  networkCongestion?: string;
  baseFeeStats?: { avg: number };
  blocksAnalyzed?: number;
  patterns?: DetectedPattern[];
  riskSummary?: { high?: number; moderate?: number; informational?: number };
  totalTransactions?: number;
}

type CryptoTab = 'portfolio' | 'transactions' | 'wallets';

// ── Component ─────────────────────────────────────────────────────────────────

export default function CryptoLensPage() {
  useLensNav('crypto');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('crypto');

  const [activeTab, setActiveTab] = useState<CryptoTab>('portfolio');
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [transacting, setTransacting] = useState(false);
  const [showBalances, setShowBalances] = useState(true);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState<'all' | 'earn' | 'spend' | 'transfer'>('all');
  const [showSendModal, setShowSendModal] = useState(false);
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showAddChain, setShowAddChain] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // ── Backend action state ───────────────────────────────────────────────────
  const runAction = useRunArtifact('crypto');
  const [actionResult, setActionResult] = useState<ActionResultData | null>(null);
  const [isRunningAction, setIsRunningAction] = useState(false);

  const handleRunAction = async (action: string) => {
    const targetId = chainItems[0]?.id ?? 'crypto-default';
    setIsRunningAction(true);
    setActionResult(null);
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      setActionResult(result as ActionResultData);
    } catch (err) {
      setActionResult({ error: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setIsRunningAction(false);
    }
  };

  // Send form
  const [sendAmount, setSendAmount] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendDescription, setSendDescription] = useState('');

  // Add wallet form
  const [walletName, setWalletName] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletChainId, setWalletChainId] = useState('');

  // Add chain form
  const [chainName, setChainName] = useState('');
  const [chainSymbol, setChainSymbol] = useState('');

  // ── Data hooks ────────────────────────────────────────────────────────────

  const {
    items: chainItems,
    isLoading: chainsLoading,
    isError,
    error,
    refetch,
    create: createChain,
    update: updateChain,
  } = useLensData<ChainData>('crypto', 'chain', { seed: [] });

  const {
    items: txItems,
    isLoading: txLoading,
    isError: isError2,
    error: error2,
    refetch: refetch2,
    create: createTransaction,
  } = useLensData<TransactionData>('crypto', 'transaction', { seed: [] });

  const {
    items: walletItems,
    isLoading: walletsLoading,
    isError: isError3,
    error: error3,
    refetch: refetch3,
    create: createWallet,
    remove: removeWallet,
  } = useLensData<WalletData>('crypto', 'wallet', { seed: [] });

  // ── Derived data ──────────────────────────────────────────────────────────

  const chains = chainItems.map(item => ({
    id: item.data.chainId || item.id,
    name: item.data.name || item.title,
    symbol: item.data.symbol || '??',
    balance: item.data.balance ?? 0,
    price: item.data.price ?? 0,
    _lensId: item.id,
  }));

  const transactions = txItems.map(item => ({
    id: item.id,
    type: item.data.type || 'earn',
    amount: item.data.amount ?? 0,
    symbol: item.data.symbol || 'CC',
    description: item.data.description || item.title,
    timestamp: item.data.timestamp || item.createdAt,
    to: item.data.to,
    from: item.data.from,
  }));

  const wallets = walletItems.map(item => ({
    id: item.id,
    name: item.data.name || item.title,
    address: item.data.address || '',
    chainId: item.data.chainId || '',
    isDefault: item.data.isDefault ?? false,
  }));

  const selectedChainData = chains.find(c => c.id === selectedChain) || chains[0] || null;

  const totalPortfolioValue = chains.reduce((sum, c) => sum + c.balance * c.price, 0);

  const filteredTransactions = transactions
    .filter(tx => txFilter === 'all' || tx.type === txFilter)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const isLoading = chainsLoading || txLoading || walletsLoading;

  // ── Quick stats (transactions tab) ───────────────────────────────────────
  const totalEarned = transactions
    .filter(tx => tx.type === 'earn')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalSpent = transactions
    .filter(tx => tx.type === 'spend')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalTransferred = transactions
    .filter(tx => tx.type === 'transfer')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const netFlow = totalEarned - totalSpent;

  // ── Chain sparkline data (last 5 transactions per chain) ─────────────────
  const chainSparklines: Record<string, typeof transactions> = {};
  for (const chain of chains) {
    chainSparklines[chain.symbol] = transactions
      .filter(tx => tx.symbol === chain.symbol)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }

  // ── Allocation bar colors ─────────────────────────────────────────────────
  const ALLOC_COLORS = [
    { bg: 'bg-neon-green', text: 'text-neon-green', hex: '#00ff88' },
    { bg: 'bg-neon-blue',  text: 'text-neon-blue',  hex: '#00c8ff' },
    { bg: 'bg-neon-pink',  text: 'text-neon-pink',  hex: '#ff0080' },
    { bg: 'bg-neon-purple',text: 'text-neon-purple', hex: '#a855f7' },
  ];

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleEarn = useCallback(async () => {
    if (!selectedChainData) return;
    setTransacting(true);
    try {
      await apiHelpers.credits.earn('default', 10, 'manual-earn');
      await createTransaction({
        title: `Earned 10 ${selectedChainData.symbol}`,
        data: {
          type: 'earn',
          amount: 10,
          symbol: selectedChainData.symbol,
          description: 'Manual earn',
          timestamp: new Date().toISOString(),
        } as unknown as Partial<TransactionData>,
        meta: { tags: ['earn', selectedChainData.symbol], status: 'completed' },
      });
      await updateChain(selectedChainData._lensId, {
        data: {
          ...chainItems.find(c => c.id === selectedChainData._lensId)?.data,
          balance: selectedChainData.balance + 10,
        } as unknown as Partial<ChainData>,
      });
      refetch(); refetch2();
    } catch {
      refetch(); // Reconcile with actual backend state
    } finally {
      setTransacting(false);
    }
  }, [selectedChainData, chainItems, createTransaction, updateChain, refetch, refetch2]);

  const handleSpend = useCallback(async () => {
    if (!selectedChainData || selectedChainData.balance < 5) return;
    setTransacting(true);
    try {
      await apiHelpers.credits.spend('default', 5, 'manual-spend');
      await createTransaction({
        title: `Spent 5 ${selectedChainData.symbol}`,
        data: {
          type: 'spend',
          amount: 5,
          symbol: selectedChainData.symbol,
          description: 'Manual spend',
          timestamp: new Date().toISOString(),
        } as unknown as Partial<TransactionData>,
        meta: { tags: ['spend', selectedChainData.symbol], status: 'completed' },
      });
      await updateChain(selectedChainData._lensId, {
        data: {
          ...chainItems.find(c => c.id === selectedChainData._lensId)?.data,
          balance: selectedChainData.balance - 5,
        } as unknown as Partial<ChainData>,
      });
      refetch(); refetch2();
    } catch {
      refetch(); // Reconcile with actual backend state
    } finally {
      setTransacting(false);
    }
  }, [selectedChainData, chainItems, createTransaction, updateChain, refetch, refetch2]);

  const handleSend = useCallback(async () => {
    if (!selectedChainData || !sendAmount || !sendTo) return;
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0 || amount > selectedChainData.balance) return;
    setTransacting(true);
    try {
      await createTransaction({
        title: `Sent ${amount} ${selectedChainData.symbol} to ${sendTo}`,
        data: {
          type: 'transfer',
          amount,
          symbol: selectedChainData.symbol,
          description: sendDescription || `Transfer to ${sendTo}`,
          timestamp: new Date().toISOString(),
          to: sendTo,
        } as unknown as Partial<TransactionData>,
        meta: { tags: ['transfer', selectedChainData.symbol], status: 'completed' },
      });
      await updateChain(selectedChainData._lensId, {
        data: {
          ...chainItems.find(c => c.id === selectedChainData._lensId)?.data,
          balance: selectedChainData.balance - amount,
        } as unknown as Partial<ChainData>,
      });
      setSendAmount('');
      setSendTo('');
      setSendDescription('');
      setShowSendModal(false);
    } catch (e) {
      console.error('Send transaction failed:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Transaction failed' });
    } finally {
      setTransacting(false);
    }
  }, [selectedChainData, sendAmount, sendTo, sendDescription, chainItems, createTransaction, updateChain]);

  const handleAddWallet = useCallback(async () => {
    if (!walletName || !walletAddress) return;
    try {
      await createWallet({
        title: walletName,
        data: {
          name: walletName,
          address: walletAddress,
          chainId: walletChainId || 'concord',
          isDefault: wallets.length === 0,
        } as unknown as Partial<WalletData>,
        meta: { tags: ['wallet'], status: 'active' },
      });
      setWalletName('');
      setWalletAddress('');
      setWalletChainId('');
      setShowAddWallet(false);
    } catch (e) {
      console.error('Add wallet failed:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to add wallet' });
    }
  }, [walletName, walletAddress, walletChainId, wallets.length, createWallet]);

  const handleAddChain = useCallback(async () => {
    if (!chainName || !chainSymbol) return;
    try {
      const chainId = chainName.toLowerCase().replace(/\s+/g, '-');
      await createChain({
        title: chainName,
        data: {
          chainId,
          name: chainName,
          symbol: chainSymbol.toUpperCase(),
          balance: 0,
          price: 1,
        } as unknown as Partial<ChainData>,
        meta: { tags: ['chain'], status: 'active' },
      });
      setChainName('');
      setChainSymbol('');
      setShowAddChain(false);
    } catch (e) {
      console.error('Add chain failed:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to add chain' });
    }
  }, [chainName, chainSymbol, createChain]);

  const handleCopyAddress = useCallback((address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  }, []);

  const handleDeleteWallet = useCallback(async (id: string) => {
    try {
      await removeWallet(id);
    } catch (e) {
      console.error('Delete wallet failed:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete wallet' });
    }
  }, [removeWallet]);

  // ── Error / Loading ───────────────────────────────────────────────────────

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => { refetch(); refetch2(); refetch3(); }}
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-lens-theme="crypto" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/30 to-emerald-500/30 border border-green-500/30 flex items-center justify-center">
            <Coins className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Crypto Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">
              Portfolio management, transactions, and wallet controls
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="crypto" data={{}} compact />
          <button
            onClick={() => setShowBalances(!showBalances)}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            title={showBalances ? 'Hide balances' : 'Show balances'}
          >
            {showBalances ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => { refetch(); refetch2(); refetch3(); }}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>


      <RealtimeDataPanel domain="crypto" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* AI Actions */}
      <UniversalActions domain="crypto" artifactId={chainItems[0]?.id} compact />
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading crypto data...
        </div>
      ) : (
        <>
          {/* Portfolio Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <Wallet className="w-5 h-5 text-neon-green mb-2" />
              <p
                className="text-2xl font-bold"
                style={{
                  animation: 'portfolioGlow 3s ease-in-out infinite',
                }}
              >
                {showBalances ? `$${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '****'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-sm text-gray-400">Total Portfolio Value</p>
                {netFlow >= 0 ? (
                  <span className="flex items-center gap-0.5 text-xs text-neon-green font-mono">
                    <ArrowUp className="w-3 h-3" />
                    {totalEarned > 0 ? `+${((netFlow / (totalEarned || 1)) * 100).toFixed(1)}%` : '—'}
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 text-xs text-neon-pink font-mono">
                    <ArrowDown className="w-3 h-3" />
                    {totalEarned > 0 ? `${((netFlow / (totalEarned || 1)) * 100).toFixed(1)}%` : '—'}
                  </span>
                )}
              </div>
              <style>{`
                @keyframes portfolioGlow {
                  0%, 100% { text-shadow: 0 0 6px rgba(0,255,136,0.3); }
                  50% { text-shadow: 0 0 18px rgba(0,255,136,0.8), 0 0 32px rgba(0,255,136,0.4); }
                }
              `}</style>
            </div>
            <div className="lens-card">
              <BarChart3 className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold">{chains.length}</p>
              <p className="text-sm text-gray-400">Chains</p>
            </div>
            <div className="lens-card">
              <ArrowRightLeft className="w-5 h-5 text-neon-purple mb-2" />
              <p className="text-2xl font-bold">{transactions.length}</p>
              <p className="text-sm text-gray-400">Transactions</p>
            </div>
            <div className="lens-card">
              <Lock className="w-5 h-5 text-neon-cyan mb-2" />
              <p className="text-2xl font-bold">{wallets.length}</p>
              <p className="text-sm text-gray-400">Wallets</p>
            </div>
          </div>

          {/* Portfolio Allocation Bar */}
          {chains.length > 0 && totalPortfolioValue > 0 && (
            <div className="panel p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-neon-blue" />
                Portfolio Allocation
              </h2>
              <div className="flex rounded-full overflow-hidden h-4 w-full gap-px">
                {chains.map((chain, idx) => {
                  const pct = totalPortfolioValue > 0
                    ? ((chain.balance * chain.price) / totalPortfolioValue) * 100
                    : 0;
                  const color = ALLOC_COLORS[idx % ALLOC_COLORS.length];
                  return (
                    <div
                      key={chain.id}
                      className={`${color.bg} opacity-80 hover:opacity-100 transition-opacity`}
                      style={{ width: `${pct}%`, minWidth: pct > 0 ? '4px' : '0' }}
                      title={`${chain.symbol}: ${pct.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {chains.map((chain, idx) => {
                  const pct = totalPortfolioValue > 0
                    ? ((chain.balance * chain.price) / totalPortfolioValue) * 100
                    : 0;
                  const color = ALLOC_COLORS[idx % ALLOC_COLORS.length];
                  return (
                    <div key={chain.id} className="flex items-center gap-1.5 text-xs">
                      <span className={`w-2 h-2 rounded-full ${color.bg}`} />
                      <span className={`${color.text} font-mono font-semibold`}>{chain.symbol}</span>
                      <span className="text-gray-500">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-lattice-border">
            {([
              { key: 'portfolio' as CryptoTab, label: 'Portfolio', icon: <TrendingUp className="w-4 h-4" /> },
              { key: 'transactions' as CryptoTab, label: 'Transactions', icon: <ArrowRightLeft className="w-4 h-4" /> },
              { key: 'wallets' as CryptoTab, label: 'Wallets', icon: <Wallet className="w-4 h-4" /> },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.key
                    ? 'border-neon-green text-neon-green'
                    : 'border-transparent text-gray-400 hover:text-white'
                )}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'portfolio' && (
            <div className="space-y-4">
              {/* Chain Selector & Actions */}
              <div className="panel p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Coins className="w-4 h-4 text-neon-green" />
                    Chain Holdings
                  </h2>
                  <button
                    onClick={() => setShowAddChain(true)}
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Chain
                  </button>
                </div>
                {chains.length === 0 ? (
                  <div className="text-center py-8">
                    <Coins className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                    <p className="text-gray-500">No chains configured.</p>
                    <p className="text-sm text-gray-600 mt-1">Add a chain to start tracking your portfolio.</p>
                    <button
                      onClick={() => setShowAddChain(true)}
                      className="mt-3 btn-neon green text-sm"
                    >
                      <Plus className="w-4 h-4 inline mr-1" />
                      Add Your First Chain
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {chains.map(chain => (
                        <button
                          key={chain.id}
                          onClick={() => setSelectedChain(chain.id)}
                          className={cn(
                            'lens-card text-left transition-all',
                            selectedChain === chain.id || (!selectedChain && chain === chains[0])
                              ? 'border-neon-green ring-1 ring-neon-green'
                              : ''
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-semibold">{chain.name}</p>
                            <span className="text-xs px-2 py-0.5 rounded bg-lattice-surface text-gray-400">
                              {chain.symbol}
                            </span>
                          </div>
                          <p className="text-2xl font-bold text-neon-green">
                            {showBalances ? `${chain.balance.toLocaleString()} ${chain.symbol}` : '****'}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {showBalances
                              ? `$${(chain.balance * chain.price).toLocaleString(undefined, { minimumFractionDigits: 2 })} @ $${chain.price}`
                              : '****'}
                          </p>
                          {/* Transaction sparkline dots */}
                          {chainSparklines[chain.symbol]?.length > 0 && (
                            <div className="flex items-center gap-1 mt-2">
                              {chainSparklines[chain.symbol].map((tx, ti) => (
                                <span
                                  key={`${tx.id}-${ti}`}
                                  title={`${tx.type}: ${tx.amount} ${tx.symbol}`}
                                  className={cn(
                                    'w-2 h-2 rounded-full flex-shrink-0',
                                    tx.type === 'earn'
                                      ? 'bg-neon-green shadow-[0_0_4px_rgba(0,255,136,0.8)]'
                                      : tx.type === 'spend'
                                      ? 'bg-neon-pink shadow-[0_0_4px_rgba(255,0,128,0.8)]'
                                      : 'bg-neon-blue shadow-[0_0_4px_rgba(0,200,255,0.8)]'
                                  )}
                                />
                              ))}
                              <span className="text-xs text-gray-600 ml-1">
                                {chainSparklines[chain.symbol].length} recent
                              </span>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Quick Actions */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={handleEarn}
                        disabled={transacting || !selectedChainData}
                        className="btn-neon green flex items-center gap-2 disabled:opacity-50"
                      >
                        {transacting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownLeft className="w-4 h-4" />}
                        Earn 10 {selectedChainData?.symbol || 'CC'}
                      </button>
                      <button
                        onClick={handleSpend}
                        disabled={transacting || !selectedChainData || (selectedChainData?.balance ?? 0) < 5}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-neon-pink/20 text-neon-pink border border-neon-pink/30 hover:bg-neon-pink/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        Spend 5 {selectedChainData?.symbol || 'CC'}
                      </button>
                      <button
                        onClick={() => setShowSendModal(true)}
                        disabled={!selectedChainData || (selectedChainData?.balance ?? 0) <= 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-neon-blue/20 text-neon-blue border border-neon-blue/30 hover:bg-neon-blue/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Send className="w-4 h-4" />
                        Send
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Price Display */}
              {chains.length > 0 ? (
                <div className="panel p-4">
                  <h2 className="font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-neon-blue" />
                    Price Overview
                  </h2>
                  <div className="space-y-3">
                    {chains.map(chain => (
                      <div key={chain.id} className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-neon-green/20 flex items-center justify-center">
                            <span className="text-xs font-bold text-neon-green">{chain.symbol.slice(0, 2)}</span>
                          </div>
                          <div>
                            <p className="font-medium">{chain.name}</p>
                            <p className="text-xs text-gray-500">{chain.symbol}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-bold">${chain.price.toLocaleString()}</p>
                          <p className="text-xs text-gray-500">
                            Holdings: {showBalances ? `$${(chain.balance * chain.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '****'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                  <p>No blockchain data yet. Add chains to see network analytics.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="space-y-4">
              {/* Quick Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="panel p-3 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-neon-green" />
                    Total Earned
                  </div>
                  <p className="font-mono font-bold text-neon-green text-lg">+{totalEarned.toLocaleString()}</p>
                </div>
                <div className="panel p-3 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                    <ArrowUpRight className="w-3.5 h-3.5 text-neon-pink" />
                    Total Spent
                  </div>
                  <p className="font-mono font-bold text-neon-pink text-lg">-{totalSpent.toLocaleString()}</p>
                </div>
                <div className="panel p-3 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                    <Send className="w-3.5 h-3.5 text-neon-blue" />
                    Transferred
                  </div>
                  <p className="font-mono font-bold text-neon-blue text-lg">{totalTransferred.toLocaleString()}</p>
                </div>
                <div className="panel p-3 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                    {netFlow >= 0
                      ? <TrendingUp className="w-3.5 h-3.5 text-neon-green" />
                      : <TrendingDown className="w-3.5 h-3.5 text-neon-pink" />
                    }
                    Net Flow
                  </div>
                  <p className={cn('font-mono font-bold text-lg', netFlow >= 0 ? 'text-neon-green' : 'text-neon-pink')}>
                    {netFlow >= 0 ? '+' : ''}{netFlow.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Transaction Filters */}
              <div className="flex gap-2">
                {(['all', 'earn', 'spend', 'transfer'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setTxFilter(f)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm capitalize transition-colors',
                      txFilter === f
                        ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                        : 'bg-lattice-surface text-gray-400 hover:text-white'
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>

              {/* Transaction History */}
              <div className="panel p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-neon-blue" />
                  Transaction History
                  <span className="text-xs text-gray-500 font-normal">({filteredTransactions.length})</span>
                </h2>
                {filteredTransactions.length === 0 ? (
                  <div className="text-center py-8">
                    <ArrowRightLeft className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                    <p className="text-gray-500">No transactions found.</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {txFilter !== 'all' ? 'Try changing the filter or ' : ''}Start by earning some tokens.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTransactions.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-8 h-8 rounded-full flex items-center justify-center',
                            tx.type === 'earn' ? 'bg-neon-green/20' : tx.type === 'spend' ? 'bg-neon-pink/20' : 'bg-neon-blue/20'
                          )}>
                            {tx.type === 'earn' && <ArrowDownLeft className="w-4 h-4 text-neon-green" />}
                            {tx.type === 'spend' && <ArrowUpRight className="w-4 h-4 text-neon-pink" />}
                            {tx.type === 'transfer' && <Send className="w-4 h-4 text-neon-blue" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{tx.description}</p>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span>{new Date(tx.timestamp).toLocaleString()}</span>
                              {tx.to && <span>To: {tx.to}</span>}
                            </div>
                          </div>
                        </div>
                        <span className={cn(
                          'font-mono font-semibold',
                          tx.type === 'earn' ? 'text-neon-green' : tx.type === 'spend' ? 'text-neon-pink' : 'text-neon-blue'
                        )}>
                          {tx.type === 'earn' ? '+' : '-'}{tx.amount} {tx.symbol}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'wallets' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Settings className="w-4 h-4 text-neon-purple" />
                  Wallet Management
                </h2>
                <button
                  onClick={() => setShowAddWallet(true)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-neon-green/20 text-neon-green rounded-lg hover:bg-neon-green/30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Wallet
                </button>
              </div>

              {wallets.length === 0 ? (
                <div className="panel p-8 text-center">
                  <Wallet className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                  <p className="text-gray-500">No wallets configured.</p>
                  <p className="text-sm text-gray-600 mt-1">Add a wallet to manage your addresses.</p>
                  <button
                    onClick={() => setShowAddWallet(true)}
                    className="mt-3 btn-neon green text-sm"
                  >
                    <Plus className="w-4 h-4 inline mr-1" />
                    Add Wallet
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {wallets.map((wallet, widx) => {
                    const chainColor = ALLOC_COLORS[widx % ALLOC_COLORS.length];
                    const shortAddr = wallet.address.length > 12
                      ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                      : wallet.address;
                    return (
                      <div key={wallet.id} className="panel p-4 flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          {/* Chain-colored icon badge */}
                          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', `bg-${chainColor.bg.replace('bg-', '')}/20`)}>
                            <Wallet className={cn('w-5 h-5', chainColor.text)} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold">{wallet.name}</h3>
                              {wallet.isDefault && (
                                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-neon-green/15 text-neon-green border border-neon-green/30">
                                  <ShieldCheck className="w-3 h-3" />
                                  Verified
                                </span>
                              )}
                              <span className={cn('text-xs px-2 py-0.5 rounded-full border font-mono', `${chainColor.bg}/10 ${chainColor.text} border-${chainColor.bg.replace('bg-','')}/30`)}>
                                {wallet.chainId || 'unknown'}
                              </span>
                            </div>
                            {/* Address with copy-on-hover effect */}
                            <button
                              onClick={() => handleCopyAddress(wallet.address)}
                              className="flex items-center gap-1.5 mt-0.5 group/addr"
                              title="Click to copy full address"
                            >
                              <p className="text-xs text-gray-400 font-mono tracking-wide group-hover/addr:text-white transition-colors">
                                {copiedAddress === wallet.address ? wallet.address : shortAddr}
                              </p>
                              <span className="opacity-0 group-hover/addr:opacity-100 transition-opacity">
                                {copiedAddress === wallet.address
                                  ? <Check className="w-3 h-3 text-neon-green" />
                                  : <Copy className="w-3 h-3 text-gray-500" />
                                }
                              </span>
                            </button>
                            <p className="text-xs text-gray-600 mt-0.5">
                              Added {new Date().toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopyAddress(wallet.address)}
                            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                            title="Copy address"
                          >
                            {copiedAddress === wallet.address ? <Check className="w-4 h-4 text-neon-green" /> : <Copy className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleDeleteWallet(wallet.id)}
                            className="p-2 text-gray-400 hover:text-neon-pink transition-colors rounded-lg hover:bg-neon-pink/10"
                            title="Remove wallet"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Send Modal */}
      <AnimatePresence>
        {showSendModal && selectedChainData && (
          <motion.div
            key="send-modal-backdrop"
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShowSendModal(false)}
          >
            <motion.div
              key="send-modal-panel"
              className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-md space-y-4"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Send {selectedChainData.symbol}</h2>
                <button onClick={() => setShowSendModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <p className="text-sm text-gray-400">
                Available: {showBalances ? `${selectedChainData.balance} ${selectedChainData.symbol}` : '****'}
              </p>
              <input
                type="text"
                placeholder="Recipient address or name"
                value={sendTo}
                onChange={e => setSendTo(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <input
                type="number"
                placeholder="Amount"
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
                max={selectedChainData.balance}
                min={0}
                step="any"
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={sendDescription}
                onChange={e => setSendDescription(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowSendModal(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-lattice-surface">Cancel</button>
                <button
                  onClick={handleSend}
                  disabled={transacting || !sendTo || !sendAmount || parseFloat(sendAmount) <= 0 || parseFloat(sendAmount) > selectedChainData.balance}
                  className="px-4 py-2 rounded-lg text-sm bg-neon-blue text-white hover:bg-neon-blue/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {transacting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Wallet Modal */}
      <AnimatePresence>
        {showAddWallet && (
          <motion.div
            key="add-wallet-backdrop"
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShowAddWallet(false)}
          >
            <motion.div
              key="add-wallet-panel"
              className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-md space-y-4"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Add Wallet</h2>
                <button onClick={() => setShowAddWallet(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <input
                type="text"
                placeholder="Wallet Name"
                value={walletName}
                onChange={e => setWalletName(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <input
                type="text"
                placeholder="Wallet Address"
                value={walletAddress}
                onChange={e => setWalletAddress(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <input
                type="text"
                placeholder="Chain ID (e.g., concord)"
                value={walletChainId}
                onChange={e => setWalletChainId(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowAddWallet(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-lattice-surface">Cancel</button>
                <button
                  onClick={handleAddWallet}
                  disabled={!walletName || !walletAddress}
                  className="px-4 py-2 rounded-lg text-sm bg-neon-green text-white hover:bg-neon-green/80 disabled:opacity-50"
                >
                  Add Wallet
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Chain Modal */}
      <AnimatePresence>
        {showAddChain && (
          <motion.div
            key="add-chain-backdrop"
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShowAddChain(false)}
          >
            <motion.div
              key="add-chain-panel"
              className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-md space-y-4"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Add Chain</h2>
                <button onClick={() => setShowAddChain(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <input
                type="text"
                placeholder="Chain Name (e.g., Concord Credits)"
                value={chainName}
                onChange={e => setChainName(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <input
                type="text"
                placeholder="Symbol (e.g., CC)"
                value={chainSymbol}
                onChange={e => setChainSymbol(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowAddChain(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-lattice-surface">Cancel</button>
                <button
                  onClick={handleAddChain}
                  disabled={!chainName || !chainSymbol}
                  className="px-4 py-2 rounded-lg text-sm bg-neon-green text-white hover:bg-neon-green/80 disabled:opacity-50"
                >
                  Add Chain
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backend Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm text-gray-300 uppercase tracking-wider">
          <BarChart3 className="w-4 h-4 text-neon-green" />
          Crypto Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'portfolioAnalysis', label: 'Analyze Portfolio' },
            { action: 'verifyTransaction', label: 'Verify Transaction' },
            { action: 'estimateGas', label: 'Estimate Gas Fees' },
            { action: 'detectPatterns', label: 'Detect Patterns' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleRunAction(action)}
              disabled={isRunningAction}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunningAction ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="relative rounded-lg bg-lattice-deep border border-lattice-border p-4">
            <button
              onClick={() => setActionResult(null)}
              className="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
              aria-label="Dismiss result"
            >
              <XCircle className="w-4 h-4" />
            </button>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Result</p>
            {(() => {
              const r: ActionResultData = (actionResult?.result as ActionResultData) ?? actionResult;
              if (!r) return null;
              return (
                <div className="text-xs space-y-3 max-h-72 overflow-y-auto">
                  {/* Error */}
                  {actionResult?.error && (
                    <p className="text-red-400">{actionResult.error}</p>
                  )}
                  {r?.message && !r?.error && (
                    <p className="text-gray-300">{r.message}</p>
                  )}

                  {/* portfolioAnalysis */}
                  {r?.totalValue !== undefined && r?.allocations !== undefined && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-green">${r.totalValue.toLocaleString()}</p>
                          <p className="text-[10px] text-gray-500">Total Value</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className={`text-sm font-bold ${(r.totalUnrealizedPnl ?? 0) >= 0 ? 'text-neon-green' : 'text-red-400'}`}>
                            {r.totalUnrealizedPnl != null ? `${r.totalUnrealizedPnl >= 0 ? '+' : ''}$${r.totalUnrealizedPnl.toLocaleString()}` : '—'}
                          </p>
                          <p className="text-[10px] text-gray-500">Unrealized P&L</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Concentration:</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.concentrationRisk === 'low' ? 'bg-neon-green/20 text-neon-green' : r.concentrationRisk === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' : r.concentrationRisk === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'}`}>
                          {r.concentrationRisk}
                        </span>
                        <span className="ml-auto text-gray-500">HHI: {r.hhi}</span>
                      </div>
                      <div className="space-y-1">
                        {(r.allocations as Allocation[]).map((h: Allocation) => (
                          <div key={h.token} className="flex items-center gap-2">
                            <span className="text-gray-300 w-12 font-mono">{h.token}</span>
                            <div className="flex-1 bg-lattice-bg rounded-full h-1.5">
                              <div className="bg-neon-green h-1.5 rounded-full" style={{ width: `${h.weight}%` }} />
                            </div>
                            <span className="text-gray-400 w-10 text-right">{h.weight}%</span>
                          </div>
                        ))}
                      </div>
                      {(r.stablecoinExposure ?? 0) > 0 && (
                        <p className="text-[10px] text-gray-500">Stablecoin exposure: {r.stablecoinExposure}%</p>
                      )}
                    </div>
                  )}

                  {/* verifyTransaction */}
                  {r?.checks !== undefined && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.valid ? 'bg-neon-green/20 text-neon-green' : 'bg-red-500/20 text-red-400'}`}>
                          {r.valid ? 'VALID' : 'INVALID'}
                        </span>
                        <span className="text-gray-400">{r.network}</span>
                        <span className="ml-auto text-gray-500">Gas: {r.maxGasCostEth} ETH</span>
                      </div>
                      {(r.warnings?.length ?? 0) > 0 && (
                        <div className="space-y-1">
                          {(r.warnings as string[]).map((w: string, i: number) => (
                            <div key={i} className="flex items-center gap-1.5 text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">
                              <span className="text-[10px]">{w}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-1">
                        {(r.checks as TransactionCheck[]).map((c: TransactionCheck) => (
                          <div key={c.field} className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-500 font-mono">{c.field}</span>
                            <span className={c.valid ? 'text-neon-green' : 'text-red-400'}>{c.valid ? 'OK' : 'FAIL'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* estimateGas */}
                  {r?.recommendations !== undefined && r?.gasLimit !== undefined && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-neon-green">{r.gasLimit.toLocaleString()}</p>
                          <p className="text-[10px] text-gray-500">Gas Limit</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className={`font-bold ${r.networkCongestion === 'low' ? 'text-neon-green' : r.networkCongestion === 'moderate' ? 'text-yellow-400' : 'text-red-400'}`}>{r.networkCongestion ?? 'N/A'}</p>
                          <p className="text-[10px] text-gray-500">Congestion</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['slow', 'standard', 'fast'] as const).map(speed => (
                          <div key={speed} className="p-2 bg-lattice-bg rounded text-center space-y-0.5">
                            <p className="text-[10px] text-gray-500 capitalize">{speed}</p>
                            <p className="font-bold text-neon-green text-sm">{(r.recommendations as Record<string, GasRecommendation>)[speed].maxFeeGwei} Gwei</p>
                            <p className="text-[10px] text-gray-500">+{(r.recommendations as Record<string, GasRecommendation>)[speed].priorityFeeGwei} tip</p>
                            <p className="text-[10px] text-gray-400">{(r.recommendations as Record<string, GasRecommendation>)[speed].waitBlocks} blocks</p>
                          </div>
                        ))}
                      </div>
                      {r.baseFeeStats && (
                        <p className="text-[10px] text-gray-500">Avg base fee: {r.baseFeeStats.avg} Gwei · {r.blocksAnalyzed ?? 0} blocks</p>
                      )}
                    </div>
                  )}

                  {/* detectPatterns */}
                  {r?.patterns !== undefined && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-red-400">{r.riskSummary?.high ?? 0}</p>
                          <p className="text-[10px] text-gray-500">High Risk</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-yellow-400">{r.riskSummary?.moderate ?? 0}</p>
                          <p className="text-[10px] text-gray-500">Moderate</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-neon-green">{r.riskSummary?.informational ?? 0}</p>
                          <p className="text-[10px] text-gray-500">Info</p>
                        </div>
                      </div>
                      <p className="text-gray-500">Scanned {r.totalTransactions} transactions</p>
                      {r.patterns.length === 0 && (
                        <p className="text-neon-green text-[11px]">No suspicious patterns detected.</p>
                      )}
                      <div className="space-y-1">
                        {(r.patterns as DetectedPattern[]).map((p: DetectedPattern, i: number) => (
                          <div key={i} className="p-2 bg-lattice-bg rounded space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-200 font-mono text-[10px]">{p.type.replace(/_/g, ' ')}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${p.risk === 'high' ? 'bg-red-500/20 text-red-400' : p.risk === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>
                                {p.risk}
                              </span>
                            </div>
                            {p.hops && <p className="text-[10px] text-gray-500">{p.hops} hops</p>}
                            {p.occurrences && <p className="text-[10px] text-gray-500">{p.occurrences} occurrences</p>}
                            {p.count && p.type === 'whale_movement' && <p className="text-[10px] text-gray-500">{p.count} whale txs · largest: {p.largest}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

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
            <LensFeaturePanel lensId="crypto" />
          </div>
        )}
      </div>
    </div>
  );
}
