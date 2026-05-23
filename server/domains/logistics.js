// server/domains/logistics.js
// Domain actions for logistics: route optimization, HOS compliance, vehicle maintenance, inventory audit.

export default function registerLogisticsActions(registerLensAction) {
  /**
   * optimizeRoute
   * Reorder delivery stops for shortest total distance using nearest-neighbor heuristic.
   * artifact.data.stops: [{ stopId, name, lat, lng, timeWindowStart, timeWindowEnd, serviceMins }]
   * artifact.data.origin: { lat, lng } (starting point)
   */
  registerLensAction("logistics", "optimizeRoute", (ctx, artifact, params) => {
  try {
    const stops = artifact.data.stops || [];
    const origin = artifact.data.origin || params.origin || (stops.length > 0 ? { lat: stops[0].lat, lng: stops[0].lng } : null);
    const returnToOrigin = params.returnToOrigin !== false;

    if (stops.length === 0) {
      return { ok: true, result: { error: "No stops provided." } };
    }

    // Haversine distance in miles
    function haversine(lat1, lng1, lat2, lng2) {
      const R = 3958.8; // Earth radius in miles
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Nearest-neighbor greedy algorithm
    const remaining = stops.map((s, i) => ({ ...s, _idx: i }));
    const ordered = [];
    let currentLat = origin ? origin.lat : remaining[0].lat;
    let currentLng = origin ? origin.lng : remaining[0].lng;
    let totalDistance = 0;

    while (remaining.length > 0) {
      let nearest = null;
      let nearestDist = Infinity;
      let nearestIdx = -1;

      for (let i = 0; i < remaining.length; i++) {
        const d = haversine(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = remaining[i];
          nearestIdx = i;
        }
      }

      totalDistance += nearestDist;
      ordered.push({
        sequence: ordered.length + 1,
        stopId: nearest.stopId,
        name: nearest.name,
        lat: nearest.lat,
        lng: nearest.lng,
        distanceFromPrevious: Math.round(nearestDist * 100) / 100,
        cumulativeDistance: Math.round(totalDistance * 100) / 100,
        serviceMins: nearest.serviceMins || 15,
        timeWindowStart: nearest.timeWindowStart || null,
        timeWindowEnd: nearest.timeWindowEnd || null,
      });

      currentLat = nearest.lat;
      currentLng = nearest.lng;
      remaining.splice(nearestIdx, 1);
    }

    // Return leg
    if (returnToOrigin && origin) {
      const returnDist = haversine(currentLat, currentLng, origin.lat, origin.lng);
      totalDistance += returnDist;
    }

    // Estimate total time: assume 30 mph average speed + service time
    const avgSpeed = params.avgSpeedMph || 30;
    const totalDriveMinutes = Math.round((totalDistance / avgSpeed) * 60);
    const totalServiceMinutes = ordered.reduce((s, stop) => s + (stop.serviceMins || 0), 0);
    const totalMinutes = totalDriveMinutes + totalServiceMinutes;

    const result = {
      generatedAt: new Date().toISOString(),
      origin,
      stopCount: ordered.length,
      totalDistanceMiles: Math.round(totalDistance * 100) / 100,
      estimatedDriveMinutes: totalDriveMinutes,
      estimatedServiceMinutes: totalServiceMinutes,
      estimatedTotalMinutes: totalMinutes,
      returnToOrigin,
      optimizedRoute: ordered,
    };

    artifact.data.optimizedRoute = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * hosCheck
   * Verify driver hours of service against FMCSA regulations.
   * artifact.data.drivers: [{ driverId, name, logs: [{ date, drivingHours, onDutyHours, offDutyHours, sleeperHours }] }]
   * Regulations: 11-hour driving limit, 14-hour on-duty window, 60/70 hour 7/8-day limit
   */
  registerLensAction("logistics", "hosCheck", (ctx, artifact, params) => {
  try {
    const drivers = artifact.data.drivers || [];
    const cycleType = params.cycleType || "70-8"; // "60-7" or "70-8"
    const cycleDays = cycleType === "60-7" ? 7 : 8;
    const cycleLimit = cycleType === "60-7" ? 60 : 70;
    const drivingLimit = 11;
    const onDutyWindow = 14;

    const today = new Date();
    const results = [];

    for (const driver of drivers) {
      const logs = (driver.logs || []).sort((a, b) => new Date(b.date) - new Date(a.date));
      const todayLog = logs[0] || {};

      // Today's check
      const todayDriving = parseFloat(todayLog.drivingHours) || 0;
      const todayOnDuty = parseFloat(todayLog.onDutyHours) || 0;
      const drivingRemaining = Math.max(0, drivingLimit - todayDriving);
      const windowRemaining = Math.max(0, onDutyWindow - todayOnDuty);

      // Cycle check: sum on-duty hours in last N days
      const cycleStart = new Date(today);
      cycleStart.setDate(cycleStart.getDate() - cycleDays);
      const cycleLogs = logs.filter((l) => new Date(l.date) > cycleStart);
      const cycleHours = cycleLogs.reduce((s, l) => s + (parseFloat(l.onDutyHours) || 0), 0);
      const cycleRemaining = Math.max(0, cycleLimit - cycleHours);

      // 34-hour restart check
      let consecutiveOffDuty = 0;
      for (const log of logs) {
        const offDuty = (parseFloat(log.offDutyHours) || 0) + (parseFloat(log.sleeperHours) || 0);
        if (offDuty >= 10) {
          consecutiveOffDuty += offDuty;
        } else {
          break;
        }
      }
      const restartAvailable = consecutiveOffDuty >= 34;

      const violations = [];
      if (todayDriving > drivingLimit) violations.push(`Driving hours exceeded: ${todayDriving}/${drivingLimit}`);
      if (todayOnDuty > onDutyWindow) violations.push(`On-duty window exceeded: ${todayOnDuty}/${onDutyWindow}`);
      if (cycleHours > cycleLimit) violations.push(`Cycle hours exceeded: ${cycleHours}/${cycleLimit}`);

      results.push({
        driverId: driver.driverId,
        name: driver.name,
        today: {
          drivingHours: todayDriving,
          onDutyHours: todayOnDuty,
          drivingRemaining: Math.round(drivingRemaining * 10) / 10,
          windowRemaining: Math.round(windowRemaining * 10) / 10,
        },
        cycle: {
          type: cycleType,
          hoursUsed: Math.round(cycleHours * 10) / 10,
          hoursRemaining: Math.round(cycleRemaining * 10) / 10,
          restartAvailable,
        },
        violations,
        status: violations.length > 0 ? "violation" : drivingRemaining <= 1 || cycleRemaining <= 5 ? "warning" : "compliant",
      });
    }

    const report = {
      checkedAt: new Date().toISOString(),
      cycleType,
      driversChecked: results.length,
      violationCount: results.filter((r) => r.status === "violation").length,
      warningCount: results.filter((r) => r.status === "warning").length,
      drivers: results,
    };

    artifact.data.hosReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * maintenanceDue
   * Flag vehicles past their service interval (mileage or calendar).
   * artifact.data.vehicles: [{ vehicleId, name, type, currentMileage, lastServiceMileage, serviceIntervalMiles, lastServiceDate, serviceIntervalDays }]
   */
  registerLensAction("logistics", "maintenanceDue", (ctx, artifact, _params) => {
  try {
    const vehicles = artifact.data.vehicles || [];
    const now = new Date();

    const overdue = [];
    const upcoming = [];
    const current = [];

    for (const vehicle of vehicles) {
      const curMiles = parseFloat(vehicle.currentMileage) || 0;
      const lastMiles = parseFloat(vehicle.lastServiceMileage) || 0;
      const intervalMiles = parseFloat(vehicle.serviceIntervalMiles) || 5000;
      const milesSinceService = curMiles - lastMiles;
      const milesUntilDue = intervalMiles - milesSinceService;

      const lastDate = vehicle.lastServiceDate ? new Date(vehicle.lastServiceDate) : null;
      const intervalDays = parseInt(vehicle.serviceIntervalDays, 10) || 90;
      const daysSince = lastDate ? Math.floor((now - lastDate) / 86400000) : null;
      const daysUntilDue = daysSince !== null ? intervalDays - daysSince : null;

      const isMileageOverdue = milesUntilDue <= 0;
      const isCalendarOverdue = daysUntilDue !== null && daysUntilDue <= 0;
      const isOverdue = isMileageOverdue || isCalendarOverdue;
      const isUpcoming = !isOverdue && (milesUntilDue <= intervalMiles * 0.1 || (daysUntilDue !== null && daysUntilDue <= 14));

      const entry = {
        vehicleId: vehicle.vehicleId,
        name: vehicle.name,
        type: vehicle.type,
        currentMileage: curMiles,
        milesSinceService: Math.round(milesSinceService),
        milesUntilDue: Math.round(milesUntilDue),
        daysSinceService: daysSince,
        daysUntilDue,
        overdueReason: isOverdue
          ? [isMileageOverdue && "mileage", isCalendarOverdue && "calendar"].filter(Boolean)
          : [],
      };

      if (isOverdue) overdue.push({ ...entry, status: "overdue" });
      else if (isUpcoming) upcoming.push({ ...entry, status: "upcoming" });
      else current.push({ ...entry, status: "current" });
    }

    overdue.sort((a, b) => a.milesUntilDue - b.milesUntilDue);

    const report = {
      checkedAt: new Date().toISOString(),
      totalVehicles: vehicles.length,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
      currentCount: current.length,
      overdue,
      upcoming,
    };

    artifact.data.vehicleMaintenanceReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * complianceAudit
   * Audit shipment compliance: documentation, weight limits, hazmat, customs.
   * artifact.data.shipments: [{ shipmentId, weight, weightLimit, documents, hazmat, customs, ... }]
   */
  registerLensAction("logistics", "complianceAudit", (ctx, artifact, _params) => {
  try {
    const shipments = artifact.data?.shipments || [artifact.data];
    const results = [];
    let passCount = 0;
    let failCount = 0;

    for (const shipment of shipments) {
      const checks = [];
      // Documentation check
      const docs = shipment.documents || [];
      const requiredDocs = ['bill_of_lading', 'packing_list', 'commercial_invoice'];
      const missingDocs = requiredDocs.filter(d => !docs.some(doc => (doc.type || doc.name || '').toLowerCase().replace(/\s+/g, '_') === d));
      checks.push({ check: 'documentation', passed: missingDocs.length === 0, details: missingDocs.length > 0 ? `Missing: ${missingDocs.join(', ')}` : 'All required documents present' });

      // Weight limits
      const weight = parseFloat(shipment.weight) || 0;
      const weightLimit = parseFloat(shipment.weightLimit) || Infinity;
      const weightOk = weight <= weightLimit;
      checks.push({ check: 'weight_limit', passed: weightOk, details: weightOk ? `${weight}/${weightLimit} within limit` : `Overweight: ${weight}/${weightLimit}` });

      // Hazmat
      const hazmat = shipment.hazmat || shipment.hazardousMaterials || null;
      if (hazmat) {
        const hasCert = !!hazmat.certification;
        const hasLabels = !!hazmat.labels || !!hazmat.labeled;
        const hasPackaging = !!hazmat.properPackaging || !!hazmat.packagingApproved;
        const hazmatOk = hasCert && hasLabels && hasPackaging;
        checks.push({ check: 'hazmat', passed: hazmatOk, details: hazmatOk ? 'Hazmat compliant' : `Missing: ${[!hasCert && 'certification', !hasLabels && 'labels', !hasPackaging && 'packaging'].filter(Boolean).join(', ')}` });
      }

      // Customs
      const customs = shipment.customs || null;
      if (customs) {
        const hasDeclaration = !!customs.declaration;
        const hasTariffCode = !!customs.tariffCode || !!customs.hsCode;
        const customsOk = hasDeclaration && hasTariffCode;
        checks.push({ check: 'customs', passed: customsOk, details: customsOk ? 'Customs documentation complete' : `Missing: ${[!hasDeclaration && 'declaration', !hasTariffCode && 'tariff_code'].filter(Boolean).join(', ')}` });
      }

      const allPassed = checks.every(c => c.passed);
      if (allPassed) passCount++; else failCount++;
      results.push({ shipmentId: shipment.shipmentId || shipment.id, status: allPassed ? 'compliant' : 'non-compliant', checks });
    }

    return {
      ok: true,
      result: {
        auditedAt: new Date().toISOString(),
        shipmentsAudited: results.length,
        compliant: passCount,
        nonCompliant: failCount,
        complianceRate: results.length > 0 ? Math.round((passCount / results.length) * 100) : 100,
        shipments: results,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * fleetReport
   * Fleet summary: total vehicles, active/idle, mileage, fuel, maintenance due.
   * artifact.data.vehicles: [{ vehicleId, name, status, currentMileage, fuelConsumed, lastServiceDate, serviceIntervalDays }]
   */
  registerLensAction("logistics", "fleetReport", (ctx, artifact, _params) => {
  try {
    const vehicles = artifact.data?.vehicles || [];
    const now = new Date();
    let totalMileage = 0;
    let totalFuel = 0;
    let maintenanceDueCount = 0;
    const active = [];
    const idle = [];

    for (const v of vehicles) {
      const mileage = parseFloat(v.currentMileage) || 0;
      const fuel = parseFloat(v.fuelConsumed) || parseFloat(v.fuelUsed) || 0;
      totalMileage += mileage;
      totalFuel += fuel;

      const isActive = v.status === 'active' || v.status === 'in_transit' || v.status === 'en_route';
      if (isActive) active.push(v.vehicleId || v.name);
      else idle.push(v.vehicleId || v.name);

      const lastService = v.lastServiceDate ? new Date(v.lastServiceDate) : null;
      const intervalDays = parseInt(v.serviceIntervalDays, 10) || 90;
      if (lastService) {
        const daysSince = Math.floor((now - lastService) / 86400000);
        if (daysSince >= intervalDays) maintenanceDueCount++;
      }
    }

    const avgMileage = vehicles.length > 0 ? Math.round(totalMileage / vehicles.length) : 0;
    const avgFuel = vehicles.length > 0 ? Math.round((totalFuel / vehicles.length) * 100) / 100 : 0;

    return {
      ok: true,
      result: {
        generatedAt: new Date().toISOString(),
        totalVehicles: vehicles.length,
        activeCount: active.length,
        idleCount: idle.length,
        activeVehicles: active,
        idleVehicles: idle,
        totalMileage: Math.round(totalMileage),
        averageMileage: avgMileage,
        totalFuelConsumed: Math.round(totalFuel * 100) / 100,
        averageFuelPerVehicle: avgFuel,
        maintenanceDueCount,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * maintenanceAlert
   * Check vehicle maintenance schedules for overdue service based on mileage/date thresholds.
   * artifact.data.vehicles: [{ vehicleId, name, currentMileage, lastServiceMileage, serviceIntervalMiles, lastServiceDate, serviceIntervalDays }]
   */
  registerLensAction("logistics", "maintenanceAlert", (ctx, artifact, _params) => {
  try {
    const vehicles = artifact.data?.vehicles || [];
    const now = new Date();
    const alerts = [];

    for (const v of vehicles) {
      const reasons = [];
      const curMiles = parseFloat(v.currentMileage) || 0;
      const lastMiles = parseFloat(v.lastServiceMileage) || 0;
      const intervalMiles = parseFloat(v.serviceIntervalMiles) || 5000;
      const milesSince = curMiles - lastMiles;
      if (milesSince >= intervalMiles) {
        reasons.push({ type: 'mileage', message: `${Math.round(milesSince)} miles since last service (interval: ${intervalMiles})`, overBy: Math.round(milesSince - intervalMiles) });
      }

      const lastDate = v.lastServiceDate ? new Date(v.lastServiceDate) : null;
      const intervalDays = parseInt(v.serviceIntervalDays, 10) || 90;
      if (lastDate) {
        const daysSince = Math.floor((now - lastDate) / 86400000);
        if (daysSince >= intervalDays) {
          reasons.push({ type: 'calendar', message: `${daysSince} days since last service (interval: ${intervalDays})`, overBy: daysSince - intervalDays });
        }
      }

      if (reasons.length > 0) {
        alerts.push({
          vehicleId: v.vehicleId,
          name: v.name,
          currentMileage: curMiles,
          lastServiceDate: v.lastServiceDate || null,
          severity: reasons.some(r => r.overBy > (r.type === 'mileage' ? intervalMiles * 0.5 : intervalDays * 0.5)) ? 'critical' : 'warning',
          reasons,
        });
      }
    }

    alerts.sort((a, b) => (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0));

    return {
      ok: true,
      result: {
        checkedAt: new Date().toISOString(),
        totalVehicles: vehicles.length,
        alertCount: alerts.length,
        criticalCount: alerts.filter(a => a.severity === 'critical').length,
        alerts,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * inventoryAudit
   * Compare physical count quantities vs system quantities to identify discrepancies.
   * artifact.data.inventoryRecords: [{ sku, name, systemQty, physicalQty, location, unitCost }]
   * params.tolerancePct (default 2) — acceptable variance percentage
   */
  registerLensAction("logistics", "inventoryAudit", (ctx, artifact, params) => {
  try {
    const records = artifact.data.inventoryRecords || [];
    const tolerancePct = params.tolerancePct != null ? params.tolerancePct : 2;

    const discrepancies = [];
    const withinTolerance = [];
    let totalSystemValue = 0;
    let totalPhysicalValue = 0;

    for (const record of records) {
      const systemQty = parseFloat(record.systemQty) || 0;
      const physicalQty = parseFloat(record.physicalQty) || 0;
      const unitCost = parseFloat(record.unitCost) || 0;
      const diff = physicalQty - systemQty;
      const variancePct = systemQty !== 0 ? Math.round((Math.abs(diff) / systemQty) * 10000) / 100 : (diff !== 0 ? 100 : 0);
      const valueDiff = Math.round(diff * unitCost * 100) / 100;

      totalSystemValue += systemQty * unitCost;
      totalPhysicalValue += physicalQty * unitCost;

      const entry = {
        sku: record.sku,
        name: record.name,
        location: record.location,
        systemQty,
        physicalQty,
        difference: diff,
        variancePct,
        valueDifference: valueDiff,
      };

      if (variancePct > tolerancePct) {
        discrepancies.push({ ...entry, status: diff > 0 ? "overage" : "shortage" });
      } else {
        withinTolerance.push({ ...entry, status: "within-tolerance" });
      }
    }

    discrepancies.sort((a, b) => Math.abs(b.valueDifference) - Math.abs(a.valueDifference));

    const totalValueDiscrepancy = discrepancies.reduce((s, d) => s + d.valueDifference, 0);
    const accuracyRate = records.length > 0
      ? Math.round((withinTolerance.length / records.length) * 10000) / 100
      : 100;

    const report = {
      auditedAt: new Date().toISOString(),
      tolerancePct,
      totalSkus: records.length,
      discrepancyCount: discrepancies.length,
      withinToleranceCount: withinTolerance.length,
      accuracyRate,
      totalSystemValue: Math.round(totalSystemValue * 100) / 100,
      totalPhysicalValue: Math.round(totalPhysicalValue * 100) / 100,
      totalValueDiscrepancy: Math.round(totalValueDiscrepancy * 100) / 100,
      discrepancies,
    };

    artifact.data.inventoryAudit = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Parity-sprint macros ──
  function getLogState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.logLens) STATE.logLens = { shipments: new Map() };
    return STATE.logLens;
  }
  function saveLogState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("logistics", "shipments-list", (ctx, _artifact, _params = {}) => {
    const state = getLogState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    return { ok: true, result: { shipments: state.shipments.get(userId) || [] } };
  });

  /**
   * shipment-track — Real-time carrier tracking. Per "everything must
   * be real" directive: queries the carrier's tracking API directly
   * via the unified ShipEngine / EasyPost broker, no synthesized
   * status grid. Requires SHIPENGINE_API_KEY or EASYPOST_API_KEY for
   * multi-carrier coverage (UPS/FedEx/USPS/DHL). Free per-carrier
   * fallback for USPS Tracking Web Tools (USPS_TRACKING_USERID) is
   * also supported.
   */
  registerLensAction("logistics", "shipment-track", async (ctx, _artifact, params = {}) => {
    const state = getLogState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const trackingNumber = String(params.trackingNumber || "").trim();
    const carrier = ["UPS", "FedEx", "USPS", "DHL", "Other"].includes(params.carrier) ? params.carrier : "UPS";
    if (!trackingNumber) return { ok: false, error: "trackingNumber required" };

    const apiKey = process.env.SHIPENGINE_API_KEY || process.env.EASYPOST_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "Live shipment tracking requires SHIPENGINE_API_KEY or EASYPOST_API_KEY. Concord does not synthesize tracking status. (Free per-carrier fallback: USPS_TRACKING_USERID for USPS-only.)",
        meta: { trackingNumber, carrier },
      };
    }
    // ShipEngine has the broadest free dev tier; try it first.
    if (process.env.SHIPENGINE_API_KEY) {
      try {
        const url = `https://api.shipengine.com/v1/tracking?carrier_code=${encodeURIComponent(carrier.toLowerCase())}&tracking_number=${encodeURIComponent(trackingNumber)}`;
        const r = await fetch(url, { headers: { "API-Key": process.env.SHIPENGINE_API_KEY } });
        if (!r.ok) throw new Error(`shipengine ${r.status}`);
        const data = await r.json();
        const events = (data.events || []).map((e) => ({
          at: e.occurred_at,
          location: [e.city_locality, e.state_province, e.country_code].filter(Boolean).join(", "),
          description: e.description,
        }));
        const ship = {
          id: `ship_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          trackingNumber, carrier,
          status: data.status_code,
          currentLocation: events[events.length - 1]?.location,
          etaDate: data.estimated_delivery_date,
          events,
          source: "shipengine",
        };
        if (!state.shipments.has(userId)) state.shipments.set(userId, []);
        state.shipments.get(userId).push(ship);
        saveLogState();
        return { ok: true, result: { shipment: ship } };
      } catch (e) {
        return { ok: false, error: `shipengine unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    // EasyPost path
    try {
      const url = `https://api.easypost.com/v2/trackers`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tracker: { tracking_code: trackingNumber, carrier } }),
      });
      if (!r.ok) throw new Error(`easypost ${r.status}`);
      const data = await r.json();
      const events = (data.tracking_details || []).map((e) => ({
        at: e.datetime,
        location: [e.tracking_location?.city, e.tracking_location?.state, e.tracking_location?.country].filter(Boolean).join(", "),
        description: e.message,
      }));
      const ship = {
        id: `ship_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        trackingNumber, carrier,
        status: data.status,
        currentLocation: events[events.length - 1]?.location,
        etaDate: data.est_delivery_date,
        events,
        source: "easypost",
      };
      if (!state.shipments.has(userId)) state.shipments.set(userId, []);
      state.shipments.get(userId).push(ship);
      saveLogState();
      return { ok: true, result: { shipment: ship } };
    } catch (e) {
      return { ok: false, error: `easypost unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * route-optimize — Nearest-neighbour route-ordering with real driving
   * distances from OSRM (Open Source Routing Machine — free public
   * router at router.project-osrm.org). Per "everything must be real"
   * directive: stop distances come from real road-network routing,
   * not a hash-seeded fake matrix.
   */
  registerLensAction("logistics", "route-optimize", async (_ctx, _artifact, params = {}) => {
    const stops = Array.isArray(params.stops) ? params.stops.filter(s => typeof s === "string" && s.trim()) : [];
    if (stops.length < 2) return { ok: false, error: "need 2+ stops" };
    const startTime = String(params.startTime || "08:00");
    const vehicleType = ["car", "van", "truck", "ev"].includes(params.vehicleType) ? params.vehicleType : "van";
    const mpg = { car: 28, van: 18, truck: 9, ev: 110 }[vehicleType];
    const gasPrice = vehicleType === "ev" ? 0.15 : 3.85;

    // Geocode + distance: prefer caller-supplied stop coords (params.coords
    // = [{ lat, lng }, ...]), else fall back to Nominatim (OSM geocoder,
    // free no key, 1 req/sec courtesy limit) for each address.
    let coords = Array.isArray(params.coords) ? params.coords : null;
    if (!coords) {
      coords = [];
      try {
        for (const addr of stops) {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`;
          const r = await fetch(url, { headers: { "User-Agent": "Concord-OS/1.0 (logistics-route-optimize)" } });
          if (!r.ok) throw new Error(`nominatim ${r.status}`);
          const data = await r.json();
          if (!data?.[0]) throw new Error(`address not found: ${addr}`);
          coords.push({ lat: Number(data[0].lat), lng: Number(data[0].lon) });
        }
      } catch (e) {
        return { ok: false, error: `geocoding unreachable: ${e instanceof Error ? e.message : String(e)} — pass params.coords=[{lat,lng}...] to bypass geocoding` };
      }
    }
    if (coords.length !== stops.length) return { ok: false, error: "coords length must match stops length" };

    // OSRM table service returns a duration+distance matrix for all
    // stop pairs in one call. Distances in metres.
    const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(";");
    let distMatrix;
    try {
      const url = `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=distance,duration`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`osrm ${r.status}`);
      const data = await r.json();
      if (!data?.distances) throw new Error("osrm returned no distance matrix");
      // Convert metres → miles.
      distMatrix = data.distances.map((row) => row.map((d) => (d || 0) / 1609.34));
    } catch (e) {
      return { ok: false, error: `osrm unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const enteredOrder = stops.map((_, i) => i);
    function totalDist(order) {
      let total = 0;
      for (let i = 0; i < order.length - 1; i++) total += distMatrix[order[i]][order[i + 1]];
      return total;
    }
    const enteredDist = totalDist(enteredOrder);
    const visited = new Set([0]);
    const order = [0];
    while (visited.size < stops.length) {
      const last = order[order.length - 1];
      let best = -1, bestD = Infinity;
      for (let j = 0; j < stops.length; j++) {
        if (visited.has(j)) continue;
        const d = distMatrix[last][j];
        if (d < bestD) { bestD = d; best = j; }
      }
      visited.add(best);
      order.push(best);
    }
    const optimizedDist = totalDist(order);

    let totalDuration = 0;
    const [hh, mm] = startTime.split(":").map(Number);
    let nowMin = hh * 60 + (mm || 0);
    const optimizedStops = order.map((stopIdx, i) => {
      const dist = i === 0 ? 0 : distMatrix[order[i - 1]][stopIdx];
      const drive = dist / 35 * 60;
      const dwell = i === 0 ? 0 : 10;
      nowMin += drive + dwell;
      totalDuration += drive + dwell;
      return {
        order: i + 1,
        address: stops[stopIdx],
        arrivalTime: `${String(Math.floor(nowMin / 60) % 24).padStart(2, "0")}:${String(Math.round(nowMin % 60)).padStart(2, "0")}`,
        durationMin: drive + dwell,
        distanceMi: dist,
      };
    });
    const fuelCostUsd = optimizedDist / mpg * gasPrice;
    return {
      ok: true,
      result: {
        totalDistanceMi: optimizedDist,
        totalDurationMin: totalDuration,
        totalDistanceSavedMi: Math.max(0, enteredDist - optimizedDist),
        totalDurationSavedMin: Math.max(0, (enteredDist - optimizedDist) / 35 * 60),
        fuelCostUsd,
        stops: optimizedStops,
      },
    };
  });

  registerLensAction("logistics", "inventory-list", (_ctx, _artifact, _params = {}) => {
    // Per "everything must be real" directive: inventory comes from the
    // user's real catalog (managed via retail.product-* or warehouse
    // intake macros). No SAMPLE_SKUS seed. Returns empty + setup hint
    // until a real inventory feed is wired (warehouse WMS export,
    // Shopify catalog sync, or per-user warehouse macros).
    return {
      ok: true,
      result: {
        items: [],
        source: "empty",
        notes: "No inventory loaded. Wire a real warehouse feed (WMS export, Shopify catalog sync, or per-user logistics.warehouse-* macros) to populate.",
      },
    };
  });

  // ─── Full-app parity: FedEx + Project44 + SAP TMS 2026 ─────────────

  function uidLog(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function logActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function ensureLogState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.logisticsLens) STATE.logisticsLens = {};
    return STATE.logisticsLens;
  }
  function ensureLogBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }
  function hashLog(s) {
    let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  // ── Shipments CRUD ────────────────────────────────────────────

  registerLensAction("logistics", "shipments-create", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const origin = String(params.origin || "").trim();
    const destination = String(params.destination || "").trim();
    if (!origin || !destination) return { ok: false, error: "origin and destination required" };
    const carrierId = String(params.carrierId || "");
    const mode = ["parcel", "ltl", "ftl", "ocean", "air", "intermodal", "drayage"].includes(params.mode) ? params.mode : "parcel";
    const weightLbs = Math.max(0, Number(params.weightLbs) || 0);
    const shipment = {
      id: uidLog("shp"),
      trackingNumber: `1Z${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      origin, destination, carrierId, mode, weightLbs,
      dimensions: params.dimensions || null,
      serviceLevel: String(params.serviceLevel || "standard"),
      status: "label_created",
      createdAt: new Date().toISOString(),
      estimatedDelivery: params.estimatedDelivery || null,
      actualDelivery: null,
      poNumber: String(params.poNumber || ""),
      consignee: String(params.consignee || ""),
    };
    ensureLogBucket(s, "shipments", userId).push(shipment);
    saveLogState();
    return { ok: true, result: { shipment } };
  });

  registerLensAction("logistics", "shipments-get", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const shipment = ensureLogBucket(s, "shipments", userId).find(x => x.id === id || x.trackingNumber === id);
    if (!shipment) return { ok: false, error: "shipment not found" };
    return { ok: true, result: { shipment } };
  });

  registerLensAction("logistics", "shipments-delete", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const list = ensureLogBucket(s, "shipments", userId);
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return { ok: false, error: "shipment not found" };
    list.splice(idx, 1);
    saveLogState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("logistics", "shipments-set-status", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const status = ["label_created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception", "returned"].includes(params.status) ? params.status : null;
    if (!status) return { ok: false, error: "invalid status" };
    const shp = ensureLogBucket(s, "shipments", userId).find(x => x.id === id);
    if (!shp) return { ok: false, error: "shipment not found" };
    shp.status = status;
    if (status === "delivered") shp.actualDelivery = new Date().toISOString();
    // Log event
    ensureLogBucket(s, "shipmentEvents", userId).push({
      id: uidLog("evt"), shipmentId: id, kind: status,
      timestamp: new Date().toISOString(), location: String(params.location || ""),
    });
    saveLogState();
    return { ok: true, result: { shipment: shp } };
  });

  // ── Carriers ──────────────────────────────────────────────────

  registerLensAction("logistics", "carriers-list", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const carriers = ensureLogBucket(s, "carriers", userId);
    return { ok: true, result: { carriers } };
  });

  registerLensAction("logistics", "carriers-add", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const name = String(params.name || "").trim();
    const code = String(params.code || "").trim().toUpperCase();
    if (!name || !code) return { ok: false, error: "name and code required" };
    const carrier = {
      id: uidLog("car"), name, code,
      scac: String(params.scac || "").toUpperCase(),
      modes: Array.isArray(params.modes) ? params.modes : ["parcel"],
      accountNumber: String(params.accountNumber || ""),
      apiKey: params.apiKey ? "[redacted]" : null,
      active: true,
      createdAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "carriers", userId).push(carrier);
    saveLogState();
    return { ok: true, result: { carrier } };
  });

  registerLensAction("logistics", "carriers-delete", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const list = ensureLogBucket(s, "carriers", userId);
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, error: "carrier not found" };
    list.splice(idx, 1);
    saveLogState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Rate quoting (multi-carrier compare, deterministic) ───────

  registerLensAction("logistics", "rates-quote", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const origin = String(params.origin || "").trim();
    const destination = String(params.destination || "").trim();
    const weightLbs = Math.max(0.1, Number(params.weightLbs) || 1);
    const mode = ["parcel", "ltl", "ftl"].includes(params.mode) ? params.mode : "parcel";
    if (!origin || !destination) return { ok: false, error: "origin and destination required" };
    const carriers = ensureLogBucket(s, "carriers", userId);
    if (carriers.length === 0) return { ok: false, error: "no carriers configured (use carriers-add first)" };
    const baseDist = Math.abs(hashLog(origin + destination)) % 2500 + 50;
    const quotes = carriers.filter(c => c.modes.includes(mode)).map(c => {
      const carrierFactor = ((Math.abs(hashLog(c.code)) % 30) + 85) / 100;
      const rateBase = mode === "parcel" ? (weightLbs * 0.85 + 8) : mode === "ltl" ? (weightLbs * 0.18 + 80) : 1.85 * baseDist;
      const rate = Math.round(rateBase * carrierFactor * 100) / 100;
      const transitDays = mode === "parcel" ? 1 + Math.floor(baseDist / 800) : mode === "ltl" ? 2 + Math.floor(baseDist / 500) : 1 + Math.floor(baseDist / 600);
      return {
        carrierId: c.id, carrierName: c.name, carrierCode: c.code,
        rateUsd: rate,
        transitDays,
        serviceLevel: mode === "parcel" ? (transitDays <= 1 ? "next_day" : transitDays <= 2 ? "2_day" : "ground") : "standard",
        guaranteed: transitDays <= 2,
      };
    }).sort((a, b) => a.rateUsd - b.rateUsd);
    return {
      ok: true,
      result: { quotes, origin, destination, weightLbs, mode, distanceMi: baseDist },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Pickup scheduling ─────────────────────────────────────────

  registerLensAction("logistics", "pickups-list", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const pickups = ensureLogBucket(s, "pickups", userId);
    return { ok: true, result: { pickups } };
  });

  registerLensAction("logistics", "pickups-schedule", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const carrierId = String(params.carrierId || "");
    const address = String(params.address || "").trim();
    const date = String(params.date || "").slice(0, 10);
    if (!carrierId || !address || !date) return { ok: false, error: "carrierId, address, date required" };
    const carriers = ensureLogBucket(s, "carriers", userId);
    const carrier = carriers.find(c => c.id === carrierId);
    if (!carrier) return { ok: false, error: "carrier not found" };
    const pickup = {
      id: uidLog("pkp"), carrierId, carrierName: carrier.name,
      address, date,
      timeWindow: String(params.timeWindow || "9am-5pm"),
      packageCount: Math.max(1, Number(params.packageCount) || 1),
      status: "scheduled",
      confirmationNumber: `PKP${Math.floor(Math.random() * 9_000_000) + 1_000_000}`,
      createdAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "pickups", userId).push(pickup);
    saveLogState();
    return { ok: true, result: { pickup } };
  });

  registerLensAction("logistics", "pickups-cancel", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const pickup = ensureLogBucket(s, "pickups", userId).find(p => p.id === id);
    if (!pickup) return { ok: false, error: "pickup not found" };
    pickup.status = "cancelled";
    saveLogState();
    return { ok: true, result: { pickup } };
  });

  // ── Proof of delivery (signature/photo/GPS) ───────────────────

  registerLensAction("logistics", "delivery-confirm", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "");
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    const shp = ensureLogBucket(s, "shipments", userId).find(x => x.id === shipmentId);
    if (!shp) return { ok: false, error: "shipment not found" };
    const pod = {
      id: uidLog("pod"), shipmentId,
      signatureName: String(params.signatureName || ""),
      signatureUrl: params.signatureUrl || null,
      photoUrl: params.photoUrl || null,
      gpsLat: params.gpsLat != null ? Number(params.gpsLat) : null,
      gpsLng: params.gpsLng != null ? Number(params.gpsLng) : null,
      deliveredAt: new Date().toISOString(),
      receivedBy: String(params.receivedBy || params.signatureName || ""),
    };
    ensureLogBucket(s, "pods", userId).push(pod);
    shp.status = "delivered";
    shp.actualDelivery = pod.deliveredAt;
    shp.podId = pod.id;
    saveLogState();
    return { ok: true, result: { pod, shipment: shp } };
  });

  registerLensAction("logistics", "pods-list", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = params.shipmentId ? String(params.shipmentId) : null;
    const all = ensureLogBucket(s, "pods", userId);
    const filtered = shipmentId ? all.filter(p => p.shipmentId === shipmentId) : all;
    return { ok: true, result: { pods: filtered.slice().reverse() } };
  });

  // ── Dock appointments + scheduling (Project44-style) ──────────

  registerLensAction("logistics", "docks-list", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const docks = ensureLogBucket(s, "docks", userId);
    return { ok: true, result: { docks } };
  });

  registerLensAction("logistics", "docks-create", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const name = String(params.name || "").trim();
    const facility = String(params.facility || "").trim();
    if (!name || !facility) return { ok: false, error: "name and facility required" };
    const dock = {
      id: uidLog("dock"), name, facility,
      kind: ["loading", "unloading", "cross_dock"].includes(params.kind) ? params.kind : "loading",
      status: "available",
      hoursStart: String(params.hoursStart || "06:00"),
      hoursEnd: String(params.hoursEnd || "22:00"),
      createdAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "docks", userId).push(dock);
    saveLogState();
    return { ok: true, result: { dock } };
  });

  registerLensAction("logistics", "dock-appointments-list", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const date = params.date ? String(params.date).slice(0, 10) : null;
    const all = ensureLogBucket(s, "dockAppointments", userId);
    const filtered = date ? all.filter(a => a.date === date) : all;
    return { ok: true, result: { appointments: filtered } };
  });

  registerLensAction("logistics", "dock-appointments-book", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const dockId = String(params.dockId || "");
    const date = String(params.date || "").slice(0, 10);
    const startTime = String(params.startTime || "");
    const durationMin = Math.max(15, Number(params.durationMin) || 60);
    if (!dockId || !date || !startTime) return { ok: false, error: "dockId, date, startTime required" };
    const dock = ensureLogBucket(s, "docks", userId).find(d => d.id === dockId);
    if (!dock) return { ok: false, error: "dock not found" };
    // Check for conflicts
    const existing = ensureLogBucket(s, "dockAppointments", userId).filter(a => a.dockId === dockId && a.date === date && a.status === "scheduled");
    const newStart = parseInt(startTime.split(":")[0]) * 60 + parseInt(startTime.split(":")[1] || "0");
    const newEnd = newStart + durationMin;
    for (const ex of existing) {
      const exStart = parseInt(ex.startTime.split(":")[0]) * 60 + parseInt(ex.startTime.split(":")[1] || "0");
      const exEnd = exStart + ex.durationMin;
      if (newStart < exEnd && newEnd > exStart) {
        return { ok: false, error: `slot conflicts with existing appointment ${ex.startTime}` };
      }
    }
    const apt = {
      id: uidLog("dap"), dockId, dockName: dock.name, date, startTime, durationMin,
      carrierId: params.carrierId ? String(params.carrierId) : null,
      shipmentId: params.shipmentId ? String(params.shipmentId) : null,
      truckNumber: String(params.truckNumber || ""),
      kind: ["pickup", "delivery"].includes(params.kind) ? params.kind : "delivery",
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "dockAppointments", userId).push(apt);
    saveLogState();
    return { ok: true, result: { appointment: apt } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("logistics", "dock-appointments-cancel", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const apt = ensureLogBucket(s, "dockAppointments", userId).find(a => a.id === id);
    if (!apt) return { ok: false, error: "appointment not found" };
    apt.status = "cancelled";
    saveLogState();
    return { ok: true, result: { appointment: apt } };
  });

  // ── Fleet vehicles ────────────────────────────────────────────

  registerLensAction("logistics", "fleet-vehicles-list", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const vehicles = ensureLogBucket(s, "fleetVehicles", userId);
    return { ok: true, result: { vehicles } };
  });

  registerLensAction("logistics", "fleet-vehicles-add", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const number = String(params.number || "").trim();
    if (!number) return { ok: false, error: "number (truck/unit number) required" };
    const vehicle = {
      id: uidLog("veh"), number,
      kind: ["box_truck", "tractor", "trailer", "van", "pickup"].includes(params.kind) ? params.kind : "box_truck",
      make: String(params.make || ""),
      model: String(params.model || ""),
      year: Number(params.year) || null,
      vin: String(params.vin || ""),
      mileage: Math.max(0, Number(params.mileage) || 0),
      fuelType: String(params.fuelType || "diesel"),
      capacityLbs: Math.max(0, Number(params.capacityLbs) || 0),
      status: "available",
      assignedDriverId: null,
      lat: params.lat != null ? Number(params.lat) : null,
      lng: params.lng != null ? Number(params.lng) : null,
      lastMaintenanceMileage: 0,
      addedAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "fleetVehicles", userId).push(vehicle);
    saveLogState();
    return { ok: true, result: { vehicle } };
  });

  registerLensAction("logistics", "fleet-vehicles-update-status", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const status = ["available", "in_use", "maintenance", "out_of_service"].includes(params.status) ? params.status : null;
    if (!status) return { ok: false, error: "valid status required" };
    const vehicle = ensureLogBucket(s, "fleetVehicles", userId).find(v => v.id === id);
    if (!vehicle) return { ok: false, error: "vehicle not found" };
    vehicle.status = status;
    if (params.mileage != null) vehicle.mileage = Math.max(vehicle.mileage, Number(params.mileage));
    if (params.lat != null) vehicle.lat = Number(params.lat);
    if (params.lng != null) vehicle.lng = Number(params.lng);
    saveLogState();
    return { ok: true, result: { vehicle } };
  });

  registerLensAction("logistics", "fleet-vehicles-delete", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const list = ensureLogBucket(s, "fleetVehicles", userId);
    const idx = list.findIndex(v => v.id === id);
    if (idx < 0) return { ok: false, error: "vehicle not found" };
    list.splice(idx, 1);
    saveLogState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Load board (DAT-shape FTL marketplace) ────────────────────

  registerLensAction("logistics", "loads-list", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const status = params.status ? String(params.status) : null;
    const all = ensureLogBucket(s, "loads", userId);
    const loads = status ? all.filter(l => l.status === status) : all;
    return { ok: true, result: { loads } };
  });

  registerLensAction("logistics", "loads-post", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const origin = String(params.origin || "").trim();
    const destination = String(params.destination || "").trim();
    const ratePerMile = Number(params.ratePerMile);
    const weightLbs = Math.max(0, Number(params.weightLbs) || 0);
    if (!origin || !destination) return { ok: false, error: "origin and destination required" };
    if (!Number.isFinite(ratePerMile) || ratePerMile <= 0) return { ok: false, error: "ratePerMile must be > 0" };
    const load = {
      id: uidLog("load"), origin, destination, ratePerMile, weightLbs,
      equipment: String(params.equipment || "dry_van"),
      pickupDate: params.pickupDate || null,
      deliveryDate: params.deliveryDate || null,
      commodity: String(params.commodity || ""),
      status: "available",
      bids: [],
      postedAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "loads", userId).push(load);
    saveLogState();
    return { ok: true, result: { load } };
  });

  registerLensAction("logistics", "loads-bid", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const amount = Number(params.amount);
    const carrierId = String(params.carrierId || "");
    if (!id || !carrierId) return { ok: false, error: "id and carrierId required" };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const load = ensureLogBucket(s, "loads", userId).find(l => l.id === id);
    if (!load) return { ok: false, error: "load not found" };
    if (load.status !== "available") return { ok: false, error: `load is ${load.status}` };
    load.bids.push({ carrierId, amount, bidAt: new Date().toISOString() });
    saveLogState();
    return { ok: true, result: { load } };
  });

  registerLensAction("logistics", "loads-accept-bid", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const carrierId = String(params.carrierId || "");
    const load = ensureLogBucket(s, "loads", userId).find(l => l.id === id);
    if (!load) return { ok: false, error: "load not found" };
    const bid = load.bids.find(b => b.carrierId === carrierId);
    if (!bid) return { ok: false, error: "bid from that carrier not found" };
    load.status = "booked";
    load.bookedCarrierId = carrierId;
    load.bookedAt = new Date().toISOString();
    load.bookedAmount = bid.amount;
    saveLogState();
    return { ok: true, result: { load } };
  });

  // ── Shipment events stream (EDI-shape) ────────────────────────

  registerLensAction("logistics", "shipment-events", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = params.shipmentId ? String(params.shipmentId) : null;
    const all = ensureLogBucket(s, "shipmentEvents", userId);
    const events = shipmentId ? all.filter(e => e.shipmentId === shipmentId) : all;
    return { ok: true, result: { events: events.slice().reverse() } };
  });

  // ── Dashboard summary (TmsShell data source) ──────────────────

  registerLensAction("logistics", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipments = ensureLogBucket(s, "shipments", userId);
    const carriers = ensureLogBucket(s, "carriers", userId);
    const vehicles = ensureLogBucket(s, "fleetVehicles", userId);
    const pickups = ensureLogBucket(s, "pickups", userId);
    const docks = ensureLogBucket(s, "docks", userId);
    const loads = ensureLogBucket(s, "loads", userId);
    const today = new Date().toISOString().slice(0, 10);
    const inTransit = shipments.filter(s => s.status === "in_transit" || s.status === "out_for_delivery").length;
    const deliveredToday = shipments.filter(s => (s.actualDelivery || "").slice(0, 10) === today).length;
    const exceptions = shipments.filter(s => s.status === "exception").length;
    const onTimePct = (() => {
      const completed = shipments.filter(s => s.status === "delivered" && s.estimatedDelivery);
      if (completed.length === 0) return 100;
      const onTime = completed.filter(s => new Date(s.actualDelivery).getTime() <= new Date(s.estimatedDelivery).getTime() + 12 * 3600_000);
      return Math.round((onTime.length / completed.length) * 100);
    })();
    return {
      ok: true,
      result: {
        totalShipments: shipments.length,
        inTransit,
        deliveredToday,
        exceptions,
        onTimePct,
        carrierCount: carriers.length,
        vehicles: vehicles.length,
        vehiclesInUse: vehicles.filter(v => v.status === "in_use").length,
        pickupsToday: pickups.filter(p => p.date === today && p.status === "scheduled").length,
        dockCount: docks.length,
        loadsAvailable: loads.filter(l => l.status === "available").length,
        loadsBooked: loads.filter(l => l.status === "booked").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════
  //  Feature-parity backlog (vs Project44 / FourKites visibility)
  // ════════════════════════════════════════════════════════════════

  function haversineMi(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── [L] Real-time GPS / ELD tracking feed with live ETA recalc ──
  // A shipment carries a tracking record: an origin/destination geo pair,
  // a list of timestamped GPS pings (real user/ELD input), and a target
  // distance. Each ping recomputes remaining distance + a live ETA from
  // the average speed measured between the last two real pings.

  registerLensAction("logistics", "gps-track-init", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    const oLat = Number(params.originLat), oLng = Number(params.originLng);
    const dLat = Number(params.destLat), dLng = Number(params.destLng);
    if (![oLat, oLng, dLat, dLng].every(Number.isFinite)) {
      return { ok: false, error: "originLat, originLng, destLat, destLng required (numeric)" };
    }
    const totalDistanceMi = haversineMi(oLat, oLng, dLat, dLng);
    const track = {
      id: uidLog("trk"), shipmentId,
      origin: { lat: oLat, lng: oLng },
      destination: { lat: dLat, lng: dLng },
      totalDistanceMi: Math.round(totalDistanceMi * 100) / 100,
      pings: [],
      etaIso: null,
      status: "awaiting_first_ping",
      createdAt: new Date().toISOString(),
    };
    const list = ensureLogBucket(s, "gpsTracks", userId);
    const existingIdx = list.findIndex(t => t.shipmentId === shipmentId);
    if (existingIdx >= 0) list.splice(existingIdx, 1);
    list.push(track);
    saveLogState();
    return { ok: true, result: { track } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("logistics", "gps-ping", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    const lat = Number(params.lat), lng = Number(params.lng);
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required (numeric)" };
    const track = ensureLogBucket(s, "gpsTracks", userId).find(t => t.shipmentId === shipmentId);
    if (!track) return { ok: false, error: "track not found (call gps-track-init first)" };
    const at = params.at ? new Date(params.at).toISOString() : new Date().toISOString();
    const ping = {
      lat, lng, at,
      speedMph: params.speedMph != null ? Math.max(0, Number(params.speedMph)) : null,
      eldStatus: ["driving", "on_duty", "off_duty", "sleeper"].includes(params.eldStatus) ? params.eldStatus : null,
    };
    track.pings.push(ping);
    track.pings.sort((a, b) => new Date(a.at) - new Date(b.at));

    const remainingMi = haversineMi(lat, lng, track.destination.lat, track.destination.lng);
    // Measured speed: prefer the segment between the last two real pings.
    let measuredMph = null;
    if (track.pings.length >= 2) {
      const a = track.pings[track.pings.length - 2];
      const b = track.pings[track.pings.length - 1];
      const segMi = haversineMi(a.lat, a.lng, b.lat, b.lng);
      const segHr = (new Date(b.at) - new Date(a.at)) / 3_600_000;
      if (segHr > 0) measuredMph = segMi / segHr;
    }
    const speed = (ping.speedMph && ping.speedMph > 0) ? ping.speedMph
      : (measuredMph && measuredMph > 0) ? measuredMph : null;
    let etaIso = null, etaMinutes = null;
    if (speed && speed > 0) {
      etaMinutes = Math.round((remainingMi / speed) * 60);
      etaIso = new Date(new Date(at).getTime() + etaMinutes * 60_000).toISOString();
    }
    track.etaIso = etaIso;
    track.lastPingAt = at;
    track.currentLat = lat;
    track.currentLng = lng;
    track.remainingMi = Math.round(remainingMi * 100) / 100;
    track.progressPct = track.totalDistanceMi > 0
      ? Math.min(100, Math.round((1 - remainingMi / track.totalDistanceMi) * 100)) : 0;
    track.status = remainingMi <= 0.5 ? "arrived" : "in_transit";
    saveLogState();
    return {
      ok: true,
      result: {
        track,
        ping,
        remainingMi: track.remainingMi,
        measuredSpeedMph: measuredMph != null ? Math.round(measuredMph * 10) / 10 : null,
        etaIso, etaMinutes,
        progressPct: track.progressPct,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("logistics", "gps-track-get", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    const list = ensureLogBucket(s, "gpsTracks", userId);
    if (shipmentId) {
      const track = list.find(t => t.shipmentId === shipmentId);
      if (!track) return { ok: false, error: "track not found" };
      return { ok: true, result: { track } };
    }
    return { ok: true, result: { tracks: list.slice() } };
  });

  // ── [M] Predictive ETA + delay-risk scoring per shipment ────────
  // Combines a shipment's distance, scheduled ETA, GPS progress, and
  // carrier on-time history into a 0–100 delay-risk score.

  registerLensAction("logistics", "delay-risk-score", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    const shp = ensureLogBucket(s, "shipments", userId).find(x => x.id === shipmentId);
    if (!shp) return { ok: false, error: "shipment not found" };
    const track = ensureLogBucket(s, "gpsTracks", userId).find(t => t.shipmentId === shipmentId);

    const factors = [];
    let risk = 0;

    // Factor 1: live ETA vs scheduled ETA
    let predictedEtaIso = shp.estimatedDelivery || null;
    if (track && track.etaIso) {
      predictedEtaIso = track.etaIso;
      if (shp.estimatedDelivery) {
        const slipMin = (new Date(track.etaIso) - new Date(shp.estimatedDelivery)) / 60_000;
        if (slipMin > 0) {
          const f = Math.min(45, Math.round(slipMin / 30));
          risk += f;
          factors.push({ factor: "eta_slip", detail: `live ETA ${Math.round(slipMin)} min past schedule`, points: f });
        }
      }
    }
    // Factor 2: status-based risk
    if (shp.status === "exception") { risk += 35; factors.push({ factor: "status_exception", detail: "shipment in exception state", points: 35 }); }
    if (shp.status === "returned") { risk += 25; factors.push({ factor: "status_returned", detail: "shipment returned", points: 25 }); }
    // Factor 3: GPS staleness
    if (track && track.lastPingAt) {
      const staleHr = (Date.now() - new Date(track.lastPingAt).getTime()) / 3_600_000;
      if (staleHr > 6) {
        const f = Math.min(30, Math.round(staleHr * 2));
        risk += f;
        factors.push({ factor: "stale_gps", detail: `${Math.round(staleHr)}h since last GPS ping`, points: f });
      }
    } else if (shp.status === "in_transit" || shp.status === "out_for_delivery") {
      risk += 20;
      factors.push({ factor: "no_gps", detail: "in transit with no GPS track", points: 20 });
    }
    // Factor 4: carrier on-time history
    if (shp.carrierId) {
      const delivered = ensureLogBucket(s, "shipments", userId)
        .filter(x => x.carrierId === shp.carrierId && x.status === "delivered" && x.estimatedDelivery && x.actualDelivery);
      if (delivered.length >= 2) {
        const onTime = delivered.filter(x =>
          new Date(x.actualDelivery).getTime() <= new Date(x.estimatedDelivery).getTime() + 12 * 3600_000).length;
        const otRate = onTime / delivered.length;
        if (otRate < 0.85) {
          const f = Math.round((0.85 - otRate) * 60);
          risk += f;
          factors.push({ factor: "carrier_history", detail: `carrier on-time ${Math.round(otRate * 100)}%`, points: f });
        }
      }
    }

    risk = Math.min(100, Math.max(0, risk));
    const tier = risk >= 60 ? "high" : risk >= 30 ? "medium" : "low";
    return {
      ok: true,
      result: {
        shipmentId, riskScore: risk, riskTier: tier,
        predictedEtaIso, scheduledEtaIso: shp.estimatedDelivery || null,
        factors, scoredAt: new Date().toISOString(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] VRP — multi-stop optimization with capacity constraints ─
  // Sweep-then-nearest-neighbour: splits stops across vehicles by
  // capacity, then nearest-neighbour orders each vehicle's route.

  registerLensAction("logistics", "vrp-optimize", (ctx, _a, params = {}) => {
  try {
    const depot = params.depot || {};
    const dLat = Number(depot.lat), dLng = Number(depot.lng);
    if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return { ok: false, error: "depot {lat,lng} required" };
    const stops = Array.isArray(params.stops) ? params.stops.filter(st =>
      Number.isFinite(Number(st.lat)) && Number.isFinite(Number(st.lng))) : [];
    if (stops.length === 0) return { ok: false, error: "stops required (each with numeric lat,lng)" };
    const vehicleCount = Math.max(1, Math.floor(Number(params.vehicleCount) || 1));
    const vehicleCapacity = Math.max(0, Number(params.vehicleCapacity) || 0);
    const avgSpeedMph = Math.max(1, Number(params.avgSpeedMph) || 35);

    // Sort stops by polar angle from depot (sweep algorithm).
    const enriched = stops.map((st, i) => ({
      stopId: st.stopId || `stop_${i + 1}`,
      name: String(st.name || st.stopId || `Stop ${i + 1}`),
      lat: Number(st.lat), lng: Number(st.lng),
      demand: Math.max(0, Number(st.demand) || 0),
      serviceMins: Math.max(0, Number(st.serviceMins) || 15),
      angle: Math.atan2(Number(st.lat) - dLat, Number(st.lng) - dLng),
    })).sort((a, b) => a.angle - b.angle);

    // Assign to vehicles by capacity, sweeping around the depot.
    const routes = [];
    let cur = [], curLoad = 0;
    for (const st of enriched) {
      const wouldOverflow = vehicleCapacity > 0 && curLoad + st.demand > vehicleCapacity && cur.length > 0;
      const wouldExceedVehicles = routes.length >= vehicleCount - 1;
      if (wouldOverflow && !wouldExceedVehicles) {
        routes.push(cur); cur = []; curLoad = 0;
      }
      cur.push(st); curLoad += st.demand;
    }
    if (cur.length > 0) routes.push(cur);

    let overCapacity = false;
    const vehicleRoutes = routes.map((routeStops, vIdx) => {
      // Nearest-neighbour order within the route, starting from depot.
      const remaining = routeStops.slice();
      const ordered = [];
      let curLat = dLat, curLng = dLng, total = 0;
      while (remaining.length > 0) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = haversineMi(curLat, curLng, remaining[i].lat, remaining[i].lng);
          if (d < bestD) { bestD = d; best = i; }
        }
        total += bestD;
        const st = remaining[best];
        ordered.push({
          sequence: ordered.length + 1,
          stopId: st.stopId, name: st.name, lat: st.lat, lng: st.lng,
          demand: st.demand, serviceMins: st.serviceMins,
          legDistanceMi: Math.round(bestD * 100) / 100,
        });
        curLat = st.lat; curLng = st.lng;
        remaining.splice(best, 1);
      }
      const returnMi = haversineMi(curLat, curLng, dLat, dLng);
      total += returnMi;
      const load = ordered.reduce((sum, st) => sum + st.demand, 0);
      if (vehicleCapacity > 0 && load > vehicleCapacity) overCapacity = true;
      const serviceMin = ordered.reduce((sum, st) => sum + st.serviceMins, 0);
      const driveMin = Math.round((total / avgSpeedMph) * 60);
      return {
        vehicleIndex: vIdx + 1,
        stopCount: ordered.length,
        load,
        capacity: vehicleCapacity || null,
        utilizationPct: vehicleCapacity > 0 ? Math.round((load / vehicleCapacity) * 100) : null,
        routeDistanceMi: Math.round(total * 100) / 100,
        returnToDepotMi: Math.round(returnMi * 100) / 100,
        estimatedMinutes: driveMin + serviceMin,
        stops: ordered,
      };
    });

    return {
      ok: true,
      result: {
        depot: { lat: dLat, lng: dLng },
        vehiclesUsed: vehicleRoutes.length,
        vehiclesRequested: vehicleCount,
        totalStops: enriched.length,
        totalDistanceMi: Math.round(vehicleRoutes.reduce((s, r) => s + r.routeDistanceMi, 0) * 100) / 100,
        overCapacity,
        routes: vehicleRoutes,
        generatedAt: new Date().toISOString(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Carrier scorecard — on-time %, damage, tender acceptance ─
  // Computed entirely from the user's real shipments + carriers +
  // recorded tender offers. Carriers with no shipments report nulls.

  registerLensAction("logistics", "tender-record", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const carrierId = String(params.carrierId || "").trim();
    const outcome = ["accepted", "rejected"].includes(params.outcome) ? params.outcome : null;
    if (!carrierId) return { ok: false, error: "carrierId required" };
    if (!outcome) return { ok: false, error: "outcome must be 'accepted' or 'rejected'" };
    const carrier = ensureLogBucket(s, "carriers", userId).find(c => c.id === carrierId);
    if (!carrier) return { ok: false, error: "carrier not found" };
    const tender = {
      id: uidLog("tnd"), carrierId, outcome,
      shipmentId: params.shipmentId ? String(params.shipmentId) : null,
      lane: String(params.lane || ""),
      recordedAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "tenders", userId).push(tender);
    saveLogState();
    return { ok: true, result: { tender } };
  });

  registerLensAction("logistics", "damage-report", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    const shp = ensureLogBucket(s, "shipments", userId).find(x => x.id === shipmentId);
    if (!shp) return { ok: false, error: "shipment not found" };
    const report = {
      id: uidLog("dmg"), shipmentId, carrierId: shp.carrierId || "",
      severity: ["minor", "moderate", "severe", "total_loss"].includes(params.severity) ? params.severity : "minor",
      description: String(params.description || ""),
      claimAmountUsd: Math.max(0, Number(params.claimAmountUsd) || 0),
      reportedAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "damageReports", userId).push(report);
    saveLogState();
    return { ok: true, result: { report } };
  });

  registerLensAction("logistics", "carrier-scorecard", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const carriers = ensureLogBucket(s, "carriers", userId);
    const shipments = ensureLogBucket(s, "shipments", userId);
    const tenders = ensureLogBucket(s, "tenders", userId);
    const damages = ensureLogBucket(s, "damageReports", userId);
    const onlyId = params.carrierId ? String(params.carrierId) : null;

    const cards = carriers.filter(c => !onlyId || c.id === onlyId).map(c => {
      const carrierShipments = shipments.filter(x => x.carrierId === c.id);
      const completed = carrierShipments.filter(x => x.status === "delivered" && x.estimatedDelivery && x.actualDelivery);
      const onTime = completed.filter(x =>
        new Date(x.actualDelivery).getTime() <= new Date(x.estimatedDelivery).getTime() + 12 * 3600_000).length;
      const onTimePct = completed.length > 0 ? Math.round((onTime / completed.length) * 100) : null;
      const carrierTenders = tenders.filter(t => t.carrierId === c.id);
      const accepted = carrierTenders.filter(t => t.outcome === "accepted").length;
      const tenderAcceptancePct = carrierTenders.length > 0
        ? Math.round((accepted / carrierTenders.length) * 100) : null;
      const carrierDamages = damages.filter(d => d.carrierId === c.id);
      const damageRatePct = carrierShipments.length > 0
        ? Math.round((carrierDamages.length / carrierShipments.length) * 1000) / 10 : null;
      const exceptions = carrierShipments.filter(x => x.status === "exception").length;
      // Composite 0–100 grade; null inputs are treated as neutral (no data).
      const otScore = onTimePct == null ? 70 : onTimePct;
      const taScore = tenderAcceptancePct == null ? 70 : tenderAcceptancePct;
      const dmgScore = damageRatePct == null ? 95 : Math.max(0, 100 - damageRatePct * 5);
      const grade = Math.round(otScore * 0.45 + taScore * 0.30 + dmgScore * 0.25);
      const letter = grade >= 90 ? "A" : grade >= 80 ? "B" : grade >= 70 ? "C" : grade >= 60 ? "D" : "F";
      return {
        carrierId: c.id, carrierName: c.name, carrierCode: c.code,
        shipmentCount: carrierShipments.length,
        completedCount: completed.length,
        onTimePct, tenderAcceptancePct, damageRatePct,
        exceptionCount: exceptions,
        tenderOffers: carrierTenders.length,
        damageReports: carrierDamages.length,
        grade, letterGrade: letter,
      };
    }).sort((a, b) => b.grade - a.grade);

    return { ok: true, result: { scorecards: cards, generatedAt: new Date().toISOString() } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Geofence / milestone auto-events (departed, arrived, dwell) ─
  // Define a circular geofence; a GPS coordinate is evaluated against
  // all geofences and milestone events are emitted on enter/exit/dwell.

  registerLensAction("logistics", "geofences-list", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    return { ok: true, result: { geofences: ensureLogBucket(s, "geofences", userId).slice() } };
  });

  registerLensAction("logistics", "geofence-create", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const name = String(params.name || "").trim();
    const lat = Number(params.lat), lng = Number(params.lng);
    const radiusMi = Number(params.radiusMi);
    if (!name) return { ok: false, error: "name required" };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required (numeric)" };
    if (!Number.isFinite(radiusMi) || radiusMi <= 0) return { ok: false, error: "radiusMi must be > 0" };
    const geofence = {
      id: uidLog("geo"), name, lat, lng, radiusMi,
      kind: ["origin", "destination", "stop", "hub", "checkpoint"].includes(params.kind) ? params.kind : "checkpoint",
      createdAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "geofences", userId).push(geofence);
    saveLogState();
    return { ok: true, result: { geofence } };
  });

  registerLensAction("logistics", "geofence-delete", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const list = ensureLogBucket(s, "geofences", userId);
    const idx = list.findIndex(g => g.id === id);
    if (idx < 0) return { ok: false, error: "geofence not found" };
    list.splice(idx, 1);
    saveLogState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("logistics", "geofence-evaluate", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    const lat = Number(params.lat), lng = Number(params.lng);
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required (numeric)" };
    const at = params.at ? new Date(params.at).toISOString() : new Date().toISOString();
    const geofences = ensureLogBucket(s, "geofences", userId);
    if (geofences.length === 0) return { ok: false, error: "no geofences defined (use geofence-create first)" };
    if (!s.geofenceState) s.geofenceState = new Map();
    if (!s.geofenceState.has(userId)) s.geofenceState.set(userId, new Map());
    const stateMap = s.geofenceState.get(userId);
    const milestoneEvents = ensureLogBucket(s, "milestoneEvents", userId);
    const emitted = [];

    for (const g of geofences) {
      const distMi = haversineMi(lat, lng, g.lat, g.lng);
      const inside = distMi <= g.radiusMi;
      const key = `${shipmentId}:${g.id}`;
      const prior = stateMap.get(key) || null;
      let event = null;
      if (inside && (!prior || !prior.inside)) {
        event = { kind: "arrived", enteredAt: at };
        stateMap.set(key, { inside: true, enteredAt: at });
      } else if (inside && prior && prior.inside) {
        const dwellMin = Math.round((new Date(at) - new Date(prior.enteredAt)) / 60_000);
        event = { kind: "dwell", enteredAt: prior.enteredAt, dwellMinutes: dwellMin };
        stateMap.set(key, { inside: true, enteredAt: prior.enteredAt });
      } else if (!inside && prior && prior.inside) {
        const dwellMin = Math.round((new Date(at) - new Date(prior.enteredAt)) / 60_000);
        event = { kind: "departed", departedAt: at, dwellMinutes: dwellMin };
        stateMap.set(key, { inside: false });
      }
      if (event) {
        const milestone = {
          id: uidLog("mst"), shipmentId,
          geofenceId: g.id, geofenceName: g.name, geofenceKind: g.kind,
          ...event, at,
          distanceMi: Math.round(distMi * 100) / 100,
        };
        milestoneEvents.push(milestone);
        emitted.push(milestone);
      }
    }
    saveLogState();
    return { ok: true, result: { shipmentId, evaluatedAt: at, milestones: emitted } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("logistics", "milestones-list", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = params.shipmentId ? String(params.shipmentId) : null;
    const all = ensureLogBucket(s, "milestoneEvents", userId);
    const filtered = shipmentId ? all.filter(m => m.shipmentId === shipmentId) : all;
    return { ok: true, result: { milestones: filtered.slice().reverse() } };
  });

  // ── [M] Freight-cost audit — invoice reconciliation vs quoted rate ─

  registerLensAction("logistics", "freight-invoices-list", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    return { ok: true, result: { invoices: ensureLogBucket(s, "freightInvoices", userId).slice().reverse() } };
  });

  registerLensAction("logistics", "freight-invoice-audit", (ctx, _a, params = {}) => {
  try {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const carrierId = String(params.carrierId || "").trim();
    const invoiceNumber = String(params.invoiceNumber || "").trim();
    const quotedAmountUsd = Number(params.quotedAmountUsd);
    const invoicedAmountUsd = Number(params.invoicedAmountUsd);
    if (!invoiceNumber) return { ok: false, error: "invoiceNumber required" };
    if (!Number.isFinite(quotedAmountUsd) || quotedAmountUsd < 0) return { ok: false, error: "quotedAmountUsd must be >= 0" };
    if (!Number.isFinite(invoicedAmountUsd) || invoicedAmountUsd < 0) return { ok: false, error: "invoicedAmountUsd must be >= 0" };
    const tolerancePct = params.tolerancePct != null ? Math.max(0, Number(params.tolerancePct)) : 2;
    // Accessorial line items the user enters (fuel surcharge, detention, etc.)
    const accessorials = Array.isArray(params.accessorials)
      ? params.accessorials.filter(a => a && a.label != null).map(a => ({
          label: String(a.label),
          amountUsd: Number(a.amountUsd) || 0,
          approved: a.approved === true,
        }))
      : [];
    const accessorialTotal = Math.round(accessorials.reduce((s, a) => s + a.amountUsd, 0) * 100) / 100;
    const unapprovedAccessorial = Math.round(
      accessorials.filter(a => !a.approved).reduce((s, a) => s + a.amountUsd, 0) * 100) / 100;

    const varianceUsd = Math.round((invoicedAmountUsd - quotedAmountUsd) * 100) / 100;
    const variancePct = quotedAmountUsd > 0
      ? Math.round((varianceUsd / quotedAmountUsd) * 10000) / 100
      : (varianceUsd !== 0 ? 100 : 0);
    const withinTolerance = Math.abs(variancePct) <= tolerancePct;
    const status = withinTolerance ? "approved"
      : (varianceUsd > 0 ? "overbilled" : "underbilled");
    // Disputable amount = the unfavourable variance not explained by approved accessorials.
    const disputableUsd = status === "overbilled"
      ? Math.round(Math.max(0, varianceUsd - (accessorialTotal - unapprovedAccessorial)) * 100) / 100
      : 0;

    const invoice = {
      id: uidLog("frt"), invoiceNumber, carrierId,
      shipmentId: params.shipmentId ? String(params.shipmentId) : null,
      quotedAmountUsd: Math.round(quotedAmountUsd * 100) / 100,
      invoicedAmountUsd: Math.round(invoicedAmountUsd * 100) / 100,
      varianceUsd, variancePct, tolerancePct,
      accessorials, accessorialTotal, unapprovedAccessorial,
      withinTolerance, status, disputableUsd,
      auditedAt: new Date().toISOString(),
    };
    ensureLogBucket(s, "freightInvoices", userId).push(invoice);
    saveLogState();
    return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("logistics", "freight-invoice-dispute", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const inv = ensureLogBucket(s, "freightInvoices", userId).find(i => i.id === id);
    if (!inv) return { ok: false, error: "invoice not found" };
    const action = ["dispute", "resolve", "accept"].includes(params.action) ? params.action : null;
    if (!action) return { ok: false, error: "action must be 'dispute', 'resolve', or 'accept'" };
    inv.status = action === "dispute" ? "disputed" : action === "resolve" ? "resolved" : "approved";
    inv.disputeNote = String(params.note || inv.disputeNote || "");
    inv.disputeUpdatedAt = new Date().toISOString();
    saveLogState();
    return { ok: true, result: { invoice: inv } };
  });

  registerLensAction("logistics", "freight-audit-summary", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const invoices = ensureLogBucket(s, "freightInvoices", userId);
    const totalQuoted = Math.round(invoices.reduce((s, i) => s + i.quotedAmountUsd, 0) * 100) / 100;
    const totalInvoiced = Math.round(invoices.reduce((s, i) => s + i.invoicedAmountUsd, 0) * 100) / 100;
    const totalDisputable = Math.round(invoices.reduce((s, i) => s + (i.disputableUsd || 0), 0) * 100) / 100;
    return {
      ok: true,
      result: {
        invoiceCount: invoices.length,
        totalQuoted, totalInvoiced,
        totalVarianceUsd: Math.round((totalInvoiced - totalQuoted) * 100) / 100,
        totalDisputableUsd: totalDisputable,
        overbilledCount: invoices.filter(i => i.status === "overbilled").length,
        disputedCount: invoices.filter(i => i.status === "disputed").length,
        approvedCount: invoices.filter(i => i.status === "approved").length,
      },
    };
  });

  // ── [S] Exception management dashboard — flag + triage at-risk loads ─

  registerLensAction("logistics", "exceptions-flag", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const shipmentId = String(params.shipmentId || "").trim();
    if (!shipmentId) return { ok: false, error: "shipmentId required" };
    const shp = ensureLogBucket(s, "shipments", userId).find(x => x.id === shipmentId);
    if (!shp) return { ok: false, error: "shipment not found" };
    const kind = ["delay", "damage", "lost", "weather", "customs_hold", "documentation", "carrier_issue", "other"]
      .includes(params.kind) ? params.kind : "other";
    const severity = ["low", "medium", "high", "critical"].includes(params.severity) ? params.severity : "medium";
    const exception = {
      id: uidLog("exc"), shipmentId, kind, severity,
      description: String(params.description || ""),
      status: "open",
      assignee: String(params.assignee || ""),
      flaggedAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionNote: "",
    };
    ensureLogBucket(s, "exceptions", userId).push(exception);
    // Reflect the exception on the shipment record.
    if (shp.status !== "delivered" && shp.status !== "returned") shp.status = "exception";
    saveLogState();
    return { ok: true, result: { exception } };
  });

  registerLensAction("logistics", "exceptions-update", (ctx, _a, params = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const id = String(params.id || "");
    const exc = ensureLogBucket(s, "exceptions", userId).find(e => e.id === id);
    if (!exc) return { ok: false, error: "exception not found" };
    if (params.status != null) {
      const st = ["open", "investigating", "resolved", "escalated"].includes(params.status) ? params.status : null;
      if (!st) return { ok: false, error: "invalid status" };
      exc.status = st;
      if (st === "resolved") exc.resolvedAt = new Date().toISOString();
    }
    if (params.severity != null && ["low", "medium", "high", "critical"].includes(params.severity)) {
      exc.severity = params.severity;
    }
    if (params.assignee != null) exc.assignee = String(params.assignee);
    if (params.resolutionNote != null) exc.resolutionNote = String(params.resolutionNote);
    exc.updatedAt = new Date().toISOString();
    saveLogState();
    return { ok: true, result: { exception: exc } };
  });

  registerLensAction("logistics", "exceptions-dashboard", (ctx, _a, _p = {}) => {
    const s = ensureLogState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = logActor(ctx);
    const exceptions = ensureLogBucket(s, "exceptions", userId);
    const open = exceptions.filter(e => e.status !== "resolved");
    const sevRank = { critical: 4, high: 3, medium: 2, low: 1 };
    const triageQueue = open.slice().sort((a, b) =>
      (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0) ||
      new Date(a.flaggedAt) - new Date(b.flaggedAt));
    const byKind = {};
    for (const e of exceptions) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const e of open) bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    return {
      ok: true,
      result: {
        totalExceptions: exceptions.length,
        openCount: open.length,
        resolvedCount: exceptions.filter(e => e.status === "resolved").length,
        escalatedCount: exceptions.filter(e => e.status === "escalated").length,
        criticalCount: bySeverity.critical,
        byKind, bySeverity,
        triageQueue,
        generatedAt: new Date().toISOString(),
      },
    };
  });
};

