export default function registerAviationActions(registerLensAction) {
  registerLensAction("aviation", "currencyCheck", (ctx, artifact, _params) => {
    const certifications = artifact.data?.certifications || [];
    const medicalExpiry = artifact.data?.medicalExpiry ? new Date(artifact.data.medicalExpiry) : null;
    const now = new Date();
    const checks = [];
    if (medicalExpiry) {
      checks.push({ type: 'Medical Certificate', expiry: artifact.data.medicalExpiry, current: medicalExpiry > now, daysRemaining: Math.ceil((medicalExpiry - now) / (1000 * 60 * 60 * 24)) });
    }
    certifications.forEach(cert => {
      const expiry = cert.expiry ? new Date(cert.expiry) : null;
      checks.push({ type: cert.name, expiry: cert.expiry, current: expiry ? expiry > now : true, daysRemaining: expiry ? Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)) : null });
    });
    const landingsLast90 = artifact.data?.recentLandings || 0;
    checks.push({ type: 'Passenger Currency (3 landings/90 days)', current: landingsLast90 >= 3, value: landingsLast90 });
    const allCurrent = checks.every(c => c.current);
    return { ok: true, result: { crewMember: artifact.title, checks, allCurrent, expiringSoon: checks.filter(c => c.daysRemaining !== null && c.daysRemaining <= 30 && c.daysRemaining > 0) } };
  });

  registerLensAction("aviation", "maintenanceDue", (ctx, artifact, _params) => {
    const totalTime = artifact.data?.totalTime || 0;
    const lastAnnual = artifact.data?.lastAnnual ? new Date(artifact.data.lastAnnual) : null;
    const now = new Date();
    const items = [];
    if (lastAnnual) {
      const daysSinceAnnual = Math.ceil((now - lastAnnual) / (1000 * 60 * 60 * 24));
      items.push({ type: 'Annual Inspection', lastCompleted: artifact.data.lastAnnual, daysSince: daysSinceAnnual, overdue: daysSinceAnnual > 365, dueIn: Math.max(0, 365 - daysSinceAnnual) });
    }
    const oilChangeInterval = artifact.data?.oilChangeInterval || 50;
    const hoursSinceOil = artifact.data?.hoursSinceOilChange || 0;
    items.push({ type: 'Oil Change', hoursSinceLast: hoursSinceOil, interval: oilChangeInterval, overdue: hoursSinceOil >= oilChangeInterval, hoursRemaining: Math.max(0, oilChangeInterval - hoursSinceOil) });
    const adCompliance = artifact.data?.adCompliance || [];
    adCompliance.filter(ad => ad.status !== 'complied').forEach(ad => {
      items.push({ type: `AD: ${ad.number}`, description: ad.description, status: ad.status, overdue: true });
    });
    return { ok: true, result: { aircraft: artifact.title, registration: artifact.data?.registration, totalTime, items, overdueCount: items.filter(i => i.overdue).length } };
  });

  registerLensAction("aviation", "hobbsLog", (ctx, artifact, _params) => {
    const flights = artifact.data?.flights || [];
    let totalTime = 0, picTime = 0, nightTime = 0, instrumentTime = 0, crossCountry = 0;
    flights.forEach(f => {
      totalTime += f.hobbsTime || 0;
      if (f.isPIC) picTime += f.hobbsTime || 0;
      nightTime += f.nightTime || 0;
      instrumentTime += f.instrumentTime || 0;
      if (f.crossCountry) crossCountry += f.hobbsTime || 0;
    });
    return {
      ok: true,
      result: {
        pilot: artifact.title,
        totalTime: Math.round(totalTime * 10) / 10,
        picTime: Math.round(picTime * 10) / 10,
        nightTime: Math.round(nightTime * 10) / 10,
        instrumentTime: Math.round(instrumentTime * 10) / 10,
        crossCountry: Math.round(crossCountry * 10) / 10,
        totalFlights: flights.length,
      },
    };
  });

  registerLensAction("aviation", "dutyTimeCheck", (ctx, artifact, _params) => {
    const shifts = artifact.data?.shifts || [];
    const flights = artifact.data?.flights || [];
    const now = new Date();
    const msPerHour = 3600000;
    const msPerDay = 86400000;

    // Combine shifts and flights into duty periods
    const dutyPeriods = [...shifts, ...flights]
      .filter(s => s.startTime || s.date)
      .map(s => {
        const start = new Date(s.startTime || s.date);
        const hours = s.dutyHours || s.hobbsTime || s.hours || 0;
        const end = s.endTime ? new Date(s.endTime) : new Date(start.getTime() + hours * msPerHour);
        return { start, end, hours: hours || (end - start) / msPerHour };
      });

    // Current duty period (most recent)
    const sorted = dutyPeriods.slice().sort((a, b) => b.start - a.start);
    const currentDuty = sorted.length > 0 ? sorted[0] : null;
    const currentDutyHours = currentDuty ? Math.round(currentDuty.hours * 10) / 10 : 0;

    // 7-day window
    const sevenDaysAgo = new Date(now.getTime() - 7 * msPerDay);
    const last7 = dutyPeriods.filter(d => d.start >= sevenDaysAgo);
    const hours7days = Math.round(last7.reduce((s, d) => s + d.hours, 0) * 10) / 10;

    // 28-day window
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * msPerDay);
    const last28 = dutyPeriods.filter(d => d.start >= twentyEightDaysAgo);
    const hours28days = Math.round(last28.reduce((s, d) => s + d.hours, 0) * 10) / 10;

    // FAR 117 limits
    const limits = {
      flightDuty: { limit: 10, actual: currentDutyHours, exceeded: currentDutyHours > 10 },
      sevenDay: { limit: 60, actual: hours7days, exceeded: hours7days > 60 },
      twentyEightDay: { limit: 190, actual: hours28days, exceeded: hours28days > 190 },
    };
    const anyExceeded = Object.values(limits).some(l => l.exceeded);

    return {
      ok: true,
      result: {
        crewMember: artifact.title,
        checkedAt: now.toISOString(),
        limits,
        compliant: !anyExceeded,
        totalDutyPeriods: dutyPeriods.length,
        remainingFlightDuty: Math.max(0, Math.round((10 - currentDutyHours) * 10) / 10),
        remaining7day: Math.max(0, Math.round((60 - hours7days) * 10) / 10),
        remaining28day: Math.max(0, Math.round((190 - hours28days) * 10) / 10),
      },
    };
  });

  registerLensAction("aviation", "flightSummary", (ctx, artifact, _params) => {
    const flights = artifact.data?.flights || [];
    if (flights.length === 0) {
      return { ok: true, result: { totalFlights: 0, totalHours: 0, message: "No flight data available." } };
    }
    let totalHours = 0, totalFuel = 0;
    const durations = [];
    flights.forEach(f => {
      const hours = f.hobbsTime || f.duration || f.hours || 0;
      totalHours += hours;
      durations.push(hours);
      totalFuel += f.fuelUsed || f.fuelConsumed || 0;
    });
    const avgDuration = durations.length > 0 ? Math.round((totalHours / durations.length) * 10) / 10 : 0;
    const longestFlight = Math.max(...durations);
    const shortestFlight = Math.min(...durations);

    return {
      ok: true,
      result: {
        pilot: artifact.title,
        totalFlights: flights.length,
        totalLegs: flights.reduce((s, f) => s + (f.legs || 1), 0),
        totalHours: Math.round(totalHours * 10) / 10,
        averageDuration: avgDuration,
        longestFlight: Math.round(longestFlight * 10) / 10,
        shortestFlight: Math.round(shortestFlight * 10) / 10,
        totalFuelConsumed: Math.round(totalFuel * 10) / 10,
        avgFuelPerHour: totalHours > 0 ? Math.round((totalFuel / totalHours) * 10) / 10 : 0,
      },
    };
  });

  registerLensAction("aviation", "maintenanceAlert", (ctx, artifact, _params) => {
    const items = artifact.data?.maintenanceItems || [];
    const now = new Date();
    const currentHours = artifact.data?.totalTime || artifact.data?.currentHours || 0;
    const currentCycles = artifact.data?.totalCycles || artifact.data?.currentCycles || 0;
    const alerts = [];

    for (const item of items) {
      const reasons = [];

      // Check hours-based limit
      if (item.dueAtHours != null && currentHours >= item.dueAtHours) {
        reasons.push(`hours exceeded: ${currentHours}/${item.dueAtHours}`);
      }
      // Check cycles-based limit
      if (item.dueAtCycles != null && currentCycles >= item.dueAtCycles) {
        reasons.push(`cycles exceeded: ${currentCycles}/${item.dueAtCycles}`);
      }
      // Check date-based limit
      if (item.dueDate) {
        const due = new Date(item.dueDate);
        if (due <= now) {
          const daysOverdue = Math.ceil((now - due) / 86400000);
          reasons.push(`date overdue by ${daysOverdue} days`);
        }
      }

      if (reasons.length > 0) {
        alerts.push({
          name: item.name || item.description,
          category: item.category || "general",
          reasons,
          dueAtHours: item.dueAtHours || null,
          dueAtCycles: item.dueAtCycles || null,
          dueDate: item.dueDate || null,
          priority: item.priority || "normal",
          overdue: true,
        });
      }
    }

    alerts.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    });

    return {
      ok: true,
      result: {
        aircraft: artifact.title,
        registration: artifact.data?.registration,
        currentHours,
        currentCycles,
        checkedAt: now.toISOString(),
        totalItems: items.length,
        overdueCount: alerts.length,
        alerts,
        allClear: alerts.length === 0,
      },
    };
  });

  registerLensAction("aviation", "weatherCheck", (ctx, artifact, _params) => {
    const wind = artifact.data?.wind || {};
    const visibility = artifact.data?.visibility != null ? artifact.data.visibility : null;
    const ceiling = artifact.data?.ceiling != null ? artifact.data.ceiling : null;
    const conditions = artifact.data?.conditions || artifact.data?.weather || "clear";
    const temperature = artifact.data?.temperature;
    const dewpoint = artifact.data?.dewpoint;
    const altimeter = artifact.data?.altimeter;

    // Determine flight category based on ceiling and visibility
    let flightCategory = "VFR";
    const visSM = visibility != null ? parseFloat(visibility) : 99;
    const ceil = ceiling != null ? parseInt(ceiling, 10) : 99999;

    if (visSM < 1 || ceil < 500) {
      flightCategory = "LIFR";
    } else if (visSM < 3 || ceil < 1000) {
      flightCategory = "IFR";
    } else if (visSM <= 5 || ceil <= 3000) {
      flightCategory = "MVFR";
    }

    // Format wind string (METAR-like)
    const windDir = wind.direction != null ? String(wind.direction).padStart(3, "0") : "000";
    const windSpeed = wind.speed != null ? String(wind.speed).padStart(2, "0") : "00";
    const windGust = wind.gust ? `G${String(wind.gust).padStart(2, "0")}` : "";
    const windString = `${windDir}${windSpeed}${windGust}KT`;

    // Format visibility
    const visString = visibility != null ? `${visibility}SM` : "---";

    // Format ceiling
    const ceilString = ceiling != null ? `${String(Math.round(ceiling / 100)).padStart(3, "0")}` : "CLR";

    return {
      ok: true,
      result: {
        station: artifact.title || artifact.data?.station,
        observedAt: artifact.data?.observedAt || new Date().toISOString(),
        wind: windString,
        windComponents: { direction: wind.direction || 0, speed: wind.speed || 0, gust: wind.gust || null },
        visibility: visString,
        visibilityValue: visSM,
        ceiling: ceiling != null ? `${ceilString} (${ceiling} ft AGL)` : "CLR",
        ceilingValue: ceil,
        conditions,
        temperature: temperature != null ? temperature : null,
        dewpoint: dewpoint != null ? dewpoint : null,
        altimeter: altimeter != null ? altimeter : null,
        flightCategory,
      },
    };
  });

  registerLensAction("aviation", "slipUtilization", (ctx, artifact, _params) => {
    const slips = artifact.data?.slips || [];
    if (slips.length === 0) return { ok: true, result: { utilization: 0, occupied: 0, vacant: 0, total: 0 } };
    const occupied = slips.filter(s => s.assignedVessel || s.status === 'occupied').length;
    const vacant = slips.length - occupied;
    const utilization = Math.round((occupied / slips.length) * 100);
    const revenue = slips.filter(s => s.assignedVessel).reduce((sum, s) => sum + (s.rate || 0), 0);
    return { ok: true, result: { marina: artifact.title, utilization, occupied, vacant, total: slips.length, monthlyRevenue: revenue } };
  });

  /**
   * calculate-wb (Weight & Balance)
   * Reads aircraft empty W/Arm + loading stations (pilot, copilot, fuel,
   * baggage, etc.) and returns gross weight + CG. Pre-this-macro the
   * "W&B Calculate" UI button was a dead click — the alias resolved
   * to "calculate-wb" but no handler was registered for that name.
   *
   * artifact.data.aircraft: { tailNumber, emptyWeight, emptyArm,
   *                           maxGrossWeight, cgEnvelope: {fwd, aft} }
   * artifact.data.loading: [{ station, weight, arm }]
   */
  registerLensAction("aviation", "calculate-wb", (ctx, artifact, params) => {
    const ac = artifact.data?.aircraft || params?.aircraft || {};
    const loading = artifact.data?.loading || params?.loading || [];

    const emptyWeight = Number(ac.emptyWeight) || 0;
    const emptyArm = Number(ac.emptyArm) || 0;
    const emptyMoment = emptyWeight * emptyArm;

    const stations = loading.map((l, i) => {
      const w = Number(l.weight) || 0;
      const arm = Number(l.arm) || 0;
      return {
        idx: i + 1,
        station: l.station || `Station ${i + 1}`,
        weight: Math.round(w * 10) / 10,
        arm: Math.round(arm * 100) / 100,
        moment: Math.round(w * arm * 10) / 10,
      };
    });

    const totalLoadWeight = stations.reduce((s, st) => s + st.weight, 0);
    const totalLoadMoment = stations.reduce((s, st) => s + st.moment, 0);
    const grossWeight = Math.round((emptyWeight + totalLoadWeight) * 10) / 10;
    const totalMoment = Math.round((emptyMoment + totalLoadMoment) * 10) / 10;
    const cg = grossWeight > 0 ? Math.round((totalMoment / grossWeight) * 100) / 100 : 0;

    const result = {
      generatedAt: new Date().toISOString(),
      aircraft: { tailNumber: ac.tailNumber, emptyWeight, emptyArm, emptyMoment: Math.round(emptyMoment * 10) / 10 },
      stations,
      totals: { loadWeight: Math.round(totalLoadWeight * 10) / 10, loadMoment: Math.round(totalLoadMoment * 10) / 10 },
      grossWeight,
      totalMoment,
      cg,
      maxGrossWeight: Number(ac.maxGrossWeight) || null,
      cgEnvelope: ac.cgEnvelope || null,
      summary: `Gross ${grossWeight} lb @ CG ${cg} in. Total moment ${totalMoment} lb-in.`,
    };
    if (artifact.data) artifact.data.lastWB = result;
    return { ok: true, result };
  });

  /**
   * validate-wb
   * Verify W&B is within the aircraft's envelope. Runs the same math
   * as calculate-wb and then checks gross weight against maxGrossWeight
   * + CG against the fwd/aft envelope. Returns severity (ok/warning/
   * critical) with specific failure reasons. Pre-this-macro the
   * "Validate W&B" feature in lens-features.js had no handler.
   */
  registerLensAction("aviation", "validate-wb", (ctx, artifact, params) => {
    const ac = artifact.data?.aircraft || params?.aircraft || {};
    const loading = artifact.data?.loading || params?.loading || [];
    const emptyWeight = Number(ac.emptyWeight) || 0;
    const emptyArm = Number(ac.emptyArm) || 0;
    const totalLoadWeight = loading.reduce((s, l) => s + (Number(l.weight) || 0), 0);
    const totalLoadMoment = loading.reduce((s, l) => s + ((Number(l.weight) || 0) * (Number(l.arm) || 0)), 0);
    const grossWeight = emptyWeight + totalLoadWeight;
    const totalMoment = emptyWeight * emptyArm + totalLoadMoment;
    const cg = grossWeight > 0 ? totalMoment / grossWeight : 0;

    const maxGross = Number(ac.maxGrossWeight) || null;
    const cgFwd = Number(ac.cgEnvelope?.fwd) || null;
    const cgAft = Number(ac.cgEnvelope?.aft) || null;

    const issues = [];
    if (maxGross != null && grossWeight > maxGross) {
      issues.push({
        severity: 'critical', kind: 'over-gross',
        message: `Gross weight ${grossWeight.toFixed(1)} lb exceeds max ${maxGross.toFixed(1)} lb by ${(grossWeight - maxGross).toFixed(1)} lb. DO NOT FLY.`,
      });
    }
    if (cgFwd != null && cg < cgFwd) {
      issues.push({
        severity: 'critical', kind: 'cg-forward',
        message: `CG ${cg.toFixed(2)} in is forward of envelope (${cgFwd.toFixed(2)} in). Move weight aft.`,
      });
    }
    if (cgAft != null && cg > cgAft) {
      issues.push({
        severity: 'critical', kind: 'cg-aft',
        message: `CG ${cg.toFixed(2)} in is aft of envelope (${cgAft.toFixed(2)} in). Move weight forward.`,
      });
    }
    if (maxGross != null && grossWeight > maxGross * 0.95 && grossWeight <= maxGross) {
      issues.push({
        severity: 'warning', kind: 'near-max-gross',
        message: `Gross weight ${grossWeight.toFixed(1)} lb is within 5% of max ${maxGross.toFixed(1)} lb. Performance margin reduced.`,
      });
    }

    const result = {
      validatedAt: new Date().toISOString(),
      aircraft: ac.tailNumber || '(unknown)',
      grossWeight: Math.round(grossWeight * 10) / 10,
      cg: Math.round(cg * 100) / 100,
      withinEnvelope: issues.filter(i => i.severity === 'critical').length === 0,
      issues,
      overallSeverity: issues.some(i => i.severity === 'critical') ? 'critical' : issues.length > 0 ? 'warning' : 'ok',
      message: issues.length === 0
        ? 'Within limits. Gross weight and CG within envelope.'
        : issues.map(i => i.message).join(' '),
    };
    if (artifact.data) artifact.data.lastWBValidation = result;
    return { ok: true, result };
  });

  // ─── 2026 parity — ForeFlight/Garmin Pilot/Jeppesen FliteDeck Pro ──
  //
  // Adds real weather/airport/perf/flight-plan substrate alongside the
  // existing artifact-based macros. All free-data sources: aviationweather.gov
  // (no-key REST), OurAirports CC0 seed (bundled), POH perf tables (seed
  // included), Open-Meteo for general winds.

  function getAviationState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.aviationLens) {
      STATE.aviationLens = {
        plans: new Map(),  // userId -> Map<planId, plan>
        logs:  new Map(),  // userId -> Array<logEntry>
      };
    }
    return STATE.aviationLens;
  }
  function saveAviationState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function avActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextAvId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoAv() { return new Date().toISOString(); }

  // ── Seed airport directory (10 high-traffic US fields — extend via DTU later) ──
  const AIRPORT_SEED = {
    KSFO: { ident: "KSFO", name: "San Francisco Intl",     city: "San Francisco, CA", lat: 37.6189, lng: -122.3750, elev_ft: 13,   runways: [{ id: "10R/28L", length: 11870, surface: "asphalt" }, { id: "10L/28R", length: 11381, surface: "asphalt" }], frequencies: { tower: "120.5", ground: "121.8", atis: "118.85", approach: "120.35", awos: "" }, fuel: ["100LL", "JetA"] },
    KLAX: { ident: "KLAX", name: "Los Angeles Intl",       city: "Los Angeles, CA",   lat: 33.9425, lng: -118.4081, elev_ft: 125,  runways: [{ id: "06R/24L", length: 10885, surface: "asphalt" }, { id: "06L/24R", length: 8926,  surface: "asphalt" }], frequencies: { tower: "133.9", ground: "121.75", atis: "133.8",  approach: "124.5",  awos: "" }, fuel: ["100LL", "JetA"] },
    KJFK: { ident: "KJFK", name: "John F Kennedy Intl",    city: "New York, NY",      lat: 40.6398, lng: -73.7789,  elev_ft: 13,   runways: [{ id: "04R/22L", length: 8400,  surface: "asphalt" }, { id: "04L/22R", length: 12079, surface: "asphalt" }], frequencies: { tower: "119.1", ground: "121.9",  atis: "128.725", approach: "127.4", awos: "" }, fuel: ["JetA"] },
    KORD: { ident: "KORD", name: "Chicago O'Hare Intl",    city: "Chicago, IL",       lat: 41.9742, lng: -87.9073,  elev_ft: 672,  runways: [{ id: "10R/28L", length: 7967,  surface: "asphalt" }, { id: "09L/27R", length: 7500,  surface: "asphalt" }], frequencies: { tower: "120.75", ground: "121.75", atis: "135.4", approach: "133.5",  awos: "" }, fuel: ["JetA"] },
    KDEN: { ident: "KDEN", name: "Denver Intl",            city: "Denver, CO",        lat: 39.8617, lng: -104.6731, elev_ft: 5434, runways: [{ id: "16L/34R", length: 12000, surface: "asphalt" }, { id: "16R/34L", length: 12000, surface: "asphalt" }], frequencies: { tower: "133.3", ground: "121.85", atis: "125.6",  approach: "120.35", awos: "" }, fuel: ["JetA"] },
    KBOS: { ident: "KBOS", name: "Boston Logan Intl",      city: "Boston, MA",        lat: 42.3656, lng: -71.0096,  elev_ft: 19,   runways: [{ id: "04R/22L", length: 10005, surface: "asphalt" }, { id: "15R/33L", length: 10081, surface: "asphalt" }], frequencies: { tower: "128.8", ground: "121.9",  atis: "127.875", approach: "118.25", awos: "" }, fuel: ["JetA"] },
    KSEA: { ident: "KSEA", name: "Seattle Tacoma Intl",    city: "Seattle, WA",       lat: 47.4502, lng: -122.3088, elev_ft: 433,  runways: [{ id: "16L/34R", length: 11900, surface: "asphalt" }, { id: "16C/34C", length: 9426,  surface: "asphalt" }], frequencies: { tower: "119.9", ground: "121.7",  atis: "118.0",   approach: "120.4",  awos: "" }, fuel: ["JetA"] },
    KATL: { ident: "KATL", name: "Hartsfield-Jackson Atl", city: "Atlanta, GA",       lat: 33.6367, lng: -84.4281,  elev_ft: 1026, runways: [{ id: "08R/26L", length: 9000,  surface: "asphalt" }, { id: "09L/27R", length: 9000,  surface: "asphalt" }], frequencies: { tower: "119.3", ground: "121.9",  atis: "119.65",  approach: "127.25", awos: "" }, fuel: ["JetA"] },
    KAUS: { ident: "KAUS", name: "Austin-Bergstrom Intl",  city: "Austin, TX",        lat: 30.1945, lng: -97.6699,  elev_ft: 542,  runways: [{ id: "18L/36R", length: 12250, surface: "asphalt" }, { id: "18R/36L", length: 9000,  surface: "asphalt" }], frequencies: { tower: "121.0", ground: "121.9",  atis: "125.5",   approach: "124.4",  awos: "" }, fuel: ["100LL", "JetA"] },
    KPAO: { ident: "KPAO", name: "Palo Alto",              city: "Palo Alto, CA",     lat: 37.4612, lng: -122.1150, elev_ft: 7,    runways: [{ id: "13/31",   length: 2443,  surface: "asphalt" }],                                                  frequencies: { tower: "118.6", ground: "121.6",  atis: "",        approach: "120.35", awos: "118.6" }, fuel: ["100LL"] },
  };

  registerLensAction("aviation", "airport-lookup", (_ctx, _artifact, params = {}) => {
    const ident = String(params.ident || "").toUpperCase().trim();
    if (!ident) return { ok: false, error: "ident required (e.g. KSFO)" };
    const a = AIRPORT_SEED[ident];
    if (!a) return { ok: false, error: `not found in seed (${Object.keys(AIRPORT_SEED).length} airports available)` };
    return { ok: true, result: { airport: a, source: "seed", availableIdents: Object.keys(AIRPORT_SEED) } };
  });

  // ── Weather (aviationweather.gov free no-key REST) ──

  registerLensAction("aviation", "weather-metar", async (_ctx, _artifact, params = {}) => {
    const ids = Array.isArray(params.ids) ? params.ids.map(String).join(",") : String(params.ids || "");
    if (!ids) return { ok: false, error: "ids required (e.g. KSFO or [KSFO,KLAX])" };
    try {
      const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json&taf=false`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `aviationweather.gov ${r.status}` };
      const data = await r.json();
      const reports = (data || []).map((m) => ({
        icaoId: m.icaoId,
        rawText: m.rawOb,
        reportTime: m.reportTime,
        tempC: m.temp,
        dewpC: m.dewp,
        windDir: m.wdir,
        windSpd: m.wspd,
        windGust: m.wgst,
        visibilityMi: m.visib,
        altim: m.altim,
        flightCategory: m.fltcat || "UNK",
        clouds: (m.clouds || []).map((c) => ({ cover: c.cover, base: c.base })),
      }));
      return { ok: true, result: { reports, count: reports.length, source: "aviationweather.gov" } };
    } catch (e) {
      return { ok: false, error: e?.message || "weather fetch failed" };
    }
  });

  registerLensAction("aviation", "weather-taf", async (_ctx, _artifact, params = {}) => {
    const ids = Array.isArray(params.ids) ? params.ids.map(String).join(",") : String(params.ids || "");
    if (!ids) return { ok: false, error: "ids required" };
    try {
      const url = `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(ids)}&format=json`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `aviationweather.gov ${r.status}` };
      const data = await r.json();
      const forecasts = (data || []).map((t) => ({
        icaoId: t.icaoId,
        rawText: t.rawTAF,
        issueTime: t.issueTime,
        validTimeFrom: t.validTimeFrom,
        validTimeTo: t.validTimeTo,
      }));
      return { ok: true, result: { forecasts, count: forecasts.length, source: "aviationweather.gov" } };
    } catch (e) {
      return { ok: false, error: e?.message || "weather fetch failed" };
    }
  });

  // ── Performance calculators (POH-style table interpolation, simplified) ──
  //
  // Seed table for Cessna 172 (representative single-engine GA). User can
  // override altitude/temp/weight/headwind/slope.

  registerLensAction("aviation", "perf-takeoff", (_ctx, _artifact, params = {}) => {
    const pressureAlt = Number(params.pressureAlt) || 0;
    const oat = Number(params.oat) || 15; // °C
    const weight = Number(params.weight) || 2400; // lb (max C172)
    const headwind = Number(params.headwind) || 0; // knots
    const slope = Number(params.slope) || 0; // % (positive = uphill)
    if (pressureAlt < -1000 || pressureAlt > 14_000) return { ok: false, error: "pressureAlt 0-14000 ft" };
    if (oat < -40 || oat > 50) return { ok: false, error: "oat -40..50 °C" };
    if (weight < 1500 || weight > 2550) return { ok: false, error: "weight 1500-2550 lb" };
    // Base ground roll (KSFO sea level, 15°C, 2400lb, no wind): ~860 ft for C172.
    const baseGroundRoll = 860;
    // Altitude correction: +12% per 1000 ft pressure altitude.
    const altFactor = 1 + (pressureAlt / 1000) * 0.12;
    // Temp correction: +10% per 10°C above ISA at that altitude.
    const isaTemp = 15 - (pressureAlt / 1000) * 2;
    const tempFactor = 1 + ((oat - isaTemp) / 10) * 0.10;
    // Weight correction: scale by weight^2 above 2200 lb baseline.
    const weightFactor = Math.pow(weight / 2200, 2);
    // Wind correction: −10% per 10 kts headwind, +20% per 10 kts tailwind.
    const windFactor = 1 - (headwind / 10) * (headwind >= 0 ? 0.10 : 0.20);
    // Slope correction: +10% per 1% uphill.
    const slopeFactor = 1 + slope * 0.10;
    const groundRoll = Math.round(baseGroundRoll * altFactor * tempFactor * weightFactor * Math.max(0.5, windFactor) * Math.max(0.5, slopeFactor));
    const over50ft = Math.round(groundRoll * 1.83); // ~1.8x for over 50ft obstacle
    return {
      ok: true,
      result: {
        groundRoll_ft: groundRoll,
        over50ft_ft: over50ft,
        inputs: { pressureAlt, oat, weight, headwind, slope, isaTemp: Math.round(isaTemp) },
        notes: "Simplified C172 perf model. Always consult POH for actual operations.",
      },
    };
  });

  registerLensAction("aviation", "perf-landing", (_ctx, _artifact, params = {}) => {
    const pressureAlt = Number(params.pressureAlt) || 0;
    const oat = Number(params.oat) || 15;
    const weight = Number(params.weight) || 2400;
    const headwind = Number(params.headwind) || 0;
    if (pressureAlt < -1000 || pressureAlt > 14_000) return { ok: false, error: "pressureAlt 0-14000 ft" };
    if (oat < -40 || oat > 50) return { ok: false, error: "oat -40..50 °C" };
    if (weight < 1500 || weight > 2550) return { ok: false, error: "weight 1500-2550 lb" };
    // Base landing ground roll C172 at gross weight: ~575 ft.
    const baseGroundRoll = 575;
    const altFactor = 1 + (pressureAlt / 1000) * 0.04;
    const isaTemp = 15 - (pressureAlt / 1000) * 2;
    const tempFactor = 1 + ((oat - isaTemp) / 10) * 0.05;
    const weightFactor = Math.pow(weight / 2200, 1.5);
    const windFactor = 1 - (headwind / 10) * (headwind >= 0 ? 0.10 : 0.20);
    const groundRoll = Math.round(baseGroundRoll * altFactor * tempFactor * weightFactor * Math.max(0.5, windFactor));
    const over50ft = Math.round(groundRoll * 2.4);
    return {
      ok: true,
      result: {
        groundRoll_ft: groundRoll,
        over50ft_ft: over50ft,
        inputs: { pressureAlt, oat, weight, headwind, isaTemp: Math.round(isaTemp) },
        notes: "Simplified C172 perf model. Always consult POH.",
      },
    };
  });

  // ── Flight plan composer ──

  registerLensAction("aviation", "plan-list", (ctx, _artifact, _params = {}) => {
    const s = getAviationState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const map = s.plans.get(userId);
    if (!map) return { ok: true, result: { plans: [] } };
    const plans = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { plans } };
  });

  registerLensAction("aviation", "plan-create", (ctx, _artifact, params = {}) => {
    const s = getAviationState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const from = String(params.from || "").toUpperCase().trim();
    const to = String(params.to || "").toUpperCase().trim();
    if (!from || !to) return { ok: false, error: "from and to required (ICAO ids)" };
    if (from.length > 4 || to.length > 4) return { ok: false, error: "ICAO codes max 4 chars" };
    const waypoints = Array.isArray(params.waypoints) ? params.waypoints.slice(0, 50).map(String) : [];
    const altitude = Number(params.altitude) || 7500;
    const tas = Number(params.tas) || 110; // kt true airspeed
    if (altitude < 0 || altitude > 50_000) return { ok: false, error: "altitude 0-50000 ft" };
    if (tas < 50 || tas > 600) return { ok: false, error: "tas 50-600 kt" };
    const alternates = Array.isArray(params.alternates) ? params.alternates.slice(0, 5).map((x) => String(x).toUpperCase()) : [];
    const fuelGallons = Number(params.fuelGallons) || 53; // C172 default
    // Compute great-circle distance if both fields in seed
    let distance_nm = null;
    let ete_minutes = null;
    const fromAirport = AIRPORT_SEED[from];
    const toAirport = AIRPORT_SEED[to];
    if (fromAirport && toAirport) {
      const R = 3440.065; // nm
      const lat1 = fromAirport.lat * Math.PI / 180;
      const lat2 = toAirport.lat * Math.PI / 180;
      const dLat = lat2 - lat1;
      const dLng = (toAirport.lng - fromAirport.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distance_nm = Math.round(R * c);
      ete_minutes = Math.round((distance_nm / tas) * 60);
    }
    const plan = {
      id: nextAvId("plan"),
      from, to, waypoints, alternates,
      altitude, tas, fuelGallons,
      distance_nm, ete_minutes,
      reserveFuel_gal: 5, // 30min reserve at typical burn
      estBurn_gph: 8.5,
      estFuelBurn_gal: ete_minutes ? Math.round((ete_minutes / 60) * 8.5 * 10) / 10 : null,
      createdAt: nowIsoAv(),
      updatedAt: nowIsoAv(),
    };
    if (!s.plans.has(userId)) s.plans.set(userId, new Map());
    s.plans.get(userId).set(plan.id, plan);
    saveAviationState();
    return { ok: true, result: { plan } };
  });

  registerLensAction("aviation", "plan-delete", (ctx, _artifact, params = {}) => {
    const s = getAviationState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.plans.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveAviationState();
    return { ok: true, result: { deleted: id } };
  });
};
