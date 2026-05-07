'use client';

import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shirt, Plus, Search, Trash2, Star, Tag, Palette, DollarSign, Layers, ChevronDown, X,
  Heart, Eye, Sparkles, Grid3X3, List, Loader2, Zap, TrendingUp, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ViewMode = 'grid' | 'list';
type Tab = 'wardrobe' | 'outfits' | 'wishlist';

interface FashionItem {
  name: string;
  category: string;
  color: string;
  brand: string;
  season: string;
  size: string;
  price: number;
  condition: 'new' | 'good' | 'worn' | 'donate';
  wearCount: number;
  lastWorn: string;
  notes: string;
}

interface OutfitCombo {
  name: string;
  items: string[];
  occasion: string;
  rating: number;
}

const CATEGORIES = ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories', 'Activewear', 'Formal'];
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter', 'All Season'];

const CONDITION_COLORS: Record<string, string> = {
  new: 'text-neon-green bg-neon-green/10 border-neon-green/20',
  good: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/20',
  worn: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  donate: 'text-red-400 bg-red-400/10 border-red-400/20',
};

const CATEGORY_COLORS: Record<string, string> = {
  Tops: 'from-blue-500/20 to-cyan-500/20',
  Bottoms: 'from-indigo-500/20 to-purple-500/20',
  Dresses: 'from-pink-500/20 to-rose-500/20',
  Outerwear: 'from-amber-500/20 to-orange-500/20',
  Shoes: 'from-green-500/20 to-emerald-500/20',
  Accessories: 'from-purple-500/20 to-fuchsia-500/20',
  Activewear: 'from-cyan-500/20 to-teal-500/20',
  Formal: 'from-gray-500/20 to-zinc-500/20',
};

export default function FashionLensPage() {
  useLensNav('fashion');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('fashion');
  const [tab, setTab] = useState<Tab>('wardrobe');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [newItem, setNewItem] = useState({ name: '', category: 'Tops', color: '', brand: '', price: 0, season: 'All Season', size: '' });

  // Outfits state
  const [outfits, setOutfits] = useState<OutfitCombo[]>([]);
  const [showCreateOutfit, setShowCreateOutfit] = useState(false);
  const [newOutfitName, setNewOutfitName] = useState('');
  const [newOutfitOccasion, setNewOutfitOccasion] = useState('');

  // Wishlist state
  const [wishlist, setWishlist] = useState<{ name: string; price: number; link: string }[]>([]);
  const [newWishItem, setNewWishItem] = useState('');
  const [newWishPrice, setNewWishPrice] = useState('');

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<FashionItem>('fashion', 'garment', { seed: [] });

  const runAction = useRunArtifact('fashion');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleFashionAction = useCallback(async (action: string) => {
    const targetId = items[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ _action: action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult({ _action: action, ...(res.result as Record<string, unknown>) }); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  }, [items, runAction]);

  const garments = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, name: item.title || item.data?.name || 'Untitled' }))
      .filter(g => (!search || g.name?.toLowerCase().includes(search.toLowerCase()) || g.brand?.toLowerCase().includes(search.toLowerCase())))
      .filter(g => !catFilter || g.category === catFilter),
    [items, search, catFilter]
  );

  const stats = useMemo(() => ({
    total: garments.length,
    totalValue: garments.reduce((s, g) => s + (g.price || 0), 0),
    categories: [...new Set(garments.map(g => g.category).filter(Boolean))].length,
    toDonate: garments.filter(g => g.condition === 'donate').length,
    mostWorn: [...garments].sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0))[0],
    costPerWear: garments.filter(g => g.wearCount > 0).length > 0
      ? Math.round(garments.filter(g => g.wearCount > 0).reduce((s, g) => s + (g.price || 0) / g.wearCount, 0) / garments.filter(g => g.wearCount > 0).length)
      : 0,
  }), [garments]);

  const handleCreate = useCallback(async () => {
    if (!newItem.name.trim()) return;
    await create({
      title: newItem.name,
      data: {
        name: newItem.name, category: newItem.category, color: newItem.color,
        brand: newItem.brand, season: newItem.season, size: newItem.size, price: newItem.price,
        condition: 'new', wearCount: 0, lastWorn: '', notes: '',
      },
    });
    setNewItem({ name: '', category: 'Tops', color: '', brand: '', price: 0, season: 'All Season', size: '' });
    setShowCreate(false);
  }, [newItem, create]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const TABS: { id: Tab; label: string; icon: typeof Shirt }[] = [
    { id: 'wardrobe', label: 'Wardrobe', icon: Shirt },
    { id: 'outfits', label: 'Outfits', icon: Sparkles },
    { id: 'wishlist', label: 'Wishlist', icon: Heart },
  ];

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="fashion" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-purple-500/20 flex items-center justify-center">
            <Shirt className="w-5 h-5 text-neon-purple" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Fashion Lens</h1>
            <p className="text-sm text-gray-400">Wardrobe & style management</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="fashion" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon purple">
          <Plus className="w-4 h-4 mr-2 inline" /> Add Item
        </button>
      </header>

      <UniversalActions domain="fashion" artifactId={items[0]?.id} compact />

      {/* Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-purple" />
          Fashion Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { action: 'styleProfile',  label: 'Style Profile',   icon: Shirt,      color: 'text-neon-purple' },
            { action: 'outfitSuggest', label: 'Outfit Suggest',  icon: Sparkles,   color: 'text-pink-400' },
            { action: 'trendAnalysis', label: 'Trend Analysis',  icon: TrendingUp, color: 'text-neon-cyan' },
            { action: 'costPerWear',   label: 'Cost Per Wear',   icon: BarChart3,  color: 'text-neon-green' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleFashionAction(action)}
              disabled={!!isRunning || !items[0]?.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-sm hover:border-white/20 disabled:opacity-40 transition-colors"
            >
              {isRunning === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className={`w-4 h-4 ${color}`} />}
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {actionResult && (
          <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
            <button onClick={() => setActionResult(null)} className="absolute top-3 right-3 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>

            {/* styleProfile */}
            {actionResult._action === 'styleProfile' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Style Profile</p>
                {(actionResult.message as string) ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Items', value: String(actionResult.wardrobeSize ?? 0) },
                        { label: 'Style', value: String(actionResult.style ?? '—') },
                        { label: 'Season', value: String(actionResult.season ?? '—') },
                        { label: 'Budget', value: String(actionResult.budget ?? '—') },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className="text-sm font-bold text-white capitalize">{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(actionResult.dominantColors) && (actionResult.dominantColors as {color:string;count:number}[]).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">Dominant Colors</p>
                        <div className="flex flex-wrap gap-2">
                          {(actionResult.dominantColors as {color:string;count:number}[]).map(c => (
                            <span key={c.color} className="text-xs px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 capitalize">{c.color} ×{c.count}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* outfitSuggest */}
            {actionResult._action === 'outfitSuggest' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Outfit Suggestions</p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>Occasion: <span className="text-white capitalize">{actionResult.occasion as string}</span></span>
                  <span>Season: <span className="text-white capitalize">{actionResult.season as string}</span></span>
                </div>
                {Array.isArray(actionResult.suggestions) && (actionResult.suggestions as Record<string,string>[]).length > 0 ? (
                  <div className="space-y-2">
                    {(actionResult.suggestions as Record<string,string>[]).map((s, i) => (
                      <div key={i} className="bg-white/5 rounded-lg p-3 text-sm">
                        {s.note ? <p className="text-gray-400 italic">{s.note}</p> : (
                          <div className="flex flex-wrap gap-3">
                            {s.top && <span className="text-white">Top: <span className="text-neon-purple">{s.top}</span></span>}
                            {s.bottom && <span className="text-white">Bottom: <span className="text-neon-cyan">{s.bottom}</span></span>}
                            {s.outerwear && <span className="text-white">Outerwear: <span className="text-yellow-400">{s.outerwear}</span></span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No suggestions available — add wardrobe items.</p>
                )}
              </div>
            )}

            {/* trendAnalysis */}
            {actionResult._action === 'trendAnalysis' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Trend Analysis</p>
                {(actionResult.message as string) ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Total Trends', value: String(actionResult.totalTrends ?? 0), color: 'text-white' },
                        { label: 'Categories', value: String(actionResult.categories ?? 0), color: 'text-neon-cyan' },
                        { label: 'Hottest', value: String(actionResult.hottest ?? '—'), color: 'text-pink-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold ${color} capitalize`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(actionResult.byCategory) && (
                      <div className="space-y-1">
                        {(actionResult.byCategory as {category:string;count:number;trending:number}[]).map(c => (
                          <div key={c.category} className="flex items-center gap-3 text-xs">
                            <span className="text-gray-400 w-24 capitalize truncate">{c.category}</span>
                            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-neon-purple/60 rounded-full" style={{ width: `${Math.min(100,(c.count/((actionResult.totalTrends as number)||1))*100)}%` }} />
                            </div>
                            <span className="text-white w-6 text-right">{c.count}</span>
                            <span className="text-neon-green w-12 text-right">{c.trending} trending</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* costPerWear */}
            {actionResult._action === 'costPerWear' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Cost Per Wear</p>
                {(actionResult.message as string) ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Best Value', value: String(actionResult.bestValue ?? '—'), color: 'text-neon-green' },
                        { label: 'Worst Value', value: String(actionResult.worstValue ?? '—'), color: 'text-red-400' },
                        { label: 'Avg $/Wear', value: `$${actionResult.avgCostPerWear ?? 0}`, color: 'text-neon-cyan' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold ${color}`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(actionResult.items) && (
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {(actionResult.items as {name:string;costPerWear:number;wears:number;value:string}[]).map(item => (
                          <div key={item.name} className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5">
                            <span className="flex-1 text-white truncate">{item.name}</span>
                            <span className="text-gray-400">{item.wears}× worn</span>
                            <span className="text-neon-green font-mono">${item.costPerWear}/wear</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${item.value === 'excellent' ? 'bg-neon-green/20 text-neon-green' : item.value === 'good' ? 'bg-neon-cyan/20 text-neon-cyan' : item.value === 'moderate' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-red-400/20 text-red-400'}`}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {actionResult.tip && <p className="text-xs text-gray-500 italic">{actionResult.tip as string}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Add Wardrobe Item</h3>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} placeholder="Item name..." className="input-lattice" />
                <select value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))} className="input-lattice">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={newItem.brand} onChange={e => setNewItem(p => ({ ...p, brand: e.target.value }))} placeholder="Brand..." className="input-lattice" />
                <input value={newItem.color} onChange={e => setNewItem(p => ({ ...p, color: e.target.value }))} placeholder="Color..." className="input-lattice" />
                <select value={newItem.season} onChange={e => setNewItem(p => ({ ...p, season: e.target.value }))} className="input-lattice">
                  {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={newItem.size} onChange={e => setNewItem(p => ({ ...p, size: e.target.value }))} placeholder="Size..." className="input-lattice" />
                <input type="number" value={newItem.price || ''} onChange={e => setNewItem(p => ({ ...p, price: Number(e.target.value) }))} placeholder="Price..." className="input-lattice" />
              </div>
              <button onClick={handleCreate} disabled={createMut.isPending || !newItem.name.trim()} className="btn-neon green w-full">
                {createMut.isPending ? 'Adding...' : 'Add to Wardrobe'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><Shirt className="w-5 h-5 text-neon-purple mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Items</p></div>
        <div className="lens-card"><DollarSign className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">${stats.totalValue.toLocaleString()}</p><p className="text-sm text-gray-400">Total Value</p></div>
        <div className="lens-card"><Tag className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{stats.categories}</p><p className="text-sm text-gray-400">Categories</p></div>
        <div className="lens-card"><DollarSign className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">${stats.costPerWear}</p><p className="text-sm text-gray-400">Avg Cost/Wear</p></div>
      </div>

      {/* Category breakdown bar */}
      {garments.length > 0 && (
        <div className="panel p-4">
          <h3 className="text-xs text-gray-400 mb-2">Category Distribution</h3>
          <div className="flex rounded-full overflow-hidden h-3 bg-white/5">
            {CATEGORIES.map(cat => {
              const count = garments.filter(g => g.category === cat).length;
              if (count === 0) return null;
              return <div key={cat} className={cn('bg-gradient-to-r transition-all', CATEGORY_COLORS[cat] || 'from-gray-500/40 to-gray-500/40')} style={{ width: `${(count / garments.length) * 100}%` }} title={`${cat}: ${count}`} />;
            })}
          </div>
          <div className="flex gap-3 mt-2 flex-wrap">
            {CATEGORIES.map(cat => {
              const count = garments.filter(g => g.category === cat).length;
              if (count === 0) return null;
              return <span key={cat} className="text-[10px] text-gray-400">{cat}: {count}</span>;
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-lattice-surface p-1 rounded-lg border border-lattice-border">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors', tab === t.id ? 'bg-purple-500/20 text-purple-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        {tab === 'wardrobe' && (
          <div className="flex gap-1 bg-lattice-surface p-0.5 rounded-lg border border-lattice-border">
            <button onClick={() => setViewMode('grid')} className={cn('p-1.5 rounded', viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-500')}><Grid3X3 className="w-4 h-4" /></button>
            <button onClick={() => setViewMode('list')} className={cn('p-1.5 rounded', viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-500')}><List className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {/* Wardrobe Tab */}
      {tab === 'wardrobe' && (
        <>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search wardrobe..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
            </div>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="input-lattice w-40">
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {isLoading ? (
            <div className="panel p-6 text-center text-gray-400">Loading wardrobe...</div>
          ) : garments.length === 0 ? (
            <div className="panel p-8 text-center">
              <Shirt className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400">Your wardrobe is empty.</p>
              <button onClick={() => setShowCreate(true)} className="mt-4 btn-neon purple text-sm"><Plus className="w-4 h-4 inline mr-1" /> Add First Item</button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {garments.map((g, i) => (
                <motion.div key={g.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="panel p-4 hover:border-purple-500/30 transition-all group relative">
                  {/* Color swatch header */}
                  <div className={cn('h-2 rounded-t-lg -mt-4 -mx-4 mb-3', `bg-gradient-to-r`, CATEGORY_COLORS[g.category] || 'from-gray-500/20 to-gray-500/20')} />
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-white truncate">{g.name}</h3>
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleFavorite(g.id)} className="p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Heart className={cn('w-4 h-4', favorites.has(g.id) ? 'fill-pink-500 text-pink-500' : 'text-gray-500')} />
                      </button>
                      <button onClick={() => remove(g.id)} disabled={deleteMut.isPending} className="p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-400">{deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs mb-2">
                    {g.category && <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">{g.category}</span>}
                    {g.brand && <span className="px-2 py-0.5 rounded bg-lattice-elevated text-gray-300">{g.brand}</span>}
                    {g.condition && <span className={cn('px-2 py-0.5 rounded border', CONDITION_COLORS[g.condition])}>{g.condition}</span>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center gap-3">
                      {g.color && (
                        <span className="flex items-center gap-1">
                          <Palette className="w-3 h-3" />{g.color}
                        </span>
                      )}
                      {g.season && g.season !== 'All Season' && <span>{g.season}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {g.wearCount > 0 && <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{g.wearCount}x</span>}
                      {g.price > 0 && <span className="font-medium text-neon-green">${g.price}</span>}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {garments.map((g, i) => (
                <motion.div key={g.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }} className="panel p-3 flex items-center justify-between hover:border-purple-500/30 transition-all group">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn('w-1.5 h-10 rounded-full bg-gradient-to-b', CATEGORY_COLORS[g.category] || 'from-gray-500/40 to-gray-500/40')} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{g.name}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        {g.category && <span>{g.category}</span>}
                        {g.brand && <span>{g.brand}</span>}
                        {g.color && <span>{g.color}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {g.condition && <span className={cn('text-[10px] px-2 py-0.5 rounded border', CONDITION_COLORS[g.condition])}>{g.condition}</span>}
                    {g.price > 0 && <span className="text-sm font-medium text-neon-green">${g.price}</span>}
                    <button onClick={() => remove(g.id)} disabled={deleteMut.isPending} className="p-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400">{deleteMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}</button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Outfits Tab */}
      {tab === 'outfits' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-400" /> Outfit Combos</h3>
            <button onClick={() => setShowCreateOutfit(!showCreateOutfit)} className="btn-neon purple text-sm"><Plus className="w-3 h-3 mr-1 inline" /> Create Outfit</button>
          </div>
          <AnimatePresence>
            {showCreateOutfit && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="panel p-4 space-y-3">
                  <input value={newOutfitName} onChange={e => setNewOutfitName(e.target.value)} placeholder="Outfit name..." className="input-lattice w-full" />
                  <input value={newOutfitOccasion} onChange={e => setNewOutfitOccasion(e.target.value)} placeholder="Occasion (e.g. casual, formal, date night)..." className="input-lattice w-full" />
                  <button onClick={() => { if (newOutfitName.trim()) { setOutfits(prev => [...prev, { name: newOutfitName, items: [], occasion: newOutfitOccasion, rating: 0 }]); setNewOutfitName(''); setNewOutfitOccasion(''); setShowCreateOutfit(false); } }} className="btn-neon green w-full">Save Outfit</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {outfits.length === 0 ? (
            <div className="panel p-8 text-center">
              <Sparkles className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400 text-sm">No outfits created yet.</p>
              <p className="text-xs text-gray-600 mt-1">Combine wardrobe items into outfit combos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {outfits.map((outfit, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-white">{outfit.name}</h4>
                    {outfit.occasion && <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-300">{outfit.occasion}</span>}
                  </div>
                  <div className="flex gap-1 mt-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button key={star} onClick={() => setOutfits(prev => prev.map((o, j) => j === i ? { ...o, rating: star } : o))}>
                        <Star className={cn('w-4 h-4', star <= outfit.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600')} />
                      </button>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wishlist Tab */}
      {tab === 'wishlist' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={newWishItem} onChange={e => setNewWishItem(e.target.value)} placeholder="Item you want..." className="flex-1 input-lattice"
              onKeyDown={e => { if (e.key === 'Enter' && newWishItem.trim()) { setWishlist(prev => [...prev, { name: newWishItem.trim(), price: Number(newWishPrice) || 0, link: '' }]); setNewWishItem(''); setNewWishPrice(''); } }}
            />
            <input value={newWishPrice} onChange={e => setNewWishPrice(e.target.value)} type="number" placeholder="Price" className="input-lattice w-24" />
            <button onClick={() => { if (newWishItem.trim()) { setWishlist(prev => [...prev, { name: newWishItem.trim(), price: Number(newWishPrice) || 0, link: '' }]); setNewWishItem(''); setNewWishPrice(''); } }} className="btn-neon purple"><Plus className="w-4 h-4" /></button>
          </div>
          {wishlist.length > 0 && (
            <div className="panel p-2">
              <div className="px-3 py-2 border-b border-lattice-border text-xs text-gray-400">
                {wishlist.length} items — ${wishlist.reduce((s, w) => s + w.price, 0).toLocaleString()} total
              </div>
              {wishlist.map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 group">
                  <div className="flex items-center gap-3">
                    <Heart className="w-4 h-4 text-pink-500" />
                    <span className="text-sm">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.price > 0 && <span className="text-sm text-neon-green">${item.price}</span>}
                    <button onClick={() => setWishlist(prev => prev.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
          {wishlist.length === 0 && (
            <div className="panel p-8 text-center">
              <Heart className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400 text-sm">Your wishlist is empty.</p>
            </div>
          )}
        </div>
      )}

      <RealtimeDataPanel domain="fashion" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="fashion" /></div>}
      </div>
    </div>
  );
}
