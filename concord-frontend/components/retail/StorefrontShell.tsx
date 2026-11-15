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

export interface StorefrontProduct { sku: string; name: string; price: number; stock: number }
export interface StorefrontCustomer { id: string; name: string; email: string; orderCount: number; totalSpent: number }
export interface StorefrontDiscount { id: string; code: string; kind: string; value: number; usageCount: number; active: boolean }
export interface StorefrontZone { id: string; name: string; countries: string[]; rate?: number }
export interface StorefrontInfo { name: string; slug: string | null; published: boolean }

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
  /** Real lists behind the nav views (F9 — the nav switches views, it is not decoration). */
  products?: StorefrontProduct[];
  customers?: StorefrontCustomer[];
  discounts?: StorefrontDiscount[];
  shippingZones?: StorefrontZone[];
  storefront?: StorefrontInfo | null;
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
  products, customers, discounts, shippingZones, storefront,
  className,
}: StorefrontShellProps) {
  return (
    <div className={cn('flex flex-col bg-zinc-950 text-zinc-100 rounded-lg overflow-hidden border border-white/10 md:flex-row', className)} style={{ minHeight: 480 }}>
      {/* Storefront admin nav. On a phone it sits above the content instead of squeezing it. */}
      <aside className="w-full shrink-0 bg-[#1a1a1a] text-gray-200 md:w-48 md:flex md:flex-col">
        <div className="px-4 py-3 border-b border-white/10">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Store</div>
          <div className="text-sm font-semibold text-white truncate">{storeName}</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto py-2 md:flex-1 md:flex-col">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavChange?.(n.id)}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-2.5 px-3 text-xs text-left transition md:w-full',
                activeNav === n.id ? 'bg-white/10 text-white border-l-2 border-emerald-400' : 'text-gray-400 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
              )}
            >
              <n.icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main area — every nav item renders its own real view (F9) */}
      <main className="min-w-0 flex-1 space-y-4 bg-zinc-950 p-5">
        {(activeNav === 'home' || activeNav === 'analytics') && (
          <>
            {/* Hero metric cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <MetricCard icon={DollarSign} label="Total sales" value={fmtMoney(revenueToday)} caption="Today" tone="positive" />
              <MetricCard icon={ShoppingBag} label="Orders" value={String(ordersToday)} caption="Today" />
              <MetricCard icon={TrendingUp} label="Conversion" value={conversionRate != null ? `${conversionRate.toFixed(2)}%` : '—'} caption="Last 7 days" />
              <MetricCard icon={ShoppingCart} label="Visitors" value={visitors != null ? visitors.toLocaleString() : '—'} caption="Last 7 days" />
            </div>
            <p className="text-[10px] text-gray-400 -mt-2">Sales basis: order totals, tax included, net of refunds.</p>

            {/* Chart */}
            <section className="rounded-lg border border-white/10 p-4">
              <header className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-zinc-100">Sales · last 7 days</h3>
                <span className="text-xs text-gray-400">{fmtMoney(revenue7dSeries.reduce((s, v) => s + v, 0))}</span>
              </header>
              <RevenueChart series={revenue7dSeries} />
            </section>
          </>
        )}

        {(activeNav === 'home' || activeNav === 'orders') && (
          <section className="rounded-lg border border-white/10 overflow-hidden">
            <header className="px-4 py-2 border-b border-white/10 bg-zinc-900 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Recent orders</h3>
              <span className="text-xs text-gray-400">{recentOrders.length} shown</span>
            </header>
            {recentOrders.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">No orders yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-xs text-gray-400">
                  <tr><th className="text-left px-4 py-1.5">Order</th><th className="text-left">Customer</th><th className="text-right">Items</th><th className="text-right">Total</th><th className="text-right pr-4">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {recentOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-zinc-900">
                      <td className="px-4 py-2 font-mono text-emerald-700">{o.number}</td>
                      <td className="text-zinc-200">{o.customer || 'Guest'}</td>
                      <td className="text-right text-zinc-300">{o.itemCount}</td>
                      <td className="text-right font-mono tabular-nums text-zinc-100">{fmtMoney(o.total)}</td>
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
        )}

        {activeNav === 'products' && (
          <ListSection title="Products" empty="No products in the catalog yet.">
            {(products || []).map((pr) => (
              <Row key={pr.sku} left={<span className="font-mono text-emerald-700">{pr.sku}</span>} mid={pr.name} right={`${fmtMoney(pr.price)} · ${pr.stock} in stock`} />
            ))}
          </ListSection>
        )}

        {activeNav === 'customers' && (
          <ListSection title="Customers" empty="No customers yet.">
            {(customers || []).map((c) => (
              <Row key={c.id} left={<span className="text-zinc-100">{c.name}</span>} mid={c.email} right={`${c.orderCount} orders · ${fmtMoney(c.totalSpent)}`} />
            ))}
          </ListSection>
        )}

        {activeNav === 'discounts' && (
          <ListSection title="Discounts" empty="No discount codes yet.">
            {(discounts || []).map((d) => (
              <Row key={d.id} left={<span className="font-mono text-emerald-700">{d.code}</span>} mid={d.active ? 'Active' : 'Inactive'} right={`${d.kind === 'percentage' ? `${d.value}% off` : fmtMoney(d.value) + ' off'} · ${d.usageCount} redeemed`} />
            ))}
          </ListSection>
        )}

        {activeNav === 'shipping' && (
          <ListSection title="Shipping zones" empty="No shipping zones configured.">
            {(shippingZones || []).map((z) => (
              <Row key={z.id} left={<span className="text-zinc-100">{z.name}</span>} mid={z.countries.join(', ')} right={z.rate != null ? fmtMoney(z.rate) : ''} />
            ))}
          </ListSection>
        )}

        {activeNav === 'settings' && (
          <section className="rounded-lg border border-white/10 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-zinc-100">Storefront settings</h3>
            {storefront ? (
              <div className="text-sm text-zinc-200 space-y-1">
                <div>Name: <span className="text-zinc-100">{storefront.name || storeName}</span></div>
                <div>Address: <span className="font-mono text-zinc-100">{storefront.slug ? `/shop/${storefront.slug}` : 'not configured'}</span></div>
                <div>Status: <span className="text-zinc-100">{storefront.published ? 'Published' : 'Not published'}</span></div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Storefront not configured yet.</p>
            )}
            <p className="text-xs text-gray-400">Configure the name, theme and published products in the Commerce Suite&apos;s Storefront tab below — publishing lives there.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function ListSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="rounded-lg border border-white/10 overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      </header>
      {!has ? <div className="p-6 text-center text-sm text-gray-400">{empty}</div> : <div className="divide-y divide-white/10">{children}</div>}
    </section>
  );
}

function Row({ left, mid, right }: { left: React.ReactNode; mid?: string; right?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-zinc-900">
      <span className="w-36 flex-shrink-0 truncate">{left}</span>
      <span className="flex-1 truncate text-zinc-300">{mid || ''}</span>
      <span className="font-mono tabular-nums text-zinc-100">{right || ''}</span>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, caption, tone }: { icon: typeof DollarSign; label: string; value: string; caption: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <span className="text-xs text-gray-400">{label}</span>
        {tone === 'positive' && <ArrowUpRight className="w-3 h-3 text-emerald-600 ml-auto" />}
        {tone === 'negative' && <ArrowDownRight className="w-3 h-3 text-rose-600 ml-auto" />}
      </div>
      <div className="text-xl font-semibold text-zinc-100 tabular-nums">{value}</div>
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
