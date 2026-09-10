'use client';

import { cn } from '@/lib/utils';

type Status = 'scheduled' | 'active' | 'completed' | 'cancelled' | 'archived';

const STATUS_COLORS: Record<Status, string> = {
  scheduled: 'neon-blue',
  active: 'neon-green',
  completed: 'neon-cyan',
  cancelled: 'red-400',
  archived: 'gray-400',
};


const VITAL_RANGES: Record<
  string,
  { low: number; high: number; critLow: number; critHigh: number; unit: string }
> = {
  heartRate: { low: 60, high: 100, critLow: 40, critHigh: 150, unit: 'bpm' },
  bpSystolic: { low: 90, high: 120, critLow: 70, critHigh: 180, unit: 'mmHg' },
  bpDiastolic: { low: 60, high: 80, critLow: 40, critHigh: 120, unit: 'mmHg' },
  temperature: { low: 97.0, high: 99.0, critLow: 95.0, critHigh: 103.0, unit: 'F' },
  respiratoryRate: { low: 12, high: 20, critLow: 8, critHigh: 30, unit: '/min' },
  o2Sat: { low: 95, high: 100, critLow: 88, critHigh: 101, unit: '%' },
};



/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function getVitalColor(key: string, value: number): string {
  const range = VITAL_RANGES[key];
  if (!range) return 'text-gray-300';
  if (value < range.critLow || value > range.critHigh) return 'text-red-400';
  if (value < range.low || value > range.high) return 'text-yellow-400';
  return 'text-green-400';
}

export function getVitalBg(key: string, value: number): string {
  const range = VITAL_RANGES[key];
  if (!range) return 'bg-lattice-elevated/50';
  if (value < range.critLow || value > range.critHigh) return 'bg-red-500/10 border-red-500/30';
  if (value < range.low || value > range.high) return 'bg-yellow-500/10 border-yellow-500/30';
  return 'bg-green-500/10 border-green-500/30';
}

export function isVitalCritical(key: string, value: number): boolean {
  const range = VITAL_RANGES[key];
  if (!range) return false;
  return value < range.critLow || value > range.critHigh;
}

/** Hex color for gauge arcs: green=normal, yellow=warning, red=critical */
export function getVitalArcColor(key: string, value: number): string {
  const range = VITAL_RANGES[key];
  if (!range) return '#9ca3af';
  if (value < range.critLow || value > range.critHigh) return '#ef4444';
  if (value < range.low || value > range.high) return '#eab308';
  return '#22c55e';
}

/** SVG mini-gauge for vital signs (~60px) */
export function VitalGauge({
  value,
  vitalKey,
  label,
  unit,
}: {
  value: number;
  vitalKey: string;
  label: string;
  unit: string;
}) {
  const range = VITAL_RANGES[vitalKey];
  if (!range) return null;
  const fullMin = range.critLow - (range.high - range.low) * 0.2;
  const fullMax = range.critHigh + (range.high - range.low) * 0.2;
  const pct = Math.min(1, Math.max(0, (value - fullMin) / (fullMax - fullMin)));
  const color = getVitalArcColor(vitalKey, value);
  const critical = isVitalCritical(vitalKey, value);
  const r = 24;
  const cx = 30;
  const cy = 30;
  const startAngle = -225;
  const endAngle = 45;
  const totalArc = endAngle - startAngle; // 270 degrees
  const circumference = 2 * Math.PI * r;
  const arcLength = (totalArc / 360) * circumference;
  const filledLength = arcLength * pct;
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative"
        style={critical ? { animation: 'pulse-critical 2s ease-in-out infinite' } : undefined}
      >
        <svg width="60" height="60" viewBox="0 0 60 60">
          {/* Background arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#374151"
            strokeWidth="5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${startAngle + 90}, ${cx}, ${cy})`}
          />
          {/* Filled arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${filledLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${startAngle + 90}, ${cx}, ${cy})`}
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
          {/* Center value */}
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={color}
            fontSize="13"
            fontWeight="bold"
            className="tabular-nums"
          >
            {value}
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#9ca3af"
            fontSize="7"
          >
            {unit}
          </text>
        </svg>
      </div>
      <span className="text-[10px] text-gray-400 mt-0.5">{label}</span>
    </div>
  );
}

/** Enhanced status badge with distinct background tints */
export function StatusBadge({ status }: { status: Status }) {
  const baseColor = STATUS_COLORS[status] || 'gray-400';
  const config: Record<Status, { bg: string; text: string; border: string; label: string }> = {
    active: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Active',
    },
    scheduled: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Scheduled',
    },
    completed: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Completed',
    },
    cancelled: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Cancelled',
    },
    archived: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Archived',
    },
  };
  const c = config[status] || config.archived;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        c.bg,
        c.text,
        c.border
      )}
    >
      {status === 'active' && (
        <span className={`w-1.5 h-1.5 rounded-full bg-${baseColor} animate-pulse`} />
      )}
      {c.label}
    </span>
  );
}

export function calculateBMI(
  weightLbs: number,
  heightIn: number
): { value: number; category: string; color: string } {
  if (!weightLbs || !heightIn) return { value: 0, category: 'N/A', color: 'text-gray-400' };
  const bmi = (weightLbs / (heightIn * heightIn)) * 703;
  if (bmi < 18.5)
    return { value: Math.round(bmi * 10) / 10, category: 'Underweight', color: 'text-yellow-400' };
  if (bmi < 25)
    return { value: Math.round(bmi * 10) / 10, category: 'Normal', color: 'text-green-400' };
  if (bmi < 30)
    return { value: Math.round(bmi * 10) / 10, category: 'Overweight', color: 'text-yellow-400' };
  return { value: Math.round(bmi * 10) / 10, category: 'Obese', color: 'text-red-400' };
}

export function calculateDaysRemaining(endDate?: string): number {
  if (!endDate) return -1;
  const end = new Date(endDate);
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function calculateVisitDuration(start?: string, end?: string): string {
  if (!start || !end) return '--';
  const s = new Date(start);
  const e = new Date(end);
  const mins = Math.round((e.getTime() - s.getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function isOutOfRange(value: string, refRange: string): boolean {
  if (!value || !refRange) return false;
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  const match = refRange.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (!match) return false;
  const lo = parseFloat(match[1]);
  const hi = parseFloat(match[2]);
  return num < lo || num > hi;
}

export function getTrend(current?: string, previous?: string): 'up' | 'down' | 'stable' | 'none' {
  if (!current || !previous) return 'none';
  const c = parseFloat(current);
  const p = parseFloat(previous);
  if (isNaN(c) || isNaN(p)) return 'none';
  const diff = ((c - p) / p) * 100;
  if (Math.abs(diff) < 2) return 'stable';
  return diff > 0 ? 'up' : 'down';
}

