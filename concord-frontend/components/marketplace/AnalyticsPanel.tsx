'use client';

import { motion } from 'framer-motion';
import { BarChart2, TrendingUp } from 'lucide-react';
import RoyaltyCascadeViz from '@/components/visualizations/RoyaltyCascadeViz';
import { RoyaltyDashboard } from '@/components/market/RoyaltyDashboard';
import { cn } from '@/lib/utils';
import { useMarketplace } from './MarketplaceProvider';

export function AnalyticsPanel() {
  const m = useMarketplace();
  const myListings = m.allItems.slice(0, 3);
  const totalRevenue = myListings.reduce((sum, i) => sum + i.sales * i.prices.basic * 0.7, 0);
  const totalSales = myListings.reduce((sum, i) => sum + i.sales, 0);
  const avgOrder = totalSales > 0 ? Math.round(totalRevenue / totalSales) : 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <RoyaltyCascadeViz />
      {m.userId && <RoyaltyDashboard userId={m.userId} />}

      <div className="panel p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-neon-cyan" /> Revenue Over Time
        </h3>
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
          No revenue data yet
        </div>
      </div>

      <div className="panel p-5 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-neon-green" /> Top Selling Items
        </h3>
        {[...m.allItems]
          .sort((a, b) => b.sales - a.sales)
          .slice(0, 5)
          .map((item, i) => (
            <div
              key={item.id}
              className="flex items-center gap-3 py-2 border-b border-lattice-border last:border-0"
            >
              <span className="text-xs text-gray-400 w-5 text-right font-mono">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-gray-400">
                  {item.type} by {item.creator.name}
                </p>
              </div>
              <span className="text-xs text-gray-400 tabular-nums">{item.sales} sales</span>
              <span className="text-sm text-neon-green font-bold tabular-nums">
                ${(item.sales * item.prices.basic * 0.7).toFixed(0)}
              </span>
            </div>
          ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
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
        ].map((s) => (
          <div key={s.label} className="lens-card p-4 space-y-1">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</p>
            <p className="text-[10px] text-gray-400">{s.sub}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
