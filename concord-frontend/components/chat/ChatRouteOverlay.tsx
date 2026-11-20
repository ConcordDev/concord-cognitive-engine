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
  QUERY:    { icon: Search,        label: 'Query',    color: 'text-[color:var(--nb-blue,#60a5fa)] bg-[var(--nb-blue-soft,rgba(59,130,246,0.1))] border-[color:var(--nb-blue,rgba(59,130,246,0.2))]' },
  ANALYZE:  { icon: BarChart3,     label: 'Analyze',  color: 'text-[color:var(--nb-blue,#22d3ee)] bg-[var(--nb-blue-soft,rgba(6,182,212,0.1))] border-[color:var(--nb-blue,rgba(6,182,212,0.2))]' },
  CREATE:   { icon: Pencil,        label: 'Create',   color: 'text-[color:var(--nb-green,#4ade80)] bg-[var(--nb-green-soft,rgba(34,197,94,0.1))] border-[color:var(--nb-green,rgba(34,197,94,0.2))]' },
  SIMULATE: { icon: Beaker,        label: 'Simulate', color: 'text-[color:var(--nb-red,#c084fc)] bg-[var(--nb-red-soft,rgba(168,85,247,0.1))] border-[color:var(--nb-red,rgba(168,85,247,0.2))]' },
  TRADE:    { icon: ShoppingCart,   label: 'Trade',    color: 'text-[color:var(--nb-ochre,#fbbf24)] bg-[var(--nb-hl,rgba(245,158,11,0.1))] border-[color:var(--nb-ochre,rgba(245,158,11,0.2))]' },
  CONNECT:  { icon: Link2,         label: 'Connect',  color: 'text-[color:var(--nb-red,#f472b6)] bg-[var(--nb-red-soft,rgba(236,72,153,0.1))] border-[color:var(--nb-red,rgba(236,72,153,0.2))]' },
  TEACH:    { icon: GraduationCap, label: 'Teach',    color: 'text-[color:var(--nb-green,#34d399)] bg-[var(--nb-green-soft,rgba(16,185,129,0.1))] border-[color:var(--nb-green,rgba(16,185,129,0.2))]' },
  MANAGE:   { icon: Settings,      label: 'Manage',   color: 'text-[color:var(--nb-muted,#a1a1aa)] bg-[var(--nb-wash-2,rgba(113,113,122,0.1))] border-[color:var(--nb-rule-2,rgba(113,113,122,0.2))]' },
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
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md bg-[var(--nb-sheet,rgba(24,24,27,0.4))] border border-[color:var(--nb-rule,rgba(39,39,42,0.3))] mb-1">
      {/* Action type badge */}
      <span className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded border', config.color)}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>

      {/* Lens attribution */}
      {route.attribution && route.attribution.length > 0 && (
        <>
          <ChevronRight className="w-3 h-3 text-[color:var(--nb-faint,#52525b)]" />
          <span className="text-[color:var(--nb-muted,#a1a1aa)]">
            {route.isMultiLens ? 'Drawing from: ' : ''}
            {route.attribution.slice(0, 5).map((lens, i) => (
              <span key={lens}>
                {i > 0 && <span className="text-[color:var(--nb-faint,#52525b)]">{' + '}</span>}
                <span className="text-[color:var(--nb-ink-2,#d4d4d8)] capitalize">{lens}</span>
              </span>
            ))}
          </span>
        </>
      )}

      {/* Confidence */}
      {route.confidence >= 0.5 && (
        <span className="ml-auto text-[color:var(--nb-faint,#52525b)] tabular-nums">
          {Math.round(route.confidence * 100)}%
        </span>
      )}

      {/* Confirmation for write actions */}
      {requiresConfirmation && (
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={onConfirm}
            className="px-2 py-0.5 rounded text-[color:var(--nb-green,#4ade80)] bg-[var(--nb-green-soft,rgba(34,197,94,0.1))] hover:bg-[var(--nb-green-soft,rgba(34,197,94,0.2))] border border-[color:var(--nb-green,rgba(34,197,94,0.2))]"
          >
            Proceed
          </button>
          <button
            onClick={onCancel}
            className="px-2 py-0.5 rounded text-[color:var(--nb-muted,#a1a1aa)] hover:text-[color:var(--nb-ink-2,#d4d4d8)] hover:bg-[var(--nb-wash,#27272a)]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
