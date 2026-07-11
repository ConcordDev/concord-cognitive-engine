/**
 * Fire-and-forget writer for the studio.* parity backend's collaboration
 * edit log (server/domains/studio.js `collab-edit` / `collab-since`).
 *
 * CollabPanel already polls `collab-since` and renders an "Edit log" feed,
 * but nothing previously called `collab-edit` to populate it — the log was
 * permanently empty even during an active session. Call this from any
 * mutation on a studio.* parity project so the log reflects real actions.
 *
 * Silently no-ops (logs a console warning, never throws to the caller) when
 * there's no active collaboration session for the project — that's the
 * expected, common case, not an error worth surfacing to the user.
 */

import { lensRun } from '@/lib/api/client';

export function logStudioCollabEdit(
  projectId: string | undefined | null,
  op: string,
  target?: string,
  detail?: Record<string, unknown>
): void {
  if (!projectId) return;
  lensRun({ domain: 'studio', action: 'collab-edit', input: { projectId, op, target, detail } }).catch((e) => {
    // Expected when no collab session is active for this project — the
    // macro itself returns { ok:false, error:'no active session' } rather
    // than throwing, so a caught error here means the request itself
    // failed (network/auth), worth a console note but not user-facing.
    console.warn('[Studio] collab-edit log write failed:', e);
  });
}
