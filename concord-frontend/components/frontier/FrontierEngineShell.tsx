'use client';

/**
 * FrontierEngineShell — shared chrome for the Frontier destination.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, commit to
 * it): the JUPYTER / JUPYTERLAB NOTEBOOK interaction language. A frontier
 * engine session reads as a notebook with exactly three numbered cells,
 * always in this order and always all three present:
 *
 *   [1] COMPUTE  — an input cell. A real structured form (never a raw JSON
 *       textarea), an explicit "run" affordance (▶, mirroring notebook
 *       Shift+Enter), and honest loading/error/empty states.
 *   [2] VERIFY   — an output cell. Rendered ONLY from fields the real
 *       macro response actually returned — this cell is never populated
 *       until a real response lands, and never fabricates what a
 *       computation was "checked against."
 *   [3] BOUNDARY — a pinned markdown-note cell, always visible even before
 *       any run, quoting the engine's own honest-boundary text verbatim
 *       from `lib/frontier-engines.ts` (which cites the exact backend
 *       source). This is not a footnote appended after results — it has
 *       the same visual weight as the other two cells, on every screen.
 *
 * Visual language borrowed from Jupyter: a monospace `In [n]:` / `Out[n]:`
 * gutter, a thin colored left rail per cell kind, and generous vertical
 * rhythm between cells rather than boxed-in card chrome. Grayscale-first —
 * the left rail is the only color signal; everything else is neutral
 * surface + type-scale hierarchy (ds.typeScale / ds.spacing).
 *
 * The engine tab strip at the top reuses the same interaction language as
 * `components/common/DestinationNav.tsx` (a horizontal, keyboard-reachable
 * tab bar) but switches PANELS in place via local state rather than
 * routing between ten separate lens pages — these ten engines share one
 * destination, not ten routes.
 */

import { useRef, type ReactNode } from 'react';
// AlertCircle, not CircleAlert — this repo's installed lucide-react
// (0.309.0) does not export `CircleAlert` (added in a later lucide-react
// release); using the wrong name renders `undefined` as a JSX component
// and crashes the whole VerifyCell subtree the instant status is
// 'refused' or 'error'. Verified directly against
// node_modules/lucide-react's own exports before fixing.
import { Play, Loader2, AlertCircle } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

// ─────────────────────────────────────────────────────────────────────────
// runFrontierMacro — a deliberately narrower call helper than the shared
// `lensRun()` (lib/api/client.ts) for engines whose own DOMAIN PAYLOAD
// legitimately carries its own `ok` field with DIFFERENT semantics than
// the transport envelope's `ok`. Verified against the live engine
// (`materials.durabilityCheck`, run directly against
// `server/lib/asset-gen/durability-gate.js#checkDurabilityGate`): a
// structural check that genuinely completes and finds the structure
// fails at the final sampled year returns `{ ok:false, samples:[...],
// baseline:{...}, firstFailureYear:0, ... }` — no `reason`/`error` field,
// because it isn't a refusal, it's a real computed answer. `lensRun()`'s
// generic unwrap treats ANY object with `ok:false` as a terminal error
// envelope and collapses it to `{ ok:false, error:'lens error' }`,
// silently discarding the real samples/baseline data — confirmed by
// tracing its unwrap loop against this exact response shape. This helper
// unwraps exactly the ONE envelope layer `/api/lens/run` sends over HTTP
// (the route always replies `{ ok:true, result:<payload> }`, since the
// server's own `_unwrapLensEnvelope` already flattened the handler's
// internal `{ok,result}` wrap before the response left the server) and
// distinguishes a genuine refusal — an object with both `ok:false` AND a
// string `error` field, the shape every `registerLensAction` refusal in
// this codebase uses — from a payload that merely happens to carry its
// own unrelated `ok` field.
// ─────────────────────────────────────────────────────────────────────────

export interface FrontierMacroResult<T> {
  /** Transport-level outcome: true whenever a real payload came back,
   *  even when that payload's OWN `ok` field (if it has one) is false. */
  ok: boolean;
  /** The domain payload verbatim when `ok` is true. May carry its own
   *  `ok` field with domain-specific meaning — read it explicitly, it is
   *  not the same thing as this envelope's `ok`. */
  result: T | null;
  /** The honest refusal/error reason string when `ok` is false. */
  error: string | null;
  /** The full refusal object when `ok` is false, so a caller can read
   *  extra honest fields a refusal carries (memberIds, Re, regime,
   *  residualHistory, mechanism, ...) that a plain error string drops. */
  refusal: Record<string, unknown> | null;
}

function isRefusalEnvelope(payload: unknown): payload is { ok: false; error: string; [k: string]: unknown } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    (payload as { ok?: unknown }).ok === false &&
    typeof (payload as { error?: unknown }).error === 'string'
  );
}

export async function runFrontierMacro<T = unknown>(
  domain: string,
  name: string,
  input: Record<string, unknown>,
): Promise<FrontierMacroResult<T>> {
  try {
    const res = await api.post('/api/lens/run', { domain, action: name, input });
    const payload: unknown = res?.data?.result;
    if (isRefusalEnvelope(payload)) {
      return { ok: false, result: null, error: payload.error, refusal: payload };
    }
    if (res?.data?.ok === false) {
      return { ok: false, result: null, error: String(res?.data?.error || 'request failed'), refusal: null };
    }
    return { ok: true, result: (payload ?? null) as T, error: null, refusal: null };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : String(e), refusal: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tab strip
// ─────────────────────────────────────────────────────────────────────────

export function FrontierEngineTabs({
  engines,
  activeId,
  onSelect,
}: {
  engines: FrontierEngineDef[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      className="flex gap-1 border-b border-lattice-border px-4 overflow-x-auto no-scrollbar"
      aria-label="Frontier engine workspace navigation"
    >
      {engines.map((engine) => {
        const Icon = engine.icon;
        const isActive = engine.id === activeId;
        return (
          <button
            key={engine.id}
            type="button"
            onClick={() => onSelect(engine.id)}
            aria-current={isActive ? 'page' : undefined}
            title={engine.name}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
              isActive
                ? 'text-neon-cyan border-neon-cyan'
                : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600',
            )}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {engine.shortName}
            {!engine.built && (
              <span
                className="ml-1 h-1.5 w-1.5 rounded-full bg-slate-500"
                aria-label="not built yet"
                title="Panel not built yet"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Generic notebook cell frame
// ─────────────────────────────────────────────────────────────────────────

type CellKind = 'compute' | 'verify' | 'boundary';

const RAIL_COLOR: Record<CellKind, string> = {
  compute: 'border-l-neon-blue',
  verify: 'border-l-emerald-500',
  boundary: 'border-l-amber-500',
};

const PROMPT_LABEL: Record<CellKind, string> = {
  compute: 'In',
  verify: 'Out',
  boundary: 'Note',
};

function NotebookCell({
  kind,
  cellNumber,
  title,
  headerRight,
  children,
}: {
  kind: CellKind;
  cellNumber: number | string;
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={cn('border-l-2 pl-4 py-3', RAIL_COLOR[kind])}
      aria-label={title}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <span className={cn(ds.monoXs, 'text-gray-500 select-none')}>
            {PROMPT_LABEL[kind]} [{cellNumber}]:
          </span>
          <h3 className={cn(ds.heading3, 'text-sm')}>{title}</h3>
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Compute cell — the structured-form + run affordance
// ─────────────────────────────────────────────────────────────────────────

export interface ComputeCellProps {
  cellNumber: number;
  /** e.g. "materials.durabilityCheck" — shown as provenance, not decoration. */
  macroLabel: string;
  running: boolean;
  onRun: () => void;
  runLabel?: string;
  runDisabled?: boolean;
  /** react-hotkeys-hook key string surfaced as a discoverable kbd chip. */
  hotkey?: string;
  children: ReactNode;
}

export function ComputeCell({
  cellNumber,
  macroLabel,
  running,
  onRun,
  runLabel = 'Run',
  runDisabled = false,
  hotkey,
  children,
}: ComputeCellProps) {
  return (
    <NotebookCell
      kind="compute"
      cellNumber={cellNumber}
      title="Compute"
      headerRight={<span className={cn(ds.monoXs, 'text-gray-500')}>{macroLabel}</span>}
    >
      <div className="space-y-4">{children}</div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onRun}
          disabled={running || runDisabled}
          className={cn(ds.btnPrimary, 'gap-2')}
        >
          {running ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4" aria-hidden="true" />
          )}
          {running ? 'Running…' : runLabel}
        </button>
        {hotkey && (
          <kbd
            className={cn(
              ds.monoXs,
              'px-1.5 py-0.5 rounded border border-lattice-border text-gray-500 bg-lattice-elevated',
            )}
          >
            {hotkey}
          </kbd>
        )}
      </div>
    </NotebookCell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Verify cell — real response fields only
// ─────────────────────────────────────────────────────────────────────────

export type VerifyStatus = 'idle' | 'loading' | 'ok' | 'refused' | 'error';

export interface VerifyCellProps {
  cellNumber: number | string;
  status: VerifyStatus;
  /** The honest reason a refusal/error came back — required whenever status is 'refused' | 'error'. */
  reason?: string | null;
  children?: ReactNode;
}

export function VerifyCell({ cellNumber, status, reason, children }: VerifyCellProps) {
  return (
    <NotebookCell kind="verify" cellNumber={cellNumber} title="Verify">
      {status === 'idle' && (
        <p className={cn(ds.textMuted)}>
          Run the compute cell above to see what the engine actually checked this
          result against — nothing is shown here until a real response lands.
        </p>
      )}
      {status === 'loading' && (
        <p className={cn(ds.textMuted, 'flex items-center gap-2')}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          Waiting on the engine…
        </p>
      )}
      {status === 'refused' && (
        <div className="flex items-start gap-2 text-amber-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Honest refusal — not a fabricated pass.</p>
            {reason && <p className={cn(ds.monoXs, 'text-amber-300/80 mt-1')}>{reason}</p>}
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-start gap-2 text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Request failed.</p>
            {reason && <p className={cn(ds.monoXs, 'text-red-300/80 mt-1')}>{reason}</p>}
          </div>
        </div>
      )}
      {status === 'ok' && children}
    </NotebookCell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Boundary cell — persistent, always visible, never conditional on a run
// ─────────────────────────────────────────────────────────────────────────

export function BoundaryCell({
  cellNumber,
  text,
  source,
}: {
  cellNumber: number | string;
  text: string;
  source: string;
}) {
  return (
    <NotebookCell kind="boundary" cellNumber={cellNumber} title="Honest boundary">
      <p className={cn(ds.textBody, 'text-sm leading-relaxed')}>{text}</p>
      <p className={cn(ds.monoXs, 'text-gray-500 mt-2')}>Source: {source}</p>
    </NotebookCell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level shell
// ─────────────────────────────────────────────────────────────────────────

export function FrontierEngineShell({
  engines,
  activeId,
  onSelect,
  children,
}: {
  engines: FrontierEngineDef[];
  activeId: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col h-full">
      <FrontierEngineTabs engines={engines} activeId={activeId} onSelect={onSelect} />
      <div ref={bodyRef} className={cn(ds.pageContainer, 'flex-1 overflow-y-auto space-y-8 max-w-4xl')}>
        {children}
      </div>
    </div>
  );
}
