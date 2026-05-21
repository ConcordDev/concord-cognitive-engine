// server/domains/sync.js
//
// Sync lens — parity vs iCloud / Dropbox / Syncthing for the
// cross-device DTU synchronization experience.
//
// The legacy `dtu_sync` domain (in server.js) handles device registration
// and the portable-pack export. This file adds the *experience* layer the
// gap spec calls for: visible sync status + per-device sync logs, revoke,
// auto-sync toggle, conflict resolution, selective sync, quota usage,
// activity feed, and online/offline presence — all surfaced to real UI.
//
// Per-user state lives in `globalThis._concordSTATE.syncLens` (Maps keyed
// by userId), following the in-memory pattern used by other domain files
// (accounting.js, etc.). The legacy `dtu_sync_devices` SQLite table is the
// canonical device registry; this file mirrors / annotates it in memory
// for the sync-experience metadata that has no column there.
//
// Free public API: GitHub releases for the Syncthing project, used by the
// "real-world sync tooling" reference panel — no key required.

import { cachedFetchJson } from "../lib/external-fetch.js";

const SYNCTHING_RELEASES =
  "https://api.github.com/repos/syncthing/syncthing/releases?per_page=8";

const ONLINE_WINDOW_MS = 5 * 60 * 1000; // device "online" if seen within 5m

function actId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

/** Lazily build + return the per-user sync-lens state container. */
function syncState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  if (!g._concordSTATE.syncLens) {
    g._concordSTATE.syncLens = {
      // userId -> Map<deviceId, deviceMeta>
      devices: new Map(),
      // userId -> Array<logEntry>  (sync history / activity feed)
      logs: new Map(),
      // userId -> Array<conflict>
      conflicts: new Map(),
      // userId -> deviceId counter
      seq: new Map(),
    };
  }
  return g._concordSTATE.syncLens;
}

function userDevices(userId) {
  const s = syncState();
  if (!s.devices.has(userId)) s.devices.set(userId, new Map());
  return s.devices.get(userId);
}
function userLogs(userId) {
  const s = syncState();
  if (!s.logs.has(userId)) s.logs.set(userId, []);
  return s.logs.get(userId);
}
function userConflicts(userId) {
  const s = syncState();
  if (!s.conflicts.has(userId)) s.conflicts.set(userId, []);
  return s.conflicts.get(userId);
}
function nextId(userId, prefix) {
  const s = syncState();
  const n = (s.seq.get(userId) || 0) + 1;
  s.seq.set(userId, n);
  return `${prefix}_${Date.now().toString(36)}_${n}`;
}

/** Append a log entry (capped at 200 newest per user). */
function pushLog(userId, entry) {
  const logs = userLogs(userId);
  logs.unshift({ id: nextId(userId, "log"), at: Date.now(), ...entry });
  if (logs.length > 200) logs.length = 200;
  return logs[0];
}

/**
 * Ensure an in-memory device record exists. The legacy SQLite registry
 * owns the canonical device list; this is the experience-layer mirror so
 * the lens can attach scopes, quota, presence and a per-device log even
 * for devices registered through the old `dtu_sync` macros.
 */
function ensureDevice(userId, deviceId, label) {
  const devs = userDevices(userId);
  if (!devs.has(deviceId)) {
    devs.set(deviceId, {
      id: deviceId,
      label: label || `Device ${deviceId}`,
      autoSync: true,
      online: false,
      lastSeenAt: null,
      lastSyncAt: null,
      lastSyncStatus: "never",
      // selective sync — collections this device pulls
      scopes: ["personal", "public", "artifacts"],
      // quota (bytes) — soft, advisory; usage updated on each sync
      quotaBytes: 50 * 1024 * 1024 * 1024, // 50 GB
      usedBytes: 0,
      dtusSynced: 0,
      revoked: false,
    });
  }
  return devs.get(deviceId);
}

const ALL_SCOPES = ["personal", "public", "artifacts", "shared", "drafts"];

export default function registerSyncActions(registerLensAction) {
  /**
   * register_device — create an experience-layer device record.
   * Mirrors the legacy dtu_sync.register_device but adds scopes/quota.
   */
  registerLensAction("sync", "register_device", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const label = String(p.deviceLabel || p.label || "").trim();
      if (!label) return { ok: false, error: "missing_label" };
      const id = nextId(userId, "dev");
      const dev = ensureDevice(userId, id, label);
      dev.autoSync = p.autoSync !== false;
      dev.online = true;
      dev.lastSeenAt = Date.now();
      pushLog(userId, {
        kind: "device_registered",
        deviceId: id,
        label,
        message: `Registered "${label}"`,
      });
      return { ok: true, result: { device: dev } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * list_devices — every device with live presence + quota + scopes.
   * Presence is derived: online if lastSeenAt within ONLINE_WINDOW_MS.
   */
  registerLensAction("sync", "list_devices", (ctx, _artifact, _params) => {
    try {
      const userId = actId(ctx);
      const now = Date.now();
      const devs = [...userDevices(userId).values()]
        .filter((d) => !d.revoked)
        .map((d) => ({
          ...d,
          online: !!d.lastSeenAt && now - d.lastSeenAt < ONLINE_WINDOW_MS,
          quotaPct: d.quotaBytes ? Math.min(100, Math.round((d.usedBytes / d.quotaBytes) * 100)) : 0,
        }))
        .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
      return { ok: true, result: { devices: devs, count: devs.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * sync_now — [M] Trigger a sync for one device. Simulates a sync pass:
   * advances dtusSynced, updates quota usage, writes a per-device log
   * entry, and returns progress + a status summary.
   */
  registerLensAction("sync", "sync_now", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const deviceId = String(p.deviceId || "");
      if (!deviceId) return { ok: false, error: "missing_deviceId" };
      const dev = userDevices(userId).get(deviceId);
      if (!dev || dev.revoked) return { ok: false, error: "device_not_found" };

      // Count syncable DTUs from the live substrate, filtered by the
      // device's selective-sync scopes.
      const STATE = globalThis._concordSTATE;
      let candidate = [];
      try {
        const all = STATE?.dtus ? [...STATE.dtus.values()] : [];
        candidate = all.filter((d) => {
          const scope = d?.scope || d?.core?.scope || "personal";
          if (scope === "personal" && !dev.scopes.includes("personal")) return false;
          if (scope === "public" && !dev.scopes.includes("public")) return false;
          if ((d?.artifact || d?.artifactPath) && !dev.scopes.includes("artifacts")) return false;
          return true;
        });
      } catch { candidate = []; }

      const dtuCount = candidate.length;
      // advisory byte estimate: ~4 KB structured + artifact bytes
      const bytes = candidate.reduce((sum, d) => {
        const artBytes = Number(d?.artifactBytes || d?.artifact?.bytes || 0);
        return sum + 4096 + artBytes;
      }, 0);

      dev.lastSyncAt = Date.now();
      dev.lastSeenAt = Date.now();
      dev.online = true;
      dev.lastSyncStatus = "ok";
      dev.dtusSynced = dtuCount;
      dev.usedBytes = bytes;

      const overQuota = dev.quotaBytes > 0 && bytes > dev.quotaBytes;
      if (overQuota) dev.lastSyncStatus = "quota_exceeded";

      const log = pushLog(userId, {
        kind: "sync",
        deviceId,
        label: dev.label,
        dtuCount,
        bytes,
        status: dev.lastSyncStatus,
        message: overQuota
          ? `Sync partial — ${dtuCount} DTUs exceed device quota`
          : `Synced ${dtuCount} DTUs (${(bytes / 1048576).toFixed(1)} MB) to "${dev.label}"`,
      });

      return {
        ok: true,
        result: {
          deviceId,
          status: dev.lastSyncStatus,
          dtuCount,
          bytes,
          quotaBytes: dev.quotaBytes,
          quotaPct: dev.quotaBytes ? Math.min(100, Math.round((bytes / dev.quotaBytes) * 100)) : 0,
          scopes: dev.scopes,
          syncedAt: dev.lastSyncAt,
          logEntry: log,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * revoke_device — [S] Deregister a device. Marks it revoked (it stops
   * appearing in list_devices) and logs the action.
   */
  registerLensAction("sync", "revoke_device", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const deviceId = String(p.deviceId || "");
      if (!deviceId) return { ok: false, error: "missing_deviceId" };
      const dev = userDevices(userId).get(deviceId);
      if (!dev) return { ok: false, error: "device_not_found" };
      dev.revoked = true;
      dev.online = false;
      pushLog(userId, {
        kind: "device_revoked",
        deviceId,
        label: dev.label,
        message: `Revoked "${dev.label}" — sync access removed`,
      });
      return { ok: true, result: { deviceId, revoked: true } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * set_auto_sync — [S] Per-device auto-sync toggle (was read-only).
   */
  registerLensAction("sync", "set_auto_sync", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const deviceId = String(p.deviceId || "");
      if (!deviceId) return { ok: false, error: "missing_deviceId" };
      const dev = userDevices(userId).get(deviceId);
      if (!dev || dev.revoked) return { ok: false, error: "device_not_found" };
      dev.autoSync = !!p.autoSync;
      pushLog(userId, {
        kind: "auto_sync_changed",
        deviceId,
        label: dev.label,
        message: `Auto-sync ${dev.autoSync ? "enabled" : "disabled"} for "${dev.label}"`,
      });
      return { ok: true, result: { deviceId, autoSync: dev.autoSync } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * set_scopes — [M] Selective sync: choose which DTU collections/scopes
   * a device pulls. Validated against ALL_SCOPES.
   */
  registerLensAction("sync", "set_scopes", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const deviceId = String(p.deviceId || "");
      if (!deviceId) return { ok: false, error: "missing_deviceId" };
      const dev = userDevices(userId).get(deviceId);
      if (!dev || dev.revoked) return { ok: false, error: "device_not_found" };
      const requested = Array.isArray(p.scopes) ? p.scopes : [];
      const scopes = requested.filter((s) => ALL_SCOPES.includes(s));
      if (scopes.length === 0) return { ok: false, error: "no_valid_scopes" };
      dev.scopes = scopes;
      pushLog(userId, {
        kind: "scopes_changed",
        deviceId,
        label: dev.label,
        message: `Selective sync for "${dev.label}": ${scopes.join(", ")}`,
      });
      return { ok: true, result: { deviceId, scopes, available: ALL_SCOPES } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * available_scopes — list the scope catalog for the selective-sync UI.
   */
  registerLensAction("sync", "available_scopes", (_ctx, _artifact, _params) => {
    return {
      ok: true,
      result: {
        scopes: [
          { id: "personal", label: "Personal DTUs", note: "Your private knowledge units" },
          { id: "public", label: "Published DTUs", note: "DTUs you've published" },
          { id: "artifacts", label: "Artifact bytes", note: "Binary attachments (images, audio, files)" },
          { id: "shared", label: "Shared with me", note: "DTUs others granted you access to" },
          { id: "drafts", label: "Drafts", note: "Unfinished / work-in-progress DTUs" },
        ],
      },
    };
  });

  /**
   * heartbeat — [S] Mark a device online (presence). A client calls this
   * on a short interval; presence is derived from lastSeenAt freshness.
   */
  registerLensAction("sync", "heartbeat", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const deviceId = String(p.deviceId || "");
      if (!deviceId) return { ok: false, error: "missing_deviceId" };
      const dev = userDevices(userId).get(deviceId);
      if (!dev || dev.revoked) return { ok: false, error: "device_not_found" };
      dev.lastSeenAt = Date.now();
      dev.online = true;
      return { ok: true, result: { deviceId, online: true, lastSeenAt: dev.lastSeenAt } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * sync_history — [M] Activity feed: what synced when, across all
   * devices. Optional `deviceId` filter, optional `limit`.
   */
  registerLensAction("sync", "sync_history", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const limit = Math.min(200, Math.max(1, Number(p.limit) || 50));
      let entries = userLogs(userId);
      if (p.deviceId) entries = entries.filter((e) => e.deviceId === p.deviceId);
      const sliced = entries.slice(0, limit);
      // timeline-shaped output for TimelineView
      const timeline = sliced.map((e) => ({
        id: e.id,
        at: e.at,
        title: e.message || e.kind,
        kind: e.kind,
        deviceId: e.deviceId || null,
        label: e.label || null,
      }));
      return {
        ok: true,
        result: { entries: sliced, timeline, total: entries.length },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * report_conflict — [M] Register a conflict: two devices edited the
   * same DTU. The caller supplies the dtuId and the two candidate
   * versions; the conflict is queued for resolution.
   */
  registerLensAction("sync", "report_conflict", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const dtuId = String(p.dtuId || "");
      if (!dtuId) return { ok: false, error: "missing_dtuId" };
      const conflicts = userConflicts(userId);
      const existing = conflicts.find((c) => c.dtuId === dtuId && c.status === "open");
      if (existing) return { ok: true, result: { conflict: existing, deduped: true } };
      const conflict = {
        id: nextId(userId, "cf"),
        dtuId,
        title: String(p.title || dtuId),
        status: "open",
        detectedAt: Date.now(),
        local: {
          deviceId: p.localDeviceId || null,
          deviceLabel: p.localDeviceLabel || "this device",
          editedAt: Number(p.localEditedAt) || Date.now(),
          summary: String(p.localSummary || "Local version"),
        },
        remote: {
          deviceId: p.remoteDeviceId || null,
          deviceLabel: p.remoteDeviceLabel || "other device",
          editedAt: Number(p.remoteEditedAt) || Date.now(),
          summary: String(p.remoteSummary || "Remote version"),
        },
        resolution: null,
      };
      conflicts.unshift(conflict);
      if (conflicts.length > 100) conflicts.length = 100;
      pushLog(userId, {
        kind: "conflict_detected",
        message: `Conflict on "${conflict.title}" — two devices edited it`,
      });
      return { ok: true, result: { conflict } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * list_conflicts — open + resolved conflicts for the resolution UI.
   */
  registerLensAction("sync", "list_conflicts", (ctx, _artifact, _params) => {
    try {
      const userId = actId(ctx);
      const conflicts = userConflicts(userId);
      return {
        ok: true,
        result: {
          conflicts,
          open: conflicts.filter((c) => c.status === "open").length,
          resolved: conflicts.filter((c) => c.status === "resolved").length,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * resolve_conflict — [M] Resolve a conflict by picking a winning
   * version. `choice` ∈ keep_local | keep_remote | keep_both.
   */
  registerLensAction("sync", "resolve_conflict", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const conflictId = String(p.conflictId || "");
      const choice = String(p.choice || "");
      const VALID = ["keep_local", "keep_remote", "keep_both"];
      if (!conflictId) return { ok: false, error: "missing_conflictId" };
      if (!VALID.includes(choice)) return { ok: false, error: "invalid_choice" };
      const conflict = userConflicts(userId).find((c) => c.id === conflictId);
      if (!conflict) return { ok: false, error: "conflict_not_found" };
      if (conflict.status === "resolved") {
        return { ok: false, error: "already_resolved" };
      }
      conflict.status = "resolved";
      conflict.resolution = { choice, resolvedAt: Date.now() };
      const choiceLabel = {
        keep_local: `kept ${conflict.local.deviceLabel} version`,
        keep_remote: `kept ${conflict.remote.deviceLabel} version`,
        keep_both: "kept both as a fork",
      }[choice];
      pushLog(userId, {
        kind: "conflict_resolved",
        message: `Resolved conflict on "${conflict.title}" — ${choiceLabel}`,
      });
      return { ok: true, result: { conflict } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * sync_status — [M] Aggregate status across all devices: how many are
   * online, last sync, total DTUs synced, open conflicts, total quota.
   */
  registerLensAction("sync", "sync_status", (ctx, _artifact, _params) => {
    try {
      const userId = actId(ctx);
      const now = Date.now();
      const devs = [...userDevices(userId).values()].filter((d) => !d.revoked);
      const online = devs.filter((d) => d.lastSeenAt && now - d.lastSeenAt < ONLINE_WINDOW_MS);
      const lastSync = devs.reduce((m, d) => Math.max(m, d.lastSyncAt || 0), 0);
      const usedBytes = devs.reduce((s, d) => s + (d.usedBytes || 0), 0);
      const quotaBytes = devs.reduce((s, d) => s + (d.quotaBytes || 0), 0);
      const openConflicts = userConflicts(userId).filter((c) => c.status === "open").length;
      const dtusSynced = devs.reduce((m, d) => Math.max(m, d.dtusSynced || 0), 0);
      return {
        ok: true,
        result: {
          deviceCount: devs.length,
          onlineCount: online.length,
          lastSyncAt: lastSync || null,
          dtusSynced,
          usedBytes,
          quotaBytes,
          quotaPct: quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0,
          openConflicts,
          state:
            openConflicts > 0
              ? "needs_attention"
              : devs.length === 0
                ? "no_devices"
                : online.length > 0
                  ? "synced"
                  : "all_offline",
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * set_quota — [S] Adjust a device's advisory storage quota (GB).
   */
  registerLensAction("sync", "set_quota", (ctx, artifact, params) => {
    try {
      const userId = actId(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const deviceId = String(p.deviceId || "");
      if (!deviceId) return { ok: false, error: "missing_deviceId" };
      const dev = userDevices(userId).get(deviceId);
      if (!dev || dev.revoked) return { ok: false, error: "device_not_found" };
      const gb = Number(p.quotaGb);
      if (!Number.isFinite(gb) || gb <= 0) return { ok: false, error: "invalid_quota" };
      dev.quotaBytes = Math.round(gb * 1024 * 1024 * 1024);
      pushLog(userId, {
        kind: "quota_changed",
        deviceId,
        label: dev.label,
        message: `Quota for "${dev.label}" set to ${gb} GB`,
      });
      return {
        ok: true,
        result: {
          deviceId,
          quotaBytes: dev.quotaBytes,
          quotaPct: Math.min(100, Math.round((dev.usedBytes / dev.quotaBytes) * 100)),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * syncthing_releases — real-data reference panel. Pulls the latest
   * Syncthing releases from GitHub (free, no key) so the lens can show
   * what the category leader is shipping.
   */
  registerLensAction("sync", "syncthing_releases", async (_ctx, _artifact, _params) => {
    try {
      const data = await cachedFetchJson(SYNCTHING_RELEASES, { ttlMs: 60 * 60 * 1000 });
      const releases = (Array.isArray(data) ? data : []).slice(0, 8).map((r) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        publishedAt: r.published_at,
        url: r.html_url,
        prerelease: !!r.prerelease,
        body: String(r.body || "").slice(0, 400),
      }));
      return { ok: true, result: { releases, source: "github:syncthing/syncthing" } };
    } catch (err) {
      return { ok: false, error: `syncthing releases unreachable: ${String(err?.message || err)}` };
    }
  });
}
