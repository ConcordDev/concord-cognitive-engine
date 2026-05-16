// server/domains/space.js
//
// Pure-compute orbital mechanics (orbit calc, delta-V budget, launch
// windows, reentry analysis) plus real free APIs:
//   • SpaceX r-spacex API: https://api.spacexdata.com/v4 — upcoming
//     launches, vehicles, launchpads. No API key.
//   • Launch Library 2 (TheSpaceDevs): https://ll.thespacedevs.com/2.2.0
//     — universal launch calendar across all providers. Free, no key,
//     rate-limited (~15 req/hour anonymous).

const SPACEX_BASE = "https://api.spacexdata.com/v4";
const LAUNCH_LIBRARY_BASE = "https://ll.thespacedevs.com/2.2.0";

export default function registerSpaceActions(registerLensAction) {
  registerLensAction("space", "orbitCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const altitude = parseFloat(data.altitudeKm) || 400; const radius = 6371 + altitude; const period = 2 * Math.PI * Math.sqrt(Math.pow(radius * 1000, 3) / (6.674e-11 * 5.972e24)) / 60; const velocity = Math.sqrt(6.674e-11 * 5.972e24 / (radius * 1000)) / 1000; return { ok: true, result: { altitudeKm: altitude, orbitalRadiusKm: radius, periodMinutes: Math.round(period * 10) / 10, velocityKmS: Math.round(velocity * 100) / 100, orbitsPerDay: Math.round(1440 / period * 10) / 10, type: altitude < 2000 ? "LEO" : altitude < 35786 ? "MEO" : "GEO", escapeVelocity: `${Math.round(Math.sqrt(2) * velocity * 100) / 100} km/s` } }; });
  registerLensAction("space", "deltaVBudget", (ctx, artifact, _params) => { const maneuvers = artifact.data?.maneuvers || []; if (maneuvers.length === 0) return { ok: true, result: { message: "Add maneuvers with delta-V requirements." } }; const total = maneuvers.reduce((s,m) => s + (parseFloat(m.deltaV) || 0), 0); const analyzed = maneuvers.map(m => ({ maneuver: m.name || m.description, deltaV: parseFloat(m.deltaV) || 0, percentage: total > 0 ? Math.round((parseFloat(m.deltaV) || 0) / total * 100) : 0 })); return { ok: true, result: { maneuvers: analyzed, totalDeltaV: Math.round(total * 10) / 10, unit: "km/s", feasibility: total < 10 ? "achievable-with-chemical" : total < 50 ? "requires-efficient-propulsion" : "requires-advanced-propulsion" } }; });
  registerLensAction("space", "launchWindow", (ctx, artifact, _params) => { const data = artifact.data || {}; const targetOrbit = (data.targetOrbit || "LEO").toUpperCase(); const latitude = parseFloat(data.launchLatitude) || 28.5; const inclination = parseFloat(data.inclination) || latitude; const windowsPerDay = targetOrbit === "GEO" ? 2 : targetOrbit === "LEO" ? Math.round(1440 / (2 * Math.PI * Math.sqrt(Math.pow(6771,3) / (6.674e-11 * 5.972e24)) / 60)) : 1; return { ok: true, result: { targetOrbit, launchLatitude: latitude, orbitalInclination: inclination, windowsPerDay, windowDuration: targetOrbit === "GEO" ? "~1 hour" : "5-10 minutes", nextWindowApprox: "Requires ephemeris data for precise calculation", inclinationPenalty: Math.abs(latitude - inclination) > 5 ? "Dogleg maneuver needed — additional fuel cost" : "Direct ascent possible" } }; });
  registerLensAction("space", "reentryAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const mass = parseFloat(data.massKg) || 1000; const velocity = parseFloat(data.velocityKmS) || 7.8; const angle = parseFloat(data.reentryAngleDeg) || 6; const kineticEnergy = 0.5 * mass * Math.pow(velocity * 1000, 2); const peakG = angle > 3 ? Math.round(angle * 1.5 * 10) / 10 : Math.round(angle * 3 * 10) / 10; const peakTemp = Math.round(1000 + velocity * 200); return { ok: true, result: { massKg: mass, entryVelocity: `${velocity} km/s`, entryAngle: `${angle}°`, kineticEnergyGJ: Math.round(kineticEnergy / 1e9 * 10) / 10, peakDeceleration: `${peakG}g`, peakTemperature: `~${peakTemp}°C`, heatShieldRequired: peakTemp > 1500 ? "ablative" : "ceramic-tile", survivability: angle >= 1 && angle <= 10 ? "nominal-corridor" : angle < 1 ? "skip-off — too shallow" : "structural-failure — too steep" } }; });

  /**
   * spacex-upcoming — Upcoming SpaceX launches from r-spacex API
   * (api.spacexdata.com/v4). Free, no API key.
   */
  registerLensAction("space", "spacex-upcoming", async (_ctx, _artifact, params = {}) => {
    const limit = Math.max(1, Math.min(20, Number(params.limit) || 5));
    try {
      const r = await fetch(`${SPACEX_BASE}/launches/upcoming`);
      if (!r.ok) throw new Error(`spacex ${r.status}`);
      const data = await r.json();
      const launches = (data || []).slice(0, limit).map((l) => ({
        id: l.id,
        name: l.name,
        flightNumber: l.flight_number,
        dateUtc: l.date_utc,
        dateUnix: l.date_unix,
        precision: l.date_precision,
        rocketId: l.rocket,
        launchpadId: l.launchpad,
        details: l.details,
        success: l.success,
        upcoming: l.upcoming,
        patch: l.links?.patch?.small,
        webcast: l.links?.webcast,
        article: l.links?.article,
        wikipedia: l.links?.wikipedia,
      }));
      return {
        ok: true,
        result: { launches, count: launches.length, source: "spacexdata-api" },
      };
    } catch (e) {
      return { ok: false, error: `spacex unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * launch-library-upcoming — Universal upcoming launches across all
   * launch providers (NASA, SpaceX, ULA, ESA, Roscosmos, ISRO, etc.)
   * via Launch Library 2. Free, no API key, rate-limited 15/hr.
   */
  registerLensAction("space", "launch-library-upcoming", async (_ctx, _artifact, params = {}) => {
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    try {
      const r = await fetch(`${LAUNCH_LIBRARY_BASE}/launch/upcoming/?limit=${limit}&mode=list`);
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "launch library rate limit exceeded — try again in an hour, or use LL2 API key" };
        throw new Error(`launch library ${r.status}`);
      }
      const data = await r.json();
      const launches = (data.results || []).map((l) => ({
        id: l.id,
        name: l.name,
        net: l.net,            // No Earlier Than (UTC)
        windowStart: l.window_start,
        windowEnd: l.window_end,
        status: l.status?.name,
        provider: l.launch_service_provider?.name,
        rocket: l.rocket?.configuration?.full_name,
        mission: l.mission?.name,
        missionDescription: l.mission?.description,
        missionType: l.mission?.type,
        orbit: l.mission?.orbit?.name,
        pad: l.pad?.name,
        location: l.pad?.location?.name,
        countryCode: l.pad?.country_code,
        webcastLive: l.webcast_live,
        image: l.image,
      }));
      return {
        ok: true,
        result: { launches, count: launches.length, totalAvailable: data.count, source: "thespacedevs-launch-library" },
      };
    } catch (e) {
      return { ok: false, error: `launch library unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
