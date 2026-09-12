'use client';

/**
 * World lens retail shell — Unity WebGL viewport first.
 *
 * Default: full-bleed Concordia WebGL (env UNITY_WEBGL_URL / /unity-client /
 * /concordia-webgl) with id=concordia-unity-webgl for the ConKay postMessage
 * bridge + /unity-ws config injection. Escape (or the floating Menu chip)
 * opens a minimal overlay: leave lens, settings, advanced OS tools.
 *
 * Advanced tools lazy-load WorldOsSurface (the former page.tsx monolith) so
 * auctions / breeding / workshops / ConKay design HUD stay reachable
 * without permanently layering on the viewport. ConcordiaScene is not
 * the world — missing WebGL export is an honest unbuilt state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { LensShell } from '@/components/lens/LensShell';
import { getInjectedJwt } from '@/lib/auth-bridge';
import { UNITY_IFRAME_ID } from '@/lib/conkay/unity-bridge';
import { buildUnityIframeSearch } from '@/lib/unity-iframe-config';

const WorldOsSurface = dynamic(() => import('@/components/world/WorldOsSurface'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[50vh] items-center justify-center bg-black text-sm text-zinc-400">
      Loading OS world surface…
    </div>
  ),
});

const WorldAccessibilityMenu = dynamic(
  () => import('@/components/accessibility/WorldAccessibilityMenu'),
  { ssr: false },
);

const UNITY_WEBGL_URL =
  process.env.NEXT_PUBLIC_UNITY_WEBGL_URL ||
  process.env.NEXT_PUBLIC_CONCORDIA_UNITY_URL ||
  '';

type UnityStatus = 'checking' | 'ready' | 'missing';

type ShellPanel = null | 'menu' | 'settings' | 'advanced';

const CANDIDATE_SRCS = [
  UNITY_WEBGL_URL,
  '/unity-client/index.html',
  '/concordia-webgl/index.html',
].filter((u, i, arr) => Boolean(u) && arr.indexOf(u) === i);

async function probeUnitySrc(src: string): Promise<boolean> {
  try {
    const path = src.split('?')[0];
    const r = await fetch(path, { credentials: 'include' });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) return false;
    // Next JSON 404 / missing-export payloads are not a Unity index.
    if (ct.includes('application/json')) return false;
    return true;
  } catch {
    return false;
  }
}

export default function WorldUnityShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wantAdvanced =
    searchParams?.get('surface') === 'os' ||
    searchParams?.get('advanced') === '1';

  const [panel, setPanel] = useState<ShellPanel>(wantAdvanced ? 'advanced' : null);
  const [status, setStatus] = useState<UnityStatus>('checking');
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const worldId = 'concordia-hub';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const candidate of CANDIDATE_SRCS) {
        const ok = await probeUnitySrc(candidate);
        if (cancelled) return;
        if (ok) {
          const params = buildUnityIframeSearch({
            worldId,
            token: getInjectedJwt(),
          });
          const join = candidate.includes('?') ? '&' : '?';
          setIframeSrc(`${candidate}${join}${params.toString()}`);
          setStatus('ready');
          return;
        }
      }
      if (!cancelled) {
        setStatus('missing');
        setIframeSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape: close nested panel first, else toggle menu. Does not fight
  // pointer-lock inside the iframe (that Esc is consumed by the browser /
  // Unity); parent focus / Menu chip still opens chrome.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (panel === 'advanced' || panel === 'settings') {
        e.preventDefault();
        setPanel(null);
        return;
      }
      if (panel === 'menu') {
        e.preventDefault();
        setPanel(null);
        return;
      }
      // Only steal Esc when focus is outside the Unity iframe.
      const active = document.activeElement;
      const iframe = document.getElementById(UNITY_IFRAME_ID);
      if (iframe && (active === iframe || iframe.contains(active))) return;
      e.preventDefault();
      setPanel('menu');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const leaveLens = useCallback(() => {
    // Front door is /hub (lens grid + destinations). There is no bare lens
    // index route — only the dynamic per-lens segment — so navigating to
    // that bare path would 404.
    router.push('/hub');
  }, [router]);

  const openAdvanced = useCallback(() => {
    setPanel('advanced');
  }, []);

  const chromeHint = useMemo(() => {
    if (status === 'checking') return 'Locating Unity WebGL…';
    if (status === 'missing') {
      return 'Unity WebGL export is not built — play the Editor client against ws://127.0.0.1:5050/unity-ws';
    }
    return 'Unity WebGL · /unity-ws';
  }, [status]);

  if (panel === 'advanced') {
    return (
      <div className="relative h-full min-h-0 w-full" data-testid="world-advanced-os">
        <div className="pointer-events-auto absolute right-3 top-3 z-[80] flex gap-2">
          <button
            type="button"
            onClick={() => setPanel(null)}
            className="rounded-lg border border-amber-500/40 bg-black/80 px-3 py-1.5 text-xs uppercase tracking-wide text-amber-200 hover:bg-amber-500/20"
          >
            ← Back to Unity
          </button>
        </div>
        <WorldOsSurface />
      </div>
    );
  }

  return (
    <LensShell lensId="world" asMain={false}>
      <div
        data-testid="world-unity-shell"
        data-unity-status={status}
        className="relative h-full min-h-0 w-full overflow-hidden bg-black"
      >
        {status === 'ready' && iframeSrc ? (
          <iframe
            id={UNITY_IFRAME_ID}
            title="Concordia Unity"
            src={iframeSrc}
            className="absolute inset-0 h-full w-full border-0 bg-black"
            allow="fullscreen; gamepad; clipboard-read; clipboard-write; accelerometer; gyroscope; pointer-lock"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-zinc-300">{chromeHint}</p>
            {status === 'missing' && (
              <button
                type="button"
                onClick={openAdvanced}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-wide text-cyan-200 hover:bg-cyan-500/20"
              >
                Open OS world surface
              </button>
            )}
          </div>
        )}

        {/* Minimal always-available chrome */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between p-3">
          <div
            className="pointer-events-none rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-200/90 backdrop-blur"
            aria-hidden={status !== 'ready'}
          >
            {chromeHint}
          </div>
          <button
            type="button"
            data-testid="world-unity-menu-btn"
            onClick={() => setPanel((p) => (p === 'menu' ? null : 'menu'))}
            className="pointer-events-auto rounded-lg border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-white/90 backdrop-blur hover:bg-white/10"
          >
            Menu
          </button>
        </div>

        {panel === 'menu' && (
          <div
            role="dialog"
            aria-label="World menu"
            data-testid="world-unity-menu"
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPanel(null);
            }}
          >
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-zinc-950/95 p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">World</h2>
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="text-[10px] uppercase tracking-wide text-zinc-400 hover:text-white"
                >
                  Close Esc
                </button>
              </div>
              <ul className="flex flex-col gap-1.5">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setPanel(null);
                      // Refocus game iframe for pointer lock space
                      document.getElementById(UNITY_IFRAME_ID)?.focus();
                    }}
                    className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-left text-sm text-emerald-100 hover:bg-emerald-500/20"
                  >
                    Resume play
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setPanel('settings')}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm text-zinc-100 hover:bg-white/10"
                  >
                    Settings & accessibility
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={openAdvanced}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm text-zinc-100 hover:bg-white/10"
                  >
                    Advanced OS tools
                    <span className="mt-0.5 block text-[10px] text-zinc-500">
                      Hub, district editor, HUD stack
                    </span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={leaveLens}
                    className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-left text-sm text-rose-100 hover:bg-rose-500/20"
                  >
                    Leave world lens
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}

        {panel === 'settings' && (
          <WorldAccessibilityMenu open onClose={() => setPanel('menu')} />
        )}
      </div>
    </LensShell>
  );
}
