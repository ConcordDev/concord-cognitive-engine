'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function pct(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : fallback;
  return clamp(n, 0, 1) * 100;
}

export function severityColor(severity: unknown): string {
  const s = typeof severity === 'string' ? severity.toLowerCase() : String(severity ?? '').toLowerCase();
  if (s === 'high' || s === 'critical') return 'border-l-red-500 bg-red-500/5';
  if (s === 'medium' || s === 'moderate') return 'border-l-yellow-500 bg-yellow-500/5';
  return 'border-l-blue-500 bg-blue-500/5';
}

export function severityBadge(severity: unknown): { label: string; cls: string } {
  const s = typeof severity === 'string' ? severity.toLowerCase() : String(severity ?? '').toLowerCase();
  if (s === 'high' || s === 'critical') return { label: String(severity), cls: 'bg-red-500/20 text-red-400' };
  if (s === 'medium' || s === 'moderate') return { label: String(severity), cls: 'bg-yellow-500/20 text-yellow-400' };
  return { label: String(severity || 'low'), cls: 'bg-blue-500/20 text-blue-400' };
}

export function trendIcon(trend: unknown) {
  const t = typeof trend === 'string' ? trend.toLowerCase() : '';
  if (t === 'improving' || t === 'up') return <TrendingUp className="w-4 h-4 text-green-400" />;
  if (t === 'declining' || t === 'down') return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return '';
  try {
    const d = new Date(String(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}
