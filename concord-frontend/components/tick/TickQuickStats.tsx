'use client';

import { motion } from 'framer-motion';
import { Zap, Gauge, Eye, Heart } from 'lucide-react';
import { useTickStream } from '@/components/tick/TickStreamContext';

export function TickQuickStats() {
  const { stats, healthStatus, formatMs } = useTickStream();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Zap className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{stats.totalTicks}</p>
            <p className="text-xs text-gray-400">Ticks Processed</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Gauge className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{formatMs(stats.avgInterval)}</p>
            <p className="text-xs text-gray-400">Avg Interval</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Eye className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{Object.keys(stats.organBreakdown).length}</p>
            <p className="text-xs text-gray-400">Active Watchers</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Heart className="w-5 h-5 text-neon-pink" />
          <div>
            <p className="text-lg font-bold">{healthStatus.score}%</p>
            <p className="text-xs text-gray-400">Health Score</p>
          </div>
        </motion.div>
      </div>

  );
}
