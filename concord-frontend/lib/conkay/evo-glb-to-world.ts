// lib/conkay/evo-glb-to-world.ts
//
// Free-text archetype keyword → POST /api/conkay/design-glb → absolute same-origin
// GLB URL → Unity loadGlb → wait glb_loaded.
// Honesty: archetypes only (sword/spear/staff/mace/shield). Not full CAD suite.

import { loadGlb, onUnityEvent, unityIframePresent, type LoadGlbPayload } from './unity-bridge';

export type EvoArchetype = 'sword' | 'spear' | 'staff' | 'mace' | 'shield';

export interface EvoGlbToWorldResult {
  ok: boolean;
  error?: string;
  archetype?: string;
  assetId?: string;
  sourceId?: string;
  glbUrl?: string;
  loadPosted?: boolean;
  loadId?: string;
  glbLoaded?: boolean;
  glbLoadedPayload?: Record<string, unknown> | null;
  honesty?: {
    path: string;
    note: string;
    glb: boolean;
  };
  source: 'evo-glb-to-world';
}

function absoluteSameOrigin(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) {
    // Rewrite bare :5050 absolute to frontend origin when we are on :3000 —
    // Unity WebGL same-origin fetch prefers the Next rewrite.
    try {
      if (typeof window !== 'undefined' && window.location?.origin) {
        const u = new URL(url);
        if (
          (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
          u.port === '5050' &&
          (window.location.port === '3000' || window.location.port === '')
        ) {
          return `${window.location.origin}${u.pathname}${u.search}`;
        }
      }
    } catch {
      /* keep original */
    }
    return url;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
  }
  return `http://127.0.0.1:3000${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * Call design-glb API then post load_glb. Optionally await glb_loaded.
 */
export async function runEvoGlbToWorld(opts: {
  text: string;
  archetype?: EvoArchetype;
  spawn?: boolean;
  waitMs?: number;
  position?: LoadGlbPayload['position'];
  scale?: LoadGlbPayload['scale'];
}): Promise<EvoGlbToWorldResult> {
  const text = String(opts.text || '').trim();
  if (!text && !opts.archetype) {
    return { ok: false, error: 'empty_text', source: 'evo-glb-to-world' };
  }

  let data: Record<string, unknown> | null = null;
  try {
    const { api } = await import('@/lib/api/client');
    const res = await api.post('/api/conkay/design-glb', {
      text: text || opts.archetype,
      archetype: opts.archetype,
    });
    data = (res?.data ?? null) as Record<string, unknown> | null;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      source: 'evo-glb-to-world',
    };
  }

  if (!data?.ok) {
    return {
      ok: false,
      error: String(data?.error || data?.reason || 'design-glb failed'),
      archetype: typeof data?.archetype === 'string' ? data.archetype : undefined,
      source: 'evo-glb-to-world',
    };
  }

  const relativeOrAbs = String(
    (data.glbUrlAbsolute as string) || (data.glbUrl as string) || '',
  );
  const glbUrl = absoluteSameOrigin(relativeOrAbs);
  const archetype = String(data.archetype || opts.archetype || '');
  const assetId = typeof data.assetId === 'string' ? data.assetId : undefined;
  const sourceId = typeof data.sourceId === 'string' ? data.sourceId : undefined;
  const honesty = (data.honesty as EvoGlbToWorldResult['honesty']) || {
    path: 'archetype→design-glb→load_glb',
    note: 'Archetypes only. Not full free-text CAD.',
    glb: true,
  };

  if (opts.spawn === false) {
    return {
      ok: true,
      archetype,
      assetId,
      sourceId,
      glbUrl,
      loadPosted: false,
      honesty,
      source: 'evo-glb-to-world',
    };
  }

  if (!unityIframePresent()) {
    return {
      ok: false,
      error: 'no_unity_iframe',
      archetype,
      assetId,
      sourceId,
      glbUrl,
      honesty,
      source: 'evo-glb-to-world',
    };
  }

  const loadId = `evo-glb-${Date.now()}`;
  const loadPosted = loadGlb(
    {
      url: glbUrl,
      name: archetype || 'evo-asset',
      position: opts.position ?? { x: 0.4, y: 0, z: 0.4 },
      scale: opts.scale ?? 1,
    },
    loadId,
  );

  if (!loadPosted) {
    return {
      ok: false,
      error: 'load_glb_post_failed',
      archetype,
      assetId,
      sourceId,
      glbUrl,
      loadPosted: false,
      loadId,
      honesty,
      source: 'evo-glb-to-world',
    };
  }

  const waitMs = opts.waitMs ?? 15000;
  let glbLoaded = false;
  let glbLoadedPayload: Record<string, unknown> | null = null;

  await new Promise<void>((resolve) => {
    // Real completion is the Unity `glb_loaded` event; `deadline` only bounds
    // the wait so a silent Unity never hangs the caller. No polling, no motion.
    const deadline = setTimeout(() => {
      off();
      resolve();
    }, waitMs);
    const off = onUnityEvent((msg) => {
      if (msg.event === 'glb_loaded') {
        glbLoaded = true;
        glbLoadedPayload = (msg.payload as Record<string, unknown>) || null;
        clearTimeout(deadline);
        off();
        resolve();
      } else if (msg.event === 'error' && (!msg.id || msg.id === loadId)) {
        clearTimeout(deadline);
        off();
        resolve();
      }
    });
  });

  return {
    ok: glbLoaded,
    error: glbLoaded ? undefined : 'timeout_waiting_glb_loaded',
    archetype,
    assetId,
    sourceId,
    glbUrl,
    loadPosted: true,
    loadId,
    glbLoaded,
    glbLoadedPayload,
    honesty,
    source: 'evo-glb-to-world',
  };
}
