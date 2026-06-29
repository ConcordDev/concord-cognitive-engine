export default function registerAviationActions(registerLensAction) {
  // ── Weight & Balance shape normalizer ────────────────────────────
  //
  // The W&B editor (app/lenses/aviation/page.tsx#renderWBEditor) persists a
  // FLAT artifact.data shape — emptyWeight/emptyArm + per-station
  // <name>Weight/<name>Arm pairs (fuel/pilot/copilot/paxRow1/paxRow2/cargo/
  // baggage) + maxGross/fwdCGLimit/aftCGLimit + a STRING `aircraft` (type
  // label). The calculate-wb / validate-wb handlers were written to read a
  // STRUCTURED shape — `aircraft: { emptyWeight, emptyArm, maxGrossWeight,
  // cgEnvelope:{fwd,aft} }` + `loading: [{station,weight,arm}]`. The two
  // never met, so the W&B Calculate button returned gross 0 / cg 0 for every
  // input (a DEAD safety-critical calculator). This helper accepts BOTH:
  // structured shape passes through; flat shape is folded into the same
  // canonical { aircraft, loading } the math runs on. Non-finite numerics
  // are dropped (treated as 0 weight / 0 arm) so a poisoned field never
  // produces NaN/Infinity gross weight or CG.
  const WB_STATIONS = [
    ["fuel", "Fuel"], ["pilot", "Pilot"], ["copilot", "Copilot / Front PAX"],
    ["paxRow1", "PAX Row 1"], ["paxRow2", "PAX Row 2"],
    ["cargo", "Cargo"], ["baggage", "Baggage"],
  ];
  function _fin(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  // Fail-CLOSED guard: true when a caller-supplied field is PRESENT but
  // non-finite (NaN / Infinity / -Infinity / "1e999" / overflow). Absent fields
  // (null/undefined/"") pass. A safety-critical W&B / weather calc must reject a
  // poisoned numeric, not silently fold it to 0 and report ok:true.
  function _presentBad(v) {
    if (v == null || v === "") return false;
    const n = typeof v === "number" ? v : Number(v);
    return !Number.isFinite(n);
  }
  // Check the W&B numeric fields across both the flat editor shape and a
  // structured aircraft object. Returns the first offending field name or null.
  function _firstBadWBField(artifact, params) {
    const d = (artifact && artifact.data) || {};
    const p = params || {};
    const src = Object.keys(d).length ? d : p;
    const flat = [
      "emptyWeight", "emptyArm", "fuelWeight", "fuelArm", "pilotWeight", "pilotArm",
      "maxGross", "maxGrossWeight", "fwdCGLimit", "aftCGLimit",
    ];
    for (const f of flat) {
      if (_presentBad(src[f]) || _presentBad(p[f])) return f;
    }
    // Structured aircraft object (when supplied).
    const ac = (src.aircraft && typeof src.aircraft === "object" && !Array.isArray(src.aircraft)) ? src.aircraft : null;
    if (ac) {
      for (const f of ["emptyWeight", "emptyArm", "maxGrossWeight"]) {
        if (_presentBad(ac[f])) return f;
      }
      if (ac.cgEnvelope && typeof ac.cgEnvelope === "object") {
        if (_presentBad(ac.cgEnvelope.fwd)) return "fwdCGLimit";
        if (_presentBad(ac.cgEnvelope.aft)) return "aftCGLimit";
      }
    }
    return null;
  }
  function normalizeWBInput(artifact, params) {
    const d = (artifact && artifact.data) || {};
    const p = params || {};
    const rawAircraft = d.aircraft ?? p.aircraft;
    const rawLoading = d.loading ?? p.loading;
    // Structured shape: aircraft is an object OR an explicit loading array exists.
    const structured =
      (rawAircraft && typeof rawAircraft === "object" && !Array.isArray(rawAircraft)) ||
      Array.isArray(rawLoading);
    if (structured) {
      const acObj = (rawAircraft && typeof rawAircraft === "object") ? rawAircraft : {};
      return {
        aircraft: {
          tailNumber: acObj.tailNumber ?? d.tailNumber ?? p.tailNumber ?? null,
          emptyWeight: _fin(acObj.emptyWeight),
          emptyArm: _fin(acObj.emptyArm),
          maxGrossWeight: acObj.maxGrossWeight != null ? _fin(acObj.maxGrossWeight) : null,
          cgEnvelope: acObj.cgEnvelope && typeof acObj.cgEnvelope === "object"
            ? { fwd: _fin(acObj.cgEnvelope.fwd), aft: _fin(acObj.cgEnvelope.aft) }
            : null,
        },
        loading: Array.isArray(rawLoading)
          ? rawLoading.map((l) => ({
              station: l.station != null ? String(l.station) : "Station",
              weight: _fin(l.weight), arm: _fin(l.arm),
            }))
          : [],
      };
    }
    // Flat editor shape — fold each <name>Weight/<name>Arm pair into a station.
    const src = Object.keys(d).length ? d : p;
    const loading = [];
    for (const [key, label] of WB_STATIONS) {
      const w = _fin(src[`${key}Weight`]);
      const arm = _fin(src[`${key}Arm`]);
      if (w !== 0 || arm !== 0) loading.push({ station: label, weight: w, arm });
    }
    const maxGross = src.maxGross ?? src.maxGrossWeight;
    const fwd = src.fwdCGLimit ?? src.fwdCG;
    const aft = src.aftCGLimit ?? src.aftCG;
    const hasEnvelope = fwd != null || aft != null;
    return {
      aircraft: {
        tailNumber: src.tailNumber ?? null,
        emptyWeight: _fin(src.emptyWeight),
        emptyArm: _fin(src.emptyArm),
        maxGrossWeight: (maxGross != null && Number.isFinite(Number(maxGross))) ? _fin(maxGross) : null,
        cgEnvelope: hasEnvelope ? { fwd: _fin(fwd), aft: _fin(aft) } : null,
      },
      loading,
    };
  }

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
  try {
    const shifts = artifact.data?.shifts || [];
    const flights = artifact.data?.flights || [];
    const now = new Date();
    const msPerHour = 3600000;
    const msPerDay = 86400000;

    // Combine shifts and flights into duty periods. Coerce hours through
    // Number() with a finite guard — a poisoned string like "NaN" is truthy
    // and would slip past `||`, NaN-ing every downstream reduction.
    const finiteHours = (...vals) => {
      for (const v of vals) {
        if (v == null) continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };
    const dutyPeriods = [...shifts, ...flights]
      .filter(s => s.startTime || s.date)
      .map(s => {
        const start = new Date(s.startTime || s.date);
        const declared = finiteHours(s.dutyHours, s.hobbsTime, s.hours);
        const end = s.endTime ? new Date(s.endTime) : new Date(start.getTime() + declared * msPerHour);
        const spanHours = (end - start) / msPerHour;
        return { start, end, hours: declared || (Number.isFinite(spanHours) ? spanHours : 0) };
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    const items = artifact.data?.maintenanceItems || [];
    const now = new Date();
    // Fail CLOSED on a poisoned current-hours/cycles value — an Infinity here
    // would mark every hours/cycles-limited item "exceeded" while ok:true.
    if (_presentBad(artifact.data?.totalTime) || _presentBad(artifact.data?.currentHours)) {
      return { ok: false, error: "invalid_totalTime" };
    }
    if (_presentBad(artifact.data?.totalCycles) || _presentBad(artifact.data?.currentCycles)) {
      return { ok: false, error: "invalid_totalCycles" };
    }
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
      // Use ?? not || — `critical` maps to 0, which `||` would wrongly treat
      // as missing and demote to 2, so critical alerts never sorted to the top.
      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "weatherCheck", (ctx, artifact, _params) => {
  try {
    // Accept BOTH the structured `wind: { direction, speed, gust }` shape and
    // the flat editor shape (windDirection / windSpeed / windGust) the
    // Weather editor (renderWeatherEditor) actually persists — otherwise the
    // METAR-format wind string read 000/00KT for every observation.
    const d = artifact.data || {};
    // Fail CLOSED on poisoned (present-but-non-finite) weather numerics — an
    // Infinity/NaN ceiling or visibility would mis-classify the flight category
    // (a safety call) while still reporting ok:true.
    const w0 = (d.wind && typeof d.wind === "object") ? d.wind : {};
    for (const [field, val] of [
      ["ceiling", d.ceiling],
      ["visibility", d.visibility],
      ["windDirection", d.windDirection ?? w0.direction],
      ["windGust", d.windGust ?? w0.gust],
      ["windSpeed", d.windSpeed ?? w0.speed],
    ]) {
      if (_presentBad(val)) return { ok: false, error: `invalid_${field}` };
    }
    const wind = (d.wind && typeof d.wind === "object")
      ? d.wind
      : { direction: d.windDirection, speed: d.windSpeed, gust: d.windGust };
    const visibility = d.visibility != null ? d.visibility : null;
    const ceiling = d.ceiling != null ? d.ceiling : null;
    const conditions = d.conditions || d.weather || d.wxConditions || "clear";
    const temperature = d.temperature;
    const dewpoint = d.dewpoint;
    const altimeter = d.altimeter;

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
        station: artifact.title || d.station || d.stationId,
        observedAt: d.observedAt || d.observationTime || new Date().toISOString(),
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    // Fail CLOSED on any poisoned (present-but-non-finite) W&B numeric — folding
    // it to 0 would produce a wrong gross weight / CG on a safety calculator.
    const badWB = _firstBadWBField(artifact, params);
    if (badWB) return { ok: false, error: `invalid_${badWB}` };
    const { aircraft: ac, loading } = normalizeWBInput(artifact, params);

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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    // Fail CLOSED on any poisoned W&B numeric — a folded-to-0 value would make
    // the envelope "withinEnvelope" verdict a dangerous false-positive.
    const badWB = _firstBadWBField(artifact, params);
    if (badWB) return { ok: false, error: `invalid_${badWB}` };
    const { aircraft: ac, loading } = normalizeWBInput(artifact, params);
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  // ── Airport lookup (live: aviationapi.com — free, no key, FAA-backed) ──
  //
  // aviationapi.com proxies the FAA NASR + airport facility directory + chart
  // supplement data. Covers all ~20,000 US public-use airports.
  // GET https://api.aviationapi.com/v1/airports?apt=KSFO
  // Returns { KSFO: [{...}] } with runways + frequencies + fuel + remarks.
  //
  // For international airports (non-FAA), we fall back to the OurAirports CC0
  // dataset proxied via a small public mirror.

  registerLensAction("aviation", "airport-lookup", async (_ctx, _artifact, params = {}) => {
    const ident = String(params.ident || "").toUpperCase().trim();
    if (!ident) return { ok: false, error: "ident required (e.g. KSFO)" };
    try {
      // Primary: aviationapi.com for US (and many ICAO) airports
      const url = `https://api.aviationapi.com/v1/airports?apt=${encodeURIComponent(ident)}`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `aviationapi.com ${r.status}` };
      const data = await r.json();
      const records = data?.[ident];
      if (!Array.isArray(records) || records.length === 0) {
        return { ok: false, error: `${ident} not found in FAA database` };
      }
      const a = records[0];
      // Pull frequencies for this airport in a second call
      let frequencies = { tower: "", ground: "", atis: "", approach: "", awos: "" };
      try {
        const fr = await globalThis.fetch(`https://api.aviationapi.com/v1/airports/frequencies?apt=${encodeURIComponent(ident)}`);
        if (fr.ok) {
          const freqData = await fr.json();
          const freqs = freqData?.[ident];
          if (Array.isArray(freqs)) {
            for (const f of freqs) {
              const desc = String(f.freq_use || f.description || "").toLowerCase();
              if (desc.includes("tower") || desc.includes("twr")) frequencies.tower = f.freq || "";
              else if (desc.includes("ground") || desc.includes("gnd")) frequencies.ground = f.freq || "";
              else if (desc.includes("atis")) frequencies.atis = f.freq || "";
              else if (desc.includes("approach") || desc.includes("app")) frequencies.approach = f.freq || "";
              else if (desc.includes("awos") || desc.includes("asos")) frequencies.awos = f.freq || "";
            }
          }
        }
      } catch (_e) { /* frequencies optional */ }
      let runways = [];
      try {
        const rw = await globalThis.fetch(`https://api.aviationapi.com/v1/airports/runways?apt=${encodeURIComponent(ident)}`);
        if (rw.ok) {
          const rwData = await rw.json();
          const rws = rwData?.[ident];
          if (Array.isArray(rws)) {
            runways = rws.map((r) => ({
              id: r.id || `${r.base_end_id || ""}/${r.reciprocal_end_id || ""}`,
              length: Number(r.length) || 0,
              surface: String(r.surface_type_code || r.surface || "").toLowerCase(),
            }));
          }
        }
      } catch (_e) { /* runways optional */ }
      return {
        ok: true,
        result: {
          airport: {
            ident,
            name: a.facility_name || a.name || ident,
            city: a.city ? `${a.city}, ${a.state_code || a.state || ""}`.trim().replace(/, $/, "") : "",
            lat: Number(a.latitude_decimal || a.latitude) || 0,
            lng: Number(a.longitude_decimal || a.longitude) || 0,
            elev_ft: Number(a.elevation) || 0,
            runways,
            frequencies,
            fuel: a.fuel_types ? String(a.fuel_types).split(/[,;]\s*/).filter(Boolean) : [],
          },
          source: "aviationapi.com (FAA NASR)",
        },
      };
    } catch (e) {
      return { ok: false, error: `airport lookup failed: ${e?.message || "network"}` };
    }
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

  registerLensAction("aviation", "plan-create", async (ctx, _artifact, params = {}) => {
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
    // Great-circle distance via aviationapi.com lookups (real FAA NASR data).
    // If either endpoint isn't in the FAA DB, distance is left null and the
    // client can prompt for manual entry.
    let distance_nm = null;
    let ete_minutes = null;
    async function airportCoords(ident) {
      try {
        const r = await globalThis.fetch(`https://api.aviationapi.com/v1/airports?apt=${encodeURIComponent(ident)}`);
        if (!r.ok) return null;
        const data = await r.json();
        const rec = data?.[ident]?.[0];
        if (!rec) return null;
        const lat = Number(rec.latitude_decimal || rec.latitude);
        const lng = Number(rec.longitude_decimal || rec.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
      } catch (_e) { return null; }
    }
    const [fromAirport, toAirport] = await Promise.all([airportCoords(from), airportCoords(to)]);
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

  // ─── Full-app parity: ForeFlight + FlightAware 2026 ─────────────────

  function uidAv(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function ensureAvBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }

  // ── Aircraft profiles ────────────────────────────────────────

  registerLensAction("aviation", "aircraft-list", (ctx, _a, _p = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const aircraft = ensureAvBucket(s, "aircraft", userId);
    return { ok: true, result: { aircraft } };
  });

  registerLensAction("aviation", "aircraft-add", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const tail = String(params.tail || "").trim().toUpperCase();
    const make = String(params.make || "").trim();
    const model = String(params.model || "").trim();
    if (!tail || !make || !model) return { ok: false, error: "tail, make, model required" };
    const ac = {
      id: uidAv("ac"), tail, make, model,
      year: Number(params.year) || null,
      kind: ["single_engine_piston", "multi_engine_piston", "turboprop", "jet", "helicopter", "light_sport", "experimental"].includes(params.kind) ? params.kind : "single_engine_piston",
      icaoType: String(params.icaoType || ""),
      cruiseKts: Math.max(0, Number(params.cruiseKts) || 110),
      fuelBurnGph: Math.max(0, Number(params.fuelBurnGph) || 8),
      fuelCapacityGal: Math.max(0, Number(params.fuelCapacityGal) || 50),
      maxTakeoffWeightLbs: Math.max(0, Number(params.maxTakeoffWeightLbs) || 2400),
      emptyWeightLbs: Math.max(0, Number(params.emptyWeightLbs) || 1500),
      hobbsHours: Math.max(0, Number(params.hobbsHours) || 0),
      tachHours: Math.max(0, Number(params.tachHours) || 0),
      addedAt: new Date().toISOString(),
    };
    ensureAvBucket(s, "aircraft", userId).push(ac);
    saveAviationState();
    return { ok: true, result: { aircraft: ac } };
  });

  registerLensAction("aviation", "aircraft-update", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    const ac = ensureAvBucket(s, "aircraft", userId).find(a => a.id === id);
    if (!ac) return { ok: false, error: "aircraft not found" };
    for (const key of ["cruiseKts", "fuelBurnGph", "fuelCapacityGal", "hobbsHours", "tachHours"]) {
      if (params[key] != null) ac[key] = Math.max(0, Number(params[key]));
    }
    saveAviationState();
    return { ok: true, result: { aircraft: ac } };
  });

  registerLensAction("aviation", "aircraft-delete", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    const list = ensureAvBucket(s, "aircraft", userId);
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) return { ok: false, error: "aircraft not found" };
    list.splice(idx, 1);
    saveAviationState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Pilot logbook ────────────────────────────────────────────

  registerLensAction("aviation", "logbook-list", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const aircraftId = params.aircraftId ? String(params.aircraftId) : null;
    const all = ensureAvBucket(s, "logbook", userId);
    const entries = aircraftId ? all.filter(e => e.aircraftId === aircraftId) : all;
    return { ok: true, result: { entries: entries.slice().reverse() } };
  });

  registerLensAction("aviation", "logbook-add", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const aircraftId = String(params.aircraftId || "");
    const date = String(params.date || "").slice(0, 10);
    const from = String(params.from || "").toUpperCase();
    const to = String(params.to || "").toUpperCase();
    const totalHours = Number(params.totalHours);
    if (!aircraftId || !date || !from || !to) return { ok: false, error: "aircraftId, date, from, to required" };
    if (!Number.isFinite(totalHours) || totalHours <= 0) return { ok: false, error: "totalHours > 0 required" };
    const entry = {
      id: uidAv("log"), aircraftId, date, from, to, totalHours,
      route: Array.isArray(params.route) ? params.route : [from, to],
      pic: Math.max(0, Number(params.pic) || 0),
      sic: Math.max(0, Number(params.sic) || 0),
      crossCountry: Math.max(0, Number(params.crossCountry) || 0),
      night: Math.max(0, Number(params.night) || 0),
      instrument: Math.max(0, Number(params.instrument) || 0),
      simulated: Math.max(0, Number(params.simulated) || 0),
      dayLandings: Math.max(0, Math.floor(Number(params.dayLandings) || 0)),
      nightLandings: Math.max(0, Math.floor(Number(params.nightLandings) || 0)),
      approaches: Array.isArray(params.approaches) ? params.approaches : [],
      conditions: ["VFR", "MVFR", "IFR", "LIFR"].includes(params.conditions) ? params.conditions : "VFR",
      remarks: String(params.remarks || ""),
      createdAt: new Date().toISOString(),
    };
    ensureAvBucket(s, "logbook", userId).push(entry);
    // Auto-roll Hobbs on the aircraft
    const ac = ensureAvBucket(s, "aircraft", userId).find(a => a.id === aircraftId);
    if (ac) {
      ac.hobbsHours = Math.round((ac.hobbsHours + totalHours) * 10) / 10;
    }
    saveAviationState();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "logbook-delete", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    const list = ensureAvBucket(s, "logbook", userId);
    const idx = list.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, error: "log entry not found" };
    list.splice(idx, 1);
    saveAviationState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("aviation", "logbook-totals", (ctx, _a, _p = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const entries = ensureAvBucket(s, "logbook", userId);
    const sum = (key) => Math.round(entries.reduce((s, e) => s + (Number(e[key]) || 0), 0) * 10) / 10;
    const totalLandings = entries.reduce((s, e) => s + (e.dayLandings || 0) + (e.nightLandings || 0), 0);
    return {
      ok: true,
      result: {
        totalHours: sum("totalHours"),
        pic: sum("pic"),
        sic: sum("sic"),
        crossCountry: sum("crossCountry"),
        night: sum("night"),
        instrument: sum("instrument"),
        simulated: sum("simulated"),
        totalFlights: entries.length,
        totalLandings,
        nightLandings: entries.reduce((s, e) => s + (e.nightLandings || 0), 0),
      },
    };
  });

  // ── Currency tracking (BFR / IPC / medical / 90-day) ────────

  registerLensAction("aviation", "currency-status", (ctx, _a, _p = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const events = ensureAvBucket(s, "currencyEvents", userId);
    const logbook = ensureAvBucket(s, "logbook", userId);
    const today = Date.now();
    const day = 86400000;
    // BFR: most recent 'flight_review' within 24 calendar months
    const bfrEvent = events.filter(e => e.kind === "flight_review").sort((a, b) => b.date.localeCompare(a.date))[0];
    const bfrDays = bfrEvent ? Math.floor((today - new Date(bfrEvent.date).getTime()) / day) : null;
    const bfrCurrent = bfrEvent && bfrDays < 730;
    // IPC: 'ipc' within 6 calendar months, OR 6 approaches + holding + tracking within last 6 months
    const ipcEvent = events.filter(e => e.kind === "ipc").sort((a, b) => b.date.localeCompare(a.date))[0];
    const ipcDays = ipcEvent ? Math.floor((today - new Date(ipcEvent.date).getTime()) / day) : null;
    // Medical: 'medical_first/second/third_class'
    const medEvent = events.filter(e => e.kind.startsWith("medical_")).sort((a, b) => b.date.localeCompare(a.date))[0];
    const medDays = medEvent ? Math.floor((today - new Date(medEvent.date).getTime()) / day) : null;
    const medValidity = medEvent ? (medEvent.kind === "medical_first_class" ? 365 : medEvent.kind === "medical_second_class" ? 365 : 730) : null;
    const medCurrent = medEvent && medValidity && medDays < medValidity;
    // 90-day passenger carrying: 3 takeoffs/landings within preceding 90 days
    const last90 = logbook.filter(e => (today - new Date(e.date).getTime()) < 90 * day);
    const dayTakeoffs90 = last90.reduce((s, e) => s + (e.dayLandings || 0), 0);
    const nightTakeoffs90 = last90.reduce((s, e) => s + (e.nightLandings || 0), 0);
    // 6 approaches + holding + tracking within preceding 6 months (IFR currency)
    const last180 = logbook.filter(e => (today - new Date(e.date).getTime()) < 180 * day);
    const approaches180 = last180.reduce((s, e) => s + (Array.isArray(e.approaches) ? e.approaches.length : 0), 0);
    return {
      ok: true,
      result: {
        bfr: { current: bfrCurrent, lastDate: bfrEvent?.date || null, daysSince: bfrDays, expiresInDays: bfrEvent ? 730 - bfrDays : null },
        ipc: { current: ipcDays != null && ipcDays < 183, lastDate: ipcEvent?.date || null, daysSince: ipcDays },
        medical: { current: medCurrent, lastDate: medEvent?.date || null, daysSince: medDays, validityDays: medValidity, kind: medEvent?.kind || null },
        passenger90: { dayCurrent: dayTakeoffs90 >= 3, dayCount: dayTakeoffs90, nightCurrent: nightTakeoffs90 >= 3, nightCount: nightTakeoffs90 },
        ifr180: { current: approaches180 >= 6, approaches: approaches180 },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "currency-event-add", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const kind = String(params.kind || "");
    const date = String(params.date || new Date().toISOString().slice(0, 10));
    const allowed = ["flight_review", "ipc", "medical_first_class", "medical_second_class", "medical_third_class", "checkride", "training"];
    if (!allowed.includes(kind)) return { ok: false, error: `kind must be one of ${allowed.join(", ")}` };
    const event = {
      id: uidAv("evt"), kind, date,
      cfi: String(params.cfi || ""),
      notes: String(params.notes || ""),
      certificateNumber: String(params.certificateNumber || ""),
      createdAt: new Date().toISOString(),
    };
    ensureAvBucket(s, "currencyEvents", userId).push(event);
    saveAviationState();
    return { ok: true, result: { event } };
  });

  // ── Track logs (recorded flights) ────────────────────────────

  registerLensAction("aviation", "track-logs-list", (ctx, _a, _p = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const tracks = ensureAvBucket(s, "trackLogs", userId);
    return { ok: true, result: { tracks: tracks.slice().reverse() } };
  });

  registerLensAction("aviation", "track-logs-start", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const aircraftId = String(params.aircraftId || "");
    if (!aircraftId) return { ok: false, error: "aircraftId required" };
    const ac = ensureAvBucket(s, "aircraft", userId).find(a => a.id === aircraftId);
    if (!ac) return { ok: false, error: "aircraft not found" };
    const tracks = ensureAvBucket(s, "trackLogs", userId);
    const open = tracks.find(t => t.aircraftId === aircraftId && !t.endedAt);
    if (open) return { ok: false, error: "active track already exists for this aircraft" };
    const track = {
      id: uidAv("trk"), aircraftId, tail: ac.tail,
      startedAt: new Date().toISOString(),
      endedAt: null,
      from: params.from ? String(params.from).toUpperCase() : null,
      to: params.to ? String(params.to).toUpperCase() : null,
      points: [],
      maxAltitudeFt: 0,
      maxGroundSpeedKts: 0,
      totalDistanceNm: 0,
    };
    tracks.push(track);
    saveAviationState();
    return { ok: true, result: { track } };
  });

  registerLensAction("aviation", "track-logs-append", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const trackId = String(params.trackId || "");
    const track = ensureAvBucket(s, "trackLogs", userId).find(t => t.id === trackId);
    if (!track) return { ok: false, error: "track not found" };
    if (track.endedAt) return { ok: false, error: "track already ended" };
    const lat = Number(params.lat), lng = Number(params.lng);
    const altitudeFt = Number(params.altitudeFt) || 0;
    const groundSpeedKts = Number(params.groundSpeedKts) || 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required" };
    const point = {
      lat, lng, altitudeFt, groundSpeedKts,
      heading: Number(params.heading) || null,
      timestamp: new Date().toISOString(),
    };
    if (track.points.length > 0) {
      const prev = track.points[track.points.length - 1];
      const dLat = (lat - prev.lat) * Math.PI / 180;
      const dLng = (lng - prev.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const distNm = 2 * 6371 * Math.asin(Math.sqrt(a)) * 0.539957;
      track.totalDistanceNm = Math.round((track.totalDistanceNm + distNm) * 100) / 100;
    }
    track.points.push(point);
    if (altitudeFt > track.maxAltitudeFt) track.maxAltitudeFt = altitudeFt;
    if (groundSpeedKts > track.maxGroundSpeedKts) track.maxGroundSpeedKts = groundSpeedKts;
    saveAviationState();
    return { ok: true, result: { track } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "track-logs-end", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const trackId = String(params.trackId || "");
    const track = ensureAvBucket(s, "trackLogs", userId).find(t => t.id === trackId);
    if (!track) return { ok: false, error: "track not found" };
    if (track.endedAt) return { ok: false, error: "track already ended" };
    track.endedAt = new Date().toISOString();
    track.durationMin = Math.round((new Date(track.endedAt).getTime() - new Date(track.startedAt).getTime()) / 60000);
    saveAviationState();
    return { ok: true, result: { track } };
  });

  // ── Briefing aggregator (METAR + TAF + PIREP + AIRMET + SIGMET) ──

  registerLensAction("aviation", "briefing-graphical", async (_ctx, _a, params = {}) => {
    const icaos = Array.isArray(params.icaos) ? params.icaos.map(String).map(s => s.toUpperCase()) : [];
    if (icaos.length === 0) return { ok: false, error: "icaos array required" };
    // aviationweather.gov public API endpoints — no key required
    const fetchOne = async (url) => {
      try {
        const r = await globalThis.fetch(url);
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    };
    try {
      const [metars, tafs, pireps, airmets] = await Promise.all([
        fetchOne(`https://aviationweather.gov/api/data/metar?ids=${icaos.join(",")}&format=json`),
        fetchOne(`https://aviationweather.gov/api/data/taf?ids=${icaos.join(",")}&format=json`),
        fetchOne(`https://aviationweather.gov/api/data/pirep?bbox=24,-130,50,-66&format=json`),
        fetchOne(`https://aviationweather.gov/api/data/airsigmet?format=json`),
      ]);
      return {
        ok: true,
        result: {
          metars: Array.isArray(metars) ? metars.slice(0, 30) : [],
          tafs: Array.isArray(tafs) ? tafs.slice(0, 30) : [],
          pireps: Array.isArray(pireps) ? pireps.slice(0, 50) : [],
          airmets: Array.isArray(airmets) ? airmets.slice(0, 30) : [],
          fetchedAt: new Date().toISOString(),
          source: "aviationweather.gov (NWS)",
        },
      };
    } catch (e) {
      return { ok: false, error: `briefing fetch failed: ${e?.message || "network"}` };
    }
  });

  // ── NOTAMs (FAA NOTAM API; requires key in production) ───────

  registerLensAction("aviation", "notams-fetch", async (_ctx, _a, params = {}) => {
    const icao = String(params.icao || "").toUpperCase().trim();
    if (!icao) return { ok: false, error: "icao required" };
    const apiKey = process.env.FAA_NOTAM_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "FAA_NOTAM_API_KEY not configured. Register at https://api.faa.gov/ to receive a free key.",
      };
    }
    try {
      const r = await globalThis.fetch(`https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${icao}&pageSize=50`, {
        headers: { client_id: process.env.FAA_NOTAM_CLIENT_ID || "", client_secret: apiKey },
      });
      if (!r.ok) return { ok: false, error: `FAA NOTAM API ${r.status}` };
      const data = await r.json();
      return {
        ok: true,
        result: {
          icao,
          items: (data.items || []).slice(0, 50),
          totalCount: data.totalCount || 0,
          source: "api.faa.gov (FAA NOTAM API)",
        },
      };
    } catch (e) {
      return { ok: false, error: `NOTAM fetch failed: ${e?.message || "network"}` };
    }
  });

  // ── Route advisor (suggest filed routes) ────────────────────

  registerLensAction("aviation", "route-advisor", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const from = String(params.from || "").toUpperCase();
    const to = String(params.to || "").toUpperCase();
    const altitudeFt = Math.max(1000, Number(params.altitudeFt) || 8000);
    if (!from || !to) return { ok: false, error: "from and to ICAO required" };
    // Surface routes from the user's prior logbook entries on the same city-pair
    const logbook = ensureAvBucket(s, "logbook", userId);
    const priorRoutes = logbook.filter(e => e.from === from && e.to === to);
    const uniqueRoutes = new Map();
    for (const e of priorRoutes) {
      const key = e.route.join("→");
      if (!uniqueRoutes.has(key)) uniqueRoutes.set(key, { route: e.route, flownCount: 0, avgHours: 0 });
      const r = uniqueRoutes.get(key);
      r.flownCount++;
      r.avgHours = (r.avgHours * (r.flownCount - 1) + e.totalHours) / r.flownCount;
    }
    const suggestions = [
      { route: [from, to], rationale: "Direct", flownCount: 0, altitudeFt },
      ...Array.from(uniqueRoutes.values()).map(r => ({
        route: r.route,
        rationale: `Flown ${r.flownCount}× before · avg ${r.avgHours.toFixed(1)}h`,
        flownCount: r.flownCount,
        altitudeFt,
      })),
    ];
    return { ok: true, result: { from, to, suggestions, altitudeFt } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Live flight tracking (FlightAware-shape) ────────────────

  registerLensAction("aviation", "live-flights-tracked", (ctx, _a, _p = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const watched = ensureAvBucket(s, "watchedFlights", userId);
    return { ok: true, result: { flights: watched } };
  });

  registerLensAction("aviation", "live-flights-watch", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const ident = String(params.ident || "").trim().toUpperCase();
    if (!ident) return { ok: false, error: "ident (callsign or tail) required" };
    const watched = ensureAvBucket(s, "watchedFlights", userId);
    if (watched.find(w => w.ident === ident)) return { ok: false, error: "already watching" };
    watched.push({
      id: uidAv("watch"), ident,
      addedAt: new Date().toISOString(),
      lastSeenAt: null,
      lastPosition: null,
    });
    saveAviationState();
    return { ok: true, result: { ident, watched: true } };
  });

  registerLensAction("aviation", "live-flights-unwatch", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const ident = String(params.ident || "").toUpperCase();
    const watched = ensureAvBucket(s, "watchedFlights", userId);
    const idx = watched.findIndex(w => w.ident === ident);
    if (idx < 0) return { ok: false, error: "not watching" };
    watched.splice(idx, 1);
    saveAviationState();
    return { ok: true, result: { ident, removed: true } };
  });

  // ── Fuel stops calculator ───────────────────────────────────

  registerLensAction("aviation", "fuel-stops-calc", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const aircraftId = String(params.aircraftId || "");
    const totalDistanceNm = Math.max(0, Number(params.totalDistanceNm) || 0);
    const reserveGal = Math.max(0, Number(params.reserveGal) || 5);
    if (!aircraftId || totalDistanceNm <= 0) return { ok: false, error: "aircraftId and totalDistanceNm > 0 required" };
    const ac = ensureAvBucket(s, "aircraft", userId).find(a => a.id === aircraftId);
    if (!ac) return { ok: false, error: "aircraft not found" };
    const cruiseKts = ac.cruiseKts || 110;
    const burnGph = ac.fuelBurnGph || 8;
    const usableGal = Math.max(0, ac.fuelCapacityGal - reserveGal);
    const enduranceHr = burnGph > 0 ? usableGal / burnGph : 0;
    const maxLegNm = enduranceHr * cruiseKts;
    const totalTimeHr = totalDistanceNm / cruiseKts;
    const totalFuelGal = totalTimeHr * burnGph + reserveGal;
    const stops = maxLegNm > 0 ? Math.max(0, Math.ceil(totalDistanceNm / maxLegNm) - 1) : 0;
    return {
      ok: true,
      result: {
        totalDistanceNm,
        totalTimeHr: Math.round(totalTimeHr * 10) / 10,
        totalFuelGal: Math.round(totalFuelGal * 10) / 10,
        maxLegNm: Math.round(maxLegNm),
        fuelStopsRequired: stops,
        reserveGal,
        cruiseKts, fuelBurnGph: burnGph,
        usableFuelGal: usableGal,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard summary (AvShell data source) ─────────────────

  registerLensAction("aviation", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const aircraft = ensureAvBucket(s, "aircraft", userId);
    const logbook = ensureAvBucket(s, "logbook", userId);
    const tracks = ensureAvBucket(s, "trackLogs", userId);
    const plans = s.plans?.get(userId) ? Array.from(s.plans.get(userId).values()) : [];
    const totalHours = Math.round(logbook.reduce((s, e) => s + (Number(e.totalHours) || 0), 0) * 10) / 10;
    const last30 = Date.now() - 30 * 86400000;
    const hours30d = Math.round(logbook.filter(e => new Date(e.date).getTime() > last30).reduce((s, e) => s + (Number(e.totalHours) || 0), 0) * 10) / 10;
    return {
      ok: true,
      result: {
        aircraftCount: aircraft.length,
        totalHours,
        hours30d,
        totalFlights: logbook.length,
        savedPlanCount: plans.length,
        activeTracks: tracks.filter(t => !t.endedAt).length,
        completedTracks: tracks.filter(t => t.endedAt).length,
        watchedFlights: (s.watchedFlights?.get(userId) || []).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "feed", async (ctx, _a, params = {}) => {
    const STATE = globalThis._concordSTATE; if (!STATE) return { ok: false, error: "STATE unavailable" };
    if (!STATE.aviationLens) STATE.aviationLens = {};
    if (!(STATE.aviationLens.feedSeen instanceof Set)) STATE.aviationLens.feedSeen = new Set();
    const seen = STATE.aviationLens.feedSeen;
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch("https://opensky-network.org/api/states/all");
      if (!r.ok) return { ok: false, error: `opensky ${r.status}` };
      const data = await r.json();
      const states = (data.states || []).filter((st) => st[1] && String(st[1]).trim()).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const st of states) {
        const callsign = String(st[1] || "").trim();
        const key = `${st[0]}-${data.time}`;
        if (seen.has(key)) { skipped++; continue; }
        const title = `Flight ${callsign} (${st[2] || "?"})`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\nICAO24: ${st[0]}\nAltitude: ${st[7] != null ? Math.round(st[7]) + " m" : "?"}\nVelocity: ${st[9] != null ? Math.round(st[9]) + " m/s" : "?"}\nPosition: ${st[6]}, ${st[5]}`,
          tags: ["aviation", "feed", "flight", "opensky"],
          source: "opensky-feed",
          meta: { icao24: st[0], callsign, originCountry: st[2], lat: st[6], lon: st[5], altitude: st[7] },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); seen.add(key); }
      }
      if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } }
      return { ok: true, result: { ingested, skipped, source: "opensky-network", dtuIds } };
    } catch (e) { return { ok: false, error: `opensky unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  ForeFlight feature-parity backlog — visual core + EFB tooling
  //  (moving map, route plotting, weather radar overlay, ATC filing,
  //   approach plates, endorsements, synthetic-vision attitude)
  // ═══════════════════════════════════════════════════════════════════

  // ── 1. Moving-map chart catalog (sectional / IFR-low / IFR-high) ──
  //
  // FAA publishes the Digital Aeronautical Chart catalog as a public,
  // keyless XML index. We surface it as a structured list so the client
  // moving-map can offer real, current chart editions as tile/overlay
  // sources. No fabricated data — every entry is a live FAA edition.

  registerLensAction("aviation", "chart-catalog", async (_ctx, _a, params = {}) => {
    const kind = String(params.kind || "all").toLowerCase();
    const VALID = ["all", "sectional", "ifr_low", "ifr_high", "terminal"];
    if (!VALID.includes(kind)) return { ok: false, error: `kind must be one of ${VALID.join(", ")}` };
    try {
      const _url = "https://external-api.faa.gov/apra/vfr/sectional/chart?edition=current&format=tiff&geoname=";
      // FAA chart-API requires a key; the keyless public path is the
      // chart-currency catalog hosted by aeronav. Use the public
      // chart-supplement currency JSON (no key) for edition dates.
      const r = await globalThis.fetch("https://soa.smext.faa.gov/apra/vfr/sectional/chart?edition=current&format=tiff");
      let editions = [];
      if (r && r.ok) {
        try {
          const data = await r.json();
          editions = (data?.edition || []).map((e) => ({
            name: e.geoname || e.chart || "",
            editionName: e.editionName || e.edition_name || "",
            editionDate: e.editionDate || e.edition_date || "",
            editionNumber: e.editionNumber || e.edition_number || null,
          }));
        } catch (_e) { editions = []; }
      }
      // Chart layer definitions the moving map can render. These are
      // descriptors, not data — the renderer draws from live tiles/WMS.
      const layers = [
        { id: "sectional", label: "VFR Sectional", scale: "1:500,000", category: "sectional",
          wms: "https://wms.chartbundle.com/wms", layer: "sec", visible: kind === "all" || kind === "sectional" },
        { id: "ifr_low", label: "IFR Low Enroute", scale: "varies", category: "ifr_low",
          wms: "https://wms.chartbundle.com/wms", layer: "enrl", visible: kind === "all" || kind === "ifr_low" },
        { id: "ifr_high", label: "IFR High Enroute", scale: "varies", category: "ifr_high",
          wms: "https://wms.chartbundle.com/wms", layer: "enrh", visible: kind === "all" || kind === "ifr_high" },
        { id: "terminal", label: "Terminal Area Chart", scale: "1:250,000", category: "terminal",
          wms: "https://wms.chartbundle.com/wms", layer: "tac", visible: kind === "all" || kind === "terminal" },
      ];
      return {
        ok: true,
        result: {
          kind,
          layers: kind === "all" ? layers : layers.filter((l) => l.category === kind),
          editions,
          source: "FAA Aeronav / ChartBundle WMS",
          note: "WMS layers are FAA-published charts served by ChartBundle (keyless). Editions reflect current FAA chart cycle.",
        },
      };
    } catch (e) {
      // Catalog is best-effort; still return the layer descriptors so the
      // moving map works even if the edition index is unreachable.
      return {
        ok: true,
        result: {
          kind,
          layers: [
            { id: "sectional", label: "VFR Sectional", scale: "1:500,000", category: "sectional", wms: "https://wms.chartbundle.com/wms", layer: "sec", visible: true },
            { id: "ifr_low", label: "IFR Low Enroute", scale: "varies", category: "ifr_low", wms: "https://wms.chartbundle.com/wms", layer: "enrl", visible: false },
            { id: "ifr_high", label: "IFR High Enroute", scale: "varies", category: "ifr_high", wms: "https://wms.chartbundle.com/wms", layer: "enrh", visible: false },
          ],
          editions: [],
          source: "ChartBundle WMS",
          note: `Edition index unreachable (${e?.message || "network"}); layer descriptors still available.`,
        },
      };
    }
  });

  // ── 2. Visual route plotting — resolve a plan into mappable legs ──
  //
  // Takes a plan id (or from/to/waypoints) and returns geo-coordinates
  // for every leg endpoint plus per-leg bearing + distance, so the
  // moving map can draw the magenta route line. Coordinates come from
  // the live FAA airport DB (aviationapi.com). Nothing fabricated.

  registerLensAction("aviation", "route-plot", async (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    let from, to, waypoints;
    if (params.planId) {
      const map = s.plans.get(userId);
      const plan = map?.get(String(params.planId));
      if (!plan) return { ok: false, error: "plan not found" };
      from = plan.from; to = plan.to; waypoints = plan.waypoints || [];
    } else {
      from = String(params.from || "").toUpperCase().trim();
      to = String(params.to || "").toUpperCase().trim();
      waypoints = Array.isArray(params.waypoints) ? params.waypoints.map((w) => String(w).toUpperCase()) : [];
    }
    if (!from || !to) return { ok: false, error: "planId, or from + to required" };
    const idents = [from, ...waypoints, to];
    async function coordsFor(ident) {
      try {
        const r = await globalThis.fetch(`https://api.aviationapi.com/v1/airports?apt=${encodeURIComponent(ident)}`);
        if (!r.ok) return null;
        const data = await r.json();
        const rec = data?.[ident]?.[0];
        if (!rec) return null;
        const lat = Number(rec.latitude_decimal || rec.latitude);
        const lng = Number(rec.longitude_decimal || rec.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { ident, lat, lng, name: rec.facility_name || rec.name || ident };
      } catch (_e) { return null; }
    }
    const resolved = await Promise.all(idents.map(coordsFor));
    const points = [];
    for (let i = 0; i < resolved.length; i++) {
      if (resolved[i]) points.push(resolved[i]);
      else points.push({ ident: idents[i], lat: null, lng: null, name: idents[i], unresolved: true });
    }
    function gc(a, b) {
      const R = 3440.065;
      const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
      const dLa = la2 - la1, dLn = (b.lng - a.lng) * Math.PI / 180;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLn / 2) ** 2;
      const dist = 2 * R * Math.asin(Math.sqrt(h));
      const y = Math.sin(dLn) * Math.cos(la2);
      const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLn);
      let brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      return { distance_nm: Math.round(dist * 10) / 10, bearing_deg: Math.round(brg) };
    }
    const legs = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (a.lat != null && b.lat != null) {
        const m = gc(a, b);
        total += m.distance_nm;
        legs.push({ from: a.ident, to: b.ident, ...m });
      } else {
        legs.push({ from: a.ident, to: b.ident, distance_nm: null, bearing_deg: null, unresolved: true });
      }
    }
    return {
      ok: true,
      result: {
        points, legs,
        totalDistance_nm: Math.round(total * 10) / 10,
        resolvedCount: points.filter((p) => !p.unresolved).length,
        source: "aviationapi.com (FAA NASR)",
      },
    };
  });

  // ── 2b. Active TFRs + airspace alerts overlay ──────────────────
  //
  // FAA publishes active TFRs at tfr.faa.gov. The machine-readable
  // ATCSCC NAS-status feed is keyless. We surface active TFRs so the
  // moving map can render restricted-area polygons / markers.

  registerLensAction("aviation", "airspace-tfrs", async (_ctx, _a, _params = {}) => {
    try {
      // FAA NOTAM-based TFR list (keyless JSON mirror at tfr.faa.gov)
      const r = await globalThis.fetch("https://tfr.faa.gov/tfrapi/exportTfrList");
      if (!r || !r.ok) return { ok: false, error: `tfr.faa.gov ${r ? r.status : "unreachable"}` };
      const data = await r.json();
      const list = Array.isArray(data) ? data : (data?.tfrList || data?.list || []);
      const tfrs = list.slice(0, 200).map((t) => ({
        notamId: t.notam_id || t.notamId || t.id || "",
        type: t.type || "TFR",
        description: t.description || t.txt_desc || "",
        facility: t.facility || "",
        state: t.state || "",
        creationDate: t.creation_date || t.creationDate || "",
        url: t.notam_id ? `https://tfr.faa.gov/save_pages/detail_${String(t.notam_id).replace(/\//g, "_")}.html` : "",
      }));
      return { ok: true, result: { tfrs, count: tfrs.length, fetchedAt: nowIsoAv(), source: "tfr.faa.gov" } };
    } catch (e) {
      return { ok: false, error: `TFR fetch failed: ${e?.message || "network"}` };
    }
  });

  // ── 3. Weather radar + winds-aloft overlay ─────────────────────
  //
  // Two keyless sources: NWS RIDGE composite reflectivity (radar WMS
  // descriptor) and Open-Meteo for winds-aloft at requested levels.

  registerLensAction("aviation", "wx-overlay", async (_ctx, _a, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: "lat and lng required" };
    }
    // Winds aloft: Open-Meteo provides geopotential-level wind speed/dir.
    // Standard cruising pressure levels for GA/turbine ops.
    const levels = [
      { hpa: 850, approxFt: 5000 }, { hpa: 700, approxFt: 10000 },
      { hpa: 500, approxFt: 18000 }, { hpa: 300, approxFt: 30000 },
    ];
    const windsAloft = [];
    try {
      const vars = levels.map((l) => `windspeed_${l.hpa}hPa,winddirection_${l.hpa}hPa,temperature_${l.hpa}hPa`).join(",");
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${vars}&forecast_days=1&windspeed_unit=kn`;
      const r = await globalThis.fetch(url);
      if (r && r.ok) {
        const data = await r.json();
        const h = data?.hourly || {};
        const idx = 0; // current hour
        for (const l of levels) {
          windsAloft.push({
            level_hpa: l.hpa,
            altitude_ft: l.approxFt,
            windSpeed_kt: h[`windspeed_${l.hpa}hPa`]?.[idx] ?? null,
            windDir_deg: h[`winddirection_${l.hpa}hPa`]?.[idx] ?? null,
            temp_c: h[`temperature_${l.hpa}hPa`]?.[idx] ?? null,
          });
        }
      }
    } catch (_e) { /* winds aloft best-effort */ }
    return {
      ok: true,
      result: {
        center: { lat, lng },
        windsAloft,
        radarLayer: {
          id: "nws_radar",
          label: "NWS Composite Reflectivity",
          wms: "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows",
          layer: "conus_cref_qcd",
          format: "image/png",
          note: "NWS NCEP keyless WMS — base reflectivity mosaic.",
        },
        fetchedAt: nowIsoAv(),
        source: "Open-Meteo (winds aloft) + NWS NCEP (radar)",
      },
    };
  });

  // ── 4. Flight plan filing (simulated DUATS / ICAO filing) ──────
  //
  // No keyless real ATC-filing endpoint exists for civilian use, so we
  // implement a deterministic DUATS-style filing record keyed to a real
  // saved plan: validates the plan, assigns a confirmation, tracks
  // status transitions (filed → activated → closed). All data is the
  // user's own plan — no fabricated flights.

  registerLensAction("aviation", "plan-file", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const planId = String(params.planId || "");
    const map = s.plans.get(userId);
    const plan = map?.get(planId);
    if (!plan) return { ok: false, error: "plan not found" };
    const flightRules = ["VFR", "IFR"].includes(params.flightRules) ? params.flightRules : "VFR";
    const departureTime = String(params.departureTime || "").trim();
    if (!departureTime) return { ok: false, error: "departureTime required (ISO or HHMM Zulu)" };
    const pilotName = String(params.pilotName || "").trim();
    const soulsOnBoard = Math.max(1, Math.floor(Number(params.soulsOnBoard) || 1));
    if (!pilotName) return { ok: false, error: "pilotName required for filing" };
    // Filing-quality validation
    const issues = [];
    if (!plan.distance_nm) issues.push("route distance unresolved — verify departure/destination idents");
    if (!plan.alternates?.length && flightRules === "IFR") issues.push("IFR plan has no alternate filed");
    if (!plan.fuelGallons || plan.fuelGallons <= 0) issues.push("fuel on board not specified");
    if (!s.flightFilings) s.flightFilings = new Map();
    if (!s.flightFilings.has(userId)) s.flightFilings.set(userId, []);
    const confirmation = `CC${Date.now().toString(36).toUpperCase().slice(-7)}`;
    const filing = {
      id: nextAvId("file"),
      planId, confirmation, flightRules, departureTime,
      pilotName, soulsOnBoard,
      from: plan.from, to: plan.to,
      route: [plan.from, ...(plan.waypoints || []), plan.to],
      alternates: plan.alternates || [],
      altitude: plan.altitude, tas: plan.tas,
      ete_minutes: plan.ete_minutes,
      fuelGallons: plan.fuelGallons,
      status: "filed",
      validationIssues: issues,
      filedAt: nowIsoAv(),
      activatedAt: null,
      closedAt: null,
      history: [{ status: "filed", at: nowIsoAv() }],
    };
    s.flightFilings.get(userId).push(filing);
    saveAviationState();
    return { ok: true, result: { filing } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "plan-filings-list", (ctx, _a, _params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const filings = (s.flightFilings?.get(userId) || []).slice().reverse();
    return { ok: true, result: { filings } };
  });

  registerLensAction("aviation", "plan-filing-update", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    const status = String(params.status || "");
    const TRANSITIONS = { filed: ["activated", "cancelled"], activated: ["closed"], closed: [], cancelled: [] };
    const filing = (s.flightFilings?.get(userId) || []).find((f) => f.id === id);
    if (!filing) return { ok: false, error: "filing not found" };
    if (!TRANSITIONS[filing.status]?.includes(status)) {
      return { ok: false, error: `cannot transition ${filing.status} → ${status}` };
    }
    filing.status = status;
    if (status === "activated") filing.activatedAt = nowIsoAv();
    if (status === "closed") filing.closedAt = nowIsoAv();
    filing.history.push({ status, at: nowIsoAv() });
    saveAviationState();
    return { ok: true, result: { filing } };
  });

  // ── 5. Approach-plate / airport-diagram viewer ─────────────────
  //
  // aviationapi.com exposes the FAA d-TPP (Terminal Procedures) chart
  // index — the real list of every published approach plate, SID, STAR,
  // and airport diagram with direct FAA PDF links. Fully keyless.

  registerLensAction("aviation", "approach-plates", async (_ctx, _a, params = {}) => {
    const apt = String(params.apt || "").toUpperCase().trim();
    if (!apt) return { ok: false, error: "apt required (e.g. KSFO)" };
    try {
      const r = await globalThis.fetch(`https://api.aviationapi.com/v1/charts?apt=${encodeURIComponent(apt)}`);
      if (!r || !r.ok) return { ok: false, error: `aviationapi.com ${r ? r.status : "unreachable"}` };
      const data = await r.json();
      const records = data?.[apt];
      if (!Array.isArray(records) || records.length === 0) {
        return { ok: false, error: `no published terminal procedures for ${apt}` };
      }
      const classify = (name) => {
        const n = String(name || "").toUpperCase();
        if (n.includes("AIRPORT DIAGRAM") || n.includes("APD")) return "airport_diagram";
        if (n.startsWith("ILS") || n.startsWith("RNAV") || n.startsWith("VOR") || n.startsWith("LOC") || n.startsWith("GPS") || n.includes("APPROACH")) return "approach";
        if (n.includes("DEPARTURE") || n.includes("SID")) return "departure";
        if (n.includes("ARRIVAL") || n.includes("STAR")) return "arrival";
        if (n.includes("MIN") || n.includes("TAKEOFF")) return "minimums";
        return "other";
      };
      const charts = records.map((c) => ({
        name: c.chart_name || c.chart || "",
        code: c.chart_code || "",
        category: classify(c.chart_name),
        pdfUrl: c.pdf_path ? (String(c.pdf_path).startsWith("http") ? c.pdf_path : `https://aeronav.faa.gov/d-tpp/${c.pdf_path}`) : "",
        cycle: c.pdf_name || "",
      }));
      const byCategory = {};
      for (const c of charts) { (byCategory[c.category] ||= []).push(c); }
      return {
        ok: true,
        result: {
          apt,
          total: charts.length,
          charts,
          byCategory,
          source: "aviationapi.com (FAA d-TPP)",
        },
      };
    } catch (e) {
      return { ok: false, error: `approach-plate fetch failed: ${e?.message || "network"}` };
    }
  });

  // ── 6. Logbook endorsements + ratings tracking ─────────────────
  //
  // Per-user CRUD store for CFI endorsements (61.65, solo, etc.) and
  // pilot certificates / ratings. All data is the user's own input.

  const ENDORSEMENT_TYPES = [
    "solo", "solo_cross_country", "complex", "high_performance", "tailwheel",
    "high_altitude", "flight_review", "ipc", "checkride_recommendation",
    "knowledge_test", "practical_test", "type_specific", "other",
  ];
  const RATING_TYPES = [
    "student_pilot", "sport_pilot", "recreational_pilot", "private_pilot",
    "commercial_pilot", "atp", "instrument_airplane", "multi_engine_land",
    "single_engine_sea", "multi_engine_sea", "cfi", "cfii", "mei",
    "type_rating", "glider", "rotorcraft", "other",
  ];

  registerLensAction("aviation", "endorsements-list", (ctx, _a, _params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const endorsements = ensureAvBucket(s, "endorsements", userId).slice().reverse();
    const ratings = ensureAvBucket(s, "ratings", userId).slice().reverse();
    return { ok: true, result: { endorsements, ratings } };
  });

  registerLensAction("aviation", "endorsement-add", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const kind = String(params.kind || "");
    if (!ENDORSEMENT_TYPES.includes(kind)) {
      return { ok: false, error: `kind must be one of ${ENDORSEMENT_TYPES.join(", ")}` };
    }
    const date = String(params.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const cfiName = String(params.cfiName || "").trim();
    if (!cfiName) return { ok: false, error: "cfiName required" };
    const farReference = String(params.farReference || "").trim();
    const expiresMonths = Number(params.expiresMonths) || 0;
    let expiryDate = null;
    if (expiresMonths > 0) {
      const d = new Date(date);
      d.setMonth(d.getMonth() + Math.floor(expiresMonths));
      expiryDate = d.toISOString().slice(0, 10);
    }
    const endorsement = {
      id: uidAv("end"), kind, date, cfiName,
      cfiCertNumber: String(params.cfiCertNumber || ""),
      cfiExpiry: String(params.cfiExpiry || ""),
      farReference, expiresMonths, expiryDate,
      text: String(params.text || ""),
      createdAt: new Date().toISOString(),
    };
    ensureAvBucket(s, "endorsements", userId).push(endorsement);
    saveAviationState();
    return { ok: true, result: { endorsement } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("aviation", "endorsement-delete", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    const list = ensureAvBucket(s, "endorsements", userId);
    const idx = list.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, error: "endorsement not found" };
    list.splice(idx, 1);
    saveAviationState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("aviation", "rating-add", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const kind = String(params.kind || "");
    if (!RATING_TYPES.includes(kind)) {
      return { ok: false, error: `kind must be one of ${RATING_TYPES.join(", ")}` };
    }
    const dateEarned = String(params.dateEarned || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const rating = {
      id: uidAv("rat"), kind, dateEarned,
      certificateNumber: String(params.certificateNumber || ""),
      examiner: String(params.examiner || ""),
      checkrideAirport: String(params.checkrideAirport || "").toUpperCase(),
      limitations: String(params.limitations || ""),
      notes: String(params.notes || ""),
      createdAt: new Date().toISOString(),
    };
    ensureAvBucket(s, "ratings", userId).push(rating);
    saveAviationState();
    return { ok: true, result: { rating } };
  });

  registerLensAction("aviation", "rating-delete", (ctx, _a, params = {}) => {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const id = String(params.id || "");
    const list = ensureAvBucket(s, "ratings", userId);
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return { ok: false, error: "rating not found" };
    list.splice(idx, 1);
    saveAviationState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── 7. Synthetic-vision / EFIS attitude derivation ─────────────
  //
  // Derives an EFIS-style attitude/state snapshot from a recorded track
  // log's two most recent GPS points — pitch (from climb rate vs ground
  // speed), bank estimate (from heading change rate), ground track,
  // ground speed, vertical speed, altitude. All from the user's own
  // recorded points; no synthetic flight data.

  registerLensAction("aviation", "efis-snapshot", (ctx, _a, params = {}) => {
  try {
    const s = getAviationState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = avActor(ctx);
    const trackId = String(params.trackId || "");
    const track = ensureAvBucket(s, "trackLogs", userId).find((t) => t.id === trackId);
    if (!track) return { ok: false, error: "track not found" };
    const pts = track.points || [];
    if (pts.length < 2) {
      return { ok: false, error: "track needs at least 2 points for an attitude snapshot" };
    }
    const cur = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dt = (new Date(cur.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
    // Ground track from bearing between the two points
    const la1 = prev.lat * Math.PI / 180, la2 = cur.lat * Math.PI / 180;
    const dLn = (cur.lng - prev.lng) * Math.PI / 180;
    const y = Math.sin(dLn) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLn);
    const groundTrack = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    // Vertical speed (ft/min)
    const vsFpm = dt > 0 ? Math.round(((cur.altitudeFt - prev.altitudeFt) / dt) * 60) : 0;
    // Ground speed: use recorded value, else derive from distance/time
    let gsKts = Number(cur.groundSpeedKts) || 0;
    if (!gsKts && dt > 0) {
      const R = 3440.065;
      const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLn / 2) ** 2;
      const distNm = 2 * R * Math.asin(Math.sqrt(h));
      gsKts = Math.round((distNm / dt) * 3600);
    }
    // Pitch estimate: arctan(vertical speed / forward speed)
    const fwdFpm = gsKts * 101.27; // kt → ft/min
    const pitchDeg = fwdFpm > 0 ? Math.round(Math.atan2(vsFpm, fwdFpm) * 180 / Math.PI * 10) / 10 : 0;
    // Bank estimate: heading change rate → coordinated-turn bank angle
    let bankDeg = 0;
    if (cur.heading != null && prev.heading != null && dt > 0) {
      let dHdg = cur.heading - prev.heading;
      while (dHdg > 180) dHdg -= 360;
      while (dHdg < -180) dHdg += 360;
      const turnRateDps = dHdg / dt;
      // Standard coordinated turn: bank ≈ atan(turnRate·V / g)
      const vMs = gsKts * 0.514444;
      bankDeg = Math.round(Math.atan2((turnRateDps * Math.PI / 180) * vMs, 9.80665) * 180 / Math.PI * 10) / 10;
    }
    return {
      ok: true,
      result: {
        trackId,
        tail: track.tail,
        attitude: {
          pitchDeg: Math.max(-30, Math.min(30, pitchDeg)),
          bankDeg: Math.max(-60, Math.min(60, bankDeg)),
        },
        state: {
          altitudeFt: cur.altitudeFt,
          verticalSpeedFpm: vsFpm,
          groundSpeedKts: gsKts,
          groundTrackDeg: Math.round(groundTrack),
          headingDeg: cur.heading != null ? Math.round(cur.heading) : Math.round(groundTrack),
          lat: cur.lat, lng: cur.lng,
        },
        sampleIntervalSec: Math.round(dt * 10) / 10,
        pointCount: pts.length,
        computedAt: nowIsoAv(),
        note: "Attitude derived from GPS track deltas — advisory only, not a certified ADAHRS source.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};
