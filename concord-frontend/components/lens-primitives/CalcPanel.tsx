'use client';

/**
 * CalcPanel — generic two-macro analyze + render + Save-as-DTU shell.
 *
 * Empirically derived from 8 lens panels that landed in PRs #729–#736
 * (calendar, environment, history, materials, ocean, security,
 * services, automotive, energy). All share the same shape:
 *
 *   • Two input regions (form fields or editable table rows)
 *   • Single Analyze button calling two domain macros in parallel
 *   • Two-column result cards
 *   • Save-as-DTU button packing inputs + outputs
 *
 * CalcPanel owns: the mutation, the Promise.all, the Analyze button,
 * the header, the error display, the Save-as-DTU integration. The
 * consumer supplies: two `MacroSlot` configs (input renderer +
 * artifact builder) + a `renderResults` render-prop + DTU composition.
 *
 * Pattern matches `apiHelpers.lens.runDomain(domain, action, { input })`
 * which is the universal macro caller per `concord-frontend/lib/api/client.ts`.
 */

import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Wand2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

export interface MacroSlot {
  /** Macro action name on the lens domain (e.g. "feedingPlan", "vaccinationSchedule") */
  macro: string;
  /**
   * Build the artifact body sent to the macro. Receives nothing — caller closes over its own input state.
   * Return shape: `{ data: <whatever your macro expects under artifact.data> }`.
   * CalcPanel wraps this in `{ input: { artifact } }` before sending.
   */
  buildArtifact: () => Record<string, unknown>;
}

export interface CalcPanelDtu<L, R> {
  apiSource: string;
  title: (left: L, right: R) => string;
  content: (left: L, right: R) => string;
  tags: (left: L, right: R) => string[];
  rawData?: (left: L, right: R) => Record<string, unknown>;
}

export interface CalcPanelProps<LR, RR> {
  /** Panel title, e.g. "Pet care planner" */
  title: string;
  /** Domain name, e.g. "pets" */
  domain: string;
  /** Header icon (already coloured by caller) */
  icon: ReactNode;
  /** Inline macro reference, e.g. "pets.feedingPlan + vaccinationSchedule" */
  macroBadge: string;
  /** Tailwind ring/border accent for the Analyze button, e.g. "rose" */
  accent?: 'rose' | 'emerald' | 'cyan' | 'amber' | 'sky' | 'blue' | 'violet' | 'indigo' | 'orange' | 'yellow' | 'red';

  /** Left input region: render + macro configuration */
  left: MacroSlot & { render: ReactNode };
  /** Right input region: render + macro configuration */
  right: MacroSlot & { render: ReactNode };

  /**
   * Render the two result cards. `errors` is set when that side's macro
   * returned `{ ok: false }` (or the request failed). A null result with
   * an error is a refusal, not "not yet analyzed".
   */
  renderResults: (left: LR | null, right: RR | null, errors?: { left: string | null; right: string | null }) => ReactNode;

  /** Save-as-DTU composition. Only invoked when both results are non-null. */
  dtu: CalcPanelDtu<LR, RR>;

  /** Analyze button label. Default: "Analyze" */
  buttonLabel?: string;
  /** Error message. Default: "Analysis failed." */
  errorLabel?: string;
  /** Allow disabling Analyze button (e.g. minimum row count not yet reached). */
  disabled?: boolean;
  /** Disabled reason tooltip. */
  disabledHint?: string;
}

interface MacroSide<T> {
  result: T | null;
  error: string | null;
}

/** Human text from an `{ ok: false }` envelope. Prefer `message` (the
 *  sentence) over `error` (often a short code) when both are present. */
function macroFailureText(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const o = node as { ok?: unknown; error?: unknown; message?: unknown; reason?: unknown };
  if (o.ok !== false) return null;
  for (const v of [o.message, o.error, o.reason]) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return 'Analysis failed.';
}

async function callMacro<T>(
  domain: string,
  action: string,
  artifact: Record<string, unknown>,
): Promise<MacroSide<T>> {
  try {
    const r = await apiHelpers.lens.runDomain(domain, action, { input: { artifact } });
    const env = (r as { data?: unknown }).data;
    const topFail = macroFailureText(env);
    if (topFail) return { result: null, error: topFail };
    if (!env || typeof env !== 'object') return { result: null, error: 'Analysis failed.' };
    const body = env as { ok?: boolean; result?: unknown };
    if (body.ok === false) return { result: null, error: 'Analysis failed.' };
    const nestedFail = macroFailureText(body.result);
    if (nestedFail) return { result: null, error: nestedFail };
    const result = body.result;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return { result: (result as { result: T }).result, error: null };
    }
    return { result: (result ?? null) as T | null, error: null };
  } catch (e) {
    const data = (e as { response?: { data?: unknown } })?.response?.data;
    const fromBody = macroFailureText(data);
    if (fromBody) return { result: null, error: fromBody };
    const msg = e instanceof Error && e.message ? e.message : 'Analysis failed.';
    return { result: null, error: msg };
  }
}

const ACCENT_RING: Record<NonNullable<CalcPanelProps<unknown, unknown>['accent']>, string> = {
  rose:    'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
  emerald: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
  cyan:    'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25',
  amber:   'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
  sky:     'border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25',
  blue:    'border-blue-500/40 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25',
  violet:  'border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25',
  indigo:  'border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
  orange:  'border-orange-500/40 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25',
  yellow:  'border-yellow-500/40 bg-yellow-500/15 text-yellow-200 hover:bg-yellow-500/25',
  red:     'border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25',
};

export function CalcPanel<LR, RR>({
  title,
  domain,
  icon,
  macroBadge,
  accent = 'cyan',
  left,
  right,
  renderResults,
  dtu,
  buttonLabel = 'Analyze',
  errorLabel = 'Analysis failed.',
  disabled = false,
  disabledHint,
}: CalcPanelProps<LR, RR>) {
  const [leftResult, setLeftResult] = useState<LR | null>(null);
  const [rightResult, setRightResult] = useState<RR | null>(null);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const [l, r] = await Promise.all([
        callMacro<LR>(domain, left.macro, left.buildArtifact()),
        callMacro<RR>(domain, right.macro, right.buildArtifact()),
      ]);
      setLeftResult(l.result);
      setRightResult(r.result);
      setLeftError(l.error);
      setRightError(r.error);
      return { l, r };
    },
  });

  const canSave = leftResult !== null && rightResult !== null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">{macroBadge}</span>
        </div>
        {canSave && (
          <SaveAsDtuButton
            compact
            apiSource={dtu.apiSource}
            title={dtu.title(leftResult as LR, rightResult as RR)}
            content={dtu.content(leftResult as LR, rightResult as RR)}
            extraTags={dtu.tags(leftResult as LR, rightResult as RR)}
            rawData={dtu.rawData ? dtu.rawData(leftResult as LR, rightResult as RR) : { left: leftResult, right: rightResult }}
          />
        )}
      </header>

      <div className="space-y-4">{left.render}</div>
      <div className="space-y-4">{right.render}</div>

      <button
        type="button"
        onClick={() => analyze.mutate()}
        disabled={analyze.isPending || disabled}
        title={disabled ? disabledHint : undefined}
        className={`inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs font-mono disabled:opacity-50 ${ACCENT_RING[accent]}`}
      >
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        {buttonLabel}
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{errorLabel}</div>}

      {(leftError || rightError) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            {leftError && (
              <div role="alert" className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{leftError}</div>
            )}
          </div>
          <div>
            {rightError && (
              <div role="alert" className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{rightError}</div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{renderResults(leftResult, rightResult, { left: leftError, right: rightError })}</div>
    </div>
  );
}
