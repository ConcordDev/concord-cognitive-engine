'use client';

import { motion } from 'framer-motion';
import {
  BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

export interface TransactionSummary {
  royaltyTotal: number;
  salesTotal: number;
  total: number;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  from?: string;
  to?: string;
  timestamp: number;
}

export interface DTUSummary {
  id: string;
  title?: string;
  summary?: string;
  citationCount?: number;
  tags?: string[];
  tier?: string;
}

export type AnalyticsView =
  | 'overview'
  | 'revenue'
  | 'dtus'
  | 'actions'
  | 'platform'
  | 'events'
  | 'advanced'
  | 'funnels';

export type DeskMode = 'overview' | 'revenue' | 'dtus' | 'actions';

export const LENS_COLORS = [
  'bg-neon-cyan/70',
  'bg-neon-purple/70',
  'bg-neon-pink/70',
  'bg-neon-green/70',
  'bg-yellow-400/70',
  'bg-blue-400/70',
  'bg-orange-400/70',
  'bg-teal-400/70',
];

export const TIER_PIE_COLORS: Record<string, string> = {
  regular: '#3b82f6',
  mega: '#8b5cf6',
  hyper: '#ec4899',
  shadow: '#6b7280',
};

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
  raw,
}: {
  label: string;
  value: string | number;
  icon: typeof BarChart3;
  color: string;
  raw?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-lattice-deep border border-lattice-border"
    >
      <Icon className={cn('w-4 h-4 mb-2', color)} />
      <div className={cn('text-2xl font-bold', color)}>
        {raw ? value : formatNumber(value as number)}
      </div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </motion.div>
  );
}

export function RevenueBar({
  label,
  amount,
  total,
  color,
}: {
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const barColor = color.includes('purple')
    ? '#8b5cf6'
    : color.includes('cyan')
      ? '#00e5ff'
      : '#3b82f6';
  const data = [{ name: label, value: amount, total }];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="text-white font-medium">
          {formatNumber(amount)} CC ({total > 0 ? ((amount / total) * 100).toFixed(0) : 0}%)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={28}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide domain={[0, total || 1]} />
          <YAxis type="category" dataKey="name" hide />
          <Bar
            dataKey="value"
            fill={barColor}
            radius={[4, 4, 4, 4]}
            background={{ fill: '#1e293b', radius: 4 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TierBreakdown({ dtus }: { dtus: DTUSummary[] }) {
  const tierCounts: Record<string, number> = {};
  for (const dtu of dtus) {
    const tier = dtu.tier || 'regular';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  const pieData = Object.entries(tierCounts).map(([tier, count]) => ({
    name: tier,
    value: count,
    color: TIER_PIE_COLORS[tier] || '#6b7280',
  }));

  if (pieData.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No DTU data available</p>;
  }

  return (
    <div data-lens-theme="analytics" className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={55}
            paddingAngle={2}
            strokeWidth={0}
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a2e',
              border: '1px solid #2d2d44',
              borderRadius: 8,
              color: '#fff',
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {pieData.map(({ name, value, color }) => (
          <div key={name} className="flex items-center gap-2 text-sm">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-300 capitalize flex-1">{name}</span>
            <span className="text-gray-400">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
