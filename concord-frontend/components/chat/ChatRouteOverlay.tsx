'use client';

/**
 * ChatRouteOverlay — Shows lens attribution and action type for routed messages.
 *
 * Renders a compact bar above a chat message showing:
 *   - Action type badge (QUERY, CREATE, ANALYZE, etc.)
 *   - Contributing lenses ("Drawing from: Agriculture, Insurance, Legal")
 *   - Routing confidence
 *   - Confirmation prompt for write actions
 */

import {
  Search,
  BarChart3,
  Pencil,
  Beaker,
  ShoppingCart,
  Link2,
  GraduationCap,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────

interface RouteLens {
  lensId: string;
  score: number;
}

interface RouteMeta {
  actionType: string;
  lenses: RouteLens[];
  primaryLens: string | null;
  isMultiLens: boolean;
  confidence: number;
  attribution: string[];
  message: string | null;
}

interface ChatRouteOverlayProps {
  route: RouteMeta;
  requiresConfirmation?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

// ── Action Type Config ───────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: typeof Search; label: string; color: string }> = {
  QUERY:    { icon: Search,        label: 'Query',    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  ANALYZE:  { icon: BarChart3,     label: 'Analyze',  color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  CREATE:   { icon: Pencil,        label: 'Create',   color: 'text-green-400 bg-green-500/10 border-green-500/20' },
  SIMULATE: { icon: Beaker,        label: 'Simulate', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  TRADE:    { icon: ShoppingCart,   label: 'Trade',    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  CONNECT:  { icon: Link2,         label: 'Connect',  color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
  TEACH:    { icon: GraduationCap, label: 'Teach',    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  MANAGE:   { icon: Settings,      label: 'Manage',   color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' },
};

// ── Component ────────────────────────────────────────────────────

export default function ChatRouteOverlay({
  route,
  requiresConfirmation,
  onConfirm,
  onCancel,
}: ChatRouteOverlayProps) {
  if (!route || !route.actionType) return null;

  const config = ACTION_CONFIG[route.actionType] || ACTION_CONFIG.QUERY;
  const Icon = config.icon;

  // Don't show overlay for simple single-lens queries below confidence threshold
  if (!route.isMultiLens && route.confidence < 0.3 && route.actionType === 'QUERY') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md bg-zinc-900/40 border border-zinc-800/30 mb-1">
      {/* Action type badge */}
      <span className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded border', config.color)}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>

      {/* Lens attribution */}
      {route.attribution && route.attribution.length > 0 && (
        <>
          <ChevronRight className="w-3 h-3 text-zinc-600" />
          <span className="text-zinc-400">
            {route.isMultiLens ? 'Drawing from: ' : ''}
            {route.attribution.slice(0, 5).map((lens, i) => (
              <span key={lens}>
                {i > 0 && <span className="text-zinc-600">{' + '}</span>}
                <span className="text-zinc-300 capitalize">{lens}</span>
              </span>
            ))}
          </span>
        </>
      )}

      {/* Confidence */}
      {route.confidence >= 0.5 && (
        <span className="ml-auto text-zinc-600 tabular-nums">
          {Math.round(route.confidence * 100)}%
        </span>
      )}

      {/* Confirmation for write actions */}
      {requiresConfirmation && (
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={onConfirm}
            className="px-2 py-0.5 rounded text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20"
          >
            Proceed
          </button>
          <button
            onClick={onCancel}
            className="px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
