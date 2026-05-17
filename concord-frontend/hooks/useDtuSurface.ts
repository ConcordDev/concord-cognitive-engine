'use client';

/**
 * useDtuSurface — fire-and-forget recorder + read helpers for the
 * cross-lens DTU surface log (Phase 7 of the UX completeness sprint).
 *
 * Usage in a downstream lens that renders someone else's DTU:
 *
 *   useDtuSurface().record({
 *     dtuId: dtu.id,
 *     lensId: 'chat',
 *     surfaceKind: 'inline_link',
 *   });
 *
 * The hook returns a stable `record` function — call it on mount /
 * first-render of any panel that exposes the DTU to the reader. The
 * server append is fire-and-forget; failure is silent (it's a
 * metric, not user-critical).
 */

import { useCallback } from 'react';
import { api } from '@/lib/api/client';

export type SurfaceKind = 'feed' | 'citation_chip' | 'quote_block' | 'recent_card' | 'downstream_panel' | 'search_result' | 'inline_link' | 'export';

export interface RecordInput {
  dtuId: string;
  lensId: string;
  surfaceKind: SurfaceKind;
  meta?: Record<string, unknown>;
}

export function useDtuSurface() {
  const record = useCallback(async (input: RecordInput): Promise<void> => {
    if (!input.dtuId || !input.lensId || !input.surfaceKind) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'dtu_surface',
        name: 'record',
        input,
      });
    } catch {
      // Fire and forget — surface logging is not user-critical.
    }
  }, []);

  return { record };
}

export default useDtuSurface;
