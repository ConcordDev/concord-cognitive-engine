'use client';

/**
 * ForgeSharedView — resolves a Forge share link into a read-only app view.
 *
 * ForgeStudio's "Get share link" mints a token and hands the user a URL of
 * the shape `/lenses/forge?share=<token>` (forge.share). This component is
 * the missing OTHER half of that feature: it reads the `?share=` token from
 * the URL, calls forge.openShare, and renders the shared app read-only —
 * app identity, the partitioned file tree, and the real sandbox manifest
 * document the owner generated. Without it the minted link loaded the plain
 * builder and silently ignored the token (a dead path).
 *
 * Read-only by construction: openShare resolves another user's project from
 * server state and returns only display fields (code, files, html) — there
 * is no refine / restore / publish affordance here. No mock data: every
 * field rendered comes straight from the openShare payload.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Share2, Loader2, AlertTriangle, FileCode, Copy, Check,
  Download, Eye, Hammer,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SharedFile { path: string; lines: number }
interface SharedApp {
  appName: string;
  template: string;
  versionId: string;
  code: string;
  files: SharedFile[];
  html: string;
  sharedAt: number;
}

/** Read the share token from the live URL (client-only — no Suspense needed). */
function readShareToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('share');
  } catch {
    return null;
  }
}

export function ForgeSharedView() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [app, setApp] = useState<SharedApp | null>(null);
  const [copied, setCopied] = useState(false);

  // Resolve the token once on mount, and again if the URL changes (back/fwd).
  useEffect(() => {
    const sync = () => setToken(readShareToken());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (!token) { setApp(null); setError(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setApp(null);
      const r = await lensRun<SharedApp>('forge', 'openShare', { shareToken: token });
      if (cancelled) return;
      setLoading(false);
      if (r.data.ok && r.data.result) {
        setApp(r.data.result);
      } else {
        setError(r.data.error || 'This share link is no longer available.');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleCopy = useCallback(() => {
    if (!app?.code) return;
    navigator.clipboard?.writeText(app.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [app]);

  const handleDownload = useCallback(() => {
    if (!app?.code) return;
    const blob = new Blob([app.code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.appName || 'forge-app'}.mjs`;
    a.click();
    URL.revokeObjectURL(url);
  }, [app]);

  // Nothing to show when the page wasn't opened via a share link.
  if (!token) return null;

  return (
    <section className="mx-auto mb-4 max-w-screen-2xl px-2 sm:px-4">
      <div className="overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-950/10">
        <div className="flex flex-wrap items-center gap-2 border-b border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
          <Share2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-emerald-200">Shared Forge app</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            forge.openShare · read-only
          </span>
          {app && (
            <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
              {app.appName} · {app.template} · v{app.versionId}
            </span>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Resolving shared app…
          </div>
        )}

        {error && (
          <div role="alert" className="m-4 flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {app && (
          <div className="grid gap-4 p-4 lg:grid-cols-[240px_1fr]">
            {/* File tree + code actions */}
            <div className="space-y-3">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <FileCode className="h-3.5 w-3.5" /> Project tree ({app.files.length})
                </div>
                <ul className="space-y-0.5">
                  {app.files.map((f) => (
                    <li
                      key={f.path}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-400"
                    >
                      <FileCode className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" />
                      <span className="truncate font-mono">{f.path}</span>
                      <span className="ml-auto text-[10px] text-slate-500">{f.lines}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy source'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <Download className="h-3.5 w-3.5" /> Download .mjs
                </button>
              </div>
              <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200/80">
                <Hammer className="h-3 w-3 shrink-0" />
                Want to change it? Start your own project in the builder below.
              </p>
            </div>

            {/* Sandbox manifest preview */}
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Eye className="h-3.5 w-3.5" /> Live manifest preview
              </div>
              <iframe
                title="Shared Forge app preview"
                sandbox="allow-same-origin"
                srcDoc={app.html}
                className="h-96 w-full rounded-lg border border-zinc-800 bg-white"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default ForgeSharedView;
