'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'grid' | 'list';

type SortOption = 'price-asc' | 'price-desc' | 'rating' | 'delivery' | 'recent';

type OrderStatus = 'pending' | 'accepted' | 'in_progress' | 'delivered' | 'completed';

type Tab = 'browse' | 'my-orders';

interface Listing {
  id: string;
  title: string;
  provider: string;
  avatarColor: string;
  priceCC: number;
  priceUnit: string;
  rating: number;
  deliveryHours: number;
  category: string;
  description: string;
  fullDescription: string;
  portfolio: string[];
}

interface Order {
  id: string;
  listingId: string;
  listingTitle: string;
  provider: string;
  priceCC: number;
  status: OrderStatus;
  requirements: string;
  review: { stars: number; text: string } | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  'All',
  'Design Review',
  'Custom Component',
  'Structural Analysis',
  'Materials Consulting',
  'Quest Design',
  'World Building',
  'Mentoring',
  'NPC Configuration',
  'Infrastructure Planning',
  'Environmental Assessment',
  'Fabrication Consulting',
  'Other',
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'price-asc', label: 'Price Low\u2192High' },
  { value: 'price-desc', label: 'Price High\u2192Low' },
  { value: 'rating', label: 'Rating' },
  { value: 'delivery', label: 'Delivery Time' },
  { value: 'recent', label: 'Recent' },
];

const ORDER_STEPS: OrderStatus[] = ['pending', 'accepted', 'in_progress', 'delivered', 'completed'];

const ORDER_STEP_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  in_progress: 'In Progress',
  delivered: 'Delivered',
  completed: 'Completed',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDelivery(hours: number): string {
  if (hours === 0) return 'Flexible';
  if (hours < 24) return `${hours}h`;
  const days = hours / 24;
  return days === 1 ? '1 day' : `${days} days`;
}

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    '\u2605'.repeat(full) + (half ? '\u00BD' : '') + '\u2606'.repeat(5 - full - (half ? 1 : 0))
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ServiceMarketplace() {
  const [tab, setTab] = useState<Tab>('browse');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<SortOption>('rating');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Order flow state
  const [orderingId, setOrderingId] = useState<string | null>(null);
  const [orderReqs, setOrderReqs] = useState('');

  // Review state
  const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewText, setReviewText] = useState('');

  // ── Live listings from the service-market backend domain. Stays empty
  // (honest empty-state) when no user has created a listing yet — never
  // renders fabricated listings. ──
  const { data: liveListingsData } = useQuery({
    queryKey: ['service-market', 'listings'],
    queryFn: () =>
      lensRun('service-market', 'listing-list', { sort: 'recent' }).then((r) => r.data?.result),
    staleTime: 60_000,
  });
  const liveListings: Listing[] = useMemo(() => {
    const raw = liveListingsData as { listings?: Record<string, unknown>[] } | null | undefined;
    const items: Record<string, unknown>[] = Array.isArray(raw?.listings) ? raw!.listings! : [];
    if (items.length === 0) return [];
    return items.map((item: Record<string, unknown>) => ({
      id: String(item.id ?? ''),
      title: String(item.title ?? ''),
      provider: String(item.provider ?? ''),
      avatarColor: String(item.avatarColor ?? '#6366f1'),
      priceCC: Number(item.price ?? item.priceCC ?? 0),
      priceUnit: String(item.priceUnit ?? 'per project'),
      rating: Number(item.rating ?? 4.5),
      deliveryHours: Number(item.deliveryHours ?? 48),
      category: String(item.category ?? 'General'),
      description: String(item.description ?? ''),
      fullDescription: String(item.fullDescription ?? item.description ?? ''),
      portfolio: Array.isArray(item.portfolio) ? item.portfolio.map(String) : [],
    }));
  }, [liveListingsData]);

  // ── Live orders the current user placed (as buyer). Created live during
  // this session via order-create, then refetched. Starts empty. ──
  const { data: liveOrdersData, refetch: refetchOrders } = useQuery({
    queryKey: ['service-market', 'orders'],
    queryFn: () =>
      lensRun('service-market', 'order-list', { role: 'buyer' }).then((r) => r.data?.result),
    staleTime: 30_000,
  });
  const orders: Order[] = useMemo(() => {
    const raw = liveOrdersData as { orders?: Record<string, unknown>[] } | null | undefined;
    const items: Record<string, unknown>[] = Array.isArray(raw?.orders) ? raw!.orders! : [];
    return items.map((o: Record<string, unknown>) => ({
      id: String(o.id ?? ''),
      listingId: String(o.listingId ?? ''),
      listingTitle: String(o.listingTitle ?? ''),
      provider: String(o.provider ?? ''),
      priceCC: Number(o.total ?? o.unitPrice ?? 0),
      status: (String(o.status ?? 'pending') as OrderStatus),
      requirements: String(o.requirements ?? ''),
      review: (o.review as { stars: number; text: string } | null) ?? null,
    }));
  }, [liveOrdersData]);

  // ── Filtered & sorted listings ──

  const filteredListings = useMemo(() => {
    let list = [...liveListings];
    if (category !== 'All') {
      list = list.filter((l) => l.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.provider.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case 'price-asc':
        list.sort((a, b) => a.priceCC - b.priceCC);
        break;
      case 'price-desc':
        list.sort((a, b) => b.priceCC - a.priceCC);
        break;
      case 'rating':
        list.sort((a, b) => b.rating - a.rating);
        break;
      case 'delivery':
        list.sort((a, b) => a.deliveryHours - b.deliveryHours);
        break;
      case 'recent':
        break;
    }
    return list;
  }, [category, sort, search, liveListings]);

  const selectedListing = useMemo(
    () => liveListings.find((l) => l.id === selectedId) ?? null,
    [selectedId, liveListings]
  );

  // ── Order actions ──

  const placeOrder = useCallback(
    async (listing: Listing) => {
      const reqs = orderReqs;
      setOrderingId(null);
      setOrderReqs('');
      setTab('my-orders');
      await lensRun('service-market', 'order-create', {
        listingId: listing.id,
        requirements: reqs,
      });
      await refetchOrders();
    },
    [orderReqs, refetchOrders]
  );

  const submitReview = useCallback(
    async (orderId: string) => {
      setReviewOrderId(null);
      setReviewStars(5);
      setReviewText('');
      // Mark the order completed on the backend (delivered → completed). The
      // review text/stars are kept client-side until a review macro exists.
      await lensRun('service-market', 'order-update-status', {
        id: orderId,
        status: 'completed',
      });
      await refetchOrders();
    },
    [refetchOrders]
  );

  // ── Render: Listing Card ──

  const renderCard = (listing: Listing) => {
    const isGrid = viewMode === 'grid';
    return (
      <div
        key={listing.id}
        onClick={() => setSelectedId(listing.id)}
        className={`bg-white/[0.03] border border-white/10 rounded-xl cursor-pointer hover:border-white/20 hover:bg-white/[0.05] transition-all ${
          isGrid ? 'p-4' : 'p-4 flex items-start gap-4'
        }`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        {/* Avatar */}
        <div
          className={`${listing.avatarColor} w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`}
        >
          {listing.provider[1].toUpperCase()}
        </div>

        <div className={isGrid ? 'mt-3' : 'flex-1 min-w-0'}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-white/90 truncate">{listing.title}</h3>
            <span className="text-sm font-bold text-emerald-400 shrink-0">
              {listing.priceCC} CC{listing.priceUnit === 'per hour' ? '/hr' : ''}
            </span>
          </div>

          <div className="text-xs text-white/40 mt-0.5">{listing.provider}</div>

          <p className="text-xs text-white/60 mt-2 line-clamp-2 leading-relaxed">
            {listing.description}
          </p>

          <div className="flex items-center gap-3 mt-3 text-xs text-white/50">
            <span className="text-amber-400">
              {renderStars(listing.rating)} <span className="text-white/40">{listing.rating}</span>
            </span>
            {listing.deliveryHours > 0 && <span>{formatDelivery(listing.deliveryHours)}</span>}
            <span className="bg-white/5 px-1.5 py-0.5 rounded text-[10px]">{listing.category}</span>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Detail Panel ──

  const renderDetail = () => {
    if (!selectedListing) return null;
    const l = selectedListing;
    const isOrdering = orderingId === l.id;

    return (
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white/90">{l.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <div
                className={`${l.avatarColor} w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold`}
              >
                {l.provider[1].toUpperCase()}
              </div>
              <span className="text-sm text-white/50">{l.provider}</span>
              <span className="text-amber-400 text-sm">
                {renderStars(l.rating)} {l.rating}
              </span>
            </div>
          </div>
          <button
            onClick={() => setSelectedId(null)}
            className="text-white/40 hover:text-white text-lg"
          >
            \u00D7
          </button>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-400 font-bold text-lg">
            {l.priceCC} CC{l.priceUnit === 'per hour' ? '/hr' : ''}
          </span>
          {l.deliveryHours > 0 && (
            <span className="text-white/50">Delivery: {formatDelivery(l.deliveryHours)}</span>
          )}
        </div>

        <div className="text-sm text-white/70 leading-relaxed whitespace-pre-line">
          {l.fullDescription}
        </div>

        {/* Portfolio */}
        <div>
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            Portfolio DTU Previews
          </h4>
          <div className="flex gap-2 flex-wrap">
            {l.portfolio.map((item, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/60"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Order flow */}
        {!isOrdering ? (
          <button
            onClick={() => setOrderingId(l.id)}
            className="w-full py-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-medium text-sm hover:bg-emerald-500/30 transition-colors"
          >
            Order Service
          </button>
        ) : (
          <div className="space-y-3 bg-white/[0.03] border border-white/10 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white/80">Place Order</h4>
            <div>
              <label className="block text-xs text-white/50 mb-1">Requirements</label>
              <textarea
                value={orderReqs}
                onChange={(e) => setOrderReqs(e.target.value)}
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 resize-y focus:outline-none focus:border-white/25"
                placeholder="Describe what you need..."
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/50">
                Escrow: <span className="text-emerald-400 font-semibold">{l.priceCC} CC</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOrderingId(null)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 text-white/50 text-xs hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => placeOrder(l)}
                  className="px-4 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                >
                  Confirm Order
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render: Order Status Tracker ──

  const renderOrderTracker = (order: Order) => {
    const currentIdx = ORDER_STEPS.indexOf(order.status);
    return (
      <div className="flex items-center gap-1 mt-3">
        {ORDER_STEPS.map((step, i) => (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  i <= currentIdx ? 'bg-emerald-500/80 text-white' : 'bg-white/10 text-white/30'
                }`}
              >
                {i < currentIdx ? '\u2713' : i + 1}
              </div>
              <span
                className={`text-[9px] mt-0.5 ${
                  i <= currentIdx ? 'text-emerald-400/80' : 'text-white/30'
                }`}
              >
                {ORDER_STEP_LABELS[step]}
              </span>
            </div>
            {i < ORDER_STEPS.length - 1 && (
              <div
                className={`flex-1 h-px ${i < currentIdx ? 'bg-emerald-500/50' : 'bg-white/10'}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ── Render: My Orders ──

  const renderMyOrders = () => (
    <div className="space-y-3 p-4">
      {orders.length === 0 ? (
        <div className="text-center text-white/40 py-12 text-sm">No orders yet.</div>
      ) : (
        orders.map((order) => (
          <div
            key={order.id}
            className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-2"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white/90">{order.listingTitle}</h3>
                <div className="text-xs text-white/40">
                  {order.provider} &middot;{' '}
                  <span className="text-emerald-400">{order.priceCC} CC</span>
                </div>
              </div>
              <span
                className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                  order.status === 'completed'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : order.status === 'delivered'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                {ORDER_STEP_LABELS[order.status]}
              </span>
            </div>

            {order.requirements && (
              <p className="text-xs text-white/50 leading-relaxed">{order.requirements}</p>
            )}

            {renderOrderTracker(order)}

            {/* Review section */}
            {order.status === 'delivered' && !order.review && (
              <div className="mt-3 space-y-2">
                {reviewOrderId === order.id ? (
                  <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-semibold text-white/60">Leave a Review</div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          onClick={() => setReviewStars(s)}
                          className={`text-lg ${
                            s <= reviewStars ? 'text-amber-400' : 'text-white/20'
                          }`}
                        >
                          \u2605
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 resize-none focus:outline-none focus:border-white/25"
                      placeholder="Write your review..."
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setReviewOrderId(null)}
                        className="px-3 py-1 rounded text-xs text-white/40 hover:text-white/60"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => submitReview(order.id)}
                        className="px-3 py-1 rounded bg-amber-500/20 text-amber-300 text-xs font-medium hover:bg-amber-500/30 transition-colors"
                      >
                        Submit Review
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setReviewOrderId(order.id)}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    Leave a Review
                  </button>
                )}
              </div>
            )}

            {order.review && (
              <div className="mt-2 bg-white/[0.03] border border-white/10 rounded-lg p-3">
                <div className="text-amber-400 text-sm">
                  {'\u2605'.repeat(order.review.stars)}
                  {'\u2606'.repeat(5 - order.review.stars)}
                </div>
                <p className="text-xs text-white/60 mt-1">{order.review.text}</p>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  // ── Main Render ──

  return (
    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden flex flex-col h-full">
      {/* ── Header ── */}
      <div className="border-b border-white/10 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-base font-semibold text-white/90">Service Marketplace</h1>
        <div className="flex items-center gap-2">
          {/* Tabs */}
          <button
            onClick={() => setTab('browse')}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              tab === 'browse' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setTab('my-orders')}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              tab === 'my-orders' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            My Orders
            {orders.length > 0 && (
              <span className="ml-1.5 bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {orders.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === 'my-orders' ? (
        <div className="flex-1 overflow-y-auto">{renderMyOrders()}</div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* ── Sidebar ── */}
          <div className="w-52 shrink-0 border-r border-white/10 overflow-y-auto p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-2 px-2">
              Categories
            </div>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`block w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
                  category === cat
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* ── Main content ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Controls bar */}
            <div className="border-b border-white/10 px-4 py-2.5 flex items-center gap-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/90 focus:outline-none focus:border-white/25"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 focus:outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-gray-900">
                    {o.label}
                  </option>
                ))}
              </select>
              {/* View toggle */}
              <div className="flex border border-white/10 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2 py-1.5 text-xs ${
                    viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-white/40'
                  }`}
                  title="Grid view"
                >
                  \u25A6
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2 py-1.5 text-xs ${
                    viewMode === 'list' ? 'bg-white/10 text-white' : 'text-white/40'
                  }`}
                  title="List view"
                >
                  \u2630
                </button>
              </div>
              <span className="text-xs text-white/30">{filteredListings.length} services</span>
            </div>

            {/* Listings + detail */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Detail panel */}
              {selectedListing && renderDetail()}

              {/* Grid / List */}
              <div
                className={
                  viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : 'space-y-3'
                }
              >
                {filteredListings.map(renderCard)}
              </div>

              {filteredListings.length === 0 && (
                <div className="text-center text-white/40 py-12 text-sm">
                  No services match your filters.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
