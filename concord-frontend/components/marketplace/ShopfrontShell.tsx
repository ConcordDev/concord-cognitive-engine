'use client';

/**
 * ShopfrontShell — the storefront Shop Manager-shape sidebar chrome.
 *
 * Top nav (the storefront's): Home / Listings / Orders / Stats / Marketing /
 * Finances / Tools. Includes a header strip with the user's shop name
 * + currency for quick context.
 */

import React from 'react';
import { Home, Tag, Package, BarChart3, Megaphone, Wallet, Wrench, Search, Sparkles, Store, Star, MessageSquare, Layers, Truck, Ticket, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ShopNav =
  | 'home' | 'storefront' | 'listings' | 'variations' | 'orders' | 'messages'
  | 'reviews' | 'stats' | 'visibility' | 'marketing' | 'coupons' | 'insights'
  | 'shipping' | 'inventory' | 'tools' | 'shop';

interface NavItem { id: ShopNav; label: string; icon: typeof Home; badge?: number | string }

const NAV: NavItem[] = [
  { id: 'home',       label: 'Home',          icon: Home },
  { id: 'storefront', label: 'Storefront',    icon: Store },
  { id: 'listings',   label: 'Listings',      icon: Tag },
  { id: 'variations', label: 'Variations',    icon: Layers },
  { id: 'orders',     label: 'Orders',        icon: Package },
  { id: 'messages',   label: 'Messages',      icon: MessageSquare },
  { id: 'reviews',    label: 'Reviews',       icon: Star },
  { id: 'stats',      label: 'Stats',         icon: BarChart3 },
  { id: 'visibility', label: 'Search visibility', icon: Search },
  { id: 'marketing',  label: 'Marketing',     icon: Megaphone },
  { id: 'coupons',    label: 'Coupons',       icon: Ticket },
  { id: 'insights',   label: 'Insights',      icon: Sparkles },
  { id: 'shipping',   label: 'Shipping',      icon: Truck },
  { id: 'inventory',  label: 'Inventory',     icon: AlertTriangle },
  { id: 'tools',      label: 'Tools',         icon: Wrench },
  { id: 'shop',       label: 'Shop settings', icon: Store },
];

export interface ShopfrontShellProps {
  activeNav: ShopNav;
  onNavChange: (n: ShopNav) => void;
  badges?: Partial<Record<ShopNav, number | string>>;
  shopName?: string;
  currency?: string;
  children: React.ReactNode;
}

export function ShopfrontShell({ activeNav, onNavChange, badges = {}, shopName, currency, children }: ShopfrontShellProps) {
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
      <aside className="w-48 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-semibold text-gray-200">Shop Manager</span>
          </div>
          {shopName && (
            <div className="mt-1 text-[10px] text-gray-400 truncate">{shopName} · {currency || 'USD'}</div>
          )}
        </header>
        <nav className="flex-1 overflow-y-auto py-2">
          <ul>
            {NAV.map(n => {
              const Icon = n.icon;
              const active = activeNav === n.id;
              const badge = badges[n.id];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onNavChange(n.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                      active ? 'bg-orange-500/10 text-orange-200 border-l-2 border-orange-400' : 'text-gray-400 hover:text-white hover:bg-white/[0.04] border-l-2 border-transparent',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate flex-1 text-left">{n.label}</span>
                    {badge !== undefined && badge !== 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-500/20 text-orange-300 font-mono">{badge}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}

export default ShopfrontShell;
