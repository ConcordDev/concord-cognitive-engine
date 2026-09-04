'use client';

/**
 * Native Concordia presenter slot inside the world lens.
 *
 * When Unity WebGL has been exported, this is a full-bleed iframe of
 * /unity-client/index.html (OS HUD stays as siblings on the lens page).
 * When the export is missing, children (Three.js ConcordiaScene) stay up —
 * honest fallback, never a fake Unity canvas.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ds } from '@/lib/design-system';
import { getInjectedJwt } from '@/lib/auth-bridge';

type Status =
  | { kind: 'checking' }
  | { kind: 'missing'; reason: string }
  | { kind: 'ready' };

export default function NativeWorldPlayer({
  worldId,
  token,
  children,
  onReady,
}: {
  worldId: string;
  token?: string;
  children: ReactNode;
  onReady?: () => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/unity-client/index.html', { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || ct.includes('application/json')) {
          let reason = 'unity_web_export_not_built';
          try {
            const j = await r.json();
            if (typeof j?.reason === 'string') reason = j.reason;
          } catch {
            /* not json */
          }
          if (!cancelled) setStatus({ kind: 'missing', reason });
          return;
        }
        if (!cancelled) {
          setStatus({ kind: 'ready' });
          onReadyRef.current?.();
        }
      } catch {
        if (!cancelled) setStatus({ kind: 'missing', reason: 'unity_web_export_not_built' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === 'checking') {
    return <>{children}</>;
  }

  if (status.kind === 'missing') {
    return <>{children}</>;
  }

  const params = new URLSearchParams({ CONCORD_WORLD_ID: worldId });
  const jwt = token || getInjectedJwt();
  if (jwt) params.set('CONCORD_AUTH_TOKEN', jwt);

  return (
    <div className="absolute inset-0 z-0" data-testid="native-world-player">
      <iframe
        title="Concordia Unity"
        src={`/unity-client/index.html?${params.toString()}`}
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
