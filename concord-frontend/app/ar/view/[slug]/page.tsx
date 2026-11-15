'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { lensRun } from '@/lib/api/client';

interface PublishedObject { id?: string; name?: string; kind?: string }
interface PublishedScene { id?: string; name?: string; anchor?: string; objects?: PublishedObject[] }
interface Published {
  slug?: string;
  sceneName?: string;
  url?: string;
  anchor?: string;
  expiresAt?: string;
}

/**
 * Public page for a published AR scene. /ar/view/<slug> used to 404
 * because nothing was mounted at that path. This reads publishBySlug
 * and shows the scene that was published. It does not invent a WebXR runtime.
 */
export default function ArPublicViewPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug || '');
  const [scene, setScene] = useState<PublishedScene | null>(null);
  const [publish, setPublish] = useState<Published | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); setError('That link is missing a slug.'); return; }
    let cancelled = false;
    (async () => {
      const r = await lensRun<{ scene?: PublishedScene; publish?: Published }>('ar', 'publishBySlug', { slug });
      if (cancelled) return;
      const result = r.data?.result;
      if (!r.data?.ok || !result?.publish) {
        setError(r.data?.error || 'That published scene was not found.');
        setLoading(false);
        return;
      }
      setPublish(result.publish);
      setScene(result.scene || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <main className="mx-auto max-w-lg px-4 py-10 text-zinc-100">
      <p className="text-xs uppercase tracking-wide text-zinc-500">Published AR scene</p>
      {loading ? <p className="mt-4 text-sm text-zinc-400">Loading scene…</p> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p> : null}
      {!loading && !error ? (
        <>
          <h1 className="mt-2 text-2xl text-zinc-50">{scene?.name || publish?.sceneName || 'Untitled scene'}</h1>
          <p className="mt-1 text-sm text-zinc-400">Anchor: {scene?.anchor || publish?.anchor || 'plane'}</p>
          <ul className="mt-4 space-y-2" aria-label="Scene objects">
            {(scene?.objects || []).length === 0 ? (
              <li className="text-sm text-zinc-500">This publish has no objects.</li>
            ) : (scene?.objects || []).map((obj) => (
              <li key={obj.id || obj.name} className="rounded border border-white/10 px-3 py-2 text-sm">
                {obj.name || 'Object'} <span className="text-zinc-500">{obj.kind || 'model'}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
