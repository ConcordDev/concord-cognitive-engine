/**
 * Guest intent draft stash — GB-1536 §3d (SAFE SUBSET ONLY).
 *
 * When a guest tries to act (send, save, run, post), the client-side
 * draft behind that intent — the text in the box, the calculator's
 * inputs — is stashed in sessionStorage keyed by the returnTo, so
 * after signup the user lands back with the draft restored and ONE
 * click from finishing. The action itself is NEVER replayed: no
 * auto-submit, auto-save, auto-post, auto-run, auto-buy, auto-AI.
 *
 * Rules: sessionStorage only (per-tab, dies with the tab); never sent
 * to the server before auth; cleared on use, on logout, and after
 * 30 minutes.
 */

const PREFIX = 'concord_guest_draft:';
const TTL_MS = 30 * 60 * 1000;

interface DraftEntry {
  savedAt: number;
  fields: Record<string, string>;
}

function keyFor(returnTo: string): string {
  return `${PREFIX}${returnTo}`;
}

export function stashDraft(returnTo: string, fields: Record<string, string>): void {
  try {
    const entry: DraftEntry = { savedAt: Date.now(), fields };
    sessionStorage.setItem(keyFor(returnTo), JSON.stringify(entry));
  } catch {
    /* storage full/blocked — the draft is a courtesy, never a blocker */
  }
}

/** Read-and-clear: a stash is consumed by its first restore. */
export function takeDraft(returnTo: string): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(keyFor(returnTo));
    if (!raw) return null;
    sessionStorage.removeItem(keyFor(returnTo));
    const entry = JSON.parse(raw) as DraftEntry;
    if (!entry || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > TTL_MS) {
      return null;
    }
    return entry.fields && typeof entry.fields === 'object' ? entry.fields : null;
  } catch {
    return null;
  }
}

/** Peek without consuming (expiry still enforced). */
export function peekDraft(returnTo: string): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(keyFor(returnTo));
    if (!raw) return null;
    const entry = JSON.parse(raw) as DraftEntry;
    if (!entry || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > TTL_MS) {
      return null;
    }
    return entry.fields && typeof entry.fields === 'object' ? entry.fields : null;
  } catch {
    return null;
  }
}

/** Logout / auth-transition cleanup: no guest draft survives it. */
export function clearGuestDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* nothing to clear */
  }
}
