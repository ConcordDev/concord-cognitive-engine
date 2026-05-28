// Phase BA5 — scar + drift query hook for the avatar renderer.
//
// Both surfaces are public-read (mounted in publicReadPaths) so the
// hook works for any avatar id, not just the caller's own avatar.

import { useEffect, useState } from 'react';

export interface AvatarScar {
  id: string;
  region: string;          // 'head' | 'torso' | 'arms' | 'legs' | 'systemic'
  source: string;          // combat | fall | environment | fatigue | spell | poison
  severity: number;        // 0..1 — informs the decal alpha
  acquired_at: number;
  visible_label: string | null;
}

export interface AvatarScarsState {
  scars: AvatarScar[];
  drift: number;           // 0..1 — feeds the `u_wear` shader uniform
  loading: boolean;
}

/**
 * Polls /api/avatars/:userId/scars + /api/avatars/:userId/drift on
 * mount and every `refreshMs`. Returns the latest snapshot for the
 * renderer to map onto bone regions + the wear shader.
 */
export function useAvatarScars(userId: string | null | undefined, refreshMs = 30_000): AvatarScarsState {
  const [scars, setScars] = useState<AvatarScar[]>([]);
  const [drift, setDrift] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const fetchBoth = async () => {
      setLoading(true);
      try {
        const [scarsRes, driftRes] = await Promise.all([
          fetch(`/api/avatars/${encodeURIComponent(userId)}/scars`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/avatars/${encodeURIComponent(userId)}/drift`).then((r) => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        if (scarsRes?.ok) setScars(scarsRes.scars || []);
        if (driftRes?.ok) setDrift(Math.max(0, Math.min(1, driftRes.drift_score || 0)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchBoth();
    const t = setInterval(fetchBoth, refreshMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [userId, refreshMs]);

  return { scars, drift, loading };
}
