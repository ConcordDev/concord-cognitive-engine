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
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Box, ArrowLeft } from 'lucide-react';
import ARPreview from '@/components/world-lens/ARPreview';
import { api } from '@/lib/api/client';

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
  const router = useRouter();
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
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-lg items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2 transition hover:bg-cyan-500/20"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
              <Box className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              AR Preview
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {supported ? 'WebXR detected — tap-and-hold to place' : 'WebXR not available — static fallback'}
            </p>
          </div>
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-lg px-3 py-4 sm:px-6 sm:py-5">
        {loading ? (
          <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/40 p-6 text-center text-sm text-slate-400">
            Loading DTU…
          </div>
        ) : error || !dtuData ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
            {error ?? 'DTU not found'}
          </div>
        ) : (
          <ARPreview dtuId={dtuId} dtuData={dtuData} supported={supported} />
        )}
      </section>
    </main>
  );
}
