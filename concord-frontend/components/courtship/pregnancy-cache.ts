/**
 * pregnancy-cache — client-side cache of in-flight pregnancies.
 *
 * HONESTY NOTE: `courtship.conceive` is the only backend surface that ever
 * hands back a `pregnancyId` (server/lib/romance-engine.js#conceive). There
 * is no `courtship.listPregnancies` / `romance.pregnancies` macro anywhere in
 * the registered backend (verified by grep against server/domains/*.js and
 * server/server.js) — the server tracks the row in `player_pregnancies`, but
 * nothing surfaces a read-list for it. So the ONLY way this lens can ever
 * know "you have a pregnancy pending, here's its id and due date" across a
 * page reload is to remember the real id/dueAt this browser was handed at
 * the moment `conceive` succeeded. That's what this module does — it is a
 * cache of a real, already-happened server response, not fabricated data.
 *
 * Scoped per-user (localStorage key includes the user id) so switching
 * accounts on the same device never leaks another player's pregnancy. If the
 * browser's cache is lost (different device, cleared storage), the honest
 * fallback in the UI is: "no locally-known pending pregnancy" — never a
 * fabricated "no pregnancy" claim about server state we can't see.
 */

export interface CachedPregnancy {
  pregnancyId: string;
  partnerKind: string;
  partnerId: string;
  dueAt: number; // unix seconds, as returned by courtship.conceive
  conceivedAt: number; // unix seconds, recorded client-side at cache time
}

function storageKey(userId: string): string {
  return `concord:courtship:pregnancies:${userId}`;
}

export function loadCachedPregnancies(userId: string | null | undefined): CachedPregnancy[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.pregnancyId === 'string') : [];
  } catch {
    return [];
  }
}

export function addCachedPregnancy(userId: string | null | undefined, p: CachedPregnancy): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const existing = loadCachedPregnancies(userId).filter((e) => e.pregnancyId !== p.pregnancyId);
    existing.push(p);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(existing));
  } catch {
    /* best-effort cache; losing it just means the honest-empty fallback shows */
  }
}

export function removeCachedPregnancy(userId: string | null | undefined, pregnancyId: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const remaining = loadCachedPregnancies(userId).filter((e) => e.pregnancyId !== pregnancyId);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(remaining));
  } catch {
    /* best-effort */
  }
}
