'use client';

import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  DollarSign,
  Eye,
  Loader2,
  Package,
  Play,
  Plus,
  Star,
  Store,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import { PipingProvider } from '@/components/panel-polish';
import { MarketplaceActionPanel } from '@/components/marketplace/MarketplaceActionPanel';
import { ShopfrontSection } from '@/components/marketplace/ShopfrontSection';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { useQueryClient } from '@tanstack/react-query';
import type { DTU } from '@/lib/api/generated-types';
import { cn } from '@/lib/utils';
import { starRating } from './ItemCard';
import { useMarketplace } from './MarketplaceProvider';
import { LICENSE_TIERS, typeIcon } from './types';

export function SellPanel() {
  const m = useMarketplace();
  const queryClient = useQueryClient();
  const { contextDTUs: marketDTUs } = useLensDTUs({ lens: 'marketplace' });
  const runAction = useRunArtifact('marketplace');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [showPackBuilder, setShowPackBuilder] = useState(false);
  const [packForm, setPackForm] = useState({ name: '', description: '', price: '' });
  const [packSelectedDTUs, setPackSelectedDTUs] = useState<string[]>([]);
  const [packSubmitting, setPackSubmitting] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const handleAction = useCallback(
    async (action: string) => {
      const targetId = m.listingItems[0]?.id;
      if (!targetId) {
        setActionResult({
          message: m.isListingError
            ? "Couldn't load your listings, so there's nothing to analyse yet — retry in a moment."
            : m.isListingLoading
              ? 'Still loading your listings — try again in a second.'
              : 'No listings found. Add a listing first to run analysis.',
        });
        return;
      }
      setIsRunning(action);
      try {
        const res = await runAction.mutateAsync({ id: targetId, action });
        if (res.ok === false) {
          setActionResult({
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setActionResult(res.result as Record<string, unknown>);
        }
      } catch (e) {
        console.error(`Action ${action} failed:`, e);
        setActionResult({
          message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      } finally {
        setIsRunning(null);
      }
    },
    [m.listingItems, m.isListingError, m.isListingLoading, runAction]
  );

  const handleCreatePack = useCallback(async () => {
    if (!packForm.name.trim() || packSelectedDTUs.length === 0 || packSubmitting) return;
    setPackSubmitting(true);
    setPackError(null);
    try {
      const resp = await api.post('/api/marketplace/pack', {
        name: packForm.name.trim(),
        description: packForm.description.trim(),
        dtu_ids: packSelectedDTUs,
        price: Number(packForm.price) || 10,
      });
      if (resp.data.ok) {
        setShowPackBuilder(false);
        setPackForm({ name: '', description: '', price: '' });
        setPackSelectedDTUs([]);
        queryClient.invalidateQueries({ queryKey: ['marketplace-packs'] });
      } else {
        setPackError(resp.data.error || 'Failed to create pack');
      }
    } catch (err) {
      setPackError(err instanceof Error ? err.message : 'Failed to create pack');
    } finally {
      setPackSubmitting(false);
    }
  }, [packForm, packSelectedDTUs, packSubmitting, queryClient]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ShopfrontSection />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Sales',
            value: m.shopStats.totalSales,
            icon: TrendingUp,
            color: 'text-neon-green',
          },
          {
            label: 'Revenue',
            value: `$${m.shopStats.revenue.toLocaleString()}`,
            icon: DollarSign,
            color: 'text-neon-cyan',
          },
          {
            label: 'Items Listed',
            value: m.shopStats.itemsListed,
            icon: Package,
            color: 'text-neon-purple',
          },
          {
            label: 'Avg Rating',
            value: m.shopStats.avgRating,
            icon: Star,
            color: 'text-yellow-400',
          },
        ].map((s) => (
          <div key={s.label} className="lens-card p-4 space-y-1">
            <div className="flex items-center gap-2 text-gray-400 text-xs">
              <s.icon className={cn('w-4 h-4', s.color)} /> {s.label}
            </div>
            <p className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your Listings</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPackBuilder(true)}
            className="btn-neon flex items-center gap-2 text-sm"
          >
            <Package className="w-4 h-4" /> Create Pack
          </button>
          <button
            onClick={() => m.setShowNewListing(true)}
            className="btn-neon purple flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" /> New Listing
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {m.allItems.slice(0, 3).map((item) => (
          <div key={item.id} className="panel p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-lattice-deep flex items-center justify-center">
              {(() => {
                const I = typeIcon(item.type);
                return <I className="w-5 h-5 text-gray-400" />;
              })()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{item.title}</p>
              <p className="text-xs text-gray-400 tabular-nums">
                {item.type} -- {item.sales} sales -- ${item.prices.basic}+
              </p>
            </div>
            <div className="flex items-center gap-1">{starRating(item.rating)}</div>
            <span className="text-neon-green text-sm font-bold tabular-nums">
              ${(item.sales * item.prices.basic * 0.7).toFixed(0)}
            </span>
            <button
              onClick={() => {
                m.setTab('browse');
                m.setSearch(item.title);
              }}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              title="View in browse"
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {m.showNewListing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => m.setShowNewListing(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-lg p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Create New Listing</h3>
                <button
                  onClick={() => m.setShowNewListing(false)}
                  className="text-gray-400 hover:text-white"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <input
                  placeholder="Title"
                  value={m.newListingForm.title}
                  onChange={(e) => m.setNewListingForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                />
                <select
                  value={m.newListingForm.type}
                  onChange={(e) => m.setNewListingForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
                >
                  <option value="template">Template</option>
                  <option value="component">Component</option>
                  <option value="dataset">Dataset</option>
                  <option value="artwork">Artwork</option>
                  <option value="plugin">Plugin</option>
                  <option value="preset">Preset</option>
                </select>
                <textarea
                  placeholder="Description"
                  rows={3}
                  value={m.newListingForm.description}
                  onChange={(e) =>
                    m.setNewListingForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none resize-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    placeholder="Genre"
                    value={m.newListingForm.genre}
                    onChange={(e) => m.setNewListingForm((f) => ({ ...f, genre: e.target.value }))}
                    className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                  />
                  <input
                    placeholder="Tags (comma separated)"
                    value={m.newListingForm.tags}
                    onChange={(e) => m.setNewListingForm((f) => ({ ...f, tags: e.target.value }))}
                    className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                  />
                </div>
                <p className="text-xs text-gray-400 font-medium">Pricing per License Tier</p>
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'basic', field: 'basicPrice' as const },
                      { id: 'premium', field: 'premiumPrice' as const },
                      { id: 'unlimited', field: 'unlimitedPrice' as const },
                      { id: 'exclusive', field: 'exclusivePrice' as const },
                    ] as const
                  ).map((t) => {
                    const tier = LICENSE_TIERS.find((lt) => lt.id === t.id)!;
                    return (
                      <div key={t.id} className="space-y-1">
                        <label className={cn('text-[10px] font-medium', tier.color)}>
                          {tier.name}
                        </label>
                        <input
                          type="number"
                          placeholder="$"
                          value={m.newListingForm[t.field]}
                          onChange={(e) =>
                            m.setNewListingForm((f) => ({ ...f, [t.field]: e.target.value }))
                          }
                          className="w-full px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 p-4 border-2 border-dashed border-lattice-border rounded-lg justify-center text-gray-400 text-sm cursor-pointer hover:border-neon-purple/50 transition-colors">
                  <Upload className="w-5 h-5" /> Upload files
                </div>
              </div>
              {m.listingError && (
                <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                  {m.listingError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    m.setShowNewListing(false);
                    m.setListingError(null);
                  }}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={m.handlePublishListing}
                  disabled={!m.newListingForm.title.trim() || m.listingSubmitting}
                  className={cn(
                    'btn-neon purple text-sm',
                    (!m.newListingForm.title.trim() || m.listingSubmitting) &&
                      'opacity-50 cursor-not-allowed'
                  )}
                >
                  {m.listingSubmitting ? 'Publishing...' : 'Publish Listing'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPackBuilder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowPackBuilder(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Package className="w-5 h-5 text-neon-cyan" />
                  Create Knowledge Pack
                </h3>
                <button
                  onClick={() => setShowPackBuilder(false)}
                  className="text-gray-400 hover:text-white"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Bundle DTUs into a collection and list it on the marketplace.
              </p>
              <div className="space-y-3">
                <input
                  placeholder="Pack Name"
                  value={packForm.name}
                  onChange={(e) => setPackForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none"
                />
                <textarea
                  placeholder="Description"
                  rows={2}
                  value={packForm.description}
                  onChange={(e) => setPackForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none resize-none"
                />
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Price (CC)</label>
                  <input
                    type="number"
                    placeholder="10"
                    value={packForm.price}
                    onChange={(e) => setPackForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">
                    Select DTUs ({packSelectedDTUs.length} selected)
                  </label>
                  <div className="max-h-48 overflow-y-auto border border-lattice-border rounded-lg divide-y divide-lattice-border">
                    {marketDTUs.length === 0 && (
                      <p className="text-xs text-gray-400 p-3 text-center">
                        No DTUs available. Ingest content first.
                      </p>
                    )}
                    {marketDTUs.map((dtu: DTU) => {
                      const isSelected = packSelectedDTUs.includes(dtu.id);
                      return (
                        <button
                          key={dtu.id}
                          onClick={() => {
                            setPackSelectedDTUs((prev) =>
                              isSelected ? prev.filter((id) => id !== dtu.id) : [...prev, dtu.id]
                            );
                          }}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-lattice-elevated transition-colors',
                            isSelected && 'bg-neon-cyan/5'
                          )}
                        >
                          <span
                            className={cn(
                              'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                              isSelected ? 'bg-neon-cyan border-neon-cyan' : 'border-gray-600'
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span className="truncate flex-1 text-gray-300">
                            {dtu.title || dtu.id.slice(0, 12)}
                          </span>
                          {dtu.tier && dtu.tier !== 'regular' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple">
                              {dtu.tier}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {packError && (
                <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{packError}</p>
              )}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-gray-400">
                  {packSelectedDTUs.length} DTU{packSelectedDTUs.length !== 1 ? 's' : ''} in pack
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowPackBuilder(false);
                      setPackError(null);
                    }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreatePack}
                    disabled={
                      !packForm.name.trim() || packSelectedDTUs.length === 0 || packSubmitting
                    }
                    className={cn(
                      'btn-neon text-sm',
                      (!packForm.name.trim() || packSelectedDTUs.length === 0 || packSubmitting) &&
                        'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {packSubmitting
                      ? 'Creating...'
                      : `Create Pack (${packSelectedDTUs.length} DTUs)`}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PipingProvider>
        <MarketplaceActionPanel />
      </PipingProvider>

      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Store className="w-4 h-4 text-neon-green" />
          Marketplace Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'listingScore', label: 'Listing Score' },
            { action: 'priceOptimize', label: 'Price Optimize' },
            { action: 'sellerMetrics', label: 'Seller Metrics' },
            { action: 'marketTrend', label: 'Market Trend' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleAction(action)}
              disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
            >
              {isRunning === action ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'score' in actionResult && 'maxScore' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-neon-cyan font-bold text-xl">
                    {String(actionResult.score)}
                    <span className="text-gray-400 text-sm">/{String(actionResult.maxScore)}</span>
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      actionResult.rating === 'Excellent'
                        ? 'bg-neon-green/20 text-neon-green'
                        : actionResult.rating === 'Good'
                          ? 'bg-neon-cyan/20 text-neon-cyan'
                          : 'bg-yellow-400/20 text-yellow-400'
                    }`}
                  >
                    {String(actionResult.rating)}
                  </span>
                </div>
                {'tips' in actionResult &&
                  Array.isArray(actionResult.tips) &&
                  actionResult.tips.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">Tips</p>
                      {(actionResult.tips as string[]).map((t, i) => (
                        <p key={i} className="text-xs text-gray-300">
                          • {t}
                        </p>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {'suggestedPrice' in actionResult && (
              <div className="space-y-1">
                <div className="flex gap-4">
                  <span className="text-gray-400 text-xs">
                    Current: <span className="text-white">${String(actionResult.currentPrice)}</span>
                  </span>
                  <span className="text-gray-400 text-xs">
                    Suggested:{' '}
                    <span className="text-neon-green font-bold">
                      ${String(actionResult.suggestedPrice)}
                    </span>
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>
                    Margin: <span className="text-neon-cyan">{String(actionResult.margin)}%</span>
                  </span>
                  <span>
                    Position:{' '}
                    <span className="text-yellow-400">{String(actionResult.positioning)}</span>
                  </span>
                </div>
              </div>
            )}
            {'totalOrders' in actionResult && (
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">
                  Orders:{' '}
                  <span className="text-neon-cyan font-bold">
                    {String(actionResult.totalOrders)}
                  </span>
                </span>
                <span className="text-gray-400">
                  Revenue:{' '}
                  <span className="text-neon-green font-bold">
                    ${String(actionResult.totalRevenue)}
                  </span>
                </span>
                <span className="text-gray-400">
                  Level: <span className="text-yellow-400">{String(actionResult.sellerLevel)}</span>
                </span>
                <span className="text-gray-400">
                  Fulfillment:{' '}
                  <span className="text-neon-cyan">{String(actionResult.fulfillmentRate)}%</span>
                </span>
              </div>
            )}
            {'trends' in actionResult && Array.isArray(actionResult.trends) && (
              <div className="space-y-2">
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>
                    Listings:{' '}
                    <span className="text-neon-cyan">{String(actionResult.totalListings)}</span>
                  </span>
                  <span>
                    Categories:{' '}
                    <span className="text-neon-cyan">{String(actionResult.categories)}</span>
                  </span>
                </div>
                {'hottest' in actionResult &&
                  Array.isArray(actionResult.hottest) &&
                  actionResult.hottest.length > 0 && (
                    <div>
                      <p className="text-xs text-neon-green font-semibold mb-1">Hottest</p>
                      <div className="flex flex-wrap gap-1">
                        {(actionResult.hottest as string[]).map((h, i) => (
                          <span
                            key={i}
                            className="text-xs bg-neon-green/10 border border-neon-green/20 rounded px-2 py-0.5 text-neon-green"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
            {'message' in actionResult && (
              <p className="text-gray-400">{String(actionResult.message)}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
