'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Cpu, Brain, Globe, Layers, Target, LayoutDashboard,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import {
  OpsTelemetryConsole,
  type OpsView,
} from '@/components/ops-telemetry/OpsTelemetryConsole';

const VIEWS: { id: OpsView; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'heartbeats', label: 'Heartbeats', icon: Layers },
  { id: 'workers', label: 'Workers', icon: Cpu },
  { id: 'brains', label: 'Brains', icon: Brain },
  { id: 'shards', label: 'Shards', icon: Globe },
];

export default function OpsTelemetryPage() {
  useLensIdentity('ops-telemetry');
  const [active, setActive] = useState<OpsView>('overview');

  return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <DepthBadge lensId="ops-telemetry" size="sm" className="ml-2" />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <nav
          aria-label="Grafana dashboards"
          className="sticky top-0 z-40 border-b border-fuchsia-500/20 bg-zinc-950/80 backdrop-blur"
        >
          <div className="mx-auto flex max-w-screen-2xl items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6">
            <Activity className="mr-2 h-4 w-4 shrink-0 text-fuchsia-400" aria-hidden="true" />
            <span className="mr-3 hidden font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia-500/70 sm:inline">
              Grafana
            </span>
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = active === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(v.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    on
                      ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                      : 'text-slate-400 hover:bg-zinc-800/60 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {v.label}
                </button>
              );
            })}
          </div>
        </nav>
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            <OpsTelemetryConsole view={active} />
          </motion.div>
        </AnimatePresence>
      </div>
    </LensShell>
  );
}
