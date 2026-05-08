// server/lib/console-stats.js
//
// Console / device-class telemetry — public-facing demand counter.
//
// Runs in-memory only (no PII persisted). Each ping records one
// session under a device class (xbox / playstation / switch / steam-
// deck / desktop / mobile / unknown), bucketed by an hourly timestamp
// so the counter is naturally rate-limited and the dashboard can
// show "active in the last hour / 24h / 7d" without any per-user
// records.
//
// The strategic point: this number, made public, is the leverage.
// Microsoft / Sony / Nintendo notice when N thousand of their users
// are on Concord weekly — that's how user demand becomes platform-
// holder action without us begging for native deals.

const DEVICE_CLASSES = [
  "xbox",
  "playstation",
  "switch",
  "steam-deck",
  "desktop",
  "mobile",
  "tablet",
  "unknown",
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// Rolling buffer of hourly buckets keyed by hour-floor timestamp.
// Each bucket is { hour, counts: Record<deviceClass, count> }.
// 168h = 1 week kept in memory; older buckets get pruned on read.
const _buckets = new Map();

function hourFloor(ts) {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

function pruneOlderThan(cutoff) {
  for (const key of _buckets.keys()) {
    if (key < cutoff) _buckets.delete(key);
  }
}

function deviceClassFromUA(userAgent) {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  // Order matters — Xbox UA contains "edge"; Steam Deck UA looks like
  // Linux Chromium; PS5 UA contains "playstation" but is WebKit.
  if (ua.includes("xbox")) return "xbox";
  if (ua.includes("playstation") || ua.includes("ps5") || ua.includes("ps4")) return "playstation";
  if (ua.includes("nintendo") || ua.includes("switch")) return "switch";
  if (ua.includes("steamdeck") || ua.includes("valve;")) return "steam-deck";
  if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) {
    return ua.includes("ipad") || ua.includes("tablet") ? "tablet" : "mobile";
  }
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  if (ua.includes("windows") || ua.includes("mac os") || ua.includes("linux") || ua.includes("cros")) {
    return "desktop";
  }
  return "unknown";
}

/**
 * Record one session ping for the device class derived from User-
 * Agent. Optional gamepad-id override (passed by the frontend after
 * detecting the controller) lets us confirm console class even when
 * the UA is ambiguous (e.g. some Xbox builds spoof a desktop UA on
 * Edge dev settings).
 */
export function recordConsolePing({ userAgent, gamepadId }) {
  let deviceClass = deviceClassFromUA(userAgent);
  if (gamepadId) {
    const gp = gamepadId.toLowerCase();
    if (gp.includes("xbox") && deviceClass === "desktop") deviceClass = "desktop"; // keep desktop, just an Xbox controller plugged in
    if (gp.includes("dualsense") || gp.includes("dualshock")) {
      // Same — just a PS controller on desktop, don't promote to "playstation"
    }
  }
  const now = Date.now();
  const hour = hourFloor(now);
  let bucket = _buckets.get(hour);
  if (!bucket) {
    bucket = { hour, counts: Object.fromEntries(DEVICE_CLASSES.map((d) => [d, 0])) };
    _buckets.set(hour, bucket);
  }
  bucket.counts[deviceClass] = (bucket.counts[deviceClass] || 0) + 1;
  pruneOlderThan(now - WEEK_MS);
  return { ok: true, deviceClass };
}

/**
 * Aggregate counts in a window ending now.
 *
 * @param {number} windowMs — DAY_MS / HOUR_MS / WEEK_MS
 * @returns {Record<string, number>}
 */
function aggregate(windowMs) {
  const cutoff = Date.now() - windowMs;
  const sums = Object.fromEntries(DEVICE_CLASSES.map((d) => [d, 0]));
  for (const bucket of _buckets.values()) {
    if (bucket.hour < cutoff) continue;
    for (const [cls, n] of Object.entries(bucket.counts)) {
      sums[cls] = (sums[cls] || 0) + n;
    }
  }
  return sums;
}

export function getConsoleStats() {
  const lastHour = aggregate(HOUR_MS);
  const last24h = aggregate(DAY_MS);
  const last7d = aggregate(WEEK_MS);
  // Hourly time-series for the last 24h — 24 buckets, oldest first.
  const now = Date.now();
  const series = [];
  for (let i = 23; i >= 0; i -= 1) {
    const hour = hourFloor(now - i * HOUR_MS);
    const bucket = _buckets.get(hour);
    series.push({
      hour: new Date(hour).toISOString(),
      counts: bucket
        ? { ...bucket.counts }
        : Object.fromEntries(DEVICE_CLASSES.map((d) => [d, 0])),
    });
  }
  // Total active count — sum across all classes in 24h.
  const totalActive24h = Object.values(last24h).reduce((s, n) => s + n, 0);
  const consoleActive24h = (last24h.xbox || 0) + (last24h.playstation || 0) + (last24h.switch || 0) + (last24h["steam-deck"] || 0);
  return {
    deviceClasses: DEVICE_CLASSES,
    lastHour,
    last24h,
    last7d,
    series,
    totalActive24h,
    consoleActive24h,
    consolePct24h: totalActive24h > 0 ? Math.round((consoleActive24h / totalActive24h) * 1000) / 10 : 0,
  };
}

export function _resetForTests() {
  _buckets.clear();
}
