'use client';

/** Shared auction types — extracted from lenses/auction/page.tsx */

export interface PricePoint { cc: number; at: number }
export interface PriceStats { count: number; min: number; max: number; avg: number; last: number; changePct: number }
export interface DepthLevel { price: number; qty: number }
export interface MarketData {
  points: PricePoint[];
  stats: PriceStats | null;
  asks: DepthLevel[];
  bids: DepthLevel[];
  bestAsk: number | null;
  bestBid: number | null;
  spread: number | null;
}

export interface AuctionRow {
  id: string;
  sellerUserId: string;
  title: string;
  itemKind: 'dtu' | 'inventory';
  itemId: string;
  startCc: number;
  currentBidCc: number;
  buyoutCc: number | null;
  bidCount: number;
  leadingBidderUserId: string | null;
  endsAt: number;
}

export interface BuyOrderRow {
  id: string;
  buyer_user_id: string;
  world_id: string;
  item_kind: 'dtu' | 'inventory';
  item_descriptor: string;
  unit_price_cc: number;
  quantity_wanted: number;
  quantity_filled: number;
  total_escrow_cc: number;
  status: string;
  posted_at: number;
  expires_at: number;
}

export function fmtTime(endsAt: number) {
  const s = Math.max(0, endsAt - Math.floor(Date.now() / 1000));
  if (s > 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s > 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}
