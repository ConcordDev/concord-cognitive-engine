'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';

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

// ─── Seed Data ───────────────────────────────────────────────────────────────

const SEED_LISTINGS: Listing[] = [
  {
    id: 'l1',
    title: 'Seismic Review',
    provider: '@jane_structures',
    avatarColor: 'bg-rose-500',
    priceCC: 50,
    priceUnit: 'flat',
    rating: 4.8,
    deliveryHours: 24,
    category: 'Structural Analysis',
    description:
      'Comprehensive seismic load review for structural DTUs. Includes zone classification, response spectrum analysis, and compliance report.',
    fullDescription:
      'Full seismic assessment per IBC/Eurocode 8 standards. I will review your structural DTU against the target seismic zone, perform response spectrum analysis, verify base shear calculations, and produce a detailed compliance report with recommendations. Includes one revision round.\n\nDeliverables:\n- Seismic hazard classification\n- Response spectrum overlay\n- Base shear & drift check\n- Compliance summary PDF',
    portfolio: [
      'Bridge pier seismic retrofit',
      'High-rise core wall analysis',
      '3-story timber frame validation',
    ],
  },
  {
    id: 'l2',
    title: 'Custom Bridge Design',
    provider: '@engineer_dutch',
    avatarColor: 'bg-blue-500',
    priceCC: 200,
    priceUnit: 'flat',
    rating: 4.9,
    deliveryHours: 72,
    category: 'Custom Component',
    description:
      'End-to-end bridge component design from concept to validated DTU. Pedestrian, vehicular, or rail.',
    fullDescription:
      'I design bridges. From initial sketch to a fully validated DTU ready for the registry. Includes material selection, structural analysis, environmental load validation, and publication support.\n\nProcess:\n1. Requirements gathering call (30 min)\n2. Concept sketch delivery (24h)\n3. Detailed DTU with validation suite (48h)\n4. Final review & publish\n\nSupported types: pedestrian, vehicular, rail, pipeline.',
    portfolio: ['24m pedestrian bridge', '60m cable-stayed concept', 'Railway overpass DTU'],
  },
  {
    id: 'l3',
    title: 'Material Selection',
    provider: '@kai_marine',
    avatarColor: 'bg-teal-500',
    priceCC: 30,
    priceUnit: 'per hour',
    rating: 4.7,
    deliveryHours: 0,
    category: 'Materials Consulting',
    description:
      'Expert material selection consulting for marine and coastal environments. Corrosion, fatigue, and cost optimization.',
    fullDescription:
      'Specializing in material selection for harsh environments. I help you choose the right alloy, coating, or composite for marine, offshore, and coastal structures.\n\nTopics covered:\n- Corrosion resistance mapping\n- Fatigue life estimation\n- Cost-weight-performance tradeoffs\n- Galvanic compatibility checks\n- Maintenance schedule recommendations\n\nHourly rate, minimum 1 hour.',
    portfolio: [
      'Offshore platform riser material study',
      'Marina dock composite selection',
      'Subsea pipeline coating spec',
    ],
  },
  {
    id: 'l4',
    title: 'NPC Personality Design',
    provider: '@nova_circuits',
    avatarColor: 'bg-purple-500',
    priceCC: 25,
    priceUnit: 'flat',
    rating: 4.5,
    deliveryHours: 48,
    category: 'NPC Configuration',
    description:
      'Design compelling NPC personalities with dialogue trees, behavioral patterns, and memory configurations.',
    fullDescription:
      'I craft NPC personalities that feel alive. Each design includes a personality profile, dialogue tree skeleton, behavioral state machine, memory/context configuration, and integration notes for your world.\n\nIncludes:\n- Personality archetype & backstory\n- 20+ dialogue nodes\n- 3 behavioral states\n- Memory config (short/long term)\n- Integration guide',
    portfolio: ['Merchant guild NPCs', 'Quest-giver elder', 'Dynamic companion AI'],
  },
  {
    id: 'l5',
    title: 'World Planning',
    provider: '@proxy_builder',
    avatarColor: 'bg-amber-500',
    priceCC: 100,
    priceUnit: 'flat',
    rating: 4.6,
    deliveryHours: 168,
    category: 'World Building',
    description:
      'Full world planning service: terrain layout, district zoning, infrastructure routing, and environmental storytelling.',
    fullDescription:
      'Comprehensive world planning from blank canvas to a fully documented district map. I handle terrain generation guidance, district zoning with purpose-driven layouts, infrastructure routing (roads, utilities, transit), and environmental storytelling layers.\n\nDeliverables:\n- Annotated district map\n- Zoning plan with rationale\n- Infrastructure routing diagram\n- Environmental narrative document\n- 5 point-of-interest briefs\n\nTimeline: 7 days for standard world (up to 10 districts).',
    portfolio: [
      'Neon Harbor district plan',
      'Verdant Heights residential zone',
      'Industrial Spine logistics layout',
    ],
  },
];

const SEED_ORDERS: Order[] = [
  {
    id: 'o1',
    listingId: 'l2',
    listingTitle: 'Custom Bridge Design',
    provider: '@engineer_dutch',
    priceCC: 200,
    status: 'in_progress',
    requirements:
      'Need a 30m pedestrian bridge for the Concord River crossing near District 7. Must support maintenance vehicle loads up to 3.5t. Coastal wind zone III.',
    review: null,
  },
];

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
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);

  // Order flow state
  const [orderingId, setOrderingId] = useState<string | null>(null);
  const [orderReqs, setOrderReqs] = useState('');

  // Review state
  const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewText, setReviewText] = useState('');

  // ── Live listings from backend (falls back to seed data when empty) ──
  const { data: liveListingsData } = useQuery({
    queryKey: ['world-services'],
    queryFn: () => apiHelpers.lens.list('world').then((r) => r.data),
    staleTime: 60_000,
  });
  const liveListings: Listing[] = useMemo(() => {
    const raw = liveListingsData;
    const items: Record<string, unknown>[] = Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw)
        ? raw
        : [];
    if (items.length === 0) return SEED_LISTINGS;
    return items.map((item: Record<string, unknown>) => ({
      id: String(item.id ?? item.dtuId ?? ''),
      title: String(item.title ?? ''),
      provider: String(item.provider ?? item.author ?? ''),
      avatarColor: String(item.avatarColor ?? '#6366f1'),
      priceCC: Number(item.priceCC ?? item.price ?? 0),
      priceUnit: String(item.priceUnit ?? 'per project'),
      rating: Number(item.rating ?? 4.5),
      deliveryHours: Number(item.deliveryHours ?? 48),
      category: String(item.category ?? 'General'),
      description: String(item.description ?? ''),
      fullDescription: String(item.fullDescription ?? item.description ?? ''),
      portfolio: Array.isArray(item.portfolio) ? item.portfolio.map(String) : [],
    }));
  }, [liveListingsData]);

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

  const placeOrder = (listing: Listing) => {
    const newOrder: Order = {
      id: `o${Date.now()}`,
      listingId: listing.id,
      listingTitle: listing.title,
      provider: listing.provider,
      priceCC: listing.priceCC,
      status: 'pending',
      requirements: orderReqs,
      review: null,
    };
    setOrders((prev) => [...prev, newOrder]);
    setOrderingId(null);
    setOrderReqs('');
    setTab('my-orders');
  };

  const submitReview = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: 'completed' as OrderStatus,
              review: { stars: reviewStars, text: reviewText },
            }
          : o
      )
    );
    setReviewOrderId(null);
    setReviewStars(5);
    setReviewText('');
  };

  // ── Render: Listing Card ──

  const renderCard = (listing: Listing) => {
    const isGrid = viewMode === 'grid';
    return (
      <div
        key={listing.id}
        onClick={() => setSelectedId(listing.id)}
        className={`bg-white/[0.03] border border-white/10 rounded-xl cursor-pointer hover:border-white/20 hover:bg-white/[0.05] transition-all ${
          isGrid ? 'p-4' : 'p-4 flex items-start gap-4'
        }`}
      >
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
