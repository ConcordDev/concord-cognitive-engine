// server/lib/esign-links.js
//
// Shared signing links for every e-signature surface (tools, legal, law).
// A link is an unguessable token (crypto.randomBytes, base64url) scoped
// server-side to exactly ONE signer of ONE envelope. The signer opens it
// without a Concord account, reads the document and signs as themselves —
// the envelope owner can never sign on their behalf.
//
// Each lens registers a provider that knows how to show and sign its own
// envelopes; the public routes (/api/esign/:token) only ever call
// view/sign through this module, so a token can't be widened to reach
// anything but its own signer slot.
//
// Delivery is honest: a link is emailed from the sender's own Gmail when
// that connector is linked; otherwise the link is returned for the sender
// to share and the result says it was NOT emailed.

import crypto from "node:crypto";
import { writeGmailMessage } from "./connector-client.js";

const providers = new Map();

/**
 * provider = {
 *   view(entry)  -> { ok, document: { title, text?, hash? }, sender, signer: { name, email, status }, envelopeStatus }
 *   sign(entry, { typedName, ip, userAgent, signedAt }) -> { ok, envelopeStatus, completed }
 * }
 * entry = { token, kind, ownerId, envelopeId, recipientId, name, email, createdAt }
 */
export function registerEsignProvider(kind, provider) {
  providers.set(kind, provider);
}

function linkStore() {
  const S = globalThis._concordSTATE;
  if (!S) return null;
  if (!(S.esignLinks instanceof Map)) S.esignLinks = new Map();
  return S.esignLinks;
}

function save() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
  }
}

export function signingUrl(token) {
  const base = (process.env.FRONTEND_URL || "https://concord-os.org").replace(/\/+$/, "");
  return `${base}/sign/${token}`;
}

/** Mint one link per signer, replacing any earlier link for the same slot. */
export function issueSigningLinks(kind, ownerId, envelopeId, signers) {
  const store = linkStore();
  if (!store) return [];
  for (const [tok, e] of store) {
    if (e.kind === kind && e.ownerId === ownerId && e.envelopeId === envelopeId && signers.some((s) => s.id === e.recipientId)) store.delete(tok);
  }
  const out = [];
  for (const s of signers) {
    const token = crypto.randomBytes(24).toString("base64url");
    const entry = {
      token, kind, ownerId, envelopeId,
      recipientId: s.id,
      name: String(s.name || "").slice(0, 120),
      email: String(s.email || "").slice(0, 200),
      createdAt: new Date().toISOString(),
    };
    store.set(token, entry);
    out.push({ recipientId: s.id, name: entry.name, email: entry.email, token, url: signingUrl(token) });
  }
  save();
  return out;
}

/** Drop every link for an envelope (void / delete). */
export function revokeSigningLinks(kind, ownerId, envelopeId) {
  const store = linkStore();
  if (!store) return 0;
  let n = 0;
  for (const [tok, e] of store) {
    if (e.kind === kind && e.ownerId === ownerId && e.envelopeId === envelopeId) { store.delete(tok); n++; }
  }
  if (n) save();
  return n;
}

function resolve(token) {
  const store = linkStore();
  const t = String(token || "");
  if (!store || t.length < 16 || t.length > 120) return null;
  const entry = store.get(t);
  if (!entry) return null;
  const provider = providers.get(entry.kind);
  return provider ? { entry, provider } : null;
}

export async function viewSigningLink(token) {
  const r = resolve(token);
  if (!r) return { ok: false, error: "link_not_found" };
  return r.provider.view(r.entry);
}

export async function signViaLink(token, { typedName, consent, ip, userAgent } = {}) {
  const r = resolve(token);
  if (!r) return { ok: false, error: "link_not_found" };
  const name = String(typedName || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "typed_name_required" };
  if (consent !== true) return { ok: false, error: "consent_required" };
  const res = await r.provider.sign(r.entry, {
    typedName: name,
    ip: String(ip || "").slice(0, 64),
    userAgent: String(userAgent || "").slice(0, 300),
    signedAt: new Date().toISOString(),
  });
  if (res?.ok) {
    r.entry.usedAt = new Date().toISOString();
    save();
  }
  return res;
}

/**
 * Email each link from the sender's own Gmail when connected. Never claims
 * delivery it didn't make: each result is { recipientId, delivered: "email" }
 * or { delivered: "link_only", reason }.
 */
export async function deliverSigningLinks(db, ownerId, links, { title, senderName } = {}) {
  const results = [];
  for (const l of links) {
    if (!l.email) { results.push({ recipientId: l.recipientId, delivered: "link_only", reason: "no_email", url: l.url }); continue; }
    if (!db) { results.push({ recipientId: l.recipientId, delivered: "link_only", reason: "no_db", url: l.url }); continue; }
    try {
      const sent = await writeGmailMessage(db, ownerId, {
        to: l.name ? `${l.name} <${l.email}>` : l.email,
        subject: `Please sign: ${title || "document"}`,
        body: `${senderName || "Someone"} has asked you to sign "${title || "a document"}".\n\nReview and sign here:\n${l.url}\n\nThis link is only for you. If you weren't expecting this, you can ignore it.`,
      });
      results.push(sent?.ok
        ? { recipientId: l.recipientId, delivered: "email", url: l.url }
        : { recipientId: l.recipientId, delivered: "link_only", reason: sent?.reason || "send_failed", url: l.url });
    } catch (e) {
      results.push({ recipientId: l.recipientId, delivered: "link_only", reason: String(e?.message || e), url: l.url });
    }
  }
  return results;
}

export function _resetEsignLinksForTest() {
  const S = globalThis._concordSTATE;
  if (S) S.esignLinks = new Map();
}
