'use client';

import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-neon-cyan',
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <span className={ds.textMuted}>{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className={cn(ds.textMuted, 'text-xs mt-0.5')}>{sub}</p>}
    </div>
  );
}
