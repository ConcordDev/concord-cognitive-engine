'use client';

/**
 * StorefrontShell — a storefront-admin surface.
 *
 * Left-rail nav (Home/Orders/Products/Customers/Analytics) + top metric
 * tiles row + chart placeholder + recent-orders rail. Drop into the
 * retail lens above the existing workbench and the page reads as a
 * a familiar storefront admin inside 200ms.
 */

import React from 'react';
import {
  Home, ShoppingBag, Package, Users, BarChart3, Tag, Truck, Settings,
  DollarSign, TrendingUp, ShoppingCart, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StorefrontOrder {
  id: string;
  number: string;
  customer?: string;
  total: number;
  status: 'paid' | 'pending' | 'refunded' | 'fulfilled';
  itemCount: number;
  timestamp: string;
}

export interface StorefrontShellProps {
  activeNav?: 'home' | 'orders' | 'products' | 'customers' | 'analytics' | 'discounts' | 'shipping' | 'settings';
  onNavChange?: (nav: StorefrontShellProps['activeNav']) => void;
  storeName?: string;
  revenueToday: number;
  ordersToday: number;
  conversionRate?: number;
  visitors?: number;
  revenue7dSeries: number[];
  recentOrders: StorefrontOrder[];
  className?: string;
}

const NAV = [
  { id: 'home' as const, label: 'Home', icon: Home },
  { id: 'orders' as const, label: 'Orders', icon: ShoppingBag },
  { id: 'products' as const, label: 'Products', icon: Package },
  { id: 'customers' as const, label: 'Customers', icon: Users },
  { id: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
  { id: 'discounts' as const, label: 'Discounts', icon: Tag },
  { id: 'shipping' as const, label: 'Shipping', icon: Truck },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function StorefrontShell({
  activeNav = 'home', onNavChange,
  storeName = 'My Concord Store',
  revenueToday, ordersToday, conversionRate, visitors,
  revenue7dSeries, recentOrders,
  className,
}: StorefrontShellProps) {
  return (
    <div className={cn('flex bg-[#f6f6f7] text-gray-800 rounded-lg overflow-hidden border border-gray-200', className)} style={{ minHeight: 480 }}>
      {/* Left rail (storefront admin nav) */}
      <aside className="w-48 bg-[#1a1a1a] text-gray-200 flex-shrink-0 flex flex-col">
        <div className="px-4 py-3 border-b border-white/10">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Store</div>
          <div className="text-sm font-semibold text-white truncate">{storeName}</div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavChange?.(n.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition',
                activeNav === n.id ? 'bg-white/10 text-white border-l-2 border-emerald-400' : 'text-gray-400 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
              )}
            >
              <n.icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <main className="flex-1 p-5 space-y-4 bg-white">
        {/* Hero metric cards */}
        <div className="grid grid-cols-4 gap-3">
          <MetricCard icon={DollarSign} label="Total sales" value={fmtMoney(revenueToday)} caption="Today" tone="positive" />
          <MetricCard icon={ShoppingBag} label="Orders" value={String(ordersToday)} caption="Today" />
          <MetricCard icon={TrendingUp} label="Conversion" value={conversionRate != null ? `${conversionRate.toFixed(2)}%` : '—'} caption="Last 7 days" />
          <MetricCard icon={ShoppingCart} label="Visitors" value={visitors != null ? visitors.toLocaleString() : '—'} caption="Last 7 days" />
        </div>

        {/* Chart placeholder */}
        <section className="rounded-lg border border-gray-200 p-4">
          <header className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">Sales · last 7 days</h3>
            <span className="text-xs text-gray-400">{fmtMoney(revenue7dSeries.reduce((s, v) => s + v, 0))}</span>
          </header>
          <RevenueChart series={revenue7dSeries} />
        </section>

        {/* Recent orders */}
        <section className="rounded-lg border border-gray-200 overflow-hidden">
          <header className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Recent orders</h3>
            <span className="text-xs text-emerald-700 hover:text-emerald-800 cursor-pointer">View all →</span>
          </header>
          {recentOrders.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No orders yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-400">
                <tr><th className="text-left px-4 py-1.5">Order</th><th className="text-left">Customer</th><th className="text-right">Items</th><th className="text-right">Total</th><th className="text-right pr-4">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentOrders.slice(0, 8).map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-emerald-700">{o.number}</td>
                    <td className="text-gray-700">{o.customer || 'Guest'}</td>
                    <td className="text-right text-gray-600">{o.itemCount}</td>
                    <td className="text-right font-mono tabular-nums text-gray-900">{fmtMoney(o.total)}</td>
                    <td className="text-right pr-4">
                      <span className={cn(
                        'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium',
                        o.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                          : o.status === 'pending' ? 'bg-amber-100 text-amber-700'
                          : o.status === 'fulfilled' ? 'bg-cyan-100 text-cyan-700'
                          : 'bg-rose-100 text-rose-700'
                      )}>{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, caption, tone }: { icon: typeof DollarSign; label: string; value: string; caption: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <span className="text-xs text-gray-400">{label}</span>
        {tone === 'positive' && <ArrowUpRight className="w-3 h-3 text-emerald-600 ml-auto" />}
        {tone === 'negative' && <ArrowDownRight className="w-3 h-3 text-rose-600 ml-auto" />}
      </div>
      <div className="text-xl font-semibold text-gray-900 tabular-nums">{value}</div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider">{caption}</div>
    </div>
  );
}

function RevenueChart({ series }: { series: number[] }) {
  if (!series || series.length === 0) return <div className="h-24 flex items-center justify-center text-xs text-gray-400">No data</div>;
  const max = Math.max(...series, 1);
  return (
    <div className="flex items-end gap-1 h-24">
      {series.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-emerald-400/70 hover:bg-emerald-500 rounded-t transition"
            style={{ height: `${(v / max) * 100}%`, minHeight: 2 }}
            title={fmtMoney(v)}
          />
          <span className="text-[9px] text-gray-400">D{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

export default StorefrontShell;
