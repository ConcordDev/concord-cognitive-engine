import {
  FileAudio,
  Grid3X3,
  Layers,
  Palette,
  Plug,
  Settings2,
  ShoppingBag,
} from 'lucide-react';

export interface CreatorInfo {
  name: string;
  avatar?: string;
  verified?: boolean;
}

export interface LicensePrice {
  basic: number;
  premium: number;
  unlimited: number;
  exclusive: number;
}

export interface MarketplaceItem {
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

export interface CartItem {
  item: MarketplaceItem;
  license: string;
  price: number;
}

export interface Purchase {
  id: string;
  item: MarketplaceItem;
  license: string;
  price: number;
  purchasedAt: string;
}

export type MarketplaceTabId =
  | 'browse'
  | 'sell'
  | 'cart'
  | 'purchases'
  | 'analytics'
  | 'watchlist';

export type ViewMode = 'grid' | 'list';
export type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'newest' | 'rating';
export type CategoryFilter =
  | 'all'
  | 'templates'
  | 'components'
  | 'datasets'
  | 'artwork'
  | 'plugins'
  | 'presets';

export const LICENSE_TIERS = [
  { id: 'basic', name: 'Basic', color: 'text-gray-400' },
  { id: 'premium', name: 'Premium', color: 'text-neon-cyan' },
  { id: 'unlimited', name: 'Unlimited', color: 'text-neon-purple' },
  { id: 'exclusive', name: 'Exclusive', color: 'text-neon-pink' },
] as const;

export const CATEGORIES: { id: CategoryFilter; name: string; icon: typeof ShoppingBag }[] = [
  { id: 'all', name: 'All', icon: Grid3X3 },
  { id: 'templates', name: 'Templates', icon: ShoppingBag },
  { id: 'components', name: 'Components', icon: FileAudio },
  { id: 'datasets', name: 'Datasets', icon: Layers },
  { id: 'artwork', name: 'Artwork', icon: Palette },
  { id: 'plugins', name: 'Plugins', icon: Plug },
  { id: 'presets', name: 'Presets', icon: Settings2 },
];

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'popular', label: 'Popular' },
  { value: 'price-asc', label: 'Price: Low-High' },
  { value: 'price-desc', label: 'Price: High-Low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Best Rated' },
];

export const GENRE_OPTIONS = [
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

export const WATCHLIST_KEY = 'concord_marketplace_watchlist';

export const LISTING_TYPE_TO_ITEM_TYPE: Record<string, MarketplaceItem['type']> = {
  beat: 'template',
  stems: 'component',
  'sample-pack': 'dataset',
  artwork: 'artwork',
};

export interface ServerPurchaseRow {
  id: string;
  status: string;
  listingId: string;
  listingType: string;
  licenseType?: string;
  price: number;
  purchasedAt: string;
  listing: { id: string; title: string; ownerId?: string; genre?: string; artType?: string } | null;
}

export function normalizePrices(licenses: Record<string, unknown> | null | undefined): LicensePrice {
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

export function normalizeItems(items: Record<string, unknown>[]): MarketplaceItem[] {
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

export function normalizeComponents(components: Record<string, unknown>[]): MarketplaceItem[] {
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

export function normalizeDatasets(datasets: Record<string, unknown>[]): MarketplaceItem[] {
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

export function normalizeArt(art: Record<string, unknown>[]): MarketplaceItem[] {
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

/** Plugin browse (`marketplace.browse`) — name/author/price, not the beat licenses shape. */
export function normalizePlugins(items: Record<string, unknown>[]): MarketplaceItem[] {
  return (items || []).map((p: Record<string, unknown>) => ({
    id: String(p.id || ''),
    title: String(p.name || 'Untitled Plugin'),
    description: String(p.description || ''),
    type: 'plugin' as const,
    genre: p.category ? String(p.category) : undefined,
    version: typeof p.version === 'string' ? p.version : undefined,
    creator: { name: String(p.author || 'Unknown') },
    prices: {
      basic: typeof p.price === 'number' ? p.price : 0,
      premium: 0,
      unlimited: 0,
      exclusive: 0,
    },
    rating: typeof p.rating === 'number' ? p.rating : 0,
    ratingCount: Array.isArray(p.reviews) ? p.reviews.length : 0,
    sales: typeof p.downloads === 'number' ? p.downloads : 0,
    tags: p.category ? [String(p.category)] : [],
    createdAt: typeof p.submittedAt === 'string' ? p.submittedAt : new Date().toISOString(),
  }));
}

export function normalizeServerPurchase(row: ServerPurchaseRow): Purchase {
  const type = LISTING_TYPE_TO_ITEM_TYPE[row.listingType] || 'template';
  return {
    id: row.id,
    license: row.licenseType || 'basic',
    price: row.price,
    purchasedAt: row.purchasedAt,
    item: {
      id: row.listingId,
      title: row.listing?.title || 'Untitled',
      description: '',
      type,
      genre: row.listing?.genre,
      creator: { name: row.listing?.ownerId ? row.listing.ownerId : 'Unknown seller' },
      prices: { basic: row.price, premium: row.price, unlimited: row.price, exclusive: row.price },
      rating: 0,
      ratingCount: 0,
      sales: 0,
      tags: [],
      createdAt: row.purchasedAt,
    },
  };
}

export function formatPrice(cents: number) {
  return cents === 0 ? 'Free' : `$${cents}`;
}

export function typeIcon(type: MarketplaceItem['type']) {
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

export function typeBadgeColor(type: MarketplaceItem['type']) {
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

export const hasPreview = (t: string) => ['template', 'component', 'dataset'].includes(t);

export const EMPTY_LISTING_FORM = {
  title: '',
  type: 'template' as string,
  description: '',
  genre: '',
  tags: '',
  basicPrice: '',
  premiumPrice: '',
  unlimitedPrice: '',
  exclusivePrice: '',
};

export type NewListingForm = typeof EMPTY_LISTING_FORM;
