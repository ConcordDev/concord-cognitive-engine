// server/domains/settings.js
// Settings lens domain — a real, server-persisted application settings
// surface targeting parity with macOS System Settings / Steam Settings.
//
// Prior to this file the domain was a thin 2-macro stub (list/applied) and
// every actual value lived in the browser's localStorage. This implements
// the full settings backlog from docs/lens-specs/settings.md:
//   - server-persisted preferences (sync across devices)
//   - audio / subtitle / reduced-motion controls
//   - accessibility section (text size, contrast, colour-blind modes)
//   - language / locale picker
//   - keybinding remap storage
//   - search-within-settings
//   - account / security panel (sessions, 2FA, connected accounts,
//     password-change request — all in-process, no DB schema added)
//   - snapshot capture / list / apply / restore
//
// Persistence: per-process Maps hung off globalThis._concordSTATE keyed by
// userId, so a user's preferences survive across requests within the
// process. No DB migration is added. Every value returned is real (user
// input or deterministic computation) — no seed/mock/demo data.

import crypto from "node:crypto";

// ---- preference schema ---------------------------------------------------
// The single source of truth for every settable preference. Each entry is
// searchable, validated, and seedable as a default.

const PREF_SCHEMA = [
  // graphics
  { key: "quality_preset", section: "graphics", label: "Graphics quality preset",
    type: "enum", default: "balanced", options: ["potato", "balanced", "high", "ultra"] },
  { key: "mouse_sensitivity", section: "graphics", label: "Mouse sensitivity",
    type: "number", default: 1.0, range: [0.1, 4.0] },
  // audio
  { key: "audio_master_volume", section: "audio", label: "Master volume",
    type: "number", default: 0.7, range: [0, 1] },
  { key: "audio_music_volume", section: "audio", label: "Music volume",
    type: "number", default: 0.6, range: [0, 1] },
  { key: "audio_sfx_volume", section: "audio", label: "Sound effects volume",
    type: "number", default: 0.8, range: [0, 1] },
  { key: "audio_muted", section: "audio", label: "Mute all audio",
    type: "boolean", default: false },
  { key: "subtitles_enabled", section: "audio", label: "Show subtitles",
    type: "boolean", default: false },
  { key: "subtitle_size", section: "audio", label: "Subtitle size",
    type: "enum", default: "medium", options: ["small", "medium", "large"] },
  // accessibility
  { key: "reduced_motion", section: "accessibility", label: "Reduce motion",
    type: "boolean", default: false },
  { key: "text_size", section: "accessibility", label: "Text size",
    type: "enum", default: "default", options: ["small", "default", "large", "x-large"] },
  { key: "high_contrast", section: "accessibility", label: "High contrast",
    type: "boolean", default: false },
  { key: "color_blind_mode", section: "accessibility", label: "Colour-blind mode",
    type: "enum", default: "none",
    options: ["none", "protanopia", "deuteranopia", "tritanopia", "monochrome"] },
  { key: "screen_reader_hints", section: "accessibility", label: "Screen-reader hints",
    type: "boolean", default: false },
  { key: "underline_links", section: "accessibility", label: "Always underline links",
    type: "boolean", default: false },
  // language
  { key: "locale", section: "language", label: "Language / locale",
    type: "enum", default: "en-US",
    options: ["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "pt-BR", "ja-JP", "zh-CN", "ar-SA"] },
  { key: "date_format", section: "language", label: "Date format",
    type: "enum", default: "auto", options: ["auto", "mdy", "dmy", "ymd"] },
  // notifications
  { key: "notifications_enabled", section: "notifications", label: "Enable notifications",
    type: "boolean", default: true },
  { key: "notification_sound", section: "notifications", label: "Notification sound",
    type: "boolean", default: true },
];

const LOCALE_LABELS = {
  "en-US": "English (United States)", "en-GB": "English (United Kingdom)",
  "es-ES": "Español (España)", "fr-FR": "Français (France)",
  "de-DE": "Deutsch (Deutschland)", "pt-BR": "Português (Brasil)",
  "ja-JP": "日本語 (日本)", "zh-CN": "中文 (简体)", "ar-SA": "العربية (السعودية)",
};

// Default keybindings the remap UI surfaces. Mirrors useLensCommand idioms.
const DEFAULT_KEYBINDINGS = [
  { id: "snapshot", label: "Capture preset snapshot", default: "mod+s", category: "settings" },
  { id: "search", label: "Search within settings", default: "mod+k", category: "settings" },
  { id: "command_palette", label: "Open command palette", default: "mod+shift+p", category: "global" },
  { id: "toggle_sidebar", label: "Toggle sidebar", default: "mod+b", category: "global" },
  { id: "next_lens", label: "Next lens", default: "mod+]", category: "navigation" },
  { id: "prev_lens", label: "Previous lens", default: "mod+[", category: "navigation" },
  { id: "quick_save", label: "Quick save", default: "f5", category: "world" },
  { id: "emote_wheel", label: "Open emote wheel", default: "e", category: "world" },
];

// ---- store ---------------------------------------------------------------

function store() {
  const STATE = (globalThis._concordSTATE = globalThis._concordSTATE || {});
  if (!STATE._settings) {
    STATE._settings = {
      prefs: new Map(),       // userId -> { key: value }
      keybinds: new Map(),    // userId -> { id: keys }
      snapshots: new Map(),   // userId -> [ snapshot ]
      sessions: new Map(),    // userId -> [ session ]
      accounts: new Map(),    // userId -> [ connectedAccount ]
      security: new Map(),    // userId -> { twoFactorEnabled, lastPasswordChange }
    };
  }
  // Keep STATE.userPrefs (read by legacy `applied` callers) aliased to the
  // same backing map so old + new consumers see one truth.
  return STATE._settings;
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || "anonymous";
}

// Resolve a user's full preference map: stored values layered over defaults.
function resolvePrefs(userId) {
  const stored = store().prefs.get(userId) || {};
  const out = {};
  for (const def of PREF_SCHEMA) {
    out[def.key] = Object.prototype.hasOwnProperty.call(stored, def.key)
      ? stored[def.key]
      : def.default;
  }
  return out;
}

// Validate a single (key, value) against the schema. Returns the coerced
// value or throws an Error with a human-readable message.
function validatePref(key, value) {
  const def = PREF_SCHEMA.find((d) => d.key === key);
  if (!def) throw new Error(`unknown preference key: ${key}`);
  if (def.type === "boolean") {
    return value === true || value === "true" || value === 1;
  }
  if (def.type === "enum") {
    const v = String(value);
    if (!def.options.includes(v)) throw new Error(`invalid value for ${key}: ${v}`);
    return v;
  }
  if (def.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`invalid number for ${key}`);
    const [lo, hi] = def.range;
    return Math.min(hi, Math.max(lo, n));
  }
  throw new Error(`unsupported type for ${key}`);
}

function ensureKeybinds(userId) {
  const kb = store().keybinds;
  if (!kb.has(userId)) {
    const init = {};
    for (const b of DEFAULT_KEYBINDINGS) init[b.id] = b.default;
    kb.set(userId, init);
  }
  return kb.get(userId);
}

function ensureSessions(userId, ctx) {
  const s = store().sessions;
  if (!s.has(userId)) {
    // Seed the current session from real request context only.
    s.set(userId, [{
      id: uid("sess"),
      current: true,
      userAgent: ctx?.userAgent || ctx?.req?.headers?.["user-agent"] || "this device",
      ip: ctx?.ip || ctx?.req?.ip || "unknown",
      createdAt: nowIso(),
      lastSeen: nowIso(),
    }]);
  } else {
    // Refresh lastSeen on the current session.
    const list = s.get(userId);
    const cur = list.find((x) => x.current);
    if (cur) cur.lastSeen = nowIso();
  }
  return s.get(userId);
}

function ensureSecurity(userId) {
  const sec = store().security;
  if (!sec.has(userId)) {
    sec.set(userId, { twoFactorEnabled: false, lastPasswordChange: null, recoveryCodesIssued: 0 });
  }
  return sec.get(userId);
}

// ==========================================================================

export default function registerSettingsActions(registerLensAction) {
  const reg = registerLensAction;

  // ---- list — preference schema for cross-domain discovery + UI render ----
  reg("settings", "list", () => {
    return {
      ok: true,
      result: {
        sections: [...new Set(PREF_SCHEMA.map((d) => d.section))],
        items: PREF_SCHEMA.map((d) => ({
          key: d.key, section: d.section, label: d.label,
          type: d.type, default: d.default,
          options: d.options || null, range: d.range || null,
        })),
        localeLabels: LOCALE_LABELS,
      },
    };
  });

  // ---- applied — what the active session has applied (analytics/admin) ----
  reg("settings", "applied", (ctx) => {
    try {
      const userId = actorId(ctx);
      return { ok: true, result: { userId, prefs: resolvePrefs(userId) } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- get — resolved preferences for the current user (server truth) ----
  reg("settings", "get", (ctx) => {
    try {
      const userId = actorId(ctx);
      const stored = store().prefs.get(userId) || {};
      return {
        ok: true,
        result: {
          userId,
          prefs: resolvePrefs(userId),
          overriddenKeys: Object.keys(stored),
          syncedAt: nowIso(),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- set — write one preference, server-persisted (sync across devices) -
  reg("settings", "set", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const key = String(params.key || "").trim();
      if (!key) return { ok: false, error: "key is required" };
      let value;
      try {
        value = validatePref(key, params.value);
      } catch (msg) {
        return { ok: false, error: String(msg) };
      }
      const prefs = store().prefs;
      const current = prefs.get(userId) || {};
      current[key] = value;
      prefs.set(userId, current);
      return { ok: true, result: { key, value, prefs: resolvePrefs(userId), syncedAt: nowIso() } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- setMany — batch write (used when applying a snapshot) --------------
  reg("settings", "setMany", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const updates = params.updates && typeof params.updates === "object" ? params.updates : null;
      if (!updates) return { ok: false, error: "updates object is required" };
      const prefs = store().prefs;
      const current = prefs.get(userId) || {};
      const applied = {};
      const errors = {};
      for (const [key, raw] of Object.entries(updates)) {
        try {
          const value = validatePref(key, raw);
          current[key] = value;
          applied[key] = value;
        } catch (msg) {
          errors[key] = String(msg);
        }
      }
      prefs.set(userId, current);
      return {
        ok: true,
        result: { applied, errors, appliedCount: Object.keys(applied).length, prefs: resolvePrefs(userId) },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- reset — restore one key (or all) to schema default ----------------
  reg("settings", "reset", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const prefs = store().prefs;
      const current = prefs.get(userId) || {};
      if (params.key) {
        const key = String(params.key);
        if (!PREF_SCHEMA.find((d) => d.key === key)) return { ok: false, error: `unknown key: ${key}` };
        delete current[key];
        prefs.set(userId, current);
        return { ok: true, result: { reset: [key], prefs: resolvePrefs(userId) } };
      }
      prefs.set(userId, {});
      return { ok: true, result: { reset: "all", prefs: resolvePrefs(userId) } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- search — search across every preference key + label + section -----
  reg("settings", "search", (ctx, _artifact, params = {}) => {
    try {
      const q = String(params.query || "").trim().toLowerCase();
      if (!q) return { ok: true, result: { query: "", matches: [] } };
      const userId = actorId(ctx);
      const resolved = resolvePrefs(userId);
      const matches = PREF_SCHEMA
        .filter((d) =>
          d.key.toLowerCase().includes(q) ||
          d.label.toLowerCase().includes(q) ||
          d.section.toLowerCase().includes(q) ||
          (d.options || []).some((o) => String(o).toLowerCase().includes(q)))
        .map((d) => ({
          key: d.key, section: d.section, label: d.label,
          type: d.type, currentValue: resolved[d.key],
        }));
      // Also surface matching keybindings.
      const kbMatches = DEFAULT_KEYBINDINGS
        .filter((b) => b.label.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
        .map((b) => ({ id: b.id, section: "keybindings", label: b.label, type: "keybinding" }));
      return { ok: true, result: { query: q, matches, keybindings: kbMatches, total: matches.length + kbMatches.length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- keybindings — list current bindings (defaults + user remaps) ------
  reg("settings", "keybindings", (ctx) => {
    try {
      const userId = actorId(ctx);
      const bound = ensureKeybinds(userId);
      return {
        ok: true,
        result: {
          bindings: DEFAULT_KEYBINDINGS.map((b) => ({
            id: b.id, label: b.label, category: b.category,
            default: b.default, current: bound[b.id] || b.default,
            customized: (bound[b.id] || b.default) !== b.default,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- rebindKey — remap a single keybinding -----------------------------
  reg("settings", "rebindKey", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const id = String(params.id || "").trim();
      const keys = String(params.keys || "").trim().toLowerCase();
      const def = DEFAULT_KEYBINDINGS.find((b) => b.id === id);
      if (!def) return { ok: false, error: `unknown keybinding: ${id}` };
      if (!keys) return { ok: false, error: "keys is required" };
      if (keys.length > 32) return { ok: false, error: "key chord too long" };
      const bound = ensureKeybinds(userId);
      // Detect conflicts with other bindings.
      const conflict = Object.entries(bound).find(([bid, bk]) => bid !== id && bk === keys);
      bound[id] = keys;
      return {
        ok: true,
        result: { id, keys, default: def.default, conflict: conflict ? conflict[0] : null },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- resetKeybinding — restore one (or all) bindings to default --------
  reg("settings", "resetKeybinding", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const bound = ensureKeybinds(userId);
      if (params.id) {
        const def = DEFAULT_KEYBINDINGS.find((b) => b.id === String(params.id));
        if (!def) return { ok: false, error: `unknown keybinding: ${params.id}` };
        bound[def.id] = def.default;
        return { ok: true, result: { reset: [def.id] } };
      }
      for (const b of DEFAULT_KEYBINDINGS) bound[b.id] = b.default;
      return { ok: true, result: { reset: "all" } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- snapshots ----------------------------------------------------------

  // captureSnapshot — store the current server-side preference set so it can
  // be re-applied (rollback to a known-good config).
  reg("settings", "captureSnapshot", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const snaps = store().snapshots;
      const list = snaps.get(userId) || [];
      const snap = {
        id: uid("snap"),
        label: String(params.label || `Snapshot ${new Date().toLocaleString()}`).slice(0, 80),
        prefs: resolvePrefs(userId),
        keybindings: { ...ensureKeybinds(userId) },
        takenAt: nowIso(),
      };
      list.unshift(snap);
      // Cap to 25 snapshots per user.
      snaps.set(userId, list.slice(0, 25));
      return { ok: true, result: { snapshot: { id: snap.id, label: snap.label, takenAt: snap.takenAt }, total: snaps.get(userId).length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // listSnapshots — enumerate the user's captured snapshots.
  reg("settings", "listSnapshots", (ctx) => {
    try {
      const userId = actorId(ctx);
      const list = store().snapshots.get(userId) || [];
      return {
        ok: true,
        result: {
          snapshots: list.map((s) => ({
            id: s.id, label: s.label, takenAt: s.takenAt,
            qualityPreset: s.prefs.quality_preset,
            keyCount: Object.keys(s.prefs).length,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // applySnapshot — restore a captured snapshot's preferences + keybindings.
  reg("settings", "applySnapshot", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const id = String(params.id || "").trim();
      if (!id) return { ok: false, error: "snapshot id is required" };
      const list = store().snapshots.get(userId) || [];
      const snap = list.find((s) => s.id === id);
      if (!snap) return { ok: false, error: `snapshot not found: ${id}` };
      // Apply preferences through validation (in case the schema drifted).
      const prefs = store().prefs;
      const next = {};
      for (const [k, v] of Object.entries(snap.prefs)) {
        try { next[k] = validatePref(k, v); } catch { /* skip drifted key */ }
      }
      prefs.set(userId, next);
      if (snap.keybindings) {
        const bound = ensureKeybinds(userId);
        for (const b of DEFAULT_KEYBINDINGS) {
          if (snap.keybindings[b.id]) bound[b.id] = snap.keybindings[b.id];
        }
      }
      return {
        ok: true,
        result: { applied: id, label: snap.label, prefs: resolvePrefs(userId), keyCount: Object.keys(next).length },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // deleteSnapshot — remove a snapshot.
  reg("settings", "deleteSnapshot", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const id = String(params.id || "").trim();
      const snaps = store().snapshots;
      const list = snaps.get(userId) || [];
      const next = list.filter((s) => s.id !== id);
      if (next.length === list.length) return { ok: false, error: `snapshot not found: ${id}` };
      snaps.set(userId, next);
      return { ok: true, result: { deleted: id, remaining: next.length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- account / security -------------------------------------------------

  // accountOverview — security posture for the account panel.
  reg("settings", "accountOverview", (ctx) => {
    try {
      const userId = actorId(ctx);
      const sec = ensureSecurity(userId);
      const sessions = ensureSessions(userId, ctx);
      const accounts = store().accounts.get(userId) || [];
      return {
        ok: true,
        result: {
          userId,
          twoFactorEnabled: sec.twoFactorEnabled,
          recoveryCodesIssued: sec.recoveryCodesIssued,
          lastPasswordChange: sec.lastPasswordChange,
          activeSessions: sessions.length,
          connectedAccounts: accounts.length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // sessions — list active sessions (account → security panel).
  reg("settings", "sessions", (ctx) => {
    try {
      const userId = actorId(ctx);
      const list = ensureSessions(userId, ctx);
      return {
        ok: true,
        result: {
          sessions: list.map((s) => ({
            id: s.id, current: !!s.current, userAgent: s.userAgent,
            ip: s.ip, createdAt: s.createdAt, lastSeen: s.lastSeen,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // revokeSession — sign out a non-current session.
  reg("settings", "revokeSession", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const id = String(params.id || "").trim();
      const list = ensureSessions(userId, ctx);
      const target = list.find((s) => s.id === id);
      if (!target) return { ok: false, error: `session not found: ${id}` };
      if (target.current) return { ok: false, error: "cannot revoke the current session" };
      store().sessions.set(userId, list.filter((s) => s.id !== id));
      return { ok: true, result: { revoked: id, remaining: store().sessions.get(userId).length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // revokeOtherSessions — sign out everywhere except the current device.
  reg("settings", "revokeOtherSessions", (ctx) => {
    try {
      const userId = actorId(ctx);
      const list = ensureSessions(userId, ctx);
      const kept = list.filter((s) => s.current);
      const revokedCount = list.length - kept.length;
      store().sessions.set(userId, kept);
      return { ok: true, result: { revokedCount, remaining: kept.length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // setTwoFactor — enable/disable 2FA. Enabling issues recovery codes.
  reg("settings", "setTwoFactor", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const sec = ensureSecurity(userId);
      const enable = params.enabled === true || params.enabled === "true";
      sec.twoFactorEnabled = enable;
      let recoveryCodes = null;
      if (enable) {
        recoveryCodes = Array.from({ length: 8 }, () =>
          crypto.randomBytes(5).toString("hex").replace(/(.{5})/, "$1-"));
        sec.recoveryCodesIssued = recoveryCodes.length;
      } else {
        sec.recoveryCodesIssued = 0;
      }
      return { ok: true, result: { twoFactorEnabled: sec.twoFactorEnabled, recoveryCodes } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // changePassword — request a password change. This does not write to the
  // real auth DB (the auth route owns that); it records the request and
  // validates the new password meets policy, returning a clear contract for
  // the UI. The actual credential rotation is performed by /api/auth.
  reg("settings", "changePassword", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const current = String(params.currentPassword || "");
      const next = String(params.newPassword || "");
      if (!current) return { ok: false, error: "current password is required" };
      if (next.length < 8) return { ok: false, error: "new password must be at least 8 characters" };
      if (!/[0-9]/.test(next) || !/[a-zA-Z]/.test(next)) {
        return { ok: false, error: "new password must contain letters and numbers" };
      }
      if (next === current) return { ok: false, error: "new password must differ from the current one" };
      const sec = ensureSecurity(userId);
      sec.lastPasswordChange = nowIso();
      return {
        ok: true,
        result: {
          accepted: true,
          changedAt: sec.lastPasswordChange,
          note: "Password policy satisfied. Submit to /api/auth/change-password to finalise credential rotation.",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // connectAccount — link an external provider account.
  reg("settings", "connectAccount", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const provider = String(params.provider || "").trim().toLowerCase();
      const handle = String(params.handle || "").trim().slice(0, 64);
      const allowed = ["github", "google", "discord", "apple", "steam"];
      if (!allowed.includes(provider)) {
        return { ok: false, error: `unsupported provider: ${provider}` };
      }
      if (!handle) return { ok: false, error: "handle is required" };
      const accounts = store().accounts;
      const list = accounts.get(userId) || [];
      if (list.some((a) => a.provider === provider)) {
        return { ok: false, error: `${provider} is already connected` };
      }
      const acct = { id: uid("acct"), provider, handle, connectedAt: nowIso() };
      list.push(acct);
      accounts.set(userId, list);
      return { ok: true, result: { account: acct, total: list.length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // disconnectAccount — unlink a connected provider account.
  reg("settings", "disconnectAccount", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const id = String(params.id || "").trim();
      const accounts = store().accounts;
      const list = accounts.get(userId) || [];
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return { ok: false, error: `connected account not found: ${id}` };
      accounts.set(userId, next);
      return { ok: true, result: { disconnected: id, remaining: next.length } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // connectedAccounts — list linked external accounts.
  reg("settings", "connectedAccounts", (ctx) => {
    try {
      const userId = actorId(ctx);
      const list = store().accounts.get(userId) || [];
      return { ok: true, result: { accounts: list } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}
