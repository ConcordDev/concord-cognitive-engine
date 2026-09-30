'use client';

import type { ReactNode } from 'react';
import {
  Heart,
  Activity,
  Shield,
  Brain,
  Zap,
  Battery,
  Users,
} from 'lucide-react';

export type AffectDim = {
  key: string;
  label: string;
  icon: ReactNode;
  color: string;
  bgColor: string;
  description: string;
};

export const DIMS: AffectDim[] = [
  { key: 'v', label: 'Valence', icon: <Heart className="w-4 h-4" />, color: 'text-pink-400', bgColor: 'bg-pink-400', description: 'Positive vs negative emotional tone' },
  { key: 'a', label: 'Arousal', icon: <Activity className="w-4 h-4" />, color: 'text-orange-400', bgColor: 'bg-orange-400', description: 'Level of activation and energy' },
  { key: 's', label: 'Stability', icon: <Shield className="w-4 h-4" />, color: 'text-green-400', bgColor: 'bg-green-400', description: 'Emotional steadiness over time' },
  { key: 'c', label: 'Coherence', icon: <Brain className="w-4 h-4" />, color: 'text-blue-400', bgColor: 'bg-blue-400', description: 'Internal consistency of emotional state' },
  { key: 'g', label: 'Agency', icon: <Zap className="w-4 h-4" />, color: 'text-purple-400', bgColor: 'bg-purple-400', description: 'Sense of control and self-efficacy' },
  { key: 't', label: 'Trust', icon: <Users className="w-4 h-4" />, color: 'text-cyan-400', bgColor: 'bg-cyan-400', description: 'Confidence in the interaction environment' },
  { key: 'f', label: 'Fatigue', icon: <Battery className="w-4 h-4" />, color: 'text-yellow-400', bgColor: 'bg-yellow-400', description: 'Cognitive and emotional exhaustion level' },
];

export const EVENT_TYPES = [
  'USER_MESSAGE',
  'SYSTEM_RESULT',
  'ERROR',
  'SUCCESS',
  'TIMEOUT',
  'CONFLICT',
  'SAFETY_BLOCK',
  'GOAL_PROGRESS',
  'TOOL_RESULT',
  'FEEDBACK',
  'SESSION_START',
  'SESSION_END',
  'CUSTOM',
];

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function dimColor(value: number): string {
  if (value >= 0.65) return 'text-green-400';
  if (value >= 0.35) return 'text-yellow-400';
  return 'text-red-400';
}

export function dimBgColor(value: number): string {
  if (value >= 0.65) return 'bg-green-500';
  if (value >= 0.35) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function formatTimeShort(ts: unknown): string {
  if (!ts) return '';
  try {
    const d = new Date(String(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

export function eventTypeColor(type: string): string {
  const t = type.toUpperCase();
  if (t === 'ERROR' || t === 'SAFETY_BLOCK') return 'bg-red-500/20 text-red-400';
  if (t === 'SUCCESS' || t === 'GOAL_PROGRESS') return 'bg-green-500/20 text-green-400';
  if (t === 'TIMEOUT' || t === 'CONFLICT') return 'bg-yellow-500/20 text-yellow-400';
  if (t === 'FEEDBACK') return 'bg-purple-500/20 text-purple-400';
  if (t === 'SESSION_START' || t === 'SESSION_END') return 'bg-blue-500/20 text-blue-400';
  return 'bg-gray-500/20 text-gray-400';
}

export function radarPoints(values: { value: number }[], radius: number): string {
  const n = values.length;
  return values
    .map((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = v.value * radius;
      const x = 100 + r * Math.cos(angle);
      const y = 100 + r * Math.sin(angle);
      return `${x},${y}`;
    })
    .join(' ');
}

export function radarLabelPos(index: number, total: number, radius: number) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const x = 100 + (radius + 14) * Math.cos(angle);
  const y = 100 + (radius + 14) * Math.sin(angle);
  return { x, y };
}
