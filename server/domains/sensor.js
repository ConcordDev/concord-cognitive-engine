// server/domains/sensor.js
//
// Sensor / IoT device-registry lens-action domain (id "sensor"). Backs the
// SensorDashboard panel with REAL per-user data: registered devices, recorded
// readings, deterministically-computed anomalies, and a dashboard summary.
//
// In-memory, STATE-backed (no migrations). Per-user scope via ctx.actor.userId.
// Empty by construction — no fabricated rows; a user sees nothing until they
// add a device and record readings.
//
// Macros: device-add, device-list, device-update, device-delete,
//         reading-record, anomaly-list, dashboard-summary.

export default function registerSensorActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function sensorStore() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    if (!STATE.sensorLens) STATE.sensorLens = {};
    const s = STATE.sensorLens;
    if (!(s.devices instanceof Map)) s.devices = new Map();   // userId -> Map<deviceId, Device>
    if (!(s.readings instanceof Map)) s.readings = new Map(); // userId -> Map<deviceId, Array<Reading>>
    return s;
  }
  function saveSensor() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  function userDevices(s, userId) {
    if (!s.devices.has(userId)) s.devices.set(userId, new Map());
    return s.devices.get(userId);
  }
  function userReadings(s, userId, deviceId) {
    if (!s.readings.has(userId)) s.readings.set(userId, new Map());
    const m = s.readings.get(userId);
    if (!m.has(deviceId)) m.set(deviceId, []);
    return m.get(deviceId);
  }

  const DEVICE_KINDS = [
    "environmental", "structural", "energy", "hydraulic", "acoustic", "gas", "other",
  ];
  // Default: flag any reading beyond mean ± K·stddev (when no per-device threshold set).
  const ANOMALY_K = 2;
  // Minimum samples before stddev-based detection is meaningful.
  const MIN_SAMPLES = 3;
  const ONLINE_STALE_MS = 60 * 60 * 1000; // a device with a reading in the last hour is "online"

  function normKind(k) {
    const v = String(k || "").trim().toLowerCase();
    return DEVICE_KINDS.includes(v) ? v : "other";
  }

  // ── device-add ───────────────────────────────────────────────────
  registerLensAction("sensor", "device-add", (ctx, _artifact, params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const p = params || {};
      const name = String(p.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const kindRaw = String(p.kind || p.type || "").trim();
      if (!kindRaw) return { ok: false, error: "kind required" };
      const location = String(p.location || "").trim();
      if (!location) return { ok: false, error: "location required" };
      const devices = userDevices(s, userId);
      const threshold = p.threshold && typeof p.threshold === "object"
        ? {
            min: Number.isFinite(Number(p.threshold.min)) ? Number(p.threshold.min) : null,
            max: Number.isFinite(Number(p.threshold.max)) ? Number(p.threshold.max) : null,
          }
        : null;
      const device = {
        id: sid("dev"),
        name,
        kind: normKind(kindRaw),
        location,
        unit: String(p.unit || ""),
        linkedDtu: p.linkedDtu ? String(p.linkedDtu) : null,
        threshold,
        status: "registered",
        readingCount: 0,
        lastReadingAt: null,
        lastValue: null,
        createdAt: new Date().toISOString(),
      };
      devices.set(device.id, device);
      saveSensor();
      return { ok: true, result: { device } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── device-list (per-user) ───────────────────────────────────────
  registerLensAction("sensor", "device-list", (ctx, _artifact, params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const p = params || {};
      const now = Date.now();
      let list = [...userDevices(s, userId).values()].map((d) => {
        const last = d.lastReadingAt ? new Date(d.lastReadingAt).getTime() : 0;
        const fresh = last > 0 && now - last <= ONLINE_STALE_MS;
        // anomaly count over this device's readings
        const anomalies = detectAnomalies(d, userReadings(s, userId, d.id));
        const status = !d.lastReadingAt ? "offline" : (anomalies.length > 0 ? "warning" : fresh ? "online" : "offline");
        return { ...d, status, anomalyCount: anomalies.length };
      });
      if (p.kind) list = list.filter((d) => d.kind === normKind(p.kind));
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return { ok: true, result: { devices: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── device-update ────────────────────────────────────────────────
  registerLensAction("sensor", "device-update", (ctx, _artifact, params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const p = params || {};
      const device = userDevices(s, userId).get(String(p.id || ""));
      if (!device) return { ok: false, error: "device not found" };
      if (p.name !== undefined) {
        const name = String(p.name).trim();
        if (!name) return { ok: false, error: "name cannot be empty" };
        device.name = name;
      }
      if (p.kind !== undefined) device.kind = normKind(p.kind);
      if (p.location !== undefined) device.location = String(p.location);
      if (p.unit !== undefined) device.unit = String(p.unit);
      if (p.linkedDtu !== undefined) device.linkedDtu = p.linkedDtu ? String(p.linkedDtu) : null;
      if (p.threshold !== undefined) {
        device.threshold = p.threshold && typeof p.threshold === "object"
          ? {
              min: Number.isFinite(Number(p.threshold.min)) ? Number(p.threshold.min) : null,
              max: Number.isFinite(Number(p.threshold.max)) ? Number(p.threshold.max) : null,
            }
          : null;
      }
      device.updatedAt = new Date().toISOString();
      saveSensor();
      return { ok: true, result: { device } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── device-delete (round-trip + not-found reject) ────────────────
  registerLensAction("sensor", "device-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const id = String((params || {}).id || "");
      const devices = userDevices(s, userId);
      if (!devices.has(id)) return { ok: false, error: "device not found" };
      devices.delete(id);
      const rmap = s.readings.get(userId);
      if (rmap) rmap.delete(id);
      saveSensor();
      return { ok: true, result: { deleted: true, id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── reading-record (numeric value + ts) ──────────────────────────
  registerLensAction("sensor", "reading-record", (ctx, _artifact, params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const p = params || {};
      const device = userDevices(s, userId).get(String(p.deviceId || ""));
      if (!device) return { ok: false, error: "device not found" };
      const value = Number(p.value);
      if (!Number.isFinite(value)) return { ok: false, error: "numeric value required" };
      const at = p.at ? new Date(p.at) : new Date();
      if (Number.isNaN(at.getTime())) return { ok: false, error: "invalid timestamp" };
      const reading = {
        id: sid("rd"),
        deviceId: device.id,
        value,
        at: at.toISOString(),
        ts: at.getTime(),
      };
      const list = userReadings(s, userId, device.id);
      list.push(reading);
      // Keep an upper bound so the in-memory store doesn't grow unbounded.
      if (list.length > 500) list.splice(0, list.length - 500);
      device.readingCount = list.length;
      device.lastReadingAt = reading.at;
      device.lastValue = value;
      device.status = "online";
      saveSensor();
      // Was this reading itself anomalous? (computed against the full series)
      const anomalies = detectAnomalies(device, list);
      const isAnomaly = anomalies.some((a) => a.readingId === reading.id);
      return { ok: true, result: { reading, readingCount: list.length, isAnomaly } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── anomaly detection (deterministic) ────────────────────────────
  // A reading is anomalous if:
  //   - it falls outside an explicit per-device threshold [min, max], OR
  //   - (when no threshold) it lies beyond mean ± K·stddev of the series
  //     (requires >= MIN_SAMPLES and stddev > 0).
  function detectAnomalies(device, readings) {
    const out = [];
    if (!Array.isArray(readings) || readings.length === 0) return out;
    const t = device.threshold;
    const hasThreshold = t && (t.min != null || t.max != null);
    if (hasThreshold) {
      for (const r of readings) {
        let reason = null;
        if (t.min != null && r.value < t.min) reason = `below threshold (${r.value} < ${t.min})`;
        else if (t.max != null && r.value > t.max) reason = `above threshold (${r.value} > ${t.max})`;
        if (reason) {
          out.push({
            readingId: r.id, deviceId: device.id, value: r.value, at: r.at,
            severity: "critical", reason,
          });
        }
      }
      return out;
    }
    if (readings.length < MIN_SAMPLES) return out;
    const vals = readings.map((r) => r.value);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
    const stddev = Math.sqrt(variance);
    if (stddev <= 0) return out;
    const lo = mean - ANOMALY_K * stddev;
    const hi = mean + ANOMALY_K * stddev;
    for (const r of readings) {
      if (r.value < lo || r.value > hi) {
        const z = (r.value - mean) / stddev;
        out.push({
          readingId: r.id, deviceId: device.id, value: r.value, at: r.at,
          severity: Math.abs(z) >= 3 ? "critical" : "warning",
          z: Math.round(z * 100) / 100,
          reason: `${r.value} is ${Math.round(Math.abs(z) * 100) / 100}σ from mean ${Math.round(mean * 100) / 100}`,
        });
      }
    }
    return out;
  }

  // ── anomaly-list ─────────────────────────────────────────────────
  registerLensAction("sensor", "anomaly-list", (ctx, _artifact, params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const p = params || {};
      const devices = userDevices(s, userId);
      const wanted = p.deviceId ? String(p.deviceId) : null;
      const anomalies = [];
      for (const device of devices.values()) {
        if (wanted && device.id !== wanted) continue;
        const found = detectAnomalies(device, userReadings(s, userId, device.id));
        for (const a of found) anomalies.push({ ...a, deviceName: device.name });
      }
      anomalies.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const counts = { critical: 0, warning: 0 };
      for (const a of anomalies) counts[a.severity] = (counts[a.severity] || 0) + 1;
      return { ok: true, result: { anomalies, count: anomalies.length, counts } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── dashboard-summary ────────────────────────────────────────────
  registerLensAction("sensor", "dashboard-summary", (ctx, _artifact, _params = {}) => {
    try {
      const s = sensorStore();
      const userId = aid(ctx);
      const devices = [...userDevices(s, userId).values()];
      const now = Date.now();
      let onlineCount = 0;
      let anomalyCount = 0;
      const byKind = {};
      for (const device of devices) {
        const last = device.lastReadingAt ? new Date(device.lastReadingAt).getTime() : 0;
        const fresh = last > 0 && now - last <= ONLINE_STALE_MS;
        const anomalies = detectAnomalies(device, userReadings(s, userId, device.id));
        if (fresh && anomalies.length === 0) onlineCount++;
        anomalyCount += anomalies.length;
        byKind[device.kind] = (byKind[device.kind] || 0) + 1;
      }
      return {
        ok: true,
        result: {
          deviceCount: devices.length,
          onlineCount,
          offlineCount: devices.length - onlineCount,
          anomalyCount,
          byKind,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
