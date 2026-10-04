// server/domains/tools.js
//
// Tools lens — multi-utility surface: web research, compile/transpile,
// e-signature (multi-party workflow + audit trail), and per-tool history.
//
// NEW DOMAIN FILE — register in server/domains/index.js to activate:
//   import tools from './tools.js';
//   ...and add `tools` to the default-export array.
//
// All handlers return { ok, result?, error? } and never throw (try/catch).
// Live web data uses the free no-key DuckDuckGo Instant Answer API and the
// Wikipedia OpenSearch API. Persistent per-user data lives in
// globalThis._concordSTATE Maps keyed by userId.

import crypto from "node:crypto";
import { cachedFetchJson } from "../lib/external-fetch.js";
import { registerEsignProvider, issueSigningLinks, deliverSigningLinks, revokeSigningLinks } from "../lib/esign-links.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE using it.
// An absent/null field is fine (the macro uses its default). Returns null when
// clean, else the offending key. Copied from server/domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

// REGISTRATION (saved-class fix): this file used to register through the
// legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `tools.*` macro
// it defines was invisible to runMacro and to POST /api/lens/run → every call
// hit unknown_macro. It is now wired through the canonical `register` (MACROS)
// registry — `registerToolsActions(register)` in server.js — so the macros are
// reachable both via POST /api/lens/run AND via runMacro (which the contract
// engine + macro-assassin drive). The verified handler bodies below are kept
// byte-for-byte intact via the `registerLensAction` shim that adapts the
// canonical 2-arg `(ctx, input)` signature back to `(ctx, artifact, params)`.
export default function registerToolsActions(register) {
  // Legacy-convention shim: canonical register(ctx, input) → the verified
  // (ctx, artifact, params) handler bodies below, unchanged. `params` IS the
  // input; `artifact` is a virtual wrapper (no tools macro reads it).
  const registerLensAction = (domain, action, handler, ...extra) =>
    register(domain, action, (ctx, input = {}, params) => {
      const inp = input && typeof input === "object" ? input : {};
      // Dispatchers hand us a ready artifact envelope as arg1 (body under
      // `.data`) + the flat body as arg2; pass the envelope through (not
      // re-wrapped) and fold arg2 INTO `.data` so a caller that supplies the
      // body only in arg2 (e.g. parity tests' fn(ctx,{data:{}},params)) is seen.
      const base = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : (inp.data && typeof inp.data === "object"
            ? inp
            : { id: null, domain, type: "domain_action", data: inp, meta: {} });
      const p = params && typeof params === "object" ? params : {};
      const data = { ...(base.data && typeof base.data === "object" ? base.data : {}), ...p };
      return handler(ctx, { ...base, data }, data);
    }, ...extra);

  // ── per-user STATE ───────────────────────────────────────────────
  function getToolsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.toolsLens) STATE.toolsLens = {};
    const s = STATE.toolsLens;
    if (!s.searchHistory) s.searchHistory = new Map(); // userId -> [searches]
    if (!s.compileHistory) s.compileHistory = new Map(); // userId -> [compiles]
    if (!s.envelopes) s.envelopes = new Map(); // userId -> [envelopes]
    if (!s.seq) s.seq = new Map(); // userId -> counters
    return s;
  }
  function saveToolsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function aid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoNow() { return new Date().toISOString(); }
  function bucket(map, userId) { if (!map.has(userId)) map.set(userId, []); return map.get(userId); }
  function seqFor(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { env: 1 });
    const v = s.seq.get(userId);
    if (!Number.isFinite(v.env)) v.env = 1;
    return v;
  }
  function clip(arr, max) { if (arr.length > max) arr.splice(0, arr.length - max); }

  // ── Web research ─────────────────────────────────────────────────
  // Readable list of results with title / snippet / source. Pulls from
  // the DuckDuckGo Instant Answer API (RelatedTopics) and Wikipedia
  // OpenSearch — both free, no key. Results are merged + de-duplicated.

  registerLensAction("tools", "research", async (ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length > 400) return { ok: false, error: "query too long (max 400 chars)" };
    if (badNumericField(params, ["limit"])) return { ok: false, error: "invalid_limit" };
    const limit = Math.min(Math.max(Number(params.limit) || 8, 1), 20);
    const results = [];
    let abstract = null;

    // 1. DuckDuckGo Instant Answer API.
    try {
      const ddg = await cachedFetchJson(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { ttlMs: 10 * 60 * 1000 },
      );
      if (ddg?.AbstractText) {
        abstract = {
          text: String(ddg.AbstractText),
          source: String(ddg.AbstractSource || "DuckDuckGo"),
          url: String(ddg.AbstractURL || ""),
        };
      }
      const topics = Array.isArray(ddg?.RelatedTopics) ? ddg.RelatedTopics : [];
      const flat = [];
      for (const t of topics) {
        if (t?.Text && t?.FirstURL) flat.push(t);
        else if (Array.isArray(t?.Topics)) for (const sub of t.Topics) if (sub?.Text && sub?.FirstURL) flat.push(sub);
      }
      for (const t of flat) {
        const text = String(t.Text);
        const title = text.split(" - ")[0].slice(0, 140);
        results.push({
          title,
          snippet: text,
          url: String(t.FirstURL),
          source: "DuckDuckGo",
        });
      }
    } catch (_e) { /* fall through to Wikipedia */ }

    // 2. Wikipedia OpenSearch — fills out the list when DDG is sparse.
    if (results.length < limit) {
      try {
        const wiki = await cachedFetchJson(
          `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`,
          { ttlMs: 10 * 60 * 1000 },
        );
        if (Array.isArray(wiki) && wiki.length >= 4) {
          const titles = wiki[1] || [];
          const descs = wiki[2] || [];
          const urls = wiki[3] || [];
          for (let i = 0; i < titles.length; i++) {
            const url = String(urls[i] || "");
            if (results.some((r) => r.url === url)) continue;
            results.push({
              title: String(titles[i] || "").slice(0, 140),
              snippet: String(descs[i] || ""),
              url,
              source: "Wikipedia",
            });
          }
        }
      } catch (_e) { /* best effort */ }
    }

    const trimmed = results.slice(0, limit);
    if (trimmed.length === 0 && !abstract) {
      return { ok: false, error: "no results — both DuckDuckGo and Wikipedia returned empty for this query" };
    }

    // Record into per-user history.
    const s = getToolsState();
    if (s) {
      const userId = aid(ctx);
      const hist = bucket(s.searchHistory, userId);
      hist.push({
        id: uid("search"),
        query,
        resultCount: trimmed.length,
        at: isoNow(),
        topUrl: trimmed[0]?.url || abstract?.url || "",
      });
      clip(hist, 50);
      saveToolsState();
    }

    return {
      ok: true,
      result: {
        query,
        abstract,
        results: trimmed,
        count: trimmed.length,
        sources: [...new Set(trimmed.map((r) => r.source))],
      },
    };
  });

  registerLensAction("tools", "research-history", (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (badNumericField(params, ["limit"])) return { ok: false, error: "invalid_limit" };
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
    const hist = bucket(s.searchHistory, aid(ctx));
    return { ok: true, result: { history: hist.slice().reverse().slice(0, limit), total: hist.length } };
  });

  registerLensAction("tools", "research-clear", (ctx, _artifact, _params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    s.searchHistory.set(aid(ctx), []);
    saveToolsState();
    return { ok: true, result: { cleared: true } };
  });

  // ── Compile / transpile ──────────────────────────────────────────
  // Multi-language transpile via esbuild (ts / tsx / js / jsx). Supports
  // ES-target selection, sourcemaps, and minification. Falls back to a
  // best-effort strip-types pass when esbuild is unavailable.

  const TARGETS = ["esnext", "es2022", "es2020", "es2017", "es2015"];
  const LOADERS = ["ts", "tsx", "js", "jsx"];

  registerLensAction("tools", "compile", async (ctx, _artifact, params = {}) => {
    const source = String(params.source || "");
    if (!source.trim()) return { ok: false, error: "source required" };
    if (source.length > 200_000) return { ok: false, error: "source too large (max 200KB)" };
    const target = TARGETS.includes(params.target) ? params.target : "esnext";
    const loader = LOADERS.includes(params.loader) ? params.loader : "ts";
    const format = ["esm", "cjs", "iife"].includes(params.format) ? params.format : "esm";
    const minify = params.minify === true;
    const sourcemap = params.sourcemap === true;
    const startedAt = Date.now();

    let result;
    try {
      const esbuild = await import("esbuild").catch(() => null);
      if (esbuild?.transform) {
        const r = await esbuild.transform(source, {
          loader, target, format, minify, sourcemap: sourcemap ? "inline" : false,
        });
        result = {
          code: r.code,
          map: r.map || null,
          warnings: (r.warnings || []).map((w) => ({
            text: String(w.text || ""),
            line: w.location?.line ?? null,
            column: w.location?.column ?? null,
          })),
          engine: "esbuild",
          target, loader, format, minify, sourcemap,
        };
      }
    } catch (e) {
      // esbuild compile error — surface it as a structured failure.
      return {
        ok: false,
        error: `compile error: ${String(e?.message || e).slice(0, 600)}`,
        engine: "esbuild",
      };
    }

    if (!result) {
      // Fallback: naive strip-types.
      const stripped = source
        .replace(/:\s*[A-Za-z_<>[\]|&,?.\s]+(?=[=,)\]\s])/g, "")
        .replace(/<[A-Z][^>]*>/g, "")
        .replace(/\binterface\s+\w+\s*\{[^}]*\}/g, "")
        .replace(/\btype\s+\w+\s*=\s*[^;\n]+;?/g, "");
      result = {
        code: stripped,
        map: null,
        warnings: [],
        engine: "strip-types-fallback",
        target, loader, format, minify, sourcemap,
        note: "esbuild not available on this build; returned best-effort strip-types output",
      };
    }

    const durationMs = Date.now() - startedAt;
    result.durationMs = durationMs;
    result.inputBytes = Buffer.byteLength(source, "utf8");
    result.outputBytes = Buffer.byteLength(result.code, "utf8");

    // Record into per-user history.
    const s = getToolsState();
    if (s) {
      const userId = aid(ctx);
      const hist = bucket(s.compileHistory, userId);
      hist.push({
        id: uid("compile"),
        target, loader, format, minify,
        engine: result.engine,
        inputBytes: result.inputBytes,
        outputBytes: result.outputBytes,
        warningCount: result.warnings.length,
        durationMs,
        at: isoNow(),
      });
      clip(hist, 50);
      saveToolsState();
    }

    return { ok: true, result };
  });

  registerLensAction("tools", "compile-history", (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (badNumericField(params, ["limit"])) return { ok: false, error: "invalid_limit" };
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
    const hist = bucket(s.compileHistory, aid(ctx));
    return { ok: true, result: { history: hist.slice().reverse().slice(0, limit), total: hist.length } };
  });

  // ── E-signature: multi-party workflow + audit trail ──────────────
  // Sign arbitrary document text (or a DTU machine-layer payload) with the
  // platform key via HMAC-SHA256. An envelope tracks multiple signers,
  // each with their own pending → signed lifecycle and a tamper-evident
  // signature over the canonical document hash + signer identity.

  function platformSecret() {
    return process.env.JWT_SECRET || "concord-default-signing";
  }
  function sha256(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
  }
  function signPayload(payload) {
    return crypto
      .createHmac("sha256", platformSecret())
      .update(JSON.stringify(payload))
      .digest("base64url");
  }

  // Create a signing envelope for a document with one or more parties.
  registerLensAction("tools", "esign-create", (ctx, _artifact, params = {}) => {
  try {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const title = String(params.title || "").trim();
    const document = String(params.document || "");
    if (!title) return { ok: false, error: "title required" };
    if (!document.trim()) return { ok: false, error: "document text required" };
    if (document.length > 100_000) return { ok: false, error: "document too large (max 100KB)" };
    const partiesIn = Array.isArray(params.parties) ? params.parties : [];
    if (partiesIn.length === 0) return { ok: false, error: "at least one party required" };

    const documentHash = sha256(document);
    const seq = seqFor(s, userId);
    const parties = partiesIn.map((p, i) => ({
      id: uid("party"),
      order: i + 1,
      name: String(p?.name || `Party ${i + 1}`).slice(0, 120),
      email: String(p?.email || "").slice(0, 200),
      role: String(p?.role || "signer").slice(0, 40),
      // The one party the creator signs as. Everyone else signs from their own link.
      isSender: p?.isSender === true,
      status: "pending",
      signature: null,
      signedAt: null,
      delivery: null,
    }));
    if (parties.filter((p) => p.isSender).length > 1) return { ok: false, error: "only one party can be you" };
    const envelope = {
      id: uid("env"),
      number: `ENV-${String(seq.env).padStart(5, "0")}`,
      title,
      document,
      documentHash,
      status: "out_for_signature",
      parties,
      audit: [{ event: "created", actor: userId, at: isoNow(), detail: `Envelope created with ${parties.length} parties` }],
      createdAt: isoNow(),
      completedAt: null,
      esignDisclosure: "Signatures recorded under E-SIGN Act (15 USC § 7001) and UETA § 7.",
    };
    seq.env++;
    const list = bucket(s.envelopes, userId);
    list.push(envelope);
    clip(list, 100);
    saveToolsState();
    return { ok: true, result: { envelope } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Apply one party's signature: a tamper-evident HMAC over the document
  // hash + signer identity + timestamp, plus an audit entry saying how the
  // signer was identified (the sender in-app, or a recipient via their link).
  function applyPartySignature(env, party, { via, typedName = "", ip = "", userAgent = "", signedAt = isoNow() }) {
    if (env.status === "completed") return { ok: false, error: "envelope already completed" };
    if (env.status === "voided") return { ok: false, error: "envelope was voided" };
    if (party.status === "signed") return { ok: false, error: "party already signed" };
    const sigPayload = {
      envelopeId: env.id,
      documentHash: env.documentHash,
      partyId: party.id,
      partyName: party.name,
      signedAt,
    };
    party.status = "signed";
    party.signedAt = signedAt;
    party.signedVia = via;
    if (typedName) party.typedName = typedName;
    party.signature = {
      alg: "HS256",
      token: signPayload(sigPayload),
      payload: sigPayload,
    };
    const how = via === "link" ? `via their signing link${typedName ? ` as "${typedName}"` : ""}${ip ? ` from ${ip}` : ""}` : "in the app as the sender";
    env.audit.push({ event: "signed", actor: party.name, at: signedAt, detail: `${party.name} (${party.role}) signed ${how}`, ...(userAgent ? { userAgent } : {}) });

    const allSigned = env.parties.every((p) => p.status === "signed");
    if (allSigned) {
      env.status = "completed";
      env.completedAt = signedAt;
      env.audit.push({ event: "completed", actor: "system", at: signedAt, detail: "All parties signed — envelope completed" });
    }
    saveToolsState();
    return { ok: true, result: { envelope: env, completed: allSigned } };
  }

  // The sender signs as themselves. Every other party signs from their own
  // link (esign-send) — the creator can't sign on someone else's behalf.
  registerLensAction("tools", "esign-sign", (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const env = bucket(s.envelopes, userId).find((e) => e.id === String(params.envelopeId || ""));
    if (!env) return { ok: false, error: "envelope not found" };
    const party = env.parties.find((p) => p.id === String(params.partyId || ""));
    if (!party) return { ok: false, error: "party not found" };
    if (!party.isSender) return { ok: false, error: "this party signs from their own link — send the envelope instead" };
    return applyPartySignature(env, party, { via: "sender", typedName: String(params.typedName || "").slice(0, 120) });
  });

  // Send signing links to every party who isn't you and hasn't signed:
  // emailed from your Gmail when connected, otherwise returned to share.
  registerLensAction("tools", "esign-send", async (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const env = bucket(s.envelopes, userId).find((e) => e.id === String(params.envelopeId || ""));
    if (!env) return { ok: false, error: "envelope not found" };
    if (env.status !== "out_for_signature") return { ok: false, error: `envelope is ${env.status}` };
    const targets = env.parties.filter((p) => !p.isSender && p.status !== "signed"
      && (!params.partyId || p.id === String(params.partyId)));
    if (targets.length === 0) return { ok: false, error: "no one left to send to" };
    const links = issueSigningLinks("tools", userId, env.id, targets);
    const delivery = await deliverSigningLinks(ctx?.db, userId, links, { title: env.title, senderName: ctx?.actor?.displayName || ctx?.actor?.username || "A Concord user" });
    const at = isoNow();
    for (const d of delivery) {
      const p = env.parties.find((x) => x.id === d.recipientId);
      if (p) p.delivery = { method: d.delivered, reason: d.reason || null, at };
      env.audit.push({ event: d.delivered === "email" ? "emailed" : "link_created", actor: userId, at, detail: d.delivered === "email" ? `Signing link emailed to ${p?.email}` : `Signing link created for ${p?.name} (not emailed: ${d.reason})` });
    }
    saveToolsState();
    return { ok: true, result: { envelope: env, links: delivery.map((d) => ({ partyId: d.recipientId, url: d.url, delivered: d.delivered, reason: d.reason || null })) } };
  });

  registerEsignProvider("tools", {
    view(entry) {
      const s = getToolsState();
      const env = s && bucket(s.envelopes, entry.ownerId).find((e) => e.id === entry.envelopeId);
      const party = env?.parties.find((p) => p.id === entry.recipientId);
      if (!env || !party) return { ok: false, error: "link_not_found" };
      return { ok: true, result: {
        document: { title: env.title, text: env.document, hash: env.documentHash },
        signer: { name: party.name, email: party.email, role: party.role, status: party.status, signedAt: party.signedAt },
        envelopeStatus: env.status,
        parties: env.parties.map((p) => ({ name: p.name, role: p.role, status: p.status })),
        disclosure: env.esignDisclosure,
      } };
    },
    sign(entry, sig) {
      const s = getToolsState();
      const env = s && bucket(s.envelopes, entry.ownerId).find((e) => e.id === entry.envelopeId);
      const party = env?.parties.find((p) => p.id === entry.recipientId);
      if (!env || !party) return { ok: false, error: "link_not_found" };
      const r = applyPartySignature(env, party, { via: "link", ...sig });
      return r.ok ? { ok: true, result: { signed: true, envelopeStatus: env.status, completed: r.result.completed } } : r;
    },
  });

  // Verify every applied signature in an envelope against the platform key.
  registerLensAction("tools", "esign-verify", (ctx, _artifact, params = {}) => {
  try {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const envelopeId = String(params.envelopeId || "");
    const env = bucket(s.envelopes, userId).find((e) => e.id === envelopeId);
    if (!env) return { ok: false, error: "envelope not found" };

    // Re-hash the stored document — detects post-signing tampering.
    const currentHash = sha256(env.document);
    const documentIntact = currentHash === env.documentHash;
    const checks = env.parties.map((p) => {
      if (p.status !== "signed" || !p.signature) {
        return { partyId: p.id, partyName: p.name, status: p.status, verified: false, reason: "not signed" };
      }
      const expected = signPayload(p.signature.payload);
      const tokenValid = expected === p.signature.token;
      const hashMatches = p.signature.payload.documentHash === env.documentHash;
      return {
        partyId: p.id,
        partyName: p.name,
        status: p.status,
        verified: tokenValid && hashMatches && documentIntact,
        tokenValid,
        hashMatches,
        signedAt: p.signedAt,
      };
    });
    const signedParties = checks.filter((c) => c.status === "signed");
    const allValid = documentIntact && signedParties.length > 0 && signedParties.every((c) => c.verified);
    return {
      ok: true,
      result: {
        envelopeId: env.id,
        envelopeNumber: env.number,
        documentIntact,
        currentHash,
        expectedHash: env.documentHash,
        checks,
        allValid,
        verifiedAt: isoNow(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Verify a standalone signature token produced outside an envelope (or
  // copied from one) without needing the envelope on hand.
  registerLensAction("tools", "esign-verify-token", (_ctx, _artifact, params = {}) => {
    const token = String(params.token || "").trim();
    const payload = params.payload && typeof params.payload === "object" ? params.payload : null;
    if (!token) return { ok: false, error: "token required" };
    if (!payload) return { ok: false, error: "payload object required" };
    const expected = signPayload(payload);
    const valid = expected === token;
    return {
      ok: true,
      result: {
        valid,
        reason: valid ? "signature matches platform key" : "signature does not match — token or payload was altered",
        payload,
        verifiedAt: isoNow(),
      },
    };
  });

  registerLensAction("tools", "esign-list", (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ["out_for_signature", "completed", "voided", "all"].includes(params.status)
      ? params.status : "all";
    let list = bucket(s.envelopes, aid(ctx));
    if (status !== "all") list = list.filter((e) => e.status === status);
    const envelopes = list.slice().reverse().map((e) => ({
      id: e.id,
      number: e.number,
      title: e.title,
      status: e.status,
      documentHash: e.documentHash,
      parties: e.parties.map((p) => ({ id: p.id, name: p.name, role: p.role, status: p.status, signedAt: p.signedAt })),
      signedCount: e.parties.filter((p) => p.status === "signed").length,
      partyCount: e.parties.length,
      createdAt: e.createdAt,
      completedAt: e.completedAt,
    }));
    return { ok: true, result: { envelopes, total: envelopes.length } };
  });

  registerLensAction("tools", "esign-detail", (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const env = bucket(s.envelopes, aid(ctx)).find((e) => e.id === String(params.envelopeId || ""));
    if (!env) return { ok: false, error: "envelope not found" };
    return { ok: true, result: { envelope: env } };
  });

  registerLensAction("tools", "esign-void", (ctx, _artifact, params = {}) => {
    const s = getToolsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const env = bucket(s.envelopes, userId).find((e) => e.id === String(params.envelopeId || ""));
    if (!env) return { ok: false, error: "envelope not found" };
    if (env.status === "completed") return { ok: false, error: "cannot void a completed envelope" };
    env.status = "voided";
    revokeSigningLinks("tools", userId, env.id);
    env.audit.push({ event: "voided", actor: userId, at: isoNow(), detail: String(params.reason || "Voided by sender") });
    saveToolsState();
    return { ok: true, result: { envelope: env } };
  });
}
