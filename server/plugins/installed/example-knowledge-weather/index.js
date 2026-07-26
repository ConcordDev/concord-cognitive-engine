/**
 * Example plugin: knowledge-weather-daily
 *
 * Publishes a periodic DTU summarizing "knowledge weather" — which DTU
 * kinds are most active right now (discovery.facets) and which DTUs are
 * trending by recent citation activity (discovery.trending) — as a single
 * readable digest. Demonstrates the REAL plugin surface documented in
 * docs/PLUGIN_AUTHORING_GUIDE.md §1-§2:
 *
 *   • macros export   — `weather.publish-daily` for ad-hoc invocation
 *   • tick            — runs every heartbeat while the plugin is loaded;
 *                        this plugin self-throttles to roughly once per
 *                        ONE_DAY_MS using ctx.store, since there is no
 *                        ctx.schedule primitive on the real ctx
 *   • ctx.store       — remembers the last-published timestamp so tick
 *                        doesn't republish every heartbeat. NOTE: on the
 *                        real (disk-scanned) sandboxed path, ctx.store is a
 *                        plain in-memory Map bridged from the worker
 *                        (server/lib/plugin-sandbox.js) — it does NOT
 *                        survive a plugin unload or a server restart, so
 *                        the first tick after a restart republishes even if
 *                        <24h have passed. That's an honest limitation of
 *                        the real ctx.store, not a bug in this example.
 *   • ctx.callMacro   — reaches `discovery.facets`, `discovery.trending`,
 *                        and `dtu.create`, all inside the default
 *                        non-emergent-gen macro grant
 *                        (["dtu.*","discovery.*","art.*","music.*",
 *                        "glyph-spells.*"] — server/plugins/loader.js
 *                        buildSandboxedContext's `grants` default)
 *
 * IMPORTANT — macro handler argument order: the loader calls a plugin's
 * macro handlers as `handler(ctx, input)`, ctx FIRST — see the literal
 * `value = await handler(ctx, msg.input)` in
 * server/lib/plugin-sandbox.js's WORKER_BOOTSTRAP_SRC (and the equivalent
 * `handler(_ctx, input)` in loader.js#activatePlugin's non-sandboxed path).
 * Every ctx method that crosses the worker boundary (getDTU, getDTUCount,
 * getEmergent, callMacro, store.get/set/has/delete/clear, getRateLimit)
 * returns a Promise there and must be awaited; only ctx.log is a
 * synchronous fire-and-forget call.
 *
 * What this fixes: an earlier draft of this file called
 * `ctx.schedule.every(...)`, `ctx.storage.get`/`.set`, a bare
 * `fetch("http://localhost:5050/api/intelligence/...")`, and
 * `ctx.createDTU(...)` — none of those exist on the real ctx built by
 * `buildSandboxedContext` (server/plugins/loader.js) / bridged by
 * `bridgeFromHostCtx` (server/lib/plugin-sandbox.js). There is also no
 * ambient `fetch`, `XMLHttpRequest`, or any other networking primitive
 * reachable from inside the sandbox at all (see plugin-sandbox.js's header:
 * the vm context only exposes `console` + the `ctx` bridge) — so the
 * original "call our own /api/intelligence/* endpoints over HTTP" idea is
 * dropped here rather than faked with a fake response. This version only
 * ever touches data reachable through the real, allowlisted
 * ctx.callMacro surface.
 *
 * Deploy: drop this file at
 * server/plugins/installed/example-knowledge-weather/index.js and restart
 * the server — `loadPluginsFromDisk` scans installed/ once at boot. There
 * is currently no HTTP route that re-triggers that scan at runtime (no
 * `/api/plugins/reload` exists).
 */

export const id = "example.knowledge-weather-daily";
export const name = "Knowledge Weather Daily Summary";
export const version = "1.0.0";
export const description =
  "Publishes a periodic DTU summarizing active DTU kinds and trending citations.";
export const author = "Concord";
export const license = "MIT";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function init(ctx) {
  ctx.log("info", "knowledge-weather-daily plugin initialized");
  return { ok: true };
}

export function destroy() {
  // Nothing to release: ctx.store is torn down by the loader on unload, and
  // there is no timer/handle owned by this plugin — tick (not
  // setInterval/setTimeout, which don't exist in the sandbox's vm scope
  // anyway) drives the periodic behavior.
}

export const macros = {
  // Manual trigger: POST /api/lens/run { domain: "weather", name: "publish-daily" }
  // Bypasses the tick throttle deliberately — a manual trigger should
  // always run, not silently no-op because ctx.store thinks it's too soon.
  "weather.publish-daily": async (ctx, _input) => publishDaily(ctx),
};

// Runs every heartbeat while the plugin is loaded (PLUGIN_TICK_TIMEOUT_MS =
// 2000ms budget in loader.js). Self-throttles to roughly once per
// ONE_DAY_MS via ctx.store — see the header note on why that throttle
// resets across restarts.
export async function tick(ctx) {
  const lastPublishedAt = (await ctx.store.get("lastPublishedAt")) ?? 0;
  if (Date.now() - lastPublishedAt < ONE_DAY_MS) return { ok: true, skipped: true };
  return publishDaily(ctx);
}

async function publishDaily(ctx) {
  const facetsResult = await ctx.callMacro("discovery", "facets", {});
  const trendingResult = await ctx.callMacro("discovery", "trending", { lookbackS: 86400, limit: 5 });

  const facets = facetsResult?.ok ? (facetsResult.facets || []) : [];
  const trending = trendingResult?.ok ? (trendingResult.trending || []) : [];

  if (!facetsResult?.ok) {
    ctx.log("warn", `discovery.facets unavailable: ${facetsResult?.error || "unknown"}`);
  }
  if (!trendingResult?.ok) {
    ctx.log("warn", `discovery.trending unavailable: ${trendingResult?.error || "unknown"}`);
  }

  const dtuCount = await ctx.getDTUCount();
  const date = new Date().toISOString().slice(0, 10);
  const body = formatBody(facets, trending, date, dtuCount);

  const result = await ctx.callMacro("dtu", "create", {
    title: `Knowledge Weather — ${date}`,
    body,
    domain: "intelligence",
    tags: ["knowledge_weather", "daily_summary", `date:${date}`],
  });

  if (result?.ok) {
    await ctx.store.set("lastPublishedAt", Date.now());
    const dtuId = result.result?.id || result.dtu?.id || "unknown";
    ctx.log("info", `published daily knowledge weather DTU ${dtuId}`);
  } else {
    ctx.log("error", `daily publish failed: ${result?.error || "unknown"}`);
  }
  return result;
}

function formatBody(facets, trending, date, totalDtus) {
  const facetLines = facets.slice(0, 6).map(
    (f) => `  • ${String(f.kind).padEnd(18)} ${String(f.n).padStart(6)} DTUs`,
  );
  const trendLines = trending.slice(0, 5).map(
    (t) => `  • ${String(t.title || t.id).slice(0, 40).padEnd(42)} ${t.citations} citation(s) in the last 24h`,
  );

  return [
    `Knowledge Weather Report — ${date}`,
    ``,
    `Total DTUs in the corpus: ${totalDtus}`,
    ``,
    `## Active fronts (top DTU kinds by volume)`,
    ...(facetLines.length ? facetLines : [`  (no facet data available)`]),
    ``,
    `## Trending (highest recent citation activity)`,
    ...(trendLines.length ? trendLines : [`  (no trending data available)`]),
    ``,
    `(autogenerated by example.knowledge-weather-daily plugin)`,
  ].join("\n");
}
