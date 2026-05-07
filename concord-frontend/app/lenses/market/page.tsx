'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { MarketEmpireListing } from '@/components/market/MarketEmpireListing';
import {
  Store, TrendingUp, Package, Coins, Search, Filter, X,
  ShoppingCart, Tag, ArrowUpRight, ArrowDownRight,
  RefreshCw, Layers, ChevronDown, DollarSign, BarChart3, Play, Loader2,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion } from 'framer-motion';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface MarketListingItem {
  id: string;
  title?: string;
  description?: string;
  price?: number;
  seller?: string;
  createdAt?: string;
  tags?: string[];
  type?: string;
  rating?: number;
  purchases?: number;
}

type SortField = 'newest' | 'price-asc' | 'price-desc' | 'popular';
type ListingType = 'all' | 'template' | 'component' | 'dataset' | 'artwork';

export default function MarketLensPage() {
  useLensNav('market');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('market');
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newType, setNewType] = useState('beat');
  const [newTags, setNewTags] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ListingType>('all');
  const [sortBy, setSortBy] = useState<SortField>('newest');
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [showPurchaseConfirm, setShowPurchaseConfirm] = useState<MarketListingItem | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  const { items: marketItems } = useLensData('market', 'data', { noSeed: true });
  const runAction = useRunArtifact('market');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = marketItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'No market data artifact found. Add price data to analyze.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  // Backend: GET /api/marketplace/listings
  const { data: listings, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['marketplace-listings'],
    queryFn: () => apiHelpers.marketplace.listings().then((r) => r.data),
  });

  // Backend: GET /api/economy/balance
  const { data: wallet } = useQuery({
    queryKey: ['economy-balance'],
    queryFn: () => apiHelpers.economy.balance().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload: { title: string; description: string; price: number; type: string }) =>
      apiHelpers.marketplace.submit(payload as unknown as { name: string; githubUrl: string; description?: string; category?: string }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace-listings'] });
      setShowCreate(false);
      setNewTitle('');
      setNewDescription('');
      setNewPrice('');
      setNewType('beat');
      setNewTags('');
    },
    onError: (err) => console.error('createMutation failed:', err instanceof Error ? err.message : err),
  });

  const purchaseMutation = useMutation({
    mutationFn: (listingId: string) =>
      apiHelpers.durableMarketplace.purchase(listingId, 'me'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace-listings'] });
      queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
      setShowPurchaseConfirm(null);
      setPurchasingId(null);
    },
    onError: (err) => {
      console.error('purchaseMutation failed:', err instanceof Error ? err.message : err);
      setPurchasingId(null);
    },
  });

  // Filter and sort listings
  const filteredListings = useMemo(() => {
    const raw: MarketListingItem[] = listings?.listings || [];
    let result = raw;

    // Filter by type
    if (filterType !== 'all') {
      result = result.filter((l) => l.type === filterType);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.title?.toLowerCase().includes(q) ||
          l.description?.toLowerCase().includes(q) ||
          l.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    // Sort
    switch (sortBy) {
      case 'price-asc':
        result = [...result].sort((a, b) => (a.price || 0) - (b.price || 0));
        break;
      case 'price-desc':
        result = [...result].sort((a, b) => (b.price || 0) - (a.price || 0));
        break;
      case 'popular':
        result = [...result].sort((a, b) => (b.purchases || 0) - (a.purchases || 0));
        break;
      case 'newest':
      default:
        result = [...result].sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
    }

    return result;
  }, [listings, filterType, searchQuery, sortBy]);

  const totalVolume = listings?.volume ?? 0;
  const totalTransactions = listings?.transactions ?? 0;
  const totalListings = listings?.listings?.length || 0;
  const libraryCount = listings?.library?.length ?? 0;

  const handlePurchase = (listing: MarketListingItem) => {
    setShowPurchaseConfirm(listing);
  };

  const confirmPurchase = () => {
    if (!showPurchaseConfirm) return;
    setPurchasingId(showPurchaseConfirm.id);
    purchaseMutation.mutate(showPurchaseConfirm.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-purple border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400 animate-pulse">Loading marketplace data...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏪</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Market Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">
              DTU marketplace, listings, and economy simulation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="market" data={{}} compact />
          <button className="px-3 py-2 text-sm bg-lattice-surface rounded-lg text-gray-400 hover:text-white transition-colors" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="btn-neon purple" onClick={() => setShowCreate(!showCreate)}>
            <Store className="w-4 h-4 mr-2 inline" />
            Create Listing
          </button>
        </div>
      </header>

      <RealtimeDataPanel domain="market" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="market" artifactId={null} compact />

      {/* Wallet Banner */}
      {wallet && (
        <div className="panel p-3 flex items-center justify-between bg-gradient-to-r from-neon-purple/5 to-neon-cyan/5">
          <div className="flex items-center gap-3">
            <Coins className="w-5 h-5 text-neon-cyan" />
            <span className="text-sm text-gray-300">Your Balance</span>
          </div>
          <span className="text-lg font-bold text-neon-cyan">{wallet.balance ?? 0} CC</span>
        </div>
      )}

      {/* Create Listing Form */}
      {showCreate && (
        <div className="panel p-4 space-y-3 border border-neon-purple/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Store className="w-4 h-4 text-neon-purple" />
            New Listing
          </h2>
          <input
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
            placeholder="Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <textarea
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none resize-none"
            placeholder="Description"
            rows={3}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
              placeholder="Price (CC)"
              type="number"
              min="0"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
            />
            <select
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
            >
              <option value="template">Template</option>
              <option value="component">Component</option>
              <option value="dataset">Dataset</option>
              <option value="artwork">Artwork</option>
            </select>
            <input
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
              placeholder="Tags (comma-separated)"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
            />
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-400">
              {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create listing'}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
            <button
              className="btn-neon purple text-sm"
              disabled={!newTitle.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  title: newTitle.trim(),
                  description: newDescription.trim(),
                  price: Number(newPrice) || 0,
                  type: newType,
                })
              }
            >
              {createMutation.isPending ? 'Creating...' : 'Submit Listing'}
            </button>
          </div>
        </div>
      )}

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Store className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{totalListings}</p>
            <p className="text-xs text-gray-500">Listings</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{totalVolume} CC</p>
            <p className="text-xs text-gray-500">Volume</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{totalTransactions}</p>
            <p className="text-xs text-gray-500">Transactions</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{filteredListings.length > 0 ? `${((filteredListings.reduce((a, l) => a + (l.price || 0), 0) / filteredListings.length) || 0).toFixed(0)} CC` : '--'}</p>
            <p className="text-xs text-gray-500">Avg Price</p>
          </div>
        </motion.div>
      </div>

      {/* Market Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Store className="w-5 h-5" />} label="Active Listings" value={totalListings} trend={totalListings > 0 ? '+' : undefined} />
        <StatCard icon={<Package className="w-5 h-5" />} label="Your Library" value={libraryCount} />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Transactions" value={totalTransactions} trend={totalTransactions > 0 ? '+' : undefined} />
        <StatCard icon={<Coins className="w-5 h-5" />} label="Volume" value={`${totalVolume} CC`} />
      </div>

      {/* Search and Filter Bar */}
      <div className="panel p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className="w-full pl-10 pr-8 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
              placeholder="Search listings by title, description, or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-gray-300"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as ListingType)}
            >
              <option value="all">All Types</option>
              <option value="template">Templates</option>
              <option value="component">Components</option>
              <option value="dataset">Datasets</option>
              <option value="artwork">Artwork</option>
            </select>
            <select
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-gray-300"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
            >
              <option value="newest">Newest</option>
              <option value="price-asc">Price: Low-High</option>
              <option value="price-desc">Price: High-Low</option>
              <option value="popular">Most Popular</option>
            </select>
          </div>
        </div>
        {(searchQuery || filterType !== 'all') && (
          <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
            <Filter className="w-3 h-3" />
            <span>
              Showing {filteredListings.length} of {totalListings} listings
            </span>
            {filterType !== 'all' && (
              <span className="px-2 py-0.5 bg-neon-purple/10 text-neon-purple rounded flex items-center gap-1">
                <Tag className="w-3 h-3" />
                {filterType}
                <button onClick={() => setFilterType('all')}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Listings Grid */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-neon-green" />
          Active Listings
          <span className="text-xs text-gray-500 font-normal">({filteredListings.length})</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredListings.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-500 mb-2">
                {searchQuery || filterType !== 'all'
                  ? 'No listings match your filters'
                  : 'No listings yet. Create the first marketplace listing!'}
              </p>
              {(searchQuery || filterType !== 'all') && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterType('all'); }}
                  className="text-sm text-neon-purple hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            filteredListings.map((listing: MarketListingItem, index: number) => (
              <motion.div key={listing.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="relative">
                {purchasingId === listing.id && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-xl backdrop-blur-sm">
                    <div className="w-6 h-6 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <MarketEmpireListing
                  listing={listing}
                  onPurchase={() => handlePurchase(listing)}
                />
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-neon-green" />
          Market Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'trendAnalysis', label: 'Trend Analysis' },
            { action: 'competitorMatrix', label: 'Competitor Matrix' },
            { action: 'priceElasticity', label: 'Price Elasticity' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'overallTrend' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold uppercase ${
                    actionResult.overallTrend === 'bullish' ? 'text-neon-green' :
                    actionResult.overallTrend === 'bearish' ? 'text-red-400' : 'text-yellow-400'
                  }`}>{String(actionResult.overallTrend)}</span>
                  {'latestClose' in actionResult && <span className="text-gray-400 text-xs">Close: <span className="text-white">{String(actionResult.latestClose)}</span></span>}
                  {'rsi' in actionResult && actionResult.rsi !== null && <span className="text-gray-400 text-xs">RSI: <span className="text-neon-cyan">{String(actionResult.rsi)}</span></span>}
                </div>
                {'signals' in actionResult && Array.isArray(actionResult.signals) && actionResult.signals.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Signals</p>
                    {(actionResult.signals as Array<Record<string, unknown>>).map((s, i) => (
                      <div key={i} className={`text-xs px-2 py-1 rounded ${s.sentiment === 'bullish' ? 'bg-neon-green/10 text-neon-green' : 'bg-red-400/10 text-red-400'}`}>
                        {String(s.type)}: {String(s.detail || s.value || '')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'matrix' in actionResult && Array.isArray(actionResult.matrix) && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Competitors ({String((actionResult.matrix as unknown[]).length)})</p>
                {(actionResult.matrix as Array<Record<string, unknown>>).map((c, i) => (
                  <div key={i} className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1">
                    <span className="text-gray-300">{String(c.name)}</span>
                    <span className="text-neon-cyan">{String(c.compositeScore)}</span>
                  </div>
                ))}
                {'competitiveGaps' in actionResult && Array.isArray(actionResult.competitiveGaps) && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Competitive Gaps</p>
                    {(actionResult.competitiveGaps as Array<Record<string, unknown>>).filter(g => (g.gaps as unknown[]).length > 0).map((g, i) => (
                      <div key={i} className="text-xs text-yellow-400">
                        {String(g.name)}: {((g.gaps as Array<Record<string, unknown>>).map(gap => String(gap.feature))).join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'classification' in actionResult && (
              <div className="space-y-1">
                <span className="text-gray-400">Elasticity: <span className="text-neon-cyan font-bold">{String(actionResult.primaryElasticity)}</span></span>
                <span className="ml-3 text-xs text-gray-400">({String(actionResult.classification)})</span>
                {'loglogRegression' in actionResult && actionResult.loglogRegression !== null && typeof actionResult.loglogRegression === 'object' && (
                  <div className="text-xs text-gray-500 mt-1">R²: {String((actionResult.loglogRegression as Record<string, unknown>).rSquared)}</div>
                )}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
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
            <LensFeaturePanel lensId="market" />
          </div>
        )}
      </div>

      {/* Purchase Confirmation Modal */}
      {showPurchaseConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-neon-green" />
              Confirm Purchase
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Item</span>
                <span className="font-medium">{showPurchaseConfirm.title || 'Untitled'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Type</span>
                <span className="text-xs px-2 py-0.5 bg-neon-green/20 text-neon-green rounded">
                  {showPurchaseConfirm.type || 'DTU'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Price</span>
                <span className="text-lg font-bold text-neon-cyan">
                  {showPurchaseConfirm.price || 0} CC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Your Balance</span>
                <span className={`font-mono ${(wallet?.balance || 0) >= (showPurchaseConfirm.price || 0) ? 'text-neon-green' : 'text-red-400'}`}>
                  {wallet?.balance ?? 0} CC
                </span>
              </div>
            </div>
            {(wallet?.balance || 0) < (showPurchaseConfirm.price || 0) && (
              <p className="text-xs text-red-400 bg-red-400/10 p-2 rounded">
                Insufficient balance. You need {(showPurchaseConfirm.price || 0) - (wallet?.balance || 0)} more CC.
              </p>
            )}
            {purchaseMutation.isError && (
              <p className="text-xs text-red-400">
                {purchaseMutation.error instanceof Error ? purchaseMutation.error.message : 'Purchase failed'}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                onClick={() => { setShowPurchaseConfirm(null); setPurchasingId(null); }}
              >
                Cancel
              </button>
              <button
                className="btn-neon text-sm"
                disabled={
                  purchaseMutation.isPending ||
                  (wallet?.balance || 0) < (showPurchaseConfirm.price || 0)
                }
                onClick={confirmPurchase}
              >
                {purchaseMutation.isPending ? 'Processing...' : 'Confirm Purchase'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: '+' | '-';
}) {
  return (
    <div data-lens-theme="market" className="lens-card">
      <div className="flex items-center justify-between">
        <span className="text-neon-green">{icon}</span>
        <div className="flex items-center gap-1">
          <span className="text-2xl font-bold">{value}</span>
          {trend === '+' && <ArrowUpRight className="w-4 h-4 text-neon-green" />}
          {trend === '-' && <ArrowDownRight className="w-4 h-4 text-neon-pink" />}
        </div>

      {/* Real-time Data Panel */}
      </div>
      <p className="text-sm text-gray-400 mt-2">{label}</p>
    </div>
  );
}
