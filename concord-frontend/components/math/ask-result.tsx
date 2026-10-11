'use client';

/**
 * Ask-result renderer for the math CAS natural-language panel.
 *
 * math.naturalQuery returns a different shape per `kind` (see
 * server/domains/math.js). A scalar `answer` is only one of them — solve
 * nests a root object, isprime/factorize omit `answer` entirely, convert
 * puts the unit on `to`. This module turns every successful payload into
 * readable text. It never emits "[object Object]", "undefined", "NaN", or
 * a bare em-dash placeholder; an unrecognized shape falls back to JSON.
 */

export interface AskResultView {
  primary: string;
  detail?: string;
  steps?: string[];
}

const EM_DASH = '\u2014';
const MINUS = '\u2212';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isPoison(text: string): boolean {
  const trimmed = text.trim();
  return (
    !trimmed
    || trimmed === EM_DASH
    || trimmed === 'undefined'
    || trimmed === 'NaN'
    || trimmed === '[object Object]'
    || text.includes('[object Object]')
    || /\bNaN\b/.test(text)
  );
}

function prettyJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return null;
      if (typeof v === 'bigint') return v.toString();
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }, 2);
    if (!text || isPoison(text)) return 'unreadable result';
    return text;
  } catch {
    return 'unreadable result';
  }
}

function prettyPayload(record: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'interpreted') continue;
    copy[key] = value;
  }
  return prettyJson(Object.keys(copy).length ? copy : record);
}

function guard(text: string, fallback: unknown): string {
  if (!isPoison(text)) return text;
  const json = prettyJson(fallback);
  return isPoison(json) ? 'unreadable result' : json;
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Object.is(value, -0)) return '0';
    return String(value);
  }
  if (typeof value === 'string') {
    if (isPoison(value)) return null;
    return value;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function formatComplex(real: number, imag: number): string {
  if (imag === 0) return scalarText(real) ?? '0';
  const absImag = Math.abs(imag);
  const imagBody = absImag === 1 ? 'i' : `${scalarText(absImag) ?? String(absImag)}i`;
  if (real === 0) return imag < 0 ? `${MINUS}${imagBody}` : imagBody;
  const sign = imag < 0 ? MINUS : '+';
  return `${scalarText(real) ?? String(real)} ${sign} ${imagBody}`;
}

function formatRoot(root: unknown): string {
  const scalar = scalarText(root);
  if (scalar != null) return scalar;
  const record = asRecord(root);
  if (record) {
    const real = record.real ?? record.re;
    const imag = record.imag ?? record.im;
    if (typeof real === 'number' && typeof imag === 'number' && Number.isFinite(real) && Number.isFinite(imag)) {
      return formatComplex(real, imag);
    }
  }
  return prettyJson(root);
}

function readSteps(payload: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) return undefined;
  return payload.steps.map((step, index) => {
    const scalar = scalarText(step);
    if (scalar != null) return scalar;
    const json = prettyJson(step);
    return isPoison(json) ? `step ${index + 1} unreadable` : json;
  });
}

function formatSolve(result: Record<string, unknown>): AskResultView {
  const nested = asRecord(result.answer);
  const payload = nested ?? result;
  const steps = readSteps(payload) ?? readSteps(result);
  const failure = asRecord(result.detail);
  const failureText = failure ? scalarText(failure.error) : null;

  if (!nested && result.answer == null && result.kind === 'solve') {
    return { primary: guard(failureText || 'no solution returned', result), steps };
  }

  const variable = typeof payload.variable === 'string' && payload.variable.trim()
    ? payload.variable.trim()
    : 'x';
  const kind = typeof payload.kind === 'string' ? payload.kind : '';
  const rootKind = typeof payload.rootKind === 'string' ? payload.rootKind : '';
  const roots = payload.roots;

  if (roots === 'infinite' || kind === 'identity') {
    return { primary: 'infinitely many solutions', steps };
  }

  const noneKind = kind === 'no-solution' || rootKind === 'none' || rootKind === 'no-solution' || rootKind === 'no-real';
  if (noneKind || (Array.isArray(roots) && roots.length === 0 && kind !== 'numeric')) {
    return { primary: 'no solution', steps };
  }
  if (kind === 'numeric' && Array.isArray(roots) && roots.length === 0) {
    return { primary: 'no real root located', steps };
  }

  if (!Array.isArray(roots)) {
    return { primary: guard(failureText || prettyPayload(payload), result), steps };
  }

  if (rootKind === 'repeated') {
    return { primary: `${variable} = ${formatRoot(roots[0])} (repeated root)`, steps };
  }

  const equations = roots.map((root) => `${variable} = ${formatRoot(root)}`).join(', ');
  return { primary: guard(equations, result), steps };
}

function formatIsPrime(result: Record<string, unknown>): AskResultView {
  const n = scalarText(result.number);
  if (n != null && typeof result.isPrime === 'boolean') {
    return { primary: result.isPrime ? `${n} is prime` : `${n} is not prime` };
  }
  return { primary: prettyPayload(result) };
}

function exponentForm(factors: number[]): string {
  const order: number[] = [];
  const counts = new Map<number, number>();
  for (const factor of factors) {
    if (!counts.has(factor)) order.push(factor);
    counts.set(factor, (counts.get(factor) ?? 0) + 1);
  }
  if (order.length === 0) return '1';
  return order.map((factor) => {
    const exponent = counts.get(factor) ?? 1;
    return exponent > 1 ? `${factor}^${exponent}` : String(factor);
  }).join(' \u00d7 ');
}

function formatFactorize(result: Record<string, unknown>): AskResultView {
  const n = scalarText(result.number);
  const factors = result.primeFactors;
  if (
    n != null
    && Array.isArray(factors)
    && factors.every((factor) => typeof factor === 'number' && Number.isFinite(factor))
  ) {
    if (factors.length === 0) return { primary: `${n} has no prime factors` };
    return { primary: `${n} = ${exponentForm(factors as number[])}` };
  }
  return { primary: prettyPayload(result) };
}

function formatConvert(result: Record<string, unknown>): AskResultView {
  const value = scalarText(result.answer);
  const unit = typeof result.to === 'string' ? result.to.trim() : '';
  if (value != null && unit) return { primary: `${value} ${unit}` };
  if (value != null) return { primary: value };
  return { primary: prettyPayload(result) };
}

function formatDefinite(result: Record<string, unknown>): AskResultView {
  const value = scalarText(result.answer);
  const primary = value ?? prettyPayload(result);
  let detail: string | undefined;
  if (Array.isArray(result.bounds) && result.bounds.length >= 2) {
    const form = result.closedForm ? 'closed form' : 'numeric';
    const lo = scalarText(result.bounds[0]) ?? prettyJson(result.bounds[0]);
    const hi = scalarText(result.bounds[1]) ?? prettyJson(result.bounds[1]);
    detail = `bounds [${lo}, ${hi}] · ${form}`;
  }
  return { primary: guard(primary, result), detail };
}

function formatAntiderivative(result: Record<string, unknown>): AskResultView {
  const value = scalarText(result.answer);
  if (value != null) return { primary: value };
  return { primary: 'no closed form' };
}

function formatScalarAnswer(result: Record<string, unknown>): AskResultView {
  const value = scalarText(result.answer);
  if (value != null) return { primary: value };
  if (result.answer == null) return { primary: prettyPayload(result) };
  return { primary: prettyJson(result.answer) };
}

function looksLikeSolve(result: Record<string, unknown>): boolean {
  if (result.roots === undefined && result.rootKind == null) return false;
  const kind = result.kind;
  return kind === 'quadratic' || kind === 'linear' || kind === 'identity'
    || kind === 'no-solution' || kind === 'numeric' || typeof result.rootKind === 'string';
}

export function formatAskResult(result: unknown): AskResultView {
  const record = asRecord(result);
  if (!record) {
    const scalar = scalarText(result);
    return { primary: scalar ?? 'empty result' };
  }
  const kind = typeof record.kind === 'string' ? record.kind : '';

  if (kind === 'solve' || (kind !== 'definite-integral' && looksLikeSolve(record))) {
    const view = formatSolve(kind === 'solve' ? record : { kind: 'solve', answer: record });
    return { ...view, primary: guard(view.primary, result) };
  }

  switch (kind) {
    case 'isprime':
      return { primary: guard(formatIsPrime(record).primary, result) };
    case 'factorize':
      return { primary: guard(formatFactorize(record).primary, result) };
    case 'convert':
      return { primary: guard(formatConvert(record).primary, result) };
    case 'definite-integral':
      return formatDefinite(record);
    case 'antiderivative':
      return formatAntiderivative(record);
    case 'derivative':
    case 'simplify':
    case 'evaluate':
      return { primary: guard(formatScalarAnswer(record).primary, result) };
    default: {
      const scalar = scalarText(record.answer);
      if (scalar != null) return { primary: scalar };
      return { primary: guard(prettyPayload(record), result) };
    }
  }
}

export function AskResultCard({ result }: { result: unknown }) {
  const view = formatAskResult(result);
  const record = asRecord(result);
  const kind = record && typeof record.kind === 'string' && record.kind.trim()
    ? record.kind
    : 'result';

  return (
    <div data-testid="ask-result" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
        {kind}
      </div>
      <div className="font-mono text-lg text-emerald-200 break-all whitespace-pre-wrap">
        {view.primary}
      </div>
      {view.detail && (
        <div className="text-[10px] text-zinc-400">{view.detail}</div>
      )}
      {view.steps && view.steps.length > 0 && (
        <details data-testid="ask-steps" className="rounded border border-zinc-800 bg-black/30 px-2 py-1.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-zinc-400">
            Steps ({view.steps.length})
          </summary>
          <ol className="mt-1.5 space-y-1">
            {view.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[9px] font-bold text-indigo-300">
                  {index + 1}
                </span>
                <span className="font-mono text-zinc-300">{step}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
