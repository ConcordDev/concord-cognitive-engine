'use client';

// concord-frontend/components/conkay/panels/MacroLibraryPanel.tsx
//
// Unit F4 — the ConKay cockpit's Macro Library panel (K3). A self-contained,
// prop-free browser over the REAL macro manifest for the domain the user is
// currently working in, backed by the existing public-read
// `GET /api/lens-actions/:domain` route (server.js — the same route
// AutoActionStrip already uses to auto-discover compute actions).
//
// Response shape (read directly off the handler at server.js, do not trust
// a paraphrase):
//   { ok: true, domain, total, actions: Array<{
//       action: string, desc: string | null, brain: string | null,
//       isAi: boolean, isGenerative: boolean, isAnalysis: boolean,
//       isLive: boolean, isCompute: boolean,
//   }> }
//
// Honest-by-construction:
//   - We render ONLY entries the API actually returned — no aspirational or
//     hardcoded action list, ever.
//   - `isLive` is a real backend flag (`/^live_/.test(name)` — true only for
//     the small set of macros that hit a live/real-time external source).
//     Everything else (`isAi` brain-backed macros and plain `isCompute`
//     macros) is a genuinely-registered, callable backend macro — it is NOT
//     scaffold. To stay honest in BOTH directions we label those entries
//     "not yet live" (literally true — the manifest didn't tag them as a
//     live/real-time source) without implying they're broken or unwired;
//     the "Live" badge is reserved for entries the manifest actually flagged.
//   - A fetch failure renders a visible, worded error state — never a
//     silently-empty panel and never fabricated content.
//   - One-shot fetch on mount (+ re-fetch if the active domain changes).
//     No interval/timeout-driven polling and no fake-progress animation.
//
// Determining "current domain": the panel takes no props (per the
// panel-registry eligibility bar — self-contained, cross-mountable
// anywhere), so it reads `conkayHudStore.activeLabel`, the real
// `domain.action` label the socket adapter stamped from the most recent
// `macro:started` event (see conkayHudStore.ts). We split on the first "."
// to recover the domain half. Before any macro has run yet in the session,
// there is nothing in the store to key off — rather than rendering a picker
// (more surface than a K3 first cut needs) we fall back to `reason`, ConKay's
// own introspection domain (home of `reason.verify`, already load-bearing in
// this store per the K3 comment block above `lastVerify`). This is a
// documented default, not a claim about what the user is doing.

import { useEffect, useState } from 'react';
import { useConkayHudStore } from '../conkayHudStore';

interface MacroAction {
  action: string;
  desc: string | null;
  brain: string | null;
  isAi: boolean;
  isGenerative: boolean;
  isAnalysis: boolean;
  isLive: boolean;
  isCompute: boolean;
}

interface LensActionsResponse {
  ok: boolean;
  domain: string;
  total: number;
  actions: MacroAction[];
}

/** Fallback domain when no macro has run yet this session (see file header). */
const DEFAULT_DOMAIN = 'reason';

function domainFromActiveLabel(activeLabel: string | null): string {
  if (!activeLabel) return DEFAULT_DOMAIN;
  const dot = activeLabel.indexOf('.');
  const domain = dot === -1 ? activeLabel : activeLabel.slice(0, dot);
  return domain || DEFAULT_DOMAIN;
}

function prettyLabel(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function ActionRow({ a }: { a: MacroAction }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px]">
      <span className="min-w-0 flex-1 truncate text-cyan-100/80" title={a.desc || a.action}>
        {prettyLabel(a.action)}
      </span>
      {a.isLive ? (
        <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-emerald-300">
          live
        </span>
      ) : (
        <span
          className="shrink-0 rounded-full border border-zinc-500/30 bg-zinc-700/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-400"
          title="Registered macro — not flagged as a live/real-time source"
        >
          not yet live
        </span>
      )}
    </li>
  );
}

function ActionGroup({ title, actions }: { title: string; actions: MacroAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">{title}</div>
      <ul className="space-y-0.5">
        {actions.map((a) => (
          <ActionRow key={a.action} a={a} />
        ))}
      </ul>
    </div>
  );
}

export function MacroLibraryPanel() {
  const activeLabel = useConkayHudStore((s) => s.activeLabel);
  const domain = domainFromActiveLabel(activeLabel);

  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [data, setData] = useState<LensActionsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);

    (async () => {
      try {
        const res = await fetch(`/api/lens-actions/${encodeURIComponent(domain)}`);
        if (!res.ok) throw new Error(`http_${res.status}`);
        const body = (await res.json()) as LensActionsResponse;
        if (cancelled) return;
        if (!body?.ok) throw new Error('response_not_ok');
        setData(body);
        setStatus('ok');
      } catch (e) {
        if (cancelled) return;
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [domain]);

  if (status === 'loading') {
    return (
      <div className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-2">
        <div className="px-1 py-1 text-[11px] text-cyan-300/60">Loading macro library for {domain}…</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto mt-2 max-w-2xl rounded-xl border border-rose-400/20 bg-black/30 p-2">
        <div className="px-1 py-1 text-[11px] text-rose-300/80">
          Couldn&apos;t load macro library for {domain}{errorMessage ? ` (${errorMessage})` : ''}.
        </div>
      </div>
    );
  }

  const actions = data?.actions ?? [];
  if (actions.length === 0) {
    return (
      <div className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-2">
        <div className="px-1 py-1 text-[11px] text-cyan-300/50">No macros registered for {domain}.</div>
      </div>
    );
  }

  const live = actions.filter((a) => a.isLive);
  const ai = actions.filter((a) => !a.isLive && a.isAi);
  const compute = actions.filter((a) => !a.isLive && !a.isAi);

  return (
    <div className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-2">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">
        macro library · {domain} ({actions.length})
      </div>
      <ActionGroup title="Live" actions={live} />
      <ActionGroup title="AI-backed" actions={ai} />
      <ActionGroup title="Compute" actions={compute} />
    </div>
  );
}

export default MacroLibraryPanel;
