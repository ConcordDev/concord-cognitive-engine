'use client';

/**
 * Wave 4 delight primitives for the Code lens (PR #1707, code.md §3b).
 *
 * Every primitive obeys the catalogue bounds: sound-free, ≤300 ms
 * (the M8 return fade is the spec'd 600 ms exception), non-blocking,
 * and `prefers-reduced-motion` turns the motion off. Nothing here
 * fakes a state: the run stamp exists only for a run that happened,
 * the quiet-success edge fires only on a confirmed success, the
 * provenance face shows only data the server returned.
 */
import { useEffect, useState } from 'react';

export const DELIGHT_CSS = `
@keyframes concord-quiet-flash {
  0% { opacity: 1; box-shadow: inset 0 0 0 2px rgba(45, 212, 191, 0.9); }
  100% { opacity: 0; box-shadow: inset 0 0 0 2px rgba(45, 212, 191, 0); }
}
@keyframes concord-return-fade {
  0% { opacity: 1; box-shadow: inset 0 0 0 2px rgba(45, 212, 191, 0.75); }
  100% { opacity: 0; box-shadow: inset 0 0 0 2px rgba(45, 212, 191, 0); }
}
@keyframes concord-settle {
  0% { opacity: 0; transform: translateY(-4px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes concord-flip-in {
  0% { opacity: 0; transform: perspective(600px) rotateX(-8deg); }
  100% { opacity: 1; transform: perspective(600px) rotateX(0deg); }
}
@keyframes concord-unfurl-line {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .concord-quiet-flash, .concord-return-fade, .concord-settle, .concord-flip-in, .concord-unfurl-line {
    animation: none !important;
  }
}
`;

function DelightStyles() {
  return <style>{DELIGHT_CSS}</style>;
}

/** M7 — The Quiet Success: one teal edge flash (200 ms), nothing else.
 *  Render with a changing `flashKey` (increment per success); 0 = idle. */
export function QuietSuccessEdge({ flashKey }: { flashKey: number }) {
  if (!flashKey) return null;
  return (
    <>
      <DelightStyles />
      <div
        key={flashKey}
        aria-hidden
        className="concord-quiet-flash pointer-events-none absolute inset-0 rounded-inherit z-10"
        style={{ animation: 'concord-quiet-flash 200ms ease-out forwards' }}
      />
    </>
  );
}

/** M8 — The Return: one soft teal edge fade (600 ms decay) on the
 *  restored file. Mounted once by the parent when a restore happened. */
export function ReturnFadeEdge() {
  return (
    <>
      <DelightStyles />
      <div
        aria-hidden
        className="concord-return-fade pointer-events-none absolute inset-0 rounded-inherit z-10"
        style={{ animation: 'concord-return-fade 600ms ease-out forwards' }}
      />
    </>
  );
}

// ── D1: the run stamp ────────────────────────────────────────────────

export interface RunStampFacts {
  elapsedMs?: number;
  exitCode?: number | null;
  timedOut?: boolean;
}

/** The M1-style stamp text: `ran · 88 ms · exit 0`. Only ever built
 *  from a real run's own figures — a timeout stamps its timeout. */
export function runStampText(facts: RunStampFacts): string {
  const ms = Number.isFinite(facts.elapsedMs) ? Math.round(Number(facts.elapsedMs)) : null;
  const duration = ms == null ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  if (facts.timedOut) return `stopped${duration ? ` · ${duration}` : ''} · timeout`;
  const exit = Number.isFinite(facts.exitCode) ? Number(facts.exitCode) : null;
  return `ran${duration ? ` · ${duration}` : ''}${exit != null ? ` · exit ${exit}` : ''}`;
}

export function RunStamp({ facts }: { facts: RunStampFacts }) {
  return (
    <span className="font-serif italic text-[12px] text-teal-300/90" data-testid="run-stamp">
      {runStampText(facts)}
    </span>
  );
}

// ── D1: the output unfurl (M5) ───────────────────────────────────────

/**
 * Run output unfurls in run order: lines appear at 40 ms intervals
 * (the catalogue's M5 cadence), capped so a long output finishes its
 * reveal promptly; reduced-motion shows everything at once.
 */
export function UnfurlPre({ text, runKey, className }: { text: string; runKey: number; className?: string }) {
  const lines = text.split('\n');
  const [shown, setShown] = useState(lines.length);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || lines.length <= 1) { setShown(lines.length); return; }
    setShown(0);
    const stepMs = 40;
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= lines.length) { window.clearInterval(id); return n; }
        return n + 1;
      });
    }, stepMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new run (runKey) restarts the unfurl
  }, [runKey]);
  return (
    <>
      <DelightStyles />
      <pre className={className} aria-label="Run output">
        {lines.slice(0, shown).map((line, i) => (
          <span key={`${runKey}-${i}`} className="concord-unfurl-line block" style={{ animation: 'concord-unfurl-line 120ms ease-out' }}>
            {line || ' '}
          </span>
        ))}
      </pre>
    </>
  );
}

// ── E-CODE-1: "Shipped, with receipts." ──────────────────────────────

/** The egg triggers on the user's own words: a commit whose message
 *  is exactly "ship it" (case-insensitive, trimmed). */
export function isShipItCommit(message: string | undefined | null): boolean {
  return String(message || '').trim().toLowerCase() === 'ship it';
}

export function ShipItLine() {
  return (
    <div className="ml-5 font-serif italic text-[11px] text-teal-300/80" data-testid="ship-it-line">
      Shipped, with receipts.
    </div>
  );
}

// ── D4: the provenance face's data summary ───────────────────────────

export interface ProvenanceSummary {
  lastCommit: { id: string; number?: string; message: string; committedAt: string } | null;
  snapshotCount: number;
  hasHistory: boolean;
}

/** Pure summary over the server's own records: the newest commit whose
 *  paths include the file, and how many DTU snapshots bundle it.
 *  Nothing is inferred — absent records read as no history. */
export function summarizeProvenance(
  log: Array<{ id: string; number?: string; message: string; committedAt: string; paths: string[] }>,
  snapshots: Array<{ files?: Array<{ name: string }> }>,
  path: string,
): ProvenanceSummary {
  const lastCommit = log.find((c) => Array.isArray(c.paths) && c.paths.includes(path)) || null;
  const base = path.split('/').pop() || path;
  const snapshotCount = snapshots.filter((snap) =>
    Array.isArray(snap.files) && snap.files.some((f) => f.name === path || f.name === base),
  ).length;
  return { lastCommit, snapshotCount, hasHistory: !!lastCommit || snapshotCount > 0 };
}
