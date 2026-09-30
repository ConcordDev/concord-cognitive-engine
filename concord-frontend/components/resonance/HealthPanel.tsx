'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Heart, Shield, Layers, TrendingUp, Eye, Radio } from 'lucide-react';
import {
  type BoundaryScan,
  SignalClassificationLegend,
} from '@/components/resonance/resonance-ui';

export function HealthPanel({
  scan,
  signal,
  homeostasis,
  repairRate,
}: {
  scan: BoundaryScan | undefined;
  signal: number;
  homeostasis: number;
  repairRate: number;
}) {
  const [legendOpen, setLegendOpen] = useState(false);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-sm font-bold">Lattice Health</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Homeostasis', value: homeostasis, icon: Heart },
          { label: 'Repair Rate', value: repairRate, icon: Shield },
          { label: 'Frontier Density', value: scan?.frontier?.density ?? 0, icon: Layers },
          { label: 'Constraint Gradient', value: scan?.gradient ?? 0, icon: TrendingUp },
          { label: 'Coherence Direction', value: Math.max(0, scan?.coherenceDirection ?? 0), icon: Eye },
          { label: 'Boundary Signal', value: signal, icon: Radio },
        ].map((m) => (
          <div key={m.label} className="p-3 rounded-lg border border-white/5"
            style={{ background: 'rgba(10,10,20,0.8)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-gray-400">{m.label}</span>
              <m.icon className="w-3.5 h-3.5 text-gray-700" />
            </div>
            <p className="text-2xl font-mono font-bold text-white">
              {(m.value * 100).toFixed(1)}<span className="text-sm text-gray-600">%</span>
            </p>
            <div className="h-1.5 bg-white/5 rounded-full mt-2 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  backgroundColor: m.value > 0.7 ? '#00ffc8' : m.value > 0.4 ? '#a855f7' : m.value > 0.15 ? '#eab308' : '#6b7280',
                }}
                initial={{ width: 0 }}
                animate={{ width: `${m.value * 100}%` }}
                transition={{ duration: 0.6 }}
              />
            </div>
          </div>
        ))}
      </div>

      <SignalClassificationLegend isOpen={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} />
    </div>
  );
}

export default HealthPanel;
