'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useAuth } from '@/hooks/useAuth';
import { useTilePush } from '@/hooks/useTilePush';
import { useUIStore } from '@/store/ui';
import {
  EMPTY_LISTING_FORM,
  normalizeArt,
  normalizeComponents,
  normalizeDatasets,
  normalizeItems,
  normalizePlugins,
  normalizeServerPurchase,
  WATCHLIST_KEY,
  type CartItem,
  type CategoryFilter,
  type LicensePrice,
  type MarketplaceItem,
  type MarketplaceTabId,
  type NewListingForm,
  type Purchase,
  type ServerPurchaseRow,
  type SortOption,
  type ViewMode,
} from './types';

export function useDeferredMount(timeoutMs = 500): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') {
      setReady(true);
      return;
    }
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: timeoutMs });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setReady(true), timeoutMs);
    return () => clearTimeout(t);
  }, [timeoutMs]);
  return ready;
}

interface MarketplaceStore {
  tab: MarketplaceTabId;
  setTab: (t: MarketplaceTabId) => void;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  category: CategoryFilter;
  setCategory: Dispatch<SetStateAction<CategoryFilter>>;
  genreFilter: string;
  setGenreFilter: Dispatch<SetStateAction<string>>;
  sortBy: SortOption;
  setSortBy: Dispatch<SetStateAction<SortOption>>;
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  cart: CartItem[];
  addToCart: (item: MarketplaceItem) => void;
  removeFromCart: (id: string) => void;
  updateCartLicense: (id: string, license: string) => void;
  cartTotal: number;
  watchlist: Set<string>;
  toggleWatchlist: (id: string) => void;
  persistWatchlist: (next: Set<string>) => void;
  setWatchlist: Dispatch<SetStateAction<Set<string>>>;
  previewItem: MarketplaceItem | null;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  handlePlay: (item: MarketplaceItem) => void;
  closePreview: () => void;
  checkoutLoading: boolean;
  checkoutError: string | null;
  setCheckoutError: Dispatch<SetStateAction<string | null>>;
  handleCheckout: () => Promise<void>;
  purchases: Purchase[];
  allItems: MarketplaceItem[];
  filteredItems: MarketplaceItem[];
  featuredItems: MarketplaceItem[];
  featuredIdx: number;
  setFeaturedIdx: Dispatch<SetStateAction<number>>;
  isBrowseLoading: boolean;
  browseHasError: boolean;
  browseErrorMessage?: string;
  refetchBrowse: () => void;
  userId: string | undefined;
  userBalance: number;
  marketplaceFeeRate: number;
  listingItems: { id?: string }[];
  isListingLoading: boolean;
  isListingError: boolean;
  showNewListing: boolean;
  setShowNewListing: Dispatch<SetStateAction<boolean>>;
  newListingForm: NewListingForm;
  setNewListingForm: Dispatch<SetStateAction<NewListingForm>>;
  listingSubmitting: boolean;
  listingError: string | null;
  setListingError: Dispatch<SetStateAction<string | null>>;
  handlePublishListing: () => Promise<void>;
  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  paletteQuery: string;
  setPaletteQuery: Dispatch<SetStateAction<string>>;
  paletteIdx: number;
  setPaletteIdx: Dispatch<SetStateAction<number>>;
  selectedArtifactId: string | null;
  setSelectedArtifactId: Dispatch<SetStateAction<string | null>>;
  royaltyVizDtuId: string | null;
  setRoyaltyVizDtuId: Dispatch<SetStateAction<string | null>>;
  deferredReady: boolean;
  shopStats: { totalSales: number; revenue: number; itemsListed: number; avgRating: number };
}

const Ctx = createContext<MarketplaceStore | null>(null);

export function useMarketplace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMarketplace must be used inside MarketplaceProvider');
  return ctx;
}

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const deferredReady = useDeferredMount();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useTilePush({
    lensId: 'marketplace',
    queryKeys: [
      ['marketplace-browse'],
      ['marketplace-templates'],
      ['marketplace-components'],
      ['marketplace-datasets'],
      ['marketplace-art'],
    ],
  });

  const [tab, setTab] = useState<MarketplaceTabId>('browse');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [genreFilter, setGenreFilter] = useState('All Categories');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [optimisticPurchases, setOptimisticPurchases] = useState<Purchase[]>([]);
  const [previewItem, setPreviewItem] = useState<MarketplaceItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [featuredIdx, setFeaturedIdx] = useState(0);
  const [showNewListing, setShowNewListing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(WATCHLIST_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const persistWatchlist = useCallback((next: Set<string>) => {
    try {
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);
  const toggleWatchlist = useCallback(
    (id: string) => {
      setWatchlist((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistWatchlist(next);
        return next;
      });
    },
    [persistWatchlist]
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  useEffect(() => {
    setPaletteIdx(0);
  }, [paletteQuery, paletteOpen]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [newListingForm, setNewListingForm] = useState(EMPTY_LISTING_FORM);
  const [listingSubmitting, setListingSubmitting] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [royaltyVizDtuId, setRoyaltyVizDtuId] = useState<string | null>(null);

  const {
    items: listingItems,
    isLoading: isListingLoading,
    isError: isListingError,
  } = useLensData('marketplace', 'listing', {
    noSeed: true,
  });

  const {
    data: browseData,
    isLoading: isBrowseLoading,
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
        return { ok: true, items: listingItems || [] };
      }
    },
  });

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

  const { data: myPurchasesData } = useQuery({
    queryKey: ['artistry-purchases'],
    enabled: Boolean(user?.id),
    queryFn: () =>
      apiHelpers.artistry.marketplace
        .purchases()
        .then((r) => r.data)
        .catch(() => ({ purchases: [] })),
  });

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

  const allItems = useMemo(() => {
    const browseItems = normalizePlugins(browseData?.items ?? browseData?.results ?? []);
    const artItems = [
      ...normalizeItems(templatesData?.beats ?? []),
      ...normalizeComponents(componentsData?.stems ?? []),
      ...normalizeDatasets(datasetsData?.samples ?? []),
      ...normalizeArt(artData?.artworks ?? []),
    ];
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

  const handlePublishListing = useCallback(async () => {
    if (!newListingForm.title.trim() || listingSubmitting) return;
    setListingSubmitting(true);
    setListingError(null);
    try {
      const created = await lensRun<{ listing: { id: string } }>('marketplace', 'listings-create', {
        title: newListingForm.title.trim(),
        description: newListingForm.description.trim(),
        priceUsd: Number(newListingForm.basicPrice) || 0,
        tags: newListingForm.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (!created.data.ok || !created.data.result?.listing?.id) {
        throw new Error(created.data.error || 'Failed to create listing');
      }
      const listingId = created.data.result.listing.id;
      const published = await lensRun('marketplace', 'listings-publish', { id: listingId });
      if (!published.data.ok) {
        throw new Error(
          published.data.error ||
            'Listing created but publish failed — find it under Sell to publish manually'
        );
      }
      setShowNewListing(false);
      setNewListingForm(EMPTY_LISTING_FORM);
      useUIStore.getState().addToast({
        type: 'success',
        message: 'Listing published — find it under Sell.',
      });
      setTab('sell');
    } catch (err) {
      setListingError(err instanceof Error ? err.message : 'Failed to publish listing');
    } finally {
      setListingSubmitting(false);
    }
  }, [newListingForm, listingSubmitting]);

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0 || checkoutLoading) return;
    if (!user?.id) {
      setCheckoutError('You must be signed in to complete checkout.');
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError(null);

    const completed: Purchase[] = [];
    const errors: string[] = [];

    for (const ci of cart) {
      try {
        if (ci.item.type === 'plugin') {
          const isFree = ci.item.prices.basic <= 0;
          const r = isFree
            ? await lensRun('marketplace', 'install', { pluginId: ci.item.id })
            : await lensRun('marketplace', 'purchasePlugin', { pluginId: ci.item.id, tier: 'install' });
          if (r.data.ok && r.data.result?.ok !== false) {
            const result = r.data.result as { price?: number } | null;
            completed.push({
              id: `plugin-${ci.item.id}-${Date.now()}`,
              item: ci.item,
              license: ci.license,
              price: isFree ? 0 : (result?.price ?? ci.price),
              purchasedAt: new Date().toISOString(),
            });
          } else {
            const failure = (r.data.result ?? r.data) as {
              message?: string;
              error?: string;
              reason?: string;
            } | null;
            errors.push(
              `${ci.item.title}: ${failure?.message || failure?.error || failure?.reason || 'Purchase failed'}`
            );
          }
          continue;
        }
        const typeMap: Record<string, string> = {
          template: 'beat',
          component: 'stems',
          dataset: 'sample-pack',
          artwork: 'artwork',
        };
        const listingType = typeMap[ci.item.type];
        if (!listingType) {
          errors.push(`${ci.item.title}: this listing type isn't purchasable yet`);
          continue;
        }
        const resp = await apiHelpers.artistry.marketplace.purchase({
          buyerId: user.id,
          listingId: ci.item.id,
          listingType,
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
      setOptimisticPurchases((prev) => [...completed, ...prev]);
      setCart((prev) => prev.filter((c) => !completed.some((p) => p.item.id === c.item.id)));
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
  }, [cart, checkoutLoading, queryClient, user]);

  const purchases = useMemo<Purchase[]>(() => {
    const fetched: Purchase[] = ((myPurchasesData?.purchases ?? []) as ServerPurchaseRow[]).map(
      normalizeServerPurchase
    );
    const fetchedItemIds = new Set(fetched.map((p) => p.item.id));
    const extra = optimisticPurchases.filter((p) => !fetchedItemIds.has(p.item.id));
    return [...extra, ...fetched];
  }, [myPurchasesData, optimisticPurchases]);

  useEffect(() => {
    setFeaturedIdx((i) => (featuredItems.length === 0 ? 0 : Math.min(i, featuredItems.length - 1)));
  }, [featuredItems.length]);

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

  const value = useMemo<MarketplaceStore>(
    () => ({
      tab,
      setTab,
      search,
      setSearch,
      category,
      setCategory,
      genreFilter,
      setGenreFilter,
      sortBy,
      setSortBy,
      viewMode,
      setViewMode,
      cart,
      addToCart,
      removeFromCart,
      updateCartLicense,
      cartTotal,
      watchlist,
      toggleWatchlist,
      persistWatchlist,
      setWatchlist,
      previewItem,
      isPlaying,
      setIsPlaying,
      handlePlay,
      closePreview,
      checkoutLoading,
      checkoutError,
      setCheckoutError,
      handleCheckout,
      purchases,
      allItems,
      filteredItems,
      featuredItems,
      featuredIdx,
      setFeaturedIdx,
      isBrowseLoading,
      browseHasError: isError5 || isError7,
      browseErrorMessage: error5?.message || error7?.message,
      refetchBrowse: () => {
        refetch5();
        refetch7();
      },
      userId: user?.id,
      userBalance,
      marketplaceFeeRate,
      listingItems: listingItems || [],
      isListingLoading,
      isListingError,
      showNewListing,
      setShowNewListing,
      newListingForm,
      setNewListingForm,
      listingSubmitting,
      listingError,
      setListingError,
      handlePublishListing,
      paletteOpen,
      setPaletteOpen,
      paletteQuery,
      setPaletteQuery,
      paletteIdx,
      setPaletteIdx,
      selectedArtifactId,
      setSelectedArtifactId,
      royaltyVizDtuId,
      setRoyaltyVizDtuId,
      deferredReady,
      shopStats,
    }),
    [
      tab,
      search,
      category,
      genreFilter,
      sortBy,
      viewMode,
      cart,
      addToCart,
      removeFromCart,
      updateCartLicense,
      cartTotal,
      watchlist,
      toggleWatchlist,
      persistWatchlist,
      previewItem,
      isPlaying,
      handlePlay,
      closePreview,
      checkoutLoading,
      checkoutError,
      handleCheckout,
      purchases,
      allItems,
      filteredItems,
      featuredItems,
      featuredIdx,
      isBrowseLoading,
      isError5,
      isError7,
      error5,
      error7,
      refetch5,
      refetch7,
      user?.id,
      userBalance,
      marketplaceFeeRate,
      listingItems,
      isListingLoading,
      isListingError,
      showNewListing,
      newListingForm,
      listingSubmitting,
      listingError,
      handlePublishListing,
      paletteOpen,
      paletteQuery,
      paletteIdx,
      selectedArtifactId,
      royaltyVizDtuId,
      deferredReady,
      shopStats,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
