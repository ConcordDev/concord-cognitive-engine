'use client';

/**
 * /lenses/world/ar/[dtuId] — DTU AR preview page.
 *
 * Mounts the absorbed ARPreview component with a real DTU loaded from
 * /api/dtus/:id. Supports WebXR availability detection so devices
 * without AR get a graceful fallback (the component renders a
 * static placeholder).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Box } from 'lucide-react';
import ARPreview from '@/components/world-lens/ARPreview';
import { api } from '@/lib/api/client';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';
import { LensShell } from '@/components/lens/LensShell';
import { ds } from '@/lib/design-system';

type ARPreviewDTU = Parameters<typeof ARPreview>[0]['dtuData'];

interface ServerDtu {
  id: string;
  human?: { summary?: string; title?: string };
  core?: {
    name?: string;
    dimensions?: { width: number; height: number; depth: number };
  };
}

function detectWebXR(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Reference XRSystem indirectly so older lib.dom.d.ts targets compile.
  const nav = navigator as unknown as { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } };
  return Boolean(nav.xr);
}

export default function ARPreviewPage() {
  const params = useParams<{ dtuId: string }>();
  const dtuId = params?.dtuId ?? '';
  const [dtuData, setDtuData] = useState<ARPreviewDTU | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(detectWebXR());
  }, []);

  useEffect(() => {
    if (!dtuId) {
      setError('missing dtuId');
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get(`/api/dtus/${encodeURIComponent(dtuId)}`)
      .then((r) => r.data as ServerDtu)
      .then((d) => {
        if (cancelled) return;
        const name = d.core?.name ?? d.human?.title ?? d.human?.summary ?? d.id;
        setDtuData({
          name,
          dimensions: d.core?.dimensions,
          validationColors: true,
        } as unknown as ARPreviewDTU);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'failed to load DTU');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dtuId]);

  return (
    <LensShell lensId="world" asMain={false}>
      <UtilityPageShell
        icon={Box}
        title="AR Preview"
        subtitle={supported ? 'WebXR detected — tap-and-hold to place' : 'WebXR not available — static fallback'}
        showBackButton
        maxWidth="max-w-screen-lg"
      >
        {loading ? (
          <div className={`${ds.panelBare} p-6 text-center text-sm text-slate-400`}>
            Loading DTU…
          </div>
        ) : error || !dtuData ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
            {error ?? 'DTU not found'}
          </div>
        ) : (
          <ARPreview dtuId={dtuId} dtuData={dtuData} supported={supported} />
        )}
      </UtilityPageShell>
    </LensShell>
  );
}
