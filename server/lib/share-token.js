// server/lib/share-token.js
//
// Bearer tokens for no-login share links. A token is the only thing standing
// between a stranger and the shared object, so it must be unguessable:
// 18 random bytes (144 bits), base64url, behind a per-kind prefix. Older
// links minted with timestamp/Math.random ids fail isStrongShareToken and are
// refused publicly; owners get a fresh strong token when they list them.

import crypto from "node:crypto";

export function newShareToken(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

export function isStrongShareToken(token, prefix) {
  const t = String(token || "");
  if (!t.startsWith(`${prefix}_`)) return false;
  return /^[A-Za-z0-9_-]{24,}$/.test(t.slice(prefix.length + 1));
}
