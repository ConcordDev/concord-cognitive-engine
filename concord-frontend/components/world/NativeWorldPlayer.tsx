'use client';

/**
 * Native Concordia presenter slot — Unity WebGL only.
 *
 * When Unity WebGL has been exported, this is a full-bleed iframe
 * (UNITY_WEBGL_URL → /unity-client → /concordia-webgl). iframe id is
 * `concordia-unity-webgl` so ConKay postUnityCmd /unity-ws bridge works.
 * When the export is missing, this slot stays an honest
 * `{ok:false, reason:'unity_web_export_not_built'}` — it does **not**
 * mount Three.js ConcordiaScene. Play Concordia in the Unity Editor
 * against `ws://127.0.0.1:5050/unity-ws`.
 *
 * `children` is accepted so WorldOsSurface can keep the retired
 * ConcordiaScene JSX for source-form tests; this presenter never mounts it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ds } from '@/lib/design-system';
import { EmptyState } from '@/components/ui/EmptyState';
import { getInjectedJwt } from '@/lib/auth-bridge';
import { UNITY_IFRAME_ID } from '@/lib/conkay/unity-bridge';

type Status =
  | { kind: 'checking' }
  | { kind: 'missing'; reason: string }
  | { kind: 'ready'; src: string };

const ENV_UNITY_URL =
  process.env.NEXT_PUBLIC_UNITY_WEBGL_URL ||
  process.env.NEXT_PUBLIC_CONCORDIA_UNITY_URL ||
  '';

const CANDIDATES = [
  ENV_UNITY_URL,
  '/unity-client/index.html',
  '/concordia-webgl/index.html',
].filter((u, i, arr) => Boolean(u) && arr.indexOf(u) === i);

async function firstLiveUnitySrc(): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    try {
      const path = candidate.split('?')[0];
      const r = await fetch(path, { credentials: 'include' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.includes('application/json')) continue;
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

export default function NativeWorldPlayer({
  worldId,
  token,
  children,
  onReady,
}: {
  worldId: string;
  token?: string;
  children?: ReactNode;
  onReady?: () => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Retired Three.js tree from callers — never mounted as the world.
  void children;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const src = await firstLiveUnitySrc();
      if (cancelled) return;
      if (!src) {
        setStatus({ kind: 'missing', reason: 'unity_web_export_not_built' });
        return;
      }
      setStatus({ kind: 'ready', src });
      onReadyRef.current?.();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === 'checking') {
    return (
      <div
        className="absolute inset-0 z-0 flex items-center justify-center bg-black"
        data-testid="native-world-checking"
      >
        <p className={`${ds.hudPill} px-3 py-1 text-[10px] uppercase tracking-widest text-amber-200/90`}>
          Locating Unity WebGL…
        </p>
      </div>
    );
  }

  if (status.kind === 'missing') {
    return (
      <div
        className="absolute inset-0 z-0 flex items-center justify-center bg-black px-6"
        data-testid="native-world-missing"
        data-reason={status.reason}
      >
        <EmptyState
          role="alert"
          ariaLabel="Unity WebGL export is not built"
          title="Unity WebGL export is not built"
          description={
            <>
              Reason: <code className="font-mono text-[10px] text-amber-200">{status.reason}</code>.
              Concordia does not fall back to Three.js. Play the Editor client at{' '}
              <code className="font-mono text-[10px] text-amber-200">
                apps/concordia-living-world/unity-client/
              </code>{' '}
              against <code className="font-mono text-[10px] text-zinc-400">ws://127.0.0.1:5050/unity-ws</code>.
            </>
          }
          className="max-w-md border-amber-500/30 bg-black/60 text-zinc-200"
        />
      </div>
    );
  }

  const params = new URLSearchParams({ CONCORD_WORLD_ID: worldId });
  const jwt = token || getInjectedJwt();
  if (jwt) params.set('CONCORD_AUTH_TOKEN', jwt);
  const join = status.src.includes('?') ? '&' : '?';
  const src = `${status.src}${join}${params.toString()}`;

  return (
    <div className="absolute inset-0 z-0" data-testid="native-world-player">
      <iframe
        id={UNITY_IFRAME_ID}
        title="Concordia Unity"
        src={src}
        className="h-full w-full border-0 bg-black"
        allow="fullscreen; gamepad; clipboard-read; clipboard-write; accelerometer; gyroscope; pointer-lock"
      />
      <div
        className={`${ds.hudPill} pointer-events-none absolute left-3 top-3 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-200/90`}
      >
        Unity WebGL · kernel `/unity-ws`
      </div>
    </div>
  );
}
