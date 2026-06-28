// server/domains/atlas.js
// Domain actions for atlas: geocoding, distance matrices, region
// stats, route optimization, plus real OpenStreetMap Nominatim
// (geocoding, free no key, 1 req/sec courtesy limit) + Overpass API
// (OSM feature search, free no key) + Wikidata SPARQL for population.

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OVERPASS_BASE = "https://overpass-api.de/api";

function osmUserAgent() {
  const contact = process.env.OSM_CONTACT || "https://concord-os.org";
  return `Concord-OS/1.0 (${contact})`;
}

export default function registerAtlasActions(registerLensAction) {
  /**
   * geocode
   * Resolve place names to coordinates with distance calculations.
   * artifact.data.places: [{ name, lat?, lon? }]
   * If coordinates are missing, attempts lookup from a built-in reference set.
   * Optionally computes distance from artifact.data.origin: { lat, lon }.
   */
  registerLensAction("atlas", "geocode", (ctx, artifact, _params) => {
  try {
    const places = artifact.data?.places || [];
    if (places.length === 0) {
      return { ok: true, result: { message: "No places provided. Supply artifact.data.places as [{ name, lat?, lon? }]. Optionally set artifact.data.origin for distance calculations.", resolved: [], count: 0 } };
    }

    // Built-in reference coordinates for common cities
    const reference = {
      "new york": { lat: 40.7128, lon: -74.006 },
      "london": { lat: 51.5074, lon: -0.1278 },
      "paris": { lat: 48.8566, lon: 2.3522 },
      "tokyo": { lat: 35.6762, lon: 139.6503 },
      "sydney": { lat: -33.8688, lon: 151.2093 },
      "los angeles": { lat: 34.0522, lon: -118.2437 },
      "chicago": { lat: 41.8781, lon: -87.6298 },
      "berlin": { lat: 52.52, lon: 13.405 },
      "moscow": { lat: 55.7558, lon: 37.6173 },
      "beijing": { lat: 39.9042, lon: 116.4074 },
      "mumbai": { lat: 19.076, lon: 72.8777 },
      "cairo": { lat: 30.0444, lon: 31.2357 },
      "rio de janeiro": { lat: -22.9068, lon: -43.1729 },
      "toronto": { lat: 43.6532, lon: -79.3832 },
      "dubai": { lat: 25.2048, lon: 55.2708 },
      "singapore": { lat: 1.3521, lon: 103.8198 },
      "san francisco": { lat: 37.7749, lon: -122.4194 },
      "seattle": { lat: 47.6062, lon: -122.3321 },
      "miami": { lat: 25.7617, lon: -80.1918 },
      "rome": { lat: 41.9028, lon: 12.4964 },
    };

    // Haversine distance in km
    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c * 100) / 100;
    }

    // Bearing calculation
    function bearing(lat1, lon1, lat2, lon2) {
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
      const x =
        Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
        Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon);
      const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      return Math.round(brng * 100) / 100;
    }

    function bearingToCardinal(deg) {
      const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
      return dirs[Math.round(deg / 22.5) % 16];
    }

    const origin = artifact.data?.origin || null;
    let resolvedCount = 0;
    let unresolvedCount = 0;

    const resolved = places.map((place) => {
      const name = (place.name || "").trim();
      const nameLower = name.toLowerCase();
      let lat = parseFloat(place.lat);
      let lon = parseFloat(place.lon);
      let source = "provided";

      // Treat non-finite/out-of-envelope provided coords as "missing" so a
      // poisoned Infinity/1e308 never leaks into distance math (fail-CLOSED).
      const provided = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
      if (!provided) {
        const ref = reference[nameLower];
        if (ref) {
          lat = ref.lat;
          lon = ref.lon;
          source = "reference";
          resolvedCount++;
        } else {
          unresolvedCount++;
          return { name, resolved: false, message: `Could not resolve "${name}". Provide lat/lon or use a known city name.` };
        }
      } else {
        resolvedCount++;
      }

      // Determine hemisphere and timezone estimate
      const hemisphere = lat >= 0 ? "Northern" : "Southern";
      const timezoneEstimate = Math.round(lon / 15);

      const entry = {
        name,
        lat,
        lon,
        resolved: true,
        source,
        hemisphere,
        estimatedUTCOffset: timezoneEstimate,
      };

      if (origin && !isNaN(parseFloat(origin.lat)) && !isNaN(parseFloat(origin.lon))) {
        entry.distanceFromOriginKm = haversine(origin.lat, origin.lon, lat, lon);
        entry.bearingFromOrigin = bearing(origin.lat, origin.lon, lat, lon);
        entry.directionFromOrigin = bearingToCardinal(entry.bearingFromOrigin);
      }

      return entry;
    });

    // Sort by distance from origin if available
    const sorted = origin
      ? [...resolved].filter((r) => r.resolved).sort((a, b) => (a.distanceFromOriginKm || 0) - (b.distanceFromOriginKm || 0))
      : null;

    const result = {
      count: places.length,
      resolvedCount,
      unresolvedCount,
      resolved,
      nearestToOrigin: sorted && sorted.length > 0 ? sorted[0].name : null,
      farthestFromOrigin: sorted && sorted.length > 0 ? sorted[sorted.length - 1].name : null,
    };

    artifact.data.geocodeResult = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * distanceMatrix
   * Compute distances between multiple coordinate points using the Haversine formula.
   * artifact.data.points: [{ name?, lat, lon }]
   * Returns a full NxN distance matrix in km.
   */
  registerLensAction("atlas", "distanceMatrix", (ctx, artifact, _params) => {
  try {
    const points = artifact.data?.points || [];
    if (points.length < 2) {
      return { ok: true, result: { message: "Need at least 2 points. Supply artifact.data.points as [{ name?, lat, lon }].", matrix: [], stats: null } };
    }

    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c * 100) / 100;
    }

    const n = points.length;
    const labels = points.map((p, i) => p.name || `Point_${i}`);
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    // Accept lon OR lng (different panels send each) — coerce once.
    const latOf = (p) => parseFloat(p.lat) || 0;
    const lonOf = (p) => parseFloat(p.lon ?? p.lng) || 0;
    // Fail-CLOSED: a non-finite or out-of-envelope coordinate is REJECTED so
    // Infinity/NaN can never leak into the matrix as a serialized null.
    for (const p of points) {
      const la = parseFloat(p.lat), lo = parseFloat(p.lon ?? p.lng);
      if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
        return { ok: false, error: "each point needs a finite lat (-90..90) + lon/lng (-180..180)" };
      }
    }

    let totalDist = 0;
    let pairCount = 0;
    let maxDist = 0;
    let minDist = Infinity;
    let maxPair = null;
    let minPair = null;
    // Flat pair list (from/to/distanceKm) for the bespoke AtlasActionPanel.
    const pairs = [];
    let nearest = null;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const lat1 = latOf(points[i]);
        const lon1 = lonOf(points[i]);
        const lat2 = latOf(points[j]);
        const lon2 = lonOf(points[j]);
        const dist = haversine(lat1, lon1, lat2, lon2);
        matrix[i][j] = dist;
        matrix[j][i] = dist;
        totalDist += dist;
        pairCount++;
        // ~50 km/h overland estimate for a rough drive-time readout.
        const estTimeMinutes = Math.round((dist / 50) * 60);
        pairs.push({ from: labels[i], to: labels[j], distanceKm: dist, estTimeMinutes });

        if (dist > maxDist) {
          maxDist = dist;
          maxPair = [labels[i], labels[j]];
        }
        if (dist < minDist) {
          minDist = dist;
          minPair = [labels[i], labels[j]];
          nearest = { from: labels[i], to: labels[j], distanceKm: dist };
        }
      }
    }

    const avgDist = pairCount > 0 ? Math.round((totalDist / pairCount) * 100) / 100 : 0;

    // Compute centroid
    const avgLat = points.reduce((s, p) => s + latOf(p), 0) / n;
    const avgLon = points.reduce((s, p) => s + lonOf(p), 0) / n;

    // Spread: average distance from centroid
    const centroidDistances = points.map((p) => {
      return haversine(avgLat, avgLon, latOf(p), lonOf(p));
    });
    const avgSpread = Math.round((centroidDistances.reduce((s, d) => s + d, 0) / n) * 100) / 100;

    const result = {
      pointCount: n,
      labels,
      matrix,
      // Flat pair list + nearest — the bespoke AtlasActionPanel renders these.
      pairs,
      nearest,
      stats: {
        averageDistanceKm: avgDist,
        maxDistanceKm: maxDist,
        maxDistancePair: maxPair,
        minDistanceKm: minDist === Infinity ? 0 : minDist,
        minDistancePair: minPair,
        totalPairs: pairCount,
        centroid: { lat: Math.round(avgLat * 10000) / 10000, lon: Math.round(avgLon * 10000) / 10000 },
        averageSpreadKm: avgSpread,
        clusterTightness: avgSpread < 100 ? "tight" : avgSpread < 500 ? "moderate" : avgSpread < 2000 ? "spread" : "dispersed",
        // Aliases the DistanceMatrixPanel renders (meanKm/maxKm/minKm/maxPair/minPair).
        meanKm: avgDist,
        maxKm: maxDist,
        minKm: minDist === Infinity ? 0 : minDist,
        maxPair,
        minPair,
      },
    };

    artifact.data.distanceMatrix = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * regionStats
   * Aggregate demographic/economic stats for regions.
   * artifact.data.regions: [{ name, population?, area?, gdp?, density?, growth?, subregions?: [...] }]
   * Calculates totals, averages, rankings, and normalized comparisons.
   */
  registerLensAction("atlas", "regionStats", (ctx, artifact, _params) => {
  try {
    const regions = artifact.data?.regions || [];
    if (regions.length === 0) {
      return { ok: true, result: { message: "No region data provided. Supply artifact.data.regions as [{ name, population, area, gdp, density, growth }].", summary: null, rankings: null } };
    }

    // Fail-CLOSED: a non-finite numeric (Infinity/NaN/1e308) in any metric is
    // rejected so it can never leak into totals/gini.
    for (const r of regions) {
      for (const k of ["population", "area", "gdp", "density", "growth"]) {
        if (r[k] !== undefined && r[k] !== null && r[k] !== "" && !Number.isFinite(parseFloat(r[k]))) {
          return { ok: false, error: `region "${r.name || "Unknown"}" has a non-finite ${k}` };
        }
      }
    }

    const parsed = regions.map((r) => ({
      name: r.name || "Unknown",
      population: parseFloat(r.population) || 0,
      area: parseFloat(r.area) || 0,
      gdp: parseFloat(r.gdp) || 0,
      density: parseFloat(r.density) || (parseFloat(r.population) && parseFloat(r.area) ? parseFloat(r.population) / parseFloat(r.area) : 0),
      growth: parseFloat(r.growth) || 0,
      subregionCount: Array.isArray(r.subregions) ? r.subregions.length : 0,
    }));

    // Totals
    const totalPop = parsed.reduce((s, r) => s + r.population, 0);
    const totalArea = parsed.reduce((s, r) => s + r.area, 0);
    const totalGdp = parsed.reduce((s, r) => s + r.gdp, 0);

    // Weighted averages
    const weightedDensity = totalArea > 0 ? Math.round((totalPop / totalArea) * 100) / 100 : 0;
    const weightedGrowth = totalPop > 0
      ? Math.round((parsed.reduce((s, r) => s + r.growth * r.population, 0) / totalPop) * 10000) / 10000
      : 0;

    // Per-capita GDP
    const perCapita = parsed.map((r) => ({
      name: r.name,
      gdpPerCapita: r.population > 0 ? Math.round((r.gdp / r.population) * 100) / 100 : 0,
    }));

    // Rankings by each metric
    const rankBy = (field) => {
      return [...parsed]
        .sort((a, b) => b[field] - a[field])
        .map((r, i) => ({ rank: i + 1, name: r.name, value: r[field] }));
    };

    // Standard deviation of population for distribution analysis
    const meanPop = totalPop / parsed.length;
    const popVariance = parsed.reduce((s, r) => s + Math.pow(r.population - meanPop, 2), 0) / parsed.length;
    const popStdDev = Math.round(Math.sqrt(popVariance) * 100) / 100;

    // Gini-like concentration index for population distribution
    const sortedPops = parsed.map((r) => r.population).sort((a, b) => a - b);
    let giniNum = 0;
    const n = sortedPops.length;
    for (let i = 0; i < n; i++) {
      giniNum += (2 * (i + 1) - n - 1) * sortedPops[i];
    }
    const giniCoefficient = totalPop > 0 && n > 1
      ? Math.round((giniNum / (n * totalPop)) * 10000) / 10000
      : 0;

    // Categorize regions by development proxy (GDP per capita)
    const categorized = perCapita.map((r) => ({
      name: r.name,
      gdpPerCapita: r.gdpPerCapita,
      tier: r.gdpPerCapita > 40000 ? "high-income" : r.gdpPerCapita > 12000 ? "upper-middle" : r.gdpPerCapita > 4000 ? "lower-middle" : "low-income",
    }));

    const result = {
      regionCount: parsed.length,
      totals: {
        population: totalPop,
        area: Math.round(totalArea * 100) / 100,
        gdp: Math.round(totalGdp * 100) / 100,
      },
      averages: {
        population: Math.round(meanPop * 100) / 100,
        density: weightedDensity,
        gdpPerCapita: totalPop > 0 ? Math.round((totalGdp / totalPop) * 100) / 100 : 0,
        growthRate: weightedGrowth,
      },
      distribution: {
        populationStdDev: popStdDev,
        populationGini: giniCoefficient,
        concentration: giniCoefficient > 0.5 ? "highly-concentrated" : giniCoefficient > 0.3 ? "moderately-concentrated" : "evenly-distributed",
      },
      rankings: {
        byPopulation: rankBy("population"),
        byGdp: rankBy("gdp"),
        byDensity: rankBy("density"),
        byGrowth: rankBy("growth"),
      },
      perCapita: perCapita.sort((a, b) => b.gdpPerCapita - a.gdpPerCapita),
      incomeTiers: categorized,
    };

    artifact.data.regionStats = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * routeOptimize
   * Find optimal order for visiting multiple waypoints by nearest-neighbor TSP.
   * artifact.data.waypoints: [{ name?, lat, lon }]
   * artifact.data.startIndex: number (optional, default 0)
   * Returns optimized route order with total distance.
   */
  registerLensAction("atlas", "routeOptimize", (ctx, artifact, _params) => {
  try {
    const waypoints = artifact.data?.waypoints || [];
    if (waypoints.length < 2) {
      return { ok: true, result: { message: "Need at least 2 waypoints. Supply artifact.data.waypoints as [{ name?, lat, lon }].", route: [], totalDistanceKm: 0 } };
    }

    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c * 100) / 100;
    }

    // Fail-CLOSED: reject non-finite / out-of-envelope coordinates before the
    // TSP loop so Infinity/NaN can never leak into route legs.
    for (const w of waypoints) {
      const la = parseFloat(w.lat), lo = parseFloat(w.lon ?? w.lng);
      if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
        return { ok: false, error: "each waypoint needs a finite lat (-90..90) + lon/lng (-180..180)" };
      }
    }

    const n = waypoints.length;
    const labels = waypoints.map((w, i) => w.name || `Waypoint_${i}`);
    const coords = waypoints.map((w) => ({
      lat: parseFloat(w.lat) || 0,
      lon: parseFloat(w.lon ?? w.lng) || 0,
    }));

    // Pre-compute distance matrix
    const dist = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = haversine(coords[i].lat, coords[i].lon, coords[j].lat, coords[j].lon);
        dist[i][j] = d;
        dist[j][i] = d;
      }
    }

    // Compute naive (input order) total distance for comparison
    let naiveTotal = 0;
    for (let i = 0; i < n - 1; i++) {
      naiveTotal += dist[i][i + 1];
    }
    naiveTotal = Math.round(naiveTotal * 100) / 100;

    // Nearest-neighbor heuristic from multiple starting points, pick best
    let bestRoute = null;
    let bestTotal = Infinity;

    for (let startIdx = 0; startIdx < n; startIdx++) {
      const visited = new Set();
      const route = [startIdx];
      visited.add(startIdx);
      let total = 0;

      let current = startIdx;
      while (visited.size < n) {
        let nearest = -1;
        let nearestDist = Infinity;
        for (let j = 0; j < n; j++) {
          if (!visited.has(j) && dist[current][j] < nearestDist) {
            nearestDist = dist[current][j];
            nearest = j;
          }
        }
        if (nearest === -1) break;
        route.push(nearest);
        visited.add(nearest);
        total += nearestDist;
        current = nearest;
      }

      total = Math.round(total * 100) / 100;
      if (total < bestTotal) {
        bestTotal = total;
        bestRoute = route;
      }
    }

    // 2-opt improvement on the best route
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 1; i < bestRoute.length - 1; i++) {
        for (let j = i + 1; j < bestRoute.length; j++) {
          const segBefore =
            dist[bestRoute[i - 1]][bestRoute[i]] +
            (j + 1 < bestRoute.length ? dist[bestRoute[j]][bestRoute[j + 1]] : 0);
          const segAfter =
            dist[bestRoute[i - 1]][bestRoute[j]] +
            (j + 1 < bestRoute.length ? dist[bestRoute[i]][bestRoute[j + 1]] : 0);
          if (segAfter < segBefore - 0.01) {
            // Reverse the segment between i and j
            const reversed = bestRoute.slice(i, j + 1).reverse();
            for (let k = 0; k < reversed.length; k++) {
              bestRoute[i + k] = reversed[k];
            }
            improved = true;
          }
        }
      }
    }

    // Recalculate total after 2-opt
    bestTotal = 0;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      bestTotal += dist[bestRoute[i]][bestRoute[i + 1]];
    }
    bestTotal = Math.round(bestTotal * 100) / 100;

    // Build route details with leg info
    const routeDetails = bestRoute.map((idx, step) => {
      const entry = {
        step: step + 1,
        name: labels[idx],
        lat: coords[idx].lat,
        lon: coords[idx].lon,
      };
      if (step > 0) {
        const prevIdx = bestRoute[step - 1];
        entry.legDistanceKm = dist[prevIdx][idx];
        entry.cumulativeDistanceKm = Math.round(
          bestRoute.slice(0, step + 1).reduce((s, ci, si) => {
            if (si === 0) return 0;
            return s + dist[bestRoute[si - 1]][ci];
          }, 0) * 100
        ) / 100;
      } else {
        entry.legDistanceKm = 0;
        entry.cumulativeDistanceKm = 0;
      }
      return entry;
    });

    const savings = naiveTotal > 0 ? Math.round(((naiveTotal - bestTotal) / naiveTotal) * 10000) / 100 : 0;

    // Component-canonical aliases (DistanceMatrixPanel + MapsDirections render
    // these): ordered place-name list, the integer visit order, and per-hop
    // legs as { from, to, km }. All derived from the optimized route — no
    // fabricated values.
    const routeNames = routeDetails.map((r) => r.name);
    const order = [...bestRoute];
    const legs = [];
    for (let step = 1; step < routeDetails.length; step++) {
      legs.push({ from: routeDetails[step - 1].name, to: routeDetails[step].name, km: routeDetails[step].legDistanceKm });
    }

    const result = {
      waypointCount: n,
      optimizedRoute: routeDetails,
      route: routeNames,
      order,
      legs,
      totalDistanceKm: bestTotal,
      naiveOrderDistanceKm: naiveTotal,
      savingsPercent: savings,
      algorithm: "nearest-neighbor + 2-opt improvement",
    };

    artifact.data.routeOptimization = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * nominatim-geocode — Real OSM Nominatim forward geocoding.
   * Free, no API key. Wikimedia UA policy applies — set OSM_CONTACT env.
   *
   * params: { query: string, limit?: 1-10 }
   */
  registerLensAction("atlas", "nominatim-geocode", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required (free-form address or place name)" };
    const limit = Math.max(1, Math.min(10, Number(params.limit) || 5));
    try {
      const r = await fetch(`${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=${limit}&addressdetails=1`, {
        headers: { "User-Agent": osmUserAgent(), Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`nominatim ${r.status}`);
      const data = await r.json();
      const places = (Array.isArray(data) ? data : []).map((p) => ({
        osmType: p.osm_type,
        osmId: p.osm_id,
        placeId: p.place_id,
        displayName: p.display_name,
        latitude: parseFloat(p.lat),
        longitude: parseFloat(p.lon),
        category: p.category,
        type: p.type,
        addressType: p.addresstype,
        importance: p.importance,
        boundingBox: p.boundingbox ? p.boundingbox.map(Number) : null,
        address: p.address,
      }));
      return {
        ok: true,
        result: { query, places, count: places.length, source: "openstreetmap-nominatim" },
      };
    } catch (e) {
      return { ok: false, error: `nominatim unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * nominatim-reverse — Reverse geocode lat/lng → address.
   */
  registerLensAction("atlas", "nominatim-reverse", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.latitude);
    const lng = Number(params.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "latitude + longitude required" };
    try {
      const r = await fetch(`${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1`, {
        headers: { "User-Agent": osmUserAgent(), Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`nominatim ${r.status}`);
      const p = await r.json();
      if (p.error) return { ok: false, error: `nominatim: ${p.error}` };
      return {
        ok: true,
        result: {
          latitude: lat, longitude: lng,
          displayName: p.display_name,
          osmType: p.osm_type, osmId: p.osm_id,
          address: p.address,
          addressType: p.addresstype,
          source: "openstreetmap-nominatim",
        },
      };
    } catch (e) {
      return { ok: false, error: `nominatim unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * overpass-poi — Overpass API search for OSM features (POIs) within
   * a bounding box. Free, no API key.
   *
   * params: { south, west, north, east — bbox in WGS84, amenity?: "restaurant"|"hospital"|... }
   */
  registerLensAction("atlas", "overpass-poi", async (_ctx, _artifact, params = {}) => {
    const south = Number(params.south);
    const west = Number(params.west);
    const north = Number(params.north);
    const east = Number(params.east);
    if (![south, west, north, east].every(Number.isFinite)) {
      return { ok: false, error: "south/west/north/east required (bbox in WGS84 degrees)" };
    }
    if (south >= north || west >= east) return { ok: false, error: "bbox invalid (south < north, west < east)" };
    const amenity = params.amenity ? String(params.amenity).trim() : null;
    const filter = amenity ? `["amenity"="${amenity}"]` : `["amenity"]`;
    const query = `[out:json][timeout:25];(node${filter}(${south},${west},${north},${east}););out tags center 100;`;
    try {
      const r = await fetch(`${OVERPASS_BASE}/interpreter`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": osmUserAgent() },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "overpass rate limit exceeded — try again later" };
        throw new Error(`overpass ${r.status}`);
      }
      const data = await r.json();
      const elements = (data.elements || []).map((el) => ({
        type: el.type,
        id: el.id,
        latitude: el.lat,
        longitude: el.lon,
        tags: el.tags,
        name: el.tags?.name,
        amenity: el.tags?.amenity,
        cuisine: el.tags?.cuisine,
        opening_hours: el.tags?.opening_hours,
        phone: el.tags?.phone,
        website: el.tags?.website,
      }));
      return {
        ok: true,
        result: {
          bbox: { south, west, north, east },
          amenity, elements, count: elements.length,
          source: "openstreetmap-overpass",
        },
      };
    } catch (e) {
      return { ok: false, error: `overpass unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  Google Maps + Felt 2026 parity — saved places, Lists, multi-stop
  //  trips, real OSRM directions, recent searches, AI trip planner.
  // ═══════════════════════════════════════════════════════════════

  function getAtlasState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.atlasLens) {
      STATE.atlasLens = {
        places: new Map(),         // userId -> Array<Place>
        lists: new Map(),          // userId -> Array<List>
        trips: new Map(),          // userId -> Array<Trip>
        recentSearches: new Map(), // userId -> Array<string>
        seq: new Map(),            // userId -> { place, list, trip }
      };
    }
    return STATE.atlasLens;
  }
  function saveAtlas() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort: ignore */ } } }
  function aidAt(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidAt(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoAt() { return new Date().toISOString(); }
  function listAt(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function ensureSeqAt(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { place: 1, list: 1, trip: 1, area: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['place','list','trip','area']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  const PLACE_CATEGORIES = ['restaurant', 'cafe', 'bar', 'hotel', 'attraction', 'park', 'shop', 'museum', 'transit', 'home', 'work', 'other'];

  // ── Saved places ──────────────────────────────────────────────

  registerLensAction("atlas", "places-list", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const category = PLACE_CATEGORIES.includes(params.category) ? params.category : null;
    let list = listAt(s.places, aidAt(ctx));
    if (category) list = list.filter(p => p.category === category);
    return { ok: true, result: { places: list.slice().sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')) } };
  });

  registerLensAction("atlas", "places-save", (ctx, _a, params = {}) => {
  try {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const name = String(params.name || "").trim();
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!name) return { ok: false, error: "name required" };
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { ok: false, error: "valid lat/lng required" };
    }
    const seq = ensureSeqAt(s, userId);
    const place = {
      id: uidAt("place"),
      number: `PL-${String(seq.place).padStart(5, '0')}`,
      name,
      lat, lng,
      category: PLACE_CATEGORIES.includes(params.category) ? params.category : 'other',
      address: String(params.address || ""),
      notes: String(params.notes || ""),
      rating: Number.isFinite(Number(params.rating)) ? Math.max(0, Math.min(5, Number(params.rating))) : null,
      savedAt: isoAt(),
    };
    seq.place++;
    listAt(s.places, userId).push(place);
    saveAtlas();
    return { ok: true, result: { place } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("atlas", "places-update", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = listAt(s.places, aidAt(ctx)).find(x => x.id === String(params.id || ""));
    if (!p) return { ok: false, error: "place not found" };
    for (const k of ['name', 'address', 'notes']) if (typeof params[k] === 'string') p[k] = params[k];
    if (PLACE_CATEGORIES.includes(params.category)) p.category = params.category;
    if (Number.isFinite(Number(params.rating))) p.rating = Math.max(0, Math.min(5, Number(params.rating)));
    saveAtlas();
    return { ok: true, result: { place: p } };
  });

  registerLensAction("atlas", "places-delete", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const id = String(params.id || "");
    const list = listAt(s.places, userId);
    const i = list.findIndex(p => p.id === id);
    if (i < 0) return { ok: false, error: "place not found" };
    list.splice(i, 1);
    // Drop from any lists too.
    for (const l of listAt(s.lists, userId)) {
      l.placeIds = (l.placeIds || []).filter(pid => pid !== id);
    }
    saveAtlas();
    return { ok: true, result: { deleted: true } };
  });

  // ── Lists (Google Maps Lists) ─────────────────────────────────

  registerLensAction("atlas", "lists-list", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const lists = listAt(s.lists, userId);
    const places = listAt(s.places, userId);
    const enriched = lists.map(l => ({
      ...l,
      placeCount: (l.placeIds || []).length,
      places: (l.placeIds || []).map(pid => places.find(p => p.id === pid)).filter(Boolean),
    }));
    return { ok: true, result: { lists: enriched } };
  });

  registerLensAction("atlas", "lists-create", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqAt(s, userId);
    const list = {
      id: uidAt("list"),
      number: `LS-${String(seq.list).padStart(4, '0')}`,
      name,
      description: String(params.description || ""),
      color: String(params.color || '#22d3ee'),
      placeIds: [],
      createdAt: isoAt(),
    };
    seq.list++;
    listAt(s.lists, userId).push(list);
    saveAtlas();
    return { ok: true, result: { list } };
  });

  registerLensAction("atlas", "lists-add-place", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const list = listAt(s.lists, userId).find(l => l.id === String(params.listId || ""));
    if (!list) return { ok: false, error: "list not found" };
    const placeId = String(params.placeId || "");
    const place = listAt(s.places, userId).find(p => p.id === placeId);
    if (!place) return { ok: false, error: "place not found" };
    if (!list.placeIds.includes(placeId)) list.placeIds.push(placeId);
    saveAtlas();
    return { ok: true, result: { list } };
  });

  registerLensAction("atlas", "lists-remove-place", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAt(s.lists, aidAt(ctx)).find(l => l.id === String(params.listId || ""));
    if (!list) return { ok: false, error: "list not found" };
    list.placeIds = (list.placeIds || []).filter(pid => pid !== String(params.placeId || ""));
    saveAtlas();
    return { ok: true, result: { list } };
  });

  registerLensAction("atlas", "lists-delete", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = listAt(s.lists, aidAt(ctx));
    const i = arr.findIndex(l => l.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "list not found" };
    arr.splice(i, 1);
    saveAtlas();
    return { ok: true, result: { deleted: true } };
  });

  // ── Trips (multi-stop itineraries) ───────────────────────────

  registerLensAction("atlas", "trips-list", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { trips: listAt(s.trips, aidAt(ctx)).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  registerLensAction("atlas", "trips-create", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqAt(s, userId);
    const trip = {
      id: uidAt("trip"),
      number: `TR-${String(seq.trip).padStart(4, '0')}`,
      name,
      startDate: String(params.startDate || ""),
      endDate: String(params.endDate || ""),
      stops: [],   // Array<{ id, name, lat, lng, placeId?, day?, notes? }>
      createdAt: isoAt(),
    };
    seq.trip++;
    listAt(s.trips, userId).push(trip);
    saveAtlas();
    return { ok: true, result: { trip } };
  });

  registerLensAction("atlas", "trips-add-stop", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const trip = listAt(s.trips, userId).find(t => t.id === String(params.tripId || ""));
    if (!trip) return { ok: false, error: "trip not found" };
    // Stop can reference a saved place OR be ad-hoc lat/lng.
    let stop;
    if (params.placeId) {
      const place = listAt(s.places, userId).find(p => p.id === String(params.placeId));
      if (!place) return { ok: false, error: "place not found" };
      stop = { id: uidAt("stop"), name: place.name, lat: place.lat, lng: place.lng, placeId: place.id, day: Number(params.day) || 1, notes: String(params.notes || "") };
    } else {
      const lat = Number(params.lat), lng = Number(params.lng);
      const name = String(params.name || "").trim();
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "placeId OR name+lat+lng required" };
      stop = { id: uidAt("stop"), name, lat, lng, placeId: null, day: Number(params.day) || 1, notes: String(params.notes || "") };
    }
    trip.stops.push(stop);
    saveAtlas();
    return { ok: true, result: { trip } };
  });

  registerLensAction("atlas", "trips-remove-stop", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = listAt(s.trips, aidAt(ctx)).find(t => t.id === String(params.tripId || ""));
    if (!trip) return { ok: false, error: "trip not found" };
    trip.stops = trip.stops.filter(st => st.id !== String(params.stopId || ""));
    saveAtlas();
    return { ok: true, result: { trip } };
  });

  registerLensAction("atlas", "trips-reorder-stops", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = listAt(s.trips, aidAt(ctx)).find(t => t.id === String(params.tripId || ""));
    if (!trip) return { ok: false, error: "trip not found" };
    const order = Array.isArray(params.stopIds) ? params.stopIds.map(String) : [];
    if (order.length !== trip.stops.length) return { ok: false, error: "stopIds must list every stop exactly once" };
    const byId = new Map(trip.stops.map(st => [st.id, st]));
    const reordered = order.map(id => byId.get(id)).filter(Boolean);
    if (reordered.length !== trip.stops.length) return { ok: false, error: "stopIds contains unknown ids" };
    trip.stops = reordered;
    saveAtlas();
    return { ok: true, result: { trip } };
  });

  registerLensAction("atlas", "trips-delete", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = listAt(s.trips, aidAt(ctx));
    const i = arr.findIndex(t => t.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "trip not found" };
    arr.splice(i, 1);
    saveAtlas();
    return { ok: true, result: { deleted: true } };
  });

  // ── Directions (real OSRM routing) ───────────────────────────

  registerLensAction("atlas", "directions", async (_ctx, _a, params = {}) => {
    const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
    if (waypoints.length < 2) return { ok: false, error: "at least 2 waypoints required" };
    for (const w of waypoints) {
      if (!Number.isFinite(Number(w.lat)) || !Number.isFinite(Number(w.lng))) return { ok: false, error: "each waypoint needs numeric lat/lng" };
    }
    const profile = ['driving', 'walking', 'cycling'].includes(params.mode) ? params.mode : 'driving';
    const coords = waypoints.map(w => `${Number(w.lng)},${Number(w.lat)}`).join(';');
    try {
      const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return { ok: false, error: `OSRM ${r.status}` };
      const data = await r.json();
      if (data.code !== 'Ok' || !data.routes?.[0]) return { ok: false, error: `OSRM: ${data.code || 'no route'}` };
      const route = data.routes[0];
      return {
        ok: true,
        result: {
          mode: profile,
          distanceMeters: Math.round(route.distance),
          distanceKm: Math.round(route.distance / 100) / 10,
          distanceMiles: Math.round(route.distance / 1609.34 * 10) / 10,
          durationSeconds: Math.round(route.duration),
          durationText: formatDuration(route.duration),
          geometry: route.geometry,   // GeoJSON LineString
          legCount: route.legs?.length || 0,
          source: 'osrm-project-osrm.org',
        },
      };
    } catch (e) {
      return { ok: false, error: `routing unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // route-stops — Google Maps 2026 "Ask Maps"-style stop suggestion:
  // route from start to end, then find a chosen amenity near the route
  // midpoint so the user can add a sensible waypoint (coffee, fuel, …).
  registerLensAction("atlas", "route-stops", async (_ctx, _a, params = {}) => {
    const start = params.start || {};
    const end = params.end || {};
    if (![start.lat, start.lng, end.lat, end.lng].every((v) => Number.isFinite(Number(v)))) {
      return { ok: false, error: "start and end each need numeric lat/lng" };
    }
    const amenity = String(params.amenity || "fuel").trim().toLowerCase().replace(/[^a-z_]/g, "") || "fuel";
    const profile = ['driving', 'walking', 'cycling'].includes(params.mode) ? params.mode : 'driving';
    try {
      const coords = `${Number(start.lng)},${Number(start.lat)};${Number(end.lng)},${Number(end.lat)}`;
      const routeR = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`, { headers: { Accept: 'application/json' } });
      if (!routeR.ok) return { ok: false, error: `OSRM ${routeR.status}` };
      const routeData = await routeR.json();
      const route = routeData.routes?.[0];
      if (routeData.code !== 'Ok' || !route) return { ok: false, error: `OSRM: ${routeData.code || 'no route'}` };
      const line = route.geometry?.coordinates || [];
      if (line.length < 2) return { ok: false, error: "route had no geometry" };
      const mid = line[Math.floor(line.length / 2)]; // [lng, lat]
      const pad = 0.045; // ~5km box around the midpoint
      const bbox = { south: mid[1] - pad, north: mid[1] + pad, west: mid[0] - pad, east: mid[0] + pad };
      const query = `[out:json][timeout:25];(node["amenity"="${amenity}"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out tags center 40;`;
      const poiR = await fetch(`${OVERPASS_BASE}/interpreter`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": osmUserAgent() },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!poiR.ok) return { ok: false, error: `overpass ${poiR.status}` };
      const poiData = await poiR.json();
      const haversineKm = (la1, lo1, la2, lo2) => {
        const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
        const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
        return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
      };
      const stops = (poiData.elements || [])
        .map((el) => {
          const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return {
            name: el.tags?.name || `(unnamed ${amenity})`,
            lat, lng,
            amenity,
            detourFromMidKm: haversineKm(mid[1], mid[0], lat, lng),
            brand: el.tags?.brand || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.detourFromMidKm - b.detourFromMidKm)
        .slice(0, 12);
      return {
        ok: true,
        result: {
          amenity, mode: profile,
          routeDistanceKm: Math.round(route.distance / 100) / 10,
          routeDurationText: formatDuration(route.duration),
          midpoint: { lat: mid[1], lng: mid[0] },
          stops, count: stops.length,
          source: "osrm + overpass",
        },
      };
    } catch (e) {
      return { ok: false, error: `route-stops unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Recent searches ──────────────────────────────────────────

  registerLensAction("atlas", "recent-searches-list", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { recent: listAt(s.recentSearches, aidAt(ctx)).slice(-20).reverse() } };
  });

  registerLensAction("atlas", "recent-searches-record", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const list = listAt(s.recentSearches, userId);
    // dedup + cap at 50
    const existing = list.findIndex(x => x.query.toLowerCase() === query.toLowerCase());
    if (existing >= 0) list.splice(existing, 1);
    list.push({ query, at: isoAt() });
    if (list.length > 50) list.splice(0, list.length - 50);
    saveAtlas();
    return { ok: true, result: { recorded: query } };
  });

  registerLensAction("atlas", "recent-searches-clear", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    s.recentSearches.set(aidAt(ctx), []);
    saveAtlas();
    return { ok: true, result: { cleared: true } };
  });

  // ── AI trip planner (Google "Ask Maps" 2026 parity) ─────────

  registerLensAction("atlas", "ai-trip-plan", async (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const prompt = String(params.prompt || "").trim();
    if (!prompt) return { ok: false, error: "prompt required" };
    const days = Math.max(1, Math.min(14, Number(params.days) || 1));
    const places = listAt(s.places, userId);
    if (places.length === 0) return { ok: false, error: "save some places first — the planner builds itineraries from your saved places" };

    // Deterministic plan: distribute saved places across days, balancing count.
    function deterministicPlan() {
      // Score places by prompt-keyword match in name / notes / category.
      const tokens = prompt.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      const scored = places.map(p => {
        const hay = `${p.name} ${p.notes} ${p.category}`.toLowerCase();
        let score = tokens.reduce((sc, t) => sc + (hay.includes(t) ? 1 : 0), 0);
        if (p.rating) score += p.rating * 0.2;
        return { place: p, score };
      }).sort((a, b) => b.score - a.score);
      const itinerary = [];
      const perDay = Math.ceil(scored.length / days);
      for (let d = 0; d < days; d++) {
        const dayPlaces = scored.slice(d * perDay, (d + 1) * perDay).map(x => ({
          placeId: x.place.id, name: x.place.name, lat: x.place.lat, lng: x.place.lng, category: x.place.category,
        }));
        if (dayPlaces.length > 0) itinerary.push({ day: d + 1, stops: dayPlaces });
      }
      return itinerary;
    }

    const itinerary = deterministicPlan();
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') {
      return { ok: true, result: { itinerary, prompt, days, source: 'deterministic', narration: `Distributed ${places.length} saved places across ${itinerary.length} day(s), ranked by relevance to "${prompt}".` } };
    }
    try {
      const placeList = places.map(p => `${p.name} (${p.category}${p.rating ? `, ${p.rating}★` : ''})`).join('; ');
      const r = await brain({
        messages: [
          { role: 'system', content: "You are a trip planner. Given a user's saved places and a request, write 2-3 sentences of advice on how to sequence them. Use ONLY the places listed — never invent new ones. NOT a booking service." },
          { role: 'user', content: `Saved places: ${placeList}\n\nRequest: ${prompt} (${days} day trip)` },
        ],
        temperature: 0.4, maxTokens: 500,
      });
      const narration = String(r?.content || r?.text || '').trim();
      return { ok: true, result: { itinerary, prompt, days, source: narration ? 'brain' : 'deterministic', narration: narration || `Distributed ${places.length} saved places across ${itinerary.length} day(s).` } };
    } catch (_e) {
      return { ok: true, result: { itinerary, prompt, days, source: 'deterministic_after_brain_error', narration: `Distributed ${places.length} saved places across ${itinerary.length} day(s).` } };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  Google Maps parity backlog — multi-modal directions, live
  //  traffic + ETA, transit, street imagery (Mapillary), place
  //  details (OSM/Wikidata/Wikipedia), offline area download, and
  //  real-time navigation mode with re-routing.
  // ═══════════════════════════════════════════════════════════════

  function haversineKm(la1, lo1, la2, lo2) {
    const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // OSRM profile-per-mode. project-osrm.org only ships the driving
  // profile; routing.openstreetmap.de hosts walking + cycling.
  const OSRM_HOSTS = {
    driving: "https://router.project-osrm.org",
    walking: "https://routing.openstreetmap.de/routed-foot",
    cycling: "https://routing.openstreetmap.de/routed-bike",
  };

  async function osrmRoute(profile, coords, withSteps) {
    const host = OSRM_HOSTS[profile] || OSRM_HOSTS.driving;
    // openstreetmap.de routers expect the literal profile name in the path differently.
    const apiProfile = host.includes("project-osrm") ? profile
      : profile === "walking" ? "foot" : profile === "cycling" ? "bike" : "driving";
    const url = `${host}/route/v1/${apiProfile}/${coords}?overview=full&geometries=geojson&steps=${withSteps ? "true" : "false"}&annotations=duration,distance`;
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": osmUserAgent() } });
    if (!r.ok) throw new Error(`OSRM ${r.status}`);
    const data = await r.json();
    if (data.code !== "Ok" || !data.routes?.[0]) throw new Error(`OSRM: ${data.code || "no route"}`);
    return data.routes[0];
  }

  // ── Multi-modal directions with turn-by-turn steps ───────────
  // [S] Multi-modal routing (walk/bike/drive toggle on directions)

  registerLensAction("atlas", "directions-multimodal", async (_ctx, _a, params = {}) => {
    const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
    if (waypoints.length < 2) return { ok: false, error: "at least 2 waypoints required" };
    for (const w of waypoints) {
      if (!Number.isFinite(Number(w.lat)) || !Number.isFinite(Number(w.lng))) return { ok: false, error: "each waypoint needs numeric lat/lng" };
    }
    const profile = ["driving", "walking", "cycling"].includes(params.mode) ? params.mode : "driving";
    const coords = waypoints.map((w) => `${Number(w.lng)},${Number(w.lat)}`).join(";");
    try {
      const route = await osrmRoute(profile, coords, true);
      const steps = [];
      for (const leg of route.legs || []) {
        for (const st of leg.steps || []) {
          const m = st.maneuver || {};
          steps.push({
            instruction: [m.modifier, m.type, st.name].filter(Boolean).join(" ").trim() || st.name || m.type || "continue",
            type: m.type || "continue",
            modifier: m.modifier || null,
            roadName: st.name || "",
            distanceMeters: Math.round(st.distance || 0),
            durationSeconds: Math.round(st.duration || 0),
          });
        }
      }
      return {
        ok: true,
        result: {
          mode: profile,
          distanceMeters: Math.round(route.distance),
          distanceKm: Math.round(route.distance / 100) / 10,
          distanceMiles: Math.round(route.distance / 1609.34 * 10) / 10,
          durationSeconds: Math.round(route.duration),
          durationText: formatDuration(route.duration),
          geometry: route.geometry,
          steps,
          stepCount: steps.length,
          source: "osrm-multimodal",
        },
      };
    } catch (e) {
      return { ok: false, error: `routing unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Live traffic + ETA ───────────────────────────────────────
  // [M] Live traffic + ETA on routes. OSRM is free-flow only; we
  //  derive a congestion estimate from time-of-day demand curves
  //  (rush hours) and per-leg speed, then surface an adjusted ETA.

  function congestionFactor(hourLocal, profile) {
    // Walking/cycling are immune to vehicle traffic.
    if (profile !== "driving") return { factor: 1.0, level: "none" };
    // Bimodal rush-hour demand curve, peaks ~08:00 and ~17:30.
    const morning = Math.exp(-((hourLocal - 8) ** 2) / 2.0);
    const evening = Math.exp(-((hourLocal - 17.5) ** 2) / 2.5);
    const demand = Math.max(morning, evening); // 0..1
    const factor = Math.round((1 + demand * 0.85) * 100) / 100; // up to +85% travel time
    const level = factor >= 1.55 ? "heavy" : factor >= 1.25 ? "moderate" : factor >= 1.08 ? "light" : "free-flow";
    return { factor, level };
  }

  registerLensAction("atlas", "live-traffic-eta", async (_ctx, _a, params = {}) => {
    const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
    if (waypoints.length < 2) return { ok: false, error: "at least 2 waypoints required" };
    for (const w of waypoints) {
      if (!Number.isFinite(Number(w.lat)) || !Number.isFinite(Number(w.lng))) return { ok: false, error: "each waypoint needs numeric lat/lng" };
    }
    const profile = ["driving", "walking", "cycling"].includes(params.mode) ? params.mode : "driving";
    const coords = waypoints.map((w) => `${Number(w.lng)},${Number(w.lat)}`).join(";");
    // Local hour at the route origin from its longitude (UTC + lon/15).
    const utcHour = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
    const localHour = ((utcHour + Number(waypoints[0].lng) / 15) % 24 + 24) % 24;
    try {
      const route = await osrmRoute(profile, coords, false);
      const { factor, level } = congestionFactor(localHour, profile);
      const freeFlowSec = Math.round(route.duration);
      const trafficSec = Math.round(freeFlowSec * factor);
      // Per-leg congestion breakdown.
      const legs = (route.legs || []).map((leg, i) => ({
        index: i,
        distanceKm: Math.round((leg.distance || 0) / 100) / 10,
        freeFlowText: formatDuration(leg.duration || 0),
        trafficText: formatDuration((leg.duration || 0) * factor),
      }));
      const eta = new Date(Date.now() + trafficSec * 1000);
      return {
        ok: true,
        result: {
          mode: profile,
          distanceKm: Math.round(route.distance / 100) / 10,
          freeFlowSeconds: freeFlowSec,
          freeFlowText: formatDuration(freeFlowSec),
          trafficSeconds: trafficSec,
          trafficText: formatDuration(trafficSec),
          delaySeconds: trafficSec - freeFlowSec,
          delayText: formatDuration(trafficSec - freeFlowSec),
          congestionLevel: level,
          congestionFactor: factor,
          localHour: Math.round(localHour * 10) / 10,
          etaIso: eta.toISOString(),
          legs,
          geometry: route.geometry,
          source: "osrm + time-of-day demand model",
        },
      };
    } catch (e) {
      return { ok: false, error: `traffic eta unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Transit directions ───────────────────────────────────────
  // [M] Transit directions. Discovers public-transport stops from
  //  OSM (Overpass) near origin/destination, computes the walk legs
  //  to/from the nearest stop, and an in-vehicle estimate. GTFS-feed
  //  free, no key — Overpass carries route_master + stop tags.

  registerLensAction("atlas", "transit-directions", async (_ctx, _a, params = {}) => {
    const start = params.start || {};
    const end = params.end || {};
    if (![start.lat, start.lng, end.lat, end.lng].every((v) => Number.isFinite(Number(v)))) {
      return { ok: false, error: "start and end each need numeric lat/lng" };
    }
    const sLat = Number(start.lat), sLng = Number(start.lng), eLat = Number(end.lat), eLng = Number(end.lng);
    const pad = 0.012; // ~1.3km search radius for stops
    const stopQuery = (la, lo) => `[out:json][timeout:25];(node["public_transport"="stop_position"](${la - pad},${lo - pad},${la + pad},${lo + pad});node["highway"="bus_stop"](${la - pad},${lo - pad},${la + pad},${lo + pad});node["railway"="station"](${la - pad},${lo - pad},${la + pad},${lo + pad});node["railway"="tram_stop"](${la - pad},${lo - pad},${la + pad},${lo + pad}););out tags 60;`;
    async function nearestStop(la, lo) {
      const r = await fetch(`${OVERPASS_BASE}/interpreter`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": osmUserAgent() },
        body: `data=${encodeURIComponent(stopQuery(la, lo))}`,
      });
      if (!r.ok) throw new Error(`overpass ${r.status}`);
      const data = await r.json();
      const stops = (data.elements || [])
        .map((el) => {
          const lat = el.lat, lng = el.lon;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const kind = el.tags?.railway === "station" ? "rail"
            : el.tags?.railway === "tram_stop" ? "tram"
            : el.tags?.highway === "bus_stop" ? "bus" : "transit";
          return { name: el.tags?.name || `(unnamed ${kind} stop)`, lat, lng, kind, walkKm: Math.round(haversineKm(la, lo, lat, lng) * 100) / 100 };
        })
        .filter(Boolean)
        .sort((a, b) => a.walkKm - b.walkKm);
      return stops;
    }
    try {
      const [originStops, destStops] = await Promise.all([nearestStop(sLat, sLng), nearestStop(eLat, eLng)]);
      if (originStops.length === 0 || destStops.length === 0) {
        return { ok: true, result: { feasible: false, reason: "No transit stops found near origin or destination.", originStops, destStops } };
      }
      const board = originStops[0], alight = destStops[0];
      const WALK_KPH = 4.8, TRANSIT_KPH = 24; // typical urban transit average incl. dwell
      const transitKm = Math.round(haversineKm(board.lat, board.lng, alight.lat, alight.lng) * 100) / 100;
      const walkToSec = Math.round(board.walkKm / WALK_KPH * 3600);
      const rideSec = Math.round(transitKm / TRANSIT_KPH * 3600) + 180; // +3min wait buffer
      const walkFromSec = Math.round(alight.walkKm / WALK_KPH * 3600);
      const totalSec = walkToSec + rideSec + walkFromSec;
      return {
        ok: true,
        result: {
          feasible: true,
          legs: [
            { type: "walk", from: "Origin", to: board.name, distanceKm: board.walkKm, durationText: formatDuration(walkToSec) },
            { type: "transit", mode: board.kind, from: board.name, to: alight.name, distanceKm: transitKm, durationText: formatDuration(rideSec) },
            { type: "walk", from: alight.name, to: "Destination", distanceKm: alight.walkKm, durationText: formatDuration(walkFromSec) },
          ],
          totalSeconds: totalSec,
          totalDurationText: formatDuration(totalSec),
          boardStop: board,
          alightStop: alight,
          originStops: originStops.slice(0, 6),
          destStops: destStops.slice(0, 6),
          source: "openstreetmap-overpass transit stops",
        },
      };
    } catch (e) {
      return { ok: false, error: `transit unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Street-level / panoramic imagery (Mapillary open imagery) ─
  // [M] Street-level imagery. Mapillary Graph API serves crowd-
  //  sourced street imagery; the tiles/images endpoint is keyless
  //  for the public coverage layer. We query images near a point.

  registerLensAction("atlas", "street-imagery", async (_ctx, _a, params = {}) => {
    const lat = Number(params.lat), lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "numeric lat/lng required" };
    const token = process.env.MAPILLARY_TOKEN || "";
    const radiusDeg = 0.0025; // ~280m bbox
    const bbox = `${lng - radiusDeg},${lat - radiusDeg},${lng + radiusDeg},${lat + radiusDeg}`;
    if (!token) {
      // No token configured — return the coverage-layer tile reference
      // so the client can still render Mapillary's public tile overlay.
      return {
        ok: true,
        result: {
          lat, lng,
          images: [],
          coverageTileUrl: "https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}",
          hasToken: false,
          note: "Set MAPILLARY_TOKEN for individual image lookups; coverage tile layer is keyless.",
          source: "mapillary",
        },
      };
    }
    try {
      const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&bbox=${bbox}&fields=id,thumb_1024_url,thumb_256_url,captured_at,compass_angle,geometry,is_pano&limit=25`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`mapillary ${r.status}`);
      const data = await r.json();
      const images = (data.data || []).map((im) => {
        const c = im.geometry?.coordinates || [];
        return {
          id: im.id,
          thumbUrl: im.thumb_1024_url || im.thumb_256_url || null,
          smallThumbUrl: im.thumb_256_url || null,
          capturedAt: im.captured_at ? new Date(im.captured_at).toISOString() : null,
          compassAngle: im.compass_angle ?? null,
          isPanoramic: !!im.is_pano,
          lat: c[1] ?? null,
          lng: c[0] ?? null,
          distanceM: c.length === 2 ? Math.round(haversineKm(lat, lng, c[1], c[0]) * 1000) : null,
        };
      }).filter((im) => im.thumbUrl).sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
      return { ok: true, result: { lat, lng, images, count: images.length, hasToken: true, source: "mapillary" } };
    } catch (e) {
      return { ok: false, error: `mapillary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Place details pages (hours, photos, reviews, links) ──────
  // [M] Place details. Pulls full OSM tags via Overpass for a node,
  //  then enriches with Wikidata + Wikipedia summary when the OSM
  //  feature carries wikidata/wikipedia tags. All free, no key.

  registerLensAction("atlas", "place-details", async (_ctx, _a, params = {}) => {
    const osmType = ["node", "way", "relation"].includes(params.osmType) ? params.osmType : null;
    const osmId = Number(params.osmId);
    const lat = Number(params.lat), lng = Number(params.lng);
    if (!osmType || !Number.isFinite(osmId)) {
      return { ok: false, error: "osmType (node|way|relation) + numeric osmId required" };
    }
    try {
      const q = `[out:json][timeout:25];${osmType}(${osmId});out tags center 1;`;
      const r = await fetch(`${OVERPASS_BASE}/interpreter`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": osmUserAgent() },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (!r.ok) throw new Error(`overpass ${r.status}`);
      const data = await r.json();
      const el = (data.elements || [])[0];
      if (!el) return { ok: false, error: "OSM feature not found" };
      const tags = el.tags || {};
      const featureLat = el.lat ?? el.center?.lat ?? (Number.isFinite(lat) ? lat : null);
      const featureLng = el.lon ?? el.center?.lon ?? (Number.isFinite(lng) ? lng : null);
      const details = {
        osmType, osmId,
        name: tags.name || null,
        lat: featureLat, lng: featureLng,
        category: tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.office || null,
        cuisine: tags.cuisine || null,
        openingHours: tags.opening_hours || null,
        phone: tags.phone || tags["contact:phone"] || null,
        website: tags.website || tags["contact:website"] || null,
        email: tags.email || tags["contact:email"] || null,
        address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:postcode"]].filter(Boolean).join(", ") || null,
        wheelchair: tags.wheelchair || null,
        operator: tags.operator || tags.brand || null,
        tags,
        wikipedia: null,
        wikidata: tags.wikidata || null,
        summary: null,
        image: null,
      };
      // Wikipedia summary enrichment.
      if (tags.wikipedia) {
        try {
          const wp = String(tags.wikipedia); // "en:Article Title"
          const colon = wp.indexOf(":");
          const lang = colon > 0 ? wp.slice(0, colon) : "en";
          const title = colon > 0 ? wp.slice(colon + 1) : wp;
          const wikiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
          const wr = await fetch(wikiUrl, { headers: { Accept: "application/json", "User-Agent": osmUserAgent() } });
          if (wr.ok) {
            const wd = await wr.json();
            details.summary = wd.extract || null;
            details.wikipedia = wd.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
            details.image = wd.thumbnail?.source || wd.originalimage?.source || null;
          }
        } catch (_e) { /* enrichment is best-effort */ }
      }
      return { ok: true, result: { details, source: "openstreetmap-overpass + wikipedia" } };
    } catch (e) {
      return { ok: false, error: `place-details unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Offline map area download ────────────────────────────────
  // [S] Offline map area download. Records a user-chosen bbox + zoom
  //  range, computes the OSM tile manifest the client must cache, and
  //  stores it so the area list persists. The client fetches the
  //  tiles into its own storage from the returned tile URLs.

  function tilesForBbox(south, west, north, east, zoom) {
    const lon2tile = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const lat2tile = (la, z) => {
      const r = la * Math.PI / 180;
      return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
    };
    const xMin = lon2tile(west, zoom), xMax = lon2tile(east, zoom);
    const yMin = lat2tile(north, zoom), yMax = lat2tile(south, zoom);
    return Math.max(0, (xMax - xMin + 1)) * Math.max(0, (yMax - yMin + 1));
  }

  registerLensAction("atlas", "offline-areas-list", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.offlineAreas) s.offlineAreas = new Map();
    return { ok: true, result: { areas: listAt(s.offlineAreas, aidAt(ctx)).slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")) } };
  });

  registerLensAction("atlas", "offline-areas-create", (ctx, _a, params = {}) => {
  try {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.offlineAreas) s.offlineAreas = new Map();
    const userId = aidAt(ctx);
    const name = String(params.name || "").trim();
    const south = Number(params.south), west = Number(params.west), north = Number(params.north), east = Number(params.east);
    if (!name) return { ok: false, error: "name required" };
    if (![south, west, north, east].every(Number.isFinite)) return { ok: false, error: "numeric south/west/north/east bbox required" };
    if (south >= north || west >= east) return { ok: false, error: "bbox invalid (south < north, west < east)" };
    const minZoom = Math.max(0, Math.min(18, Number(params.minZoom) || 10));
    const maxZoom = Math.max(minZoom, Math.min(19, Number(params.maxZoom) || 15));
    let tileCount = 0;
    for (let z = minZoom; z <= maxZoom; z++) tileCount += tilesForBbox(south, west, north, east, z);
    // ~18KB average per OSM raster tile.
    const estimatedBytes = tileCount * 18 * 1024;
    const seq = ensureSeqAt(s, userId);
    if (!Number.isFinite(seq.area)) seq.area = 1;
    const area = {
      id: uidAt("area"),
      number: `OA-${String(seq.area).padStart(4, "0")}`,
      name,
      bbox: { south, west, north, east },
      minZoom, maxZoom,
      tileCount,
      estimatedBytes,
      estimatedSizeMB: Math.round(estimatedBytes / 1048576 * 10) / 10,
      tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      status: "pending",
      createdAt: isoAt(),
    };
    seq.area++;
    listAt(s.offlineAreas, userId).push(area);
    saveAtlas();
    return { ok: true, result: { area } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("atlas", "offline-areas-update-status", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.offlineAreas) s.offlineAreas = new Map();
    const area = listAt(s.offlineAreas, aidAt(ctx)).find((x) => x.id === String(params.id || ""));
    if (!area) return { ok: false, error: "area not found" };
    const status = ["pending", "downloading", "ready", "error"].includes(params.status) ? params.status : null;
    if (!status) return { ok: false, error: "status must be pending|downloading|ready|error" };
    area.status = status;
    if (status === "ready") area.downloadedAt = isoAt();
    if (Number.isFinite(Number(params.cachedTiles))) area.cachedTiles = Math.max(0, Number(params.cachedTiles));
    saveAtlas();
    return { ok: true, result: { area } };
  });

  registerLensAction("atlas", "offline-areas-delete", (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.offlineAreas) s.offlineAreas = new Map();
    const arr = listAt(s.offlineAreas, aidAt(ctx));
    const i = arr.findIndex((x) => x.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "area not found" };
    arr.splice(i, 1);
    saveAtlas();
    return { ok: true, result: { deleted: true } };
  });

  // ── Real-time navigation mode with re-routing ────────────────
  // [M] Real-time navigation mode. Starts a navigation session for a
  //  route, then advances along it as the client posts live GPS
  //  positions. Detects off-route drift (>120m from the polyline)
  //  and re-routes from the current position to the destination.

  function nearestPointOnLine(lat, lng, line) {
    // line: [[lng,lat], ...]. Returns { idx, distM } of the closest vertex.
    let best = { idx: 0, distM: Infinity };
    for (let i = 0; i < line.length; i++) {
      const d = haversineKm(lat, lng, line[i][1], line[i][0]) * 1000;
      if (d < best.distM) best = { idx: i, distM: d };
    }
    return best;
  }

  registerLensAction("atlas", "nav-start", async (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.navSessions) s.navSessions = new Map();
    const userId = aidAt(ctx);
    const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
    if (waypoints.length < 2) return { ok: false, error: "at least 2 waypoints (start + destination) required" };
    for (const w of waypoints) {
      if (!Number.isFinite(Number(w.lat)) || !Number.isFinite(Number(w.lng))) return { ok: false, error: "each waypoint needs numeric lat/lng" };
    }
    const profile = ["driving", "walking", "cycling"].includes(params.mode) ? params.mode : "driving";
    const coords = waypoints.map((w) => `${Number(w.lng)},${Number(w.lat)}`).join(";");
    try {
      const route = await osrmRoute(profile, coords, true);
      const steps = [];
      for (const leg of route.legs || []) {
        for (const st of leg.steps || []) {
          const m = st.maneuver || {};
          steps.push({
            instruction: [m.modifier, m.type, st.name].filter(Boolean).join(" ").trim() || st.name || m.type || "continue",
            roadName: st.name || "",
            distanceMeters: Math.round(st.distance || 0),
          });
        }
      }
      const session = {
        id: uidAt("nav"),
        mode: profile,
        destination: { lat: Number(waypoints[waypoints.length - 1].lat), lng: Number(waypoints[waypoints.length - 1].lng) },
        geometry: route.geometry,
        steps,
        totalDistanceMeters: Math.round(route.distance),
        totalDurationSeconds: Math.round(route.duration),
        currentStepIndex: 0,
        progressMeters: 0,
        rerouteCount: 0,
        status: "active",
        startedAt: isoAt(),
        updatedAt: isoAt(),
      };
      s.navSessions.set(userId, session);
      saveAtlas();
      return { ok: true, result: { session } };
    } catch (e) {
      return { ok: false, error: `nav-start routing unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("atlas", "nav-update", async (ctx, _a, params = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.navSessions) s.navSessions = new Map();
    const userId = aidAt(ctx);
    const session = s.navSessions.get(userId);
    if (!session || session.status !== "active") return { ok: false, error: "no active navigation session" };
    const lat = Number(params.lat), lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "numeric lat/lng required" };
    const OFF_ROUTE_M = 120, ARRIVED_M = 35;
    const line = session.geometry?.coordinates || [];
    const distToDest = haversineKm(lat, lng, session.destination.lat, session.destination.lng) * 1000;
    if (distToDest <= ARRIVED_M) {
      session.status = "arrived";
      session.updatedAt = isoAt();
      saveAtlas();
      return { ok: true, result: { session, arrived: true, rerouted: false } };
    }
    const near = line.length ? nearestPointOnLine(lat, lng, line) : { idx: 0, distM: Infinity };
    let rerouted = false;
    if (near.distM > OFF_ROUTE_M) {
      // Off-route — re-route from current position to destination.
      try {
        const coords = `${lng},${lat};${session.destination.lng},${session.destination.lat}`;
        const route = await osrmRoute(session.mode, coords, true);
        const steps = [];
        for (const leg of route.legs || []) {
          for (const st of leg.steps || []) {
            const m = st.maneuver || {};
            steps.push({
              instruction: [m.modifier, m.type, st.name].filter(Boolean).join(" ").trim() || st.name || m.type || "continue",
              roadName: st.name || "",
              distanceMeters: Math.round(st.distance || 0),
            });
          }
        }
        session.geometry = route.geometry;
        session.steps = steps;
        session.totalDistanceMeters = Math.round(route.distance);
        session.totalDurationSeconds = Math.round(route.duration);
        session.currentStepIndex = 0;
        session.progressMeters = 0;
        session.rerouteCount += 1;
        rerouted = true;
      } catch (e) {
        session.updatedAt = isoAt();
        return { ok: false, error: `reroute failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    } else {
      // On-route — advance progress + the current step pointer.
      const newLine = session.geometry?.coordinates || [];
      const idx = newLine.length ? nearestPointOnLine(lat, lng, newLine).idx : 0;
      let progressM = 0;
      for (let i = 1; i <= idx && i < newLine.length; i++) {
        progressM += haversineKm(newLine[i - 1][1], newLine[i - 1][0], newLine[i][1], newLine[i][0]) * 1000;
      }
      session.progressMeters = Math.round(progressM);
      // Advance step pointer by accumulated step distances.
      let acc = 0, stepIdx = 0;
      for (let i = 0; i < session.steps.length; i++) {
        acc += session.steps[i].distanceMeters;
        if (acc >= progressM) { stepIdx = i; break; }
        stepIdx = i;
      }
      session.currentStepIndex = stepIdx;
    }
    session.updatedAt = isoAt();
    const remainingM = Math.max(0, session.totalDistanceMeters - session.progressMeters);
    saveAtlas();
    return {
      ok: true,
      result: {
        session,
        rerouted,
        arrived: false,
        offRouteMeters: Math.round(near.distM),
        remainingMeters: remainingM,
        remainingText: formatDuration(remainingM / (session.mode === "driving" ? 14 : session.mode === "cycling" ? 4.5 : 1.4)),
        nextStep: session.steps[session.currentStepIndex] || null,
      },
    };
  });

  registerLensAction("atlas", "nav-status", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.navSessions) s.navSessions = new Map();
    const session = s.navSessions.get(aidAt(ctx)) || null;
    return { ok: true, result: { session } };
  });

  registerLensAction("atlas", "nav-stop", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.navSessions) s.navSessions = new Map();
    const userId = aidAt(ctx);
    const session = s.navSessions.get(userId);
    if (!session) return { ok: false, error: "no navigation session" };
    s.navSessions.delete(userId);
    saveAtlas();
    return { ok: true, result: { stopped: true } };
  });

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("atlas", "atlas-dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getAtlasState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAt(ctx);
    const places = listAt(s.places, userId);
    const lists = listAt(s.lists, userId);
    const trips = listAt(s.trips, userId);
    const byCategory = {};
    for (const p of places) byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    const offlineAreas = s.offlineAreas ? listAt(s.offlineAreas, userId) : [];
    const navSession = s.navSessions ? s.navSessions.get(userId) || null : null;
    return {
      ok: true,
      result: {
        placeCount: places.length,
        listCount: lists.length,
        tripCount: trips.length,
        totalStops: trips.reduce((sum, t) => sum + t.stops.length, 0),
        recentSearchCount: listAt(s.recentSearches, userId).length,
        offlineAreaCount: offlineAreas.length,
        navActive: !!(navSession && navSession.status === "active"),
        byCategory,
      },
    };
  });
}
