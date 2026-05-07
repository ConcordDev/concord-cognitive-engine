'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api, apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store,
  Download,
  Star,
  Search,
  Plus,
  TrendingUp,
  Grid3X3,
  List,
  Trash2,
  Check,
  X,
  BarChart2,
  DollarSign,
  Package,
  ShoppingBag,
  Layers,
  ShoppingCart,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Upload,
  Eye,
  LayoutDashboard,
  FileAudio,
  Palette,
  Plug,
  Settings2,
  Loader2,
  Activity,
  GitBranch,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
// marketplace-demo.ts has been deprecated — all data comes from API
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import type { DTU } from '@/lib/api/generated-types';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ProvenanceBadge } from '@/components/dtu/ProvenanceBadge';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';
import { ArtifactDetailModal } from '@/components/market/ArtifactDetailModal';
import { RoyaltyDashboard } from '@/components/market/RoyaltyDashboard';
import { MarketplaceTab } from '@/components/lens/MarketplaceTab';
import RoyaltyCascadeViz from '@/components/visualizations/RoyaltyCascadeViz';
import SocialProofFeed from '@/components/world-lens/SocialProofFeed';
import { TrendingDomains } from '@/components/social/TrendingDomains';
import { ActivityBadge } from '@/components/platform/ActivityBadge';
import { useEvent } from '@/lib/realtime/event-bus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatorInfo {
  name: string;
  avatar?: string;
  verified?: boolean;
}

interface LicensePrice {
  basic: number;
  premium: number;
  unlimited: number;
  exclusive: number;
}

interface MarketplaceItem {
  id: string;
  title: string;
  description: string;
  type: 'template' | 'component' | 'dataset' | 'artwork' | 'plugin' | 'preset';
  genre?: string;
  version?: string;
  key?: string;
  duration?: string;
  creator: CreatorInfo;
  prices: LicensePrice;
  rating: number;
  ratingCount: number;
  sales: number;
  tags: string[];
  featured?: boolean;
  thumbnail?: string;
  previewUrl?: string;
  createdAt: string;
}

interface CartItem {
  item: MarketplaceItem;
  license: string;
  price: number;
}

interface Purchase {
  id: string;
  item: MarketplaceItem;
  license: string;
  price: number;
  purchasedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type Tab = 'browse' | 'myshop' | 'cart' | 'purchases' | 'analytics';
type ViewMode = 'grid' | 'list';
type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'newest' | 'rating';
type CategoryFilter =
  | 'all'
  | 'templates'
  | 'components'
  | 'datasets'
  | 'artwork'
  | 'plugins'
  | 'presets';

const LICENSE_TIERS = [
  { id: 'basic', name: 'Basic', color: 'text-gray-400' },
  { id: 'premium', name: 'Premium', color: 'text-neon-cyan' },
  { id: 'unlimited', name: 'Unlimited', color: 'text-neon-purple' },
  { id: 'exclusive', name: 'Exclusive', color: 'text-neon-pink' },
] as const;

const CATEGORIES: { id: CategoryFilter; name: string; icon: typeof ShoppingBag }[] = [
  { id: 'all', name: 'All', icon: Grid3X3 },
  { id: 'templates', name: 'Templates', icon: ShoppingBag },
  { id: 'components', name: 'Components', icon: FileAudio },
  { id: 'datasets', name: 'Datasets', icon: Layers },
  { id: 'artwork', name: 'Artwork', icon: Palette },
  { id: 'plugins', name: 'Plugins', icon: Plug },
  { id: 'presets', name: 'Presets', icon: Settings2 },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'popular', label: 'Popular' },
  { value: 'price-asc', label: 'Price: Low-High' },
  { value: 'price-desc', label: 'Price: High-Low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Best Rated' },
];

const GENRE_OPTIONS = [
  'All Categories',
  'AI & ML',
  'Data Science',
  'Web Dev',
  'Design',
  'Business',
  'Education',
  'Productivity',
  'Gaming',
  'Creative',
];

// ---------------------------------------------------------------------------
// Helpers: normalize API responses into MarketplaceItem shape
// ---------------------------------------------------------------------------

function normalizeItems(items: Record<string, unknown>[]): MarketplaceItem[] {
  return (items || []).map((b: Record<string, unknown>) => ({
    id: String(b.id || ''),
    title: String(b.title || 'Untitled'),
    description: String(b.description || ''),
    type: 'template' as const,
    genre: b.genre ? String(b.genre) : undefined,
    version: typeof b.version === 'string' ? b.version : undefined,
    key: b.key ? String(b.key) : undefined,
    creator: { name: String((b as Record<string, unknown>).ownerId || 'Unknown') },
    prices: normalizePrices(b.licenses as Record<string, unknown>),
    rating: typeof b.rating === 'number' ? b.rating : 0,
    ratingCount: Array.isArray(b.reviews) ? b.reviews.length : 0,
    sales: typeof b.totalSales === 'number' ? b.totalSales : 0,
    tags: Array.isArray(b.tags) ? b.tags : [],
    createdAt: b.createdAt
      ? new Date(b.createdAt as number).toISOString()
      : new Date().toISOString(),
  }));
}

function normalizeComponents(components: Record<string, unknown>[]): MarketplaceItem[] {
  return (components || []).map((s: Record<string, unknown>) => ({
    id: String(s.id || ''),
    title: String(s.title || 'Untitled'),
    description: String(s.description || ''),
    type: 'component' as const,
    genre: s.genre ? String(s.genre) : undefined,
    creator: { name: String(s.ownerId || 'Unknown') },
    prices: {
      basic: typeof s.price === 'number' ? s.price : 0,
      premium: 0,
      unlimited: 0,
      exclusive: 0,
    },
    rating: 0,
    ratingCount: 0,
    sales: typeof s.totalSales === 'number' ? s.totalSales : 0,
    tags: Array.isArray(s.tags) ? s.tags : [],
    createdAt: s.createdAt
      ? new Date(s.createdAt as number).toISOString()
      : new Date().toISOString(),
  }));
}

function normalizeDatasets(datasets: Record<string, unknown>[]): MarketplaceItem[] {
  return (datasets || []).map((s: Record<string, unknown>) => ({
    id: String(s.id || ''),
    title: String(s.title || 'Untitled'),
    description: String(s.description || ''),
    type: 'dataset' as const,
    genre: s.genre ? String(s.genre) : undefined,
    creator: { name: String(s.ownerId || 'Unknown') },
    prices: {
      basic: typeof s.price === 'number' ? s.price : 0,
      premium: 0,
      unlimited: 0,
      exclusive: 0,
    },
    rating: 0,
    ratingCount: 0,
    sales: typeof s.totalSales === 'number' ? s.totalSales : 0,
    tags: Array.isArray(s.tags) ? s.tags : [],
    createdAt: s.createdAt
      ? new Date(s.createdAt as number).toISOString()
      : new Date().toISOString(),
  }));
}

function normalizeArt(art: Record<string, unknown>[]): MarketplaceItem[] {
  return (art || []).map((a: Record<string, unknown>) => ({
    id: String(a.id || ''),
    title: String(a.title || 'Untitled'),
    description: String(a.description || ''),
    type: 'artwork' as const,
    creator: { name: String(a.ownerId || 'Unknown') },
    prices: {
      basic: typeof a.price === 'number' ? a.price : 0,
      premium: 0,
      unlimited: 0,
      exclusive: 0,
    },
    rating: 0,
    ratingCount: 0,
    sales: typeof a.totalSales === 'number' ? a.totalSales : 0,
    tags: Array.isArray(a.tags) ? a.tags : [],
    createdAt: a.createdAt
      ? new Date(a.createdAt as number).toISOString()
      : new Date().toISOString(),
  }));
}

function normalizePrices(licenses: Record<string, unknown> | null | undefined): LicensePrice {
  if (!licenses) return { basic: 0, premium: 0, unlimited: 0, exclusive: 0 };
  const get = (key: string) => {
    const entry = licenses[key] as Record<string, unknown> | undefined;
    return typeof entry?.price === 'number' ? entry.price : 0;
  };
  return {
    basic: get('basic'),
    premium: get('premium'),
    unlimited: get('unlimited'),
    exclusive: get('exclusive'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function starRating(rating: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={cn(
        'w-3 h-3',
        i < Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'
      )}
    />
  ));
}

function formatPrice(cents: number) {
  return cents === 0 ? 'Free' : `$${cents}`;
}

function typeIcon(type: MarketplaceItem['type']) {
  switch (type) {
    case 'template':
      return ShoppingBag;
    case 'component':
      return FileAudio;
    case 'dataset':
      return Layers;
    case 'artwork':
      return Palette;
    case 'plugin':
      return Plug;
    case 'preset':
      return Settings2;
  }
}

function typeBadgeColor(type: MarketplaceItem['type']) {
  switch (type) {
    case 'template':
      return 'bg-neon-purple/20 text-neon-purple';
    case 'component':
      return 'bg-neon-cyan/20 text-neon-cyan';
    case 'dataset':
      return 'bg-neon-green/20 text-neon-green';
    case 'artwork':
      return 'bg-neon-pink/20 text-neon-pink';
    case 'plugin':
      return 'bg-blue-500/20 text-blue-400';
    case 'preset':
      return 'bg-orange-500/20 text-orange-400';
  }
}

const hasPreview = (t: string) => ['template', 'component', 'dataset'].includes(t);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WaveformBars({ playing, small }: { playing?: boolean; small?: boolean }) {
  const barCount = small ? 20 : 40;
  return (
    <div className={cn('flex items-end gap-px', small ? 'h-6' : 'h-10')}>
      {Array.from({ length: barCount }, (_, i) => {
        const h = 20 + Math.sin(i * 0.7) * 30 + Math.cos(i * 1.3) * 25;
        return (
          <motion.div
            key={i}
            className={cn('rounded-sm', playing ? 'bg-neon-purple' : 'bg-gray-600')}
            style={{ width: small ? 2 : 3, height: `${h}%` }}
            animate={playing ? { height: [`${h}%`, `${h + 15}%`, `${h}%`] } : {}}
            transition={
              playing
                ? { duration: 0.4 + Math.random() * 0.3, repeat: Infinity, repeatType: 'mirror' }
                : {}
            }
          />
        );
      })}
    </div>
  );
}

function ItemCard({
  item,
  onPlay,
  isPlaying,
  onAddToCart,
  viewMode,
  onSelect,
  onRoyaltyClick,
}: {
  item: MarketplaceItem;
  onPlay: (item: MarketplaceItem) => void;
  isPlaying: boolean;
  onAddToCart: (item: MarketplaceItem) => void;
  viewMode: ViewMode;
  onSelect?: (item: MarketplaceItem) => void;
  onRoyaltyClick?: (itemId: string) => void;
}) {
  const Icon = typeIcon(item.type);
  const audio = hasPreview(item.type);

  if (viewMode === 'list') {
    return (
      <motion.div
        layout
        onClick={() => onSelect?.(item)}
        className="panel p-4 flex items-center gap-4 hover:border-neon-purple/40 transition-colors cursor-pointer"
      >
        {/* Thumbnail */}
        <div className="relative w-14 h-14 rounded-lg bg-lattice-deep flex items-center justify-center shrink-0 overflow-hidden">
          {audio ? (
            <WaveformBars playing={isPlaying} small />
          ) : (
            <Icon className="w-6 h-6 text-gray-500" />
          )}
          {audio && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white" />
              )}
            </button>
          )}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{item.title}</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                typeBadgeColor(item.type)
              )}
            >
              {item.type}
            </span>
          </div>
          <div className="text-sm text-gray-400 flex items-center gap-2">
            <span>{item.creator.name}</span>
            {item.creator.verified && <Check className="w-3 h-3 text-neon-cyan" />}
            {item.genre && (
              <>
                <span className="text-gray-600">|</span>
                <span>{item.genre}</span>
              </>
            )}
            {item.version && (
              <>
                <span className="text-gray-600">|</span>
                <span>v{item.version}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {starRating(item.rating)}
          <span className="text-xs text-gray-500 ml-1">{item.rating}</span>
        </div>
        <span className="text-neon-green font-bold">{formatPrice(item.prices.basic)}</span>
        <PullToSubstrate domain="marketplace" artifactId={item.id} compact />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToCart(item);
          }}
          className="btn-neon small flex items-center gap-1"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      onClick={() => onSelect?.(item)}
      className="panel p-0 overflow-hidden hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-200 cursor-pointer group"
    >
      {/* Thumbnail */}
      <div className="relative h-36 bg-lattice-deep flex items-center justify-center">
        {audio ? (
          <div className="px-4 w-full">
            <WaveformBars playing={isPlaying} />
          </div>
        ) : (
          <Icon className="w-12 h-12 text-gray-600" />
        )}
        {audio && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay(item);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isPlaying ? (
              <Pause className="w-8 h-8 text-white" />
            ) : (
              <Play className="w-8 h-8 text-white" />
            )}
          </button>
        )}
        <span
          className={cn(
            'absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-medium',
            typeBadgeColor(item.type)
          )}
        >
          {item.type}
        </span>
        {item.featured && (
          <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-neon-green/20 text-neon-green font-medium">
            Featured
          </span>
        )}
      </div>
      {/* Body */}
      <div className="p-3 space-y-2">
        <p className="font-semibold text-sm truncate">{item.title}</p>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <div className="w-4 h-4 rounded-full bg-lattice-elevated flex items-center justify-center text-[9px] font-bold">
            {item.creator.name[0]}
          </div>
          <span className="truncate">{item.creator.name}</span>
          {item.creator.verified && <Check className="w-3 h-3 text-amber-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-1">
          {starRating(item.rating)}
          <span className="text-[10px] text-gray-500 ml-1">({item.ratingCount})</span>
        </div>
        {(item.version || item.key || item.genre) && (
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            {item.genre && <span>{item.genre}</span>}
            {item.version && <span>v{item.version}</span>}
            {item.key && <span>{item.key}</span>}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 font-bold text-sm">
              From {formatPrice(item.prices.basic)}
            </span>
            {item.sales > 0 && onRoyaltyClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRoyaltyClick(item.id);
                }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-neon-cyan/10 border border-neon-cyan/20 text-[10px] text-neon-cyan hover:bg-neon-cyan/20 transition-colors"
                title="View royalty cascade"
              >
                <GitBranch className="w-2.5 h-2.5" />
                {item.sales}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <PullToSubstrate domain="marketplace" artifactId={item.id} compact />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToCart(item);
              }}
              className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 hover:from-amber-500/30 hover:to-orange-500/30 transition-all text-xs font-medium flex items-center gap-1"
            >
              <ShoppingCart className="w-3 h-3" /> Buy
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AudioPreviewBar({
  item,
  playing,
  onToggle,
  onClose,
}: {
  item: MarketplaceItem | null;
  playing: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  if (!item) return null;
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      className="fixed bottom-0 left-0 right-0 z-50 bg-lattice-deep/95 backdrop-blur-lg border-t border-lattice-border px-6 py-3"
    >
      <div className="max-w-5xl mx-auto flex items-center gap-4">
        <button
          onClick={onToggle}
          className="p-2 rounded-full bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 transition-colors"
        >
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold truncate">{item.title}</span>
            <span className="text-xs text-gray-500">by {item.creator.name}</span>
          </div>
          <WaveformBars playing={playing} small />
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function MarketplaceLensPage() {
  useLensNav('marketplace');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('marketplace');
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // State
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [genreFilter, setGenreFilter] = useState('All Genres');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [previewItem, setPreviewItem] = useState<MarketplaceItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [featuredIdx, setFeaturedIdx] = useState(0);
  const [showNewListing, setShowNewListing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  // New listing form state
  const [newListingForm, setNewListingForm] = useState({
    title: '',
    type: 'template' as string,
    description: '',
    genre: '',
    tags: '',
    basicPrice: '',
    premiumPrice: '',
    unlimitedPrice: '',
    exclusivePrice: '',
  });
  const [listingSubmitting, setListingSubmitting] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);

  // Knowledge Pack builder state
  const [showPackBuilder, setShowPackBuilder] = useState(false);
  const [packForm, setPackForm] = useState({ name: '', description: '', price: '' });
  const [packSelectedDTUs, setPackSelectedDTUs] = useState<string[]>([]);
  const [packSubmitting, setPackSubmitting] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const runAction = useRunArtifact('marketplace');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  // Live activity feed state
  const [recentTrades, setRecentTrades] = useState<
    Array<{ dtuId: string; title?: string; price: number; ts: string }>
  >([]);
  const [recentListings, setRecentListings] = useState<
    Array<{ dtuId: string; title?: string; ts: string }>
  >([]);
  const [royaltyVizDtuId, setRoyaltyVizDtuId] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = listingItems[0]?.id;
    if (!targetId) {
      setActionResult({ message: 'No listings found. Add a listing first to run analysis.' });
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
  };

  const {
    items: listingItems,
    isLoading,
    isError: isError,
    error: error,
    refetch: refetch,
  } = useLensData('marketplace', 'listing', {
    noSeed: true,
  });
  const {
    isError: isError2,
    error: error2,
    refetch: refetch2,
  } = useLensData('marketplace', 'purchase', {
    noSeed: true,
  });
  const isError3 = false as boolean;
  const error3 = null as Error | null;
  const refetch3 = () => {};
  const isError4 = false as boolean;
  const error4 = null as Error | null;
  const refetch4 = () => {};
  const isError6 = false as boolean;
  const error6 = null as Error | null;
  const refetch6 = () => {};

  // DTU context (v3.0 artifact support)
  const {
    contextDTUs: marketDTUs,
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    tierDistribution,
    publishToMarketplace: publishDTU,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'marketplace' });

  // Live socket event subscriptions
  useEvent<{ dtuId: string; price?: number; title?: string }>('marketplace:purchase', (data) => {
    setRecentTrades((prev) => [
      {
        dtuId: data.dtuId,
        title: data.title,
        price: data.price || 0,
        ts: new Date().toISOString(),
      },
      ...prev.slice(0, 19),
    ]);
  });
  useEvent<{ dtuId: string; title?: string }>('market:listing', (data) => {
    setRecentListings((prev) => [
      { dtuId: data.dtuId, title: data.title, ts: new Date().toISOString() },
      ...prev.slice(0, 9),
    ]);
  });

  const marketArtifacts = marketDTUs.filter((d: DTU) => d.artifact);

  // Unified marketplace browse — single query for all listing types
  const {
    data: browseData,
    isError: isError5,
    error: error5,
    refetch: refetch5,
  } = useQuery({
    queryKey: ['marketplace-browse', category, search],
    queryFn: async () => {
      try {
        const res = await api.get('/api/marketplace/browse', {
          params: {
            category: category !== 'all' ? category : undefined,
            search: search || undefined,
          },
        });
        return res.data;
      } catch (e) {
        console.warn('Marketplace browse API unavailable, falling back to lens data:', e);
        // Fallback to lens data already fetched by useLensData hook
        return { ok: true, items: listingItems || [] };
      }
    },
  });

  // Also fetch from artistry endpoints as secondary sources
  const { data: templatesData } = useQuery({
    queryKey: ['marketplace-templates'],
    queryFn: () =>
      apiHelpers.artistry.marketplace.beats
        .list()
        .then((r) => r.data)
        .catch(() => ({ beats: [] })),
  });

  const { data: componentsData } = useQuery({
    queryKey: ['marketplace-components'],
    queryFn: () =>
      apiHelpers.artistry.marketplace.stems
        .list()
        .then((r) => r.data)
        .catch(() => ({ stems: [] })),
  });

  const { data: datasetsData } = useQuery({
    queryKey: ['marketplace-datasets'],
    queryFn: () =>
      apiHelpers.artistry.marketplace.samples
        .list()
        .then((r) => r.data)
        .catch(() => ({ samples: [] })),
  });

  const {
    data: artData,
    isError: isError7,
    error: error7,
    refetch: refetch7,
  } = useQuery({
    queryKey: ['marketplace-art'],
    queryFn: () =>
      apiHelpers.artistry.marketplace.art
        .list()
        .then((r) => r.data)
        .catch(() => ({ artworks: [] })),
  });

  // Economy balance
  const { data: balanceData } = useQuery({
    queryKey: ['economy-balance'],
    queryFn: () =>
      apiHelpers.economy
        .balance()
        .then((r) => r.data)
        .catch((err) => {
          console.error('Failed to fetch balance:', err instanceof Error ? err.message : err);
          return { balance: 0 };
        }),
  });

  // Fee schedule
  const { data: feeData } = useQuery({
    queryKey: ['economy-fees'],
    queryFn: () =>
      apiHelpers.economy
        .config()
        .then((r) => r.data)
        .catch((err) => {
          console.error('Failed to fetch fees:', err instanceof Error ? err.message : err);
          return { fees: { MARKETPLACE_PURCHASE: 0.05 } };
        }),
  });

  const marketplaceFeeRate = feeData?.fees?.MARKETPLACE_PURCHASE ?? 0.05;
  const userBalance = balanceData?.balance ?? 0;

  // Merge real API data — browse endpoint + artistry fallbacks
  const allItems = useMemo(() => {
    const browseItems = normalizeItems(browseData?.items ?? browseData?.results ?? []);
    const artItems = [
      ...normalizeItems(templatesData?.beats ?? []),
      ...normalizeComponents(componentsData?.stems ?? []),
      ...normalizeDatasets(datasetsData?.samples ?? []),
      ...normalizeArt(artData?.artworks ?? []),
    ];
    // Deduplicate by id, preferring browse data
    const seen = new Set(browseItems.map((i) => i.id));
    const merged = [...browseItems];
    for (const item of artItems) {
      if (!seen.has(item.id)) {
        merged.push(item);
        seen.add(item.id);
      }
    }
    return merged;
  }, [browseData, templatesData, componentsData, datasetsData, artData]);

  const featuredItems = useMemo(() => allItems.filter((i) => i.featured), [allItems]);

  // Filtered / sorted items
  const filteredItems = useMemo(() => {
    let items = [...allItems];
    if (category !== 'all') {
      const typeMap: Record<string, string> = {
        templates: 'template',
        components: 'component',
        datasets: 'dataset',
        artwork: 'artwork',
        plugins: 'plugin',
        presets: 'preset',
      };
      items = items.filter((i) => i.type === typeMap[category]);
    }
    if (genreFilter !== 'All Categories') items = items.filter((i) => i.genre === genreFilter);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.tags.some((t) => t.includes(q))
      );
    }
    switch (sortBy) {
      case 'popular':
        items.sort((a, b) => b.sales - a.sales);
        break;
      case 'price-asc':
        items.sort((a, b) => a.prices.basic - b.prices.basic);
        break;
      case 'price-desc':
        items.sort((a, b) => b.prices.basic - a.prices.basic);
        break;
      case 'newest':
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'rating':
        items.sort((a, b) => b.rating - a.rating);
        break;
    }
    return items;
  }, [allItems, category, genreFilter, search, sortBy]);

  // Cart helpers
  const addToCart = useCallback((item: MarketplaceItem) => {
    setCart((prev) => {
      if (prev.some((c) => c.item.id === item.id)) return prev;
      return [...prev, { item, license: 'basic', price: item.prices.basic }];
    });
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => prev.filter((c) => c.item.id !== id));
  }, []);

  const updateCartLicense = useCallback((id: string, license: string) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.item.id !== id) return c;
        return { ...c, license, price: c.item.prices[license as keyof LicensePrice] };
      })
    );
  }, []);

  const cartTotal = useMemo(() => cart.reduce((s, c) => s + c.price, 0), [cart]);

  // Audio preview
  const handlePlay = useCallback(
    (item: MarketplaceItem) => {
      if (previewItem?.id === item.id) {
        setIsPlaying((p) => !p);
        return;
      }
      setPreviewItem(item);
      setIsPlaying(true);
    },
    [previewItem]
  );

  const closePreview = useCallback(() => {
    setPreviewItem(null);
    setIsPlaying(false);
  }, []);

  // Publish new listing to backend
  const handlePublishListing = useCallback(async () => {
    if (!newListingForm.title.trim() || listingSubmitting) return;
    setListingSubmitting(true);
    setListingError(null);
    try {
      const typeMap: Record<string, string> = {
        Template: 'template',
        Component: 'component',
        Dataset: 'dataset',
        Artwork: 'artwork',
        Plugin: 'plugin',
        Preset: 'preset',
        template: 'template',
        component: 'component',
        dataset: 'dataset',
        artwork: 'artwork',
        plugin: 'plugin',
        preset: 'preset',
      };
      await apiHelpers.marketplace.submit({
        title: newListingForm.title.trim(),
        type: typeMap[newListingForm.type] || 'template',
        description: newListingForm.description.trim(),
        genre: newListingForm.genre.trim() || undefined,
        tags: newListingForm.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        licenses: {
          basic: { price: Number(newListingForm.basicPrice) || 0 },
          premium: { price: Number(newListingForm.premiumPrice) || 0 },
          unlimited: { price: Number(newListingForm.unlimitedPrice) || 0 },
          exclusive: { price: Number(newListingForm.exclusivePrice) || 0 },
        },
      } as unknown as { name: string; githubUrl: string; description?: string; category?: string });
      setShowNewListing(false);
      setNewListingForm({
        title: '',
        type: 'template',
        description: '',
        genre: '',
        tags: '',
        basicPrice: '',
        premiumPrice: '',
        unlimitedPrice: '',
        exclusivePrice: '',
      });
      queryClient.invalidateQueries({ queryKey: ['marketplace-templates'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-components'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-datasets'] });
      queryClient.invalidateQueries({ queryKey: ['artistry-art'] });
    } catch (err) {
      setListingError(err instanceof Error ? err.message : 'Failed to publish listing');
    } finally {
      setListingSubmitting(false);
    }
  }, [newListingForm, listingSubmitting, queryClient]);

  // Create Knowledge Pack — bundles selected DTUs into a marketplace listing
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

  // Checkout — settles each cart item through the economy ledger
  const handleCheckout = useCallback(async () => {
    if (cart.length === 0 || checkoutLoading) return;
    setCheckoutLoading(true);
    setCheckoutError(null);

    const completed: Purchase[] = [];
    const errors: string[] = [];

    for (const ci of cart) {
      try {
        const typeMap: Record<string, string> = {
          template: 'template',
          component: 'component',
          dataset: 'dataset',
          artwork: 'artwork',
          plugin: 'plugin',
          preset: 'preset',
        };
        const resp = await apiHelpers.artistry.marketplace.purchase({
          buyerId: 'current',
          listingId: ci.item.id,
          listingType: typeMap[ci.item.type] || 'template',
          licenseType: ci.license,
        });
        const data = resp.data;
        if (data.ok) {
          completed.push({
            id: data.license?.id || `p-${Date.now()}`,
            item: ci.item,
            license: ci.license,
            price: data.paid ?? ci.price,
            purchasedAt: new Date().toISOString(),
          });
        } else {
          errors.push(`${ci.item.title}: ${data.error || 'Purchase failed'}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${ci.item.title}: ${msg}`);
      }
    }

    if (completed.length > 0) {
      setPurchases((prev) => [...completed, ...prev]);
      setCart((prev) => prev.filter((c) => !completed.some((p) => p.item.id === c.item.id)));
      // Refresh balance, listings, and purchase data after successful checkout
      queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-templates'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-components'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-datasets'] });
      queryClient.invalidateQueries({ queryKey: ['artistry-art'] });
      queryClient.invalidateQueries({ queryKey: ['artistry-purchases'] });
    }
    if (errors.length > 0) {
      setCheckoutError(errors.join('; '));
    }
    if (completed.length > 0 && errors.length === 0) {
      setTab('purchases');
    }
    setCheckoutLoading(false);
  }, [cart, checkoutLoading, queryClient]);

  // Clamp carousel index when featured items change
  useEffect(() => {
    setFeaturedIdx((i) => (featuredItems.length === 0 ? 0 : Math.min(i, featuredItems.length - 1)));
  }, [featuredItems.length]);

  // Featured carousel auto-advance
  useEffect(() => {
    if (featuredItems.length <= 1) return;
    const t = setInterval(() => setFeaturedIdx((i) => (i + 1) % featuredItems.length), 5000);
    return () => clearInterval(t);
  }, [featuredItems.length]);

  const shopStats = useMemo(() => {
    const items = allItems;
    const totalSales = items.reduce((s, i) => s + i.sales, 0);
    const revenue = items.reduce((s, i) => s + i.sales * i.prices.basic * 0.7, 0);
    const rated = items.filter((i) => i.rating > 0);
    const avgRating =
      rated.length > 0
        ? Math.round((rated.reduce((s, i) => s + i.rating, 0) / rated.length) * 10) / 10
        : 0;
    return { totalSales, revenue: Math.round(revenue), itemsListed: items.length, avgRating };
  }, [allItems]);

  // ----- Render helpers -----

  const TABS: { id: Tab; label: string; icon: typeof Store }[] = [
    { id: 'browse', label: 'Browse', icon: Store },
    { id: 'myshop', label: 'My Shop', icon: LayoutDashboard },
    { id: 'cart', label: 'Cart', icon: ShoppingCart },
    { id: 'purchases', label: 'Purchases', icon: Download },
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  ];

  // =========================================================================
  // RENDER
  // =========================================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3 || isError4 || isError5 || isError6 || isError7) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={
            error?.message ||
            error2?.message ||
            error3?.message ||
            error4?.message ||
            error5?.message ||
            error6?.message ||
            error7?.message
          }
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
            refetch4();
            refetch5();
            refetch6();
            refetch7();
          }}
        />
      </div>
    );
  }
  return (
    <div className="lens-marketplace space-y-6 pb-24" data-lens-theme="marketplace">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Store className="w-6 h-6 text-amber-400" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
            Creative Marketplace
          </h1>
        </div>

        {/* Real-time Enhancement Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <ActivityBadge />
          <DTUExportButton domain="marketplace" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTab('myshop')}
            className="btn-neon flex items-center gap-2 text-sm"
          >
            <LayoutDashboard className="w-4 h-4" /> Seller Dashboard
          </button>
          <button
            onClick={() => setTab('cart')}
            className="relative p-2 rounded-lg bg-lattice-surface border border-lattice-border hover:border-neon-purple/50 transition-colors"
          >
            <ShoppingCart className="w-5 h-5" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neon-pink text-white text-[10px] font-bold flex items-center justify-center">
                {cart.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <FeedBanner domain="marketplace" />

      {/* ---- Tab Navigation ---- */}
      <div className="flex items-center gap-1 bg-lattice-surface/50 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors',
              tab === t.id
                ? 'bg-neon-purple/20 text-neon-purple'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.id === 'cart' && cart.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-neon-pink/20 text-neon-pink text-[10px] font-bold">
                {cart.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* BROWSE TAB                                                         */}
      {/* ================================================================== */}
      {tab === 'browse' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex gap-6 items-start"
        >
          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Hero / Featured Carousel */}
            {featuredItems.length > 0 && featuredItems[featuredIdx] && (
              <div className="relative panel p-0 overflow-hidden rounded-xl">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={featuredIdx}
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -40 }}
                    transition={{ duration: 0.35 }}
                    className="p-6 bg-gradient-to-br from-neon-purple/10 via-transparent to-neon-cyan/5 flex items-center gap-6"
                  >
                    <div className="w-32 h-32 rounded-xl bg-lattice-deep flex items-center justify-center shrink-0">
                      {hasPreview(featuredItems[featuredIdx].type) ? (
                        <WaveformBars />
                      ) : (
                        (() => {
                          const I = typeIcon(featuredItems[featuredIdx].type);
                          return <I className="w-12 h-12 text-gray-500" />;
                        })()
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <span
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full font-medium',
                          typeBadgeColor(featuredItems[featuredIdx].type)
                        )}
                      >
                        {featuredItems[featuredIdx].type} -- Featured
                      </span>
                      <h2 className="text-xl font-bold truncate">
                        {featuredItems[featuredIdx].title}
                      </h2>
                      <p className="text-sm text-gray-400 line-clamp-2">
                        {featuredItems[featuredIdx].description}
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-neon-green font-bold">
                          From {formatPrice(featuredItems[featuredIdx].prices.basic)}
                        </span>
                        <div className="flex items-center gap-1">
                          {starRating(featuredItems[featuredIdx].rating)}
                        </div>
                        <span className="text-xs text-gray-500">
                          {featuredItems[featuredIdx].sales} sales
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        {hasPreview(featuredItems[featuredIdx].type) && (
                          <button
                            onClick={() => handlePlay(featuredItems[featuredIdx])}
                            className="btn-neon purple flex items-center gap-1 text-sm"
                          >
                            <Play className="w-4 h-4" /> Preview
                          </button>
                        )}
                        <button
                          onClick={() => addToCart(featuredItems[featuredIdx])}
                          className="btn-neon flex items-center gap-1 text-sm"
                        >
                          <ShoppingCart className="w-4 h-4" /> Add to Cart
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
                {featuredItems.length > 1 && (
                  <>
                    <button
                      onClick={() =>
                        setFeaturedIdx((i) => (i - 1 + featuredItems.length) % featuredItems.length)
                      }
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setFeaturedIdx((i) => (i + 1) % featuredItems.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                      {featuredItems.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setFeaturedIdx(i)}
                          className={cn(
                            'w-2 h-2 rounded-full transition-colors',
                            i === featuredIdx ? 'bg-neon-purple' : 'bg-gray-600'
                          )}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Category Pills */}
            <div className="flex items-center gap-2 flex-wrap">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors border',
                    category === c.id
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                      : 'bg-lattice-surface border-lattice-border text-gray-400 hover:text-white hover:border-amber-500/30'
                  )}
                >
                  <c.icon className="w-3.5 h-3.5" /> {c.name}
                </button>
              ))}
            </div>

            {/* Search + Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search templates, datasets, artwork..."
                  className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg focus:border-neon-purple outline-none text-sm"
                />
              </div>
              <select
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
              >
                {GENRE_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center bg-lattice-surface border border-lattice-border rounded-lg">
                <button
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'p-2 rounded-l-lg transition-colors',
                    viewMode === 'grid'
                      ? 'bg-neon-purple/20 text-neon-purple'
                      : 'text-gray-500 hover:text-white'
                  )}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'p-2 rounded-r-lg transition-colors',
                    viewMode === 'list'
                      ? 'bg-neon-purple/20 text-neon-purple'
                      : 'text-gray-500 hover:text-white'
                  )}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Results count */}
            <p className="text-xs text-gray-500">
              {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} found
            </p>

            {/* Item Grid / List */}
            <div
              className={cn(
                viewMode === 'grid'
                  ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
                  : 'space-y-2'
              )}
            >
              <AnimatePresence>
                {filteredItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    viewMode={viewMode}
                    isPlaying={previewItem?.id === item.id && isPlaying}
                    onPlay={handlePlay}
                    onAddToCart={addToCart}
                    onSelect={(i) => setSelectedArtifactId(i.id)}
                    onRoyaltyClick={(id) => setRoyaltyVizDtuId(id)}
                  />
                ))}
              </AnimatePresence>
            </div>
            {filteredItems.length === 0 && (
              <div className="text-center py-16 text-gray-500">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="mb-1 font-medium text-gray-400">No items match your filters</p>
                <p className="text-sm mb-5 text-gray-600">
                  Try broader filters or be the first to list something
                </p>
                <button
                  onClick={() => setSearch('')}
                  className="px-5 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30 transition-colors"
                >
                  Clear search
                </button>
              </div>
            )}

            {/* Domain-specific marketplace artifacts */}
            <MarketplaceTab domain="marketplace" className="mt-6" />
          </div>
          {/* end main content */}

          {/* Activity sidebar */}
          <div className="w-72 shrink-0 space-y-4 sticky top-4">
            {/* Recent Activity */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                <Activity className="w-3.5 h-3.5 text-neon-green" /> Recent Activity
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {recentTrades.map((t, i) => (
                  <motion.div
                    key={`trade-${i}`}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-xs text-gray-400 flex items-start gap-1.5"
                  >
                    <span className="text-neon-green shrink-0">sold</span>
                    <span className="truncate">{t.title || t.dtuId}</span>
                    {t.price > 0 && <span className="text-neon-green shrink-0">${t.price}</span>}
                  </motion.div>
                ))}
                {recentListings.map((l, i) => (
                  <motion.div
                    key={`listing-${i}`}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-xs text-gray-400 flex items-start gap-1.5"
                  >
                    <span className="text-amber-400 shrink-0">listed</span>
                    <span className="truncate">{l.title || l.dtuId}</span>
                  </motion.div>
                ))}
                {recentTrades.length === 0 && recentListings.length === 0 && (
                  <p className="text-xs text-gray-600 italic">Waiting for activity...</p>
                )}
              </div>
            </div>
            <SocialProofFeed />
            <TrendingDomains />
          </div>
        </motion.div>
      )}

      {/* ================================================================== */}
      {/* MY SHOP TAB                                                        */}
      {/* ================================================================== */}
      {tab === 'myshop' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: 'Total Sales',
                value: shopStats.totalSales,
                icon: TrendingUp,
                color: 'text-neon-green',
              },
              {
                label: 'Revenue',
                value: `$${shopStats.revenue.toLocaleString()}`,
                icon: DollarSign,
                color: 'text-neon-cyan',
              },
              {
                label: 'Items Listed',
                value: shopStats.itemsListed,
                icon: Package,
                color: 'text-neon-purple',
              },
              {
                label: 'Avg Rating',
                value: shopStats.avgRating,
                icon: Star,
                color: 'text-yellow-400',
              },
            ].map((s) => (
              <div key={s.label} className="lens-card p-4 space-y-1">
                <div className="flex items-center gap-2 text-gray-400 text-xs">
                  <s.icon className={cn('w-4 h-4', s.color)} /> {s.label}
                </div>
                <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
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
                onClick={() => setShowNewListing(true)}
                className="btn-neon purple flex items-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" /> New Listing
              </button>
            </div>
          </div>

          {/* Existing listings from API */}
          <div className="space-y-2">
            {allItems.slice(0, 3).map((item) => (
              <div key={item.id} className="panel p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-lattice-deep flex items-center justify-center">
                  {(() => {
                    const I = typeIcon(item.type);
                    return <I className="w-5 h-5 text-gray-500" />;
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.title}</p>
                  <p className="text-xs text-gray-500">
                    {item.type} -- {item.sales} sales -- ${item.prices.basic}+
                  </p>
                </div>
                <div className="flex items-center gap-1">{starRating(item.rating)}</div>
                <span className="text-neon-green text-sm font-bold">
                  ${(item.sales * item.prices.basic * 0.7).toFixed(0)}
                </span>
                <button
                  onClick={() => {
                    setTab('browse');
                    setSearch(item.title);
                  }}
                  className="p-1.5 text-gray-400 hover:text-white transition-colors"
                  title="View in browse"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* New Listing Modal */}
          <AnimatePresence>
            {showNewListing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                onClick={() => setShowNewListing(false)}
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
                      onClick={() => setShowNewListing(false)}
                      className="text-gray-400 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <input
                      placeholder="Title"
                      value={newListingForm.title}
                      onChange={(e) => setNewListingForm((f) => ({ ...f, title: e.target.value }))}
                      className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                    />
                    <select
                      value={newListingForm.type}
                      onChange={(e) => setNewListingForm((f) => ({ ...f, type: e.target.value }))}
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
                      value={newListingForm.description}
                      onChange={(e) =>
                        setNewListingForm((f) => ({ ...f, description: e.target.value }))
                      }
                      className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none resize-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        placeholder="Genre"
                        value={newListingForm.genre}
                        onChange={(e) =>
                          setNewListingForm((f) => ({ ...f, genre: e.target.value }))
                        }
                        className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                      />
                      <input
                        placeholder="Tags (comma separated)"
                        value={newListingForm.tags}
                        onChange={(e) => setNewListingForm((f) => ({ ...f, tags: e.target.value }))}
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
                              value={newListingForm[t.field]}
                              onChange={(e) =>
                                setNewListingForm((f) => ({ ...f, [t.field]: e.target.value }))
                              }
                              className="w-full px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 p-4 border-2 border-dashed border-lattice-border rounded-lg justify-center text-gray-500 text-sm cursor-pointer hover:border-neon-purple/50 transition-colors">
                      <Upload className="w-5 h-5" /> Upload files
                    </div>
                  </div>
                  {listingError && (
                    <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                      {listingError}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      onClick={() => {
                        setShowNewListing(false);
                        setListingError(null);
                      }}
                      className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePublishListing}
                      disabled={!newListingForm.title.trim() || listingSubmitting}
                      className={cn(
                        'btn-neon purple text-sm',
                        (!newListingForm.title.trim() || listingSubmitting) &&
                          'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {listingSubmitting ? 'Publishing...' : 'Publish Listing'}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Knowledge Pack Builder Modal */}
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
                          <p className="text-xs text-gray-500 p-3 text-center">
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
                                  isSelected
                                    ? prev.filter((id) => id !== dtu.id)
                                    : [...prev, dtu.id]
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
                    <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                      {packError}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-gray-500">
                      {packSelectedDTUs.length} DTU{packSelectedDTUs.length !== 1 ? 's' : ''} in
                      pack
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
                          (!packForm.name.trim() ||
                            packSelectedDTUs.length === 0 ||
                            packSubmitting) &&
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
        </motion.div>
      )}

      {/* ================================================================== */}
      {/* CART TAB                                                           */}
      {/* ================================================================== */}
      {tab === 'cart' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {cart.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">Your cart is empty</p>
              <p className="text-sm mt-1">Browse the marketplace to find creative assets.</p>
              <button onClick={() => setTab('browse')} className="btn-neon purple mt-4 text-sm">
                Browse Marketplace
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {cart.map((ci) => {
                  const Icon = typeIcon(ci.item.type);
                  return (
                    <div key={ci.item.id} className="panel p-4 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-lattice-deep flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-gray-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{ci.item.title}</p>
                        <p className="text-xs text-gray-500">
                          {ci.item.creator.name} -- {ci.item.type}
                        </p>
                      </div>
                      <select
                        value={ci.license}
                        onChange={(e) => updateCartLicense(ci.item.id, e.target.value)}
                        className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
                      >
                        {LICENSE_TIERS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} - {formatPrice(ci.item.prices[t.id as keyof LicensePrice])}
                          </option>
                        ))}
                      </select>
                      <span className="text-neon-green font-bold w-16 text-right">
                        {formatPrice(ci.price)}
                      </span>
                      <button
                        onClick={() => removeFromCart(ci.item.id)}
                        className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Price breakdown */}
              <div className="panel p-5 space-y-3">
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>
                    Subtotal ({cart.length} item{cart.length !== 1 ? 's' : ''})
                  </span>
                  <span>{formatPrice(cartTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>Platform fee ({(marketplaceFeeRate * 100).toFixed(0)}%)</span>
                  <span>{formatPrice(Math.round(cartTotal * marketplaceFeeRate * 100) / 100)}</span>
                </div>
                <div className="border-t border-lattice-border pt-3 flex items-center justify-between">
                  <span className="font-bold">Total</span>
                  <span className="text-neon-green text-xl font-bold">
                    {formatPrice(cartTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Your balance</span>
                  <span className={cn(userBalance < cartTotal ? 'text-red-400' : 'text-gray-400')}>
                    {formatPrice(userBalance)}
                  </span>
                </div>
                {checkoutError && (
                  <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                    {checkoutError}
                  </p>
                )}
                <button
                  onClick={() => setShowCheckoutConfirm(true)}
                  disabled={checkoutLoading || cart.length === 0 || userBalance < cartTotal}
                  className={cn(
                    'btn-neon purple w-full py-3 text-sm font-semibold flex items-center justify-center gap-2',
                    (checkoutLoading || userBalance < cartTotal) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {checkoutLoading ? (
                    <>
                      <span className="animate-spin">⟳</span> Processing...
                    </>
                  ) : userBalance < cartTotal ? (
                    <>Insufficient balance</>
                  ) : (
                    <>
                      <Check className="w-4 h-4" /> Checkout
                    </>
                  )}
                </button>

                {/* Checkout Confirmation Dialog */}
                <AnimatePresence>
                  {showCheckoutConfirm && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={() => setShowCheckoutConfirm(false)}
                    >
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-md p-6 space-y-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <h3 className="text-lg font-bold">Confirm Purchase</h3>
                        <div className="space-y-2 text-sm text-gray-400">
                          {cart.map((ci) => (
                            <div key={ci.item.id} className="flex items-center justify-between">
                              <span className="truncate">
                                {ci.item.title} ({ci.license})
                              </span>
                              <span className="text-neon-green font-mono">
                                {formatPrice(ci.price)}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-lattice-border pt-2 space-y-1">
                            <div className="flex items-center justify-between text-gray-400 text-xs">
                              <span>Platform fee ({(marketplaceFeeRate * 100).toFixed(0)}%)</span>
                              <span>
                                {formatPrice(
                                  Math.round(cartTotal * marketplaceFeeRate * 100) / 100
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between font-bold text-white">
                              <span>Total</span>
                              <span className="text-neon-green">{formatPrice(cartTotal)}</span>
                            </div>
                          </div>
                        </div>
                        {checkoutError && (
                          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                            {checkoutError}
                          </p>
                        )}
                        <div className="flex items-center justify-end gap-2 pt-2">
                          <button
                            onClick={() => {
                              setShowCheckoutConfirm(false);
                              setCheckoutError(null);
                            }}
                            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              setShowCheckoutConfirm(false);
                              handleCheckout();
                            }}
                            disabled={checkoutLoading}
                            className={cn(
                              'btn-neon purple text-sm',
                              checkoutLoading && 'opacity-50 cursor-not-allowed'
                            )}
                          >
                            {checkoutLoading ? 'Processing...' : 'Confirm Purchase'}
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* ================================================================== */}
      {/* PURCHASES TAB                                                      */}
      {/* ================================================================== */}
      {tab === 'purchases' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {purchases.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Download className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No purchases yet</p>
            </div>
          ) : (
            purchases.map((p) => {
              const tier = LICENSE_TIERS.find((t) => t.id === p.license);
              const Icon = typeIcon(p.item.type);
              return (
                <div key={p.id} className="panel p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-lattice-deep flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.item.title}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{p.item.creator.name}</span>
                      <span className="text-gray-600">|</span>
                      <span className={tier?.color}>{tier?.name} License</span>
                      <span className="text-gray-600">|</span>
                      <span>{new Date(p.purchasedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-400">{formatPrice(p.price)}</span>
                  <button
                    onClick={async () => {
                      useUIStore.getState().addToast({
                        type: 'info',
                        message: `Preparing download: ${p.item.title}...`,
                      });
                      try {
                        const res = await api.get(`/api/marketplace/install`, {
                          params: { id: p.item.id },
                        });
                        if (res.data?.ok) {
                          useUIStore.getState().addToast({
                            type: 'success',
                            message: `${p.item.title} installed successfully`,
                          });
                        } else {
                          useUIStore.getState().addToast({
                            type: 'success',
                            message: `${p.item.title} added to your library`,
                          });
                        }
                      } catch (e) {
                        console.error('Marketplace install failed:', e);
                        useUIStore.getState().addToast({
                          type: 'error',
                          message: `Failed to install ${p.item.title}`,
                        });
                      }
                    }}
                    className="btn-neon small flex items-center gap-1 text-sm"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                </div>
              );
            })
          )}
        </motion.div>
      )}

      {/* ================================================================== */}
      {/* ANALYTICS TAB                                                      */}
      {/* ================================================================== */}
      {tab === 'analytics' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Royalty Cascade Flow Visualization */}
          <RoyaltyCascadeViz />

          {/* Royalty Earnings Dashboard */}
          {user?.id && <RoyaltyDashboard userId={user.id} />}

          <div className="panel p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-neon-cyan" /> Revenue Over Time
            </h3>
            <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
              No revenue data yet
            </div>
          </div>

          {/* Top Sellers */}
          <div className="panel p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-green" /> Top Selling Items
            </h3>
            {[...allItems]
              .sort((a, b) => b.sales - a.sales)
              .slice(0, 5)
              .map((item, i) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-2 border-b border-lattice-border last:border-0"
                >
                  <span className="text-xs text-gray-600 w-5 text-right font-mono">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-xs text-gray-500">
                      {item.type} by {item.creator.name}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">{item.sales} sales</span>
                  <span className="text-sm text-neon-green font-bold">
                    ${(item.sales * item.prices.basic * 0.7).toFixed(0)}
                  </span>
                </div>
              ))}
          </div>

          {/* Quick stats — computed from real data */}
          <div className="grid grid-cols-3 gap-4">
            {(() => {
              const myListings = allItems.slice(0, 3);
              const totalRevenue = myListings.reduce(
                (sum, i) => sum + i.sales * i.prices.basic * 0.7,
                0
              );
              const totalSales = myListings.reduce((sum, i) => sum + i.sales, 0);
              const avgOrder = totalSales > 0 ? Math.round(totalRevenue / totalSales) : 0;
              return [
                {
                  label: 'Total Revenue',
                  value: totalRevenue > 0 ? `$${Math.round(totalRevenue).toLocaleString()}` : '$0',
                  sub: `From ${totalSales} sales`,
                  color: 'text-neon-green',
                },
                {
                  label: 'Total Sales',
                  value: String(totalSales),
                  sub: `Across ${myListings.length} listings`,
                  color: 'text-neon-cyan',
                },
                {
                  label: 'Avg Order Value',
                  value: avgOrder > 0 ? `$${avgOrder}` : '$0',
                  sub: 'Across all licenses',
                  color: 'text-neon-purple',
                },
              ];
            })().map((s) => (
              <div key={s.label} className="lens-card p-4 space-y-1">
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
                <p className="text-[10px] text-gray-500">{s.sub}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ================================================================== */}
      {/* AUDIO PREVIEW BAR                                                  */}
      {/* ================================================================== */}
      <AnimatePresence>
        {previewItem && (
          <AudioPreviewBar
            item={previewItem}
            playing={isPlaying}
            onToggle={() => setIsPlaying((p) => !p)}
            onClose={closePreview}
          />
        )}
      </AnimatePresence>

      {/* Artifact Detail Modal — opened on item click */}
      {selectedArtifactId && (
        <ArtifactDetailModal
          artifactId={selectedArtifactId}
          onClose={() => setSelectedArtifactId(null)}
        />
      )}

      {/* Royalty Cascade Drawer */}
      <AnimatePresence>
        {royaltyVizDtuId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4"
            onClick={() => setRoyaltyVizDtuId(null)}
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="bg-lattice-surface border border-neon-cyan/20 rounded-xl w-full max-w-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-neon-cyan" /> Royalty Cascade
                </h3>
                <button
                  onClick={() => setRoyaltyVizDtuId(null)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <RoyaltyCascadeViz />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================================================================== */}
      {/* DTU CONTEXT PANEL & ARTIFACTS (v3.0)                               */}
      {/* ================================================================== */}
      {tab === 'browse' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
          {marketArtifacts.length > 0 && (
            <div className="lg:col-span-3 space-y-3">
              <h3 className="text-lg font-bold">DTU Artifacts</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {marketArtifacts.slice(0, 6).map((dtu: DTU) => (
                  <div
                    key={dtu.id}
                    className="p-3 rounded-lg bg-lattice-surface border border-lattice-border space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate flex-1">
                        {dtu.title || dtu.human?.summary || 'Untitled'}
                      </p>
                      <ProvenanceBadge
                        source={dtu.source}
                        model={dtu.meta?.model as string}
                        authority={dtu.meta?.authority as string}
                      />
                    </div>
                    <ArtifactRenderer dtuId={dtu.id} artifact={dtu.artifact!} mode="thumbnail" />
                    <FeedbackWidget targetType="dtu" targetId={dtu.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={marketArtifacts.length > 0 ? '' : 'lg:col-start-4'}>
            <ArtifactUploader
              lens="marketplace"
              acceptTypes="audio/*,image/*"
              multi
              compact
              onUploadComplete={() => refetchDTUs()}
            />
            <div className="mt-4">
              <LensContextPanel
                hyperDTUs={hyperDTUs}
                megaDTUs={megaDTUs}
                regularDTUs={regularDTUs}
                tierDistribution={tierDistribution}
                onPublish={(dtu) => publishDTU({ dtuId: dtu.id })}
                title="Marketplace DTUs"
              />
            </div>
            <div className="mt-4">
              <FeedbackWidget targetType="lens" targetId="marketplace" />
            </div>
          </div>

          {/* Real-time Data Panel */}
          {realtimeData && (
            <>
              <UniversalActions domain="marketplace" artifactId={null} compact />
              <RealtimeDataPanel
                domain="marketplace"
                data={realtimeData}
                isLive={isLive}
                lastUpdated={lastUpdated}
                insights={realtimeInsights}
                compact
              />
            </>
          )}
        </div>
      )}

      {/* Backend Action Panel */}
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
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Tips</p>
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
                    Current:{' '}
                    <span className="text-white">${String(actionResult.currentPrice)}</span>
                  </span>
                  <span className="text-gray-400 text-xs">
                    Suggested:{' '}
                    <span className="text-neon-green font-bold">
                      ${String(actionResult.suggestedPrice)}
                    </span>
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
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
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="ext_marketplace" />
          </div>
        )}
      </div>
    </div>
  );
}
