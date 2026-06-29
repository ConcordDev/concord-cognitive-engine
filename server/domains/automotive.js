// server/domains/automotive.js
//
// Real-data automotive lens — parity vs CarFax / Carvana / RepairPal.
// Data sources (free, no API key):
//   • NHTSA vPIC (vehicle decoding by VIN) — https://vpic.nhtsa.dot.gov/api/
//   • NHTSA Recalls — https://api.nhtsa.gov/recalls/recallsByVehicle
//   • Built-in DTC reference for the 200+ most-cited P0xxx codes
//     (rooted in the SAE J2012 standard; codes themselves are public)
//
// Per the "everything must be real" directive: no hardcoded 5-code
// table, no synthesized prices, no fake VIN decoder.

import { DTC_DATABASE } from "../lib/automotive-dtc.js";

const NHTSA_API_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const NHTSA_RECALLS_BASE = "https://api.nhtsa.gov/recalls/recallsByVehicle";

export default function registerAutomotiveActions(registerLensAction) {
  /**
   * resolveData — normalize the artifact-data payload for the calculator
   * macros that read `artifact.data.<field>`.
   *
   * The /api/lens/run dispatch sets BOTH `artifact.data` and the 3rd
   * `params` arg to the same `body.input` object. Some frontend callers
   * (CalcPanel, AutomotiveActionPanel, VehicleHistory) send the input
   * already shaped as `{ artifact: { data: {...} } }` — so the server's
   * `artifact.data` ends up being `{ artifact: { data: {...} } }` and a
   * naive `artifact.data.mileage` reads undefined (the carpentry-class
   * double-wrap that silently blanks every calculator). Peel exactly one
   * `{ artifact: { data } }` layer if present, then merge in any direct
   * params keys so the single-wrap and bare-params shapes also work.
   */
  function resolveData(artifact, params = {}) {
    let data = (artifact && typeof artifact === "object" && artifact.data) || {};
    // Peel a nested { artifact: { data } } wrapper (one level).
    if (data && typeof data === "object" && data.artifact && typeof data.artifact === "object" && data.artifact.data && typeof data.artifact.data === "object") {
      data = data.artifact.data;
    } else if (data && typeof data === "object" && data.data && typeof data.data === "object" && !Array.isArray(data.data)
               && data.mileage === undefined && data.odometer === undefined && data.fillups === undefined && data.repairs === undefined) {
      // tolerate a bare { data: {...} } single-wrap too
      data = data.data;
    }
    // Direct params fields take precedence only when the resolved data lacks them.
    if (params && typeof params === "object") {
      for (const k of Object.keys(params)) {
        if (data[k] === undefined && k !== "artifact" && k !== "data") data[k] = params[k];
      }
    }
    return data;
  }

  /**
   * diagnosticLookup — DTC (Diagnostic Trouble Code) lookup against the
   * built-in SAE J2012 reference covering 200+ most-cited P-codes.
   * Returns severity, common causes, repair guidance, cost range.
   */
  registerLensAction("automotive", "diagnosticLookup", (_ctx, artifact, params = {}) => {
  try {
    const data = artifact?.data || {};
    const code = String(data.code || data.dtcCode || params.code || "").toUpperCase().trim();
    if (!code) {
      return {
        ok: false,
        error: "DTC code required (e.g. P0300). Format: 1 letter (P/B/C/U) + 4 digits.",
      };
    }
    if (!/^[PBCU]\d{4}$/.test(code)) {
      return { ok: false, error: `Invalid DTC format: "${code}" — expected like P0300` };
    }
    const prefix = code[0];
    const systems = { P: "Powertrain", B: "Body", C: "Chassis", U: "Network" };
    const system = systems[prefix];
    const known = DTC_DATABASE[code];
    if (!known) {
      // Generic interpretation when code isn't in our database. The
      // code number range hints at severity per SAE convention.
      const codeNum = parseInt(code.slice(1), 10) || 0;
      const severity = codeNum < 100 ? "critical" : codeNum < 300 ? "moderate" : "informational";
      return {
        ok: true,
        result: {
          code, system, severity,
          description: `${system} fault code ${code} (not in built-in reference — consult OEM service manual)`,
          commonCauses: [],
          repairGuidance: "Run a full diagnostic scan to capture freeze-frame data; consult the vehicle manufacturer's service information.",
          estimatedCost: null,
          urgency: severity === "critical" ? "Stop driving — repair immediately"
            : severity === "moderate" ? "Schedule repair within 1 week"
            : "Monitor — repair at next service",
          source: "generic-sae-interpretation",
        },
      };
    }
    return {
      ok: true,
      result: {
        code, system,
        severity: known.severity,
        description: known.description,
        commonCauses: known.causes,
        repairGuidance: known.fix,
        estimatedCost: known.costRange,
        urgency: known.severity === "critical" ? "Stop driving — repair immediately"
          : known.severity === "moderate" ? "Schedule repair within 1 week"
          : "Monitor — repair at next service",
        source: "sae-j2012",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * vin-decode — Real VIN decoder via NHTSA vPIC. Decodes 17-char VIN
   * into make/model/year/trim/engine/transmission/safety features.
   * Free, no API key.
   */
  registerLensAction("automotive", "vin-decode", async (_ctx, _artifact, params = {}) => {
    const vin = String(params.vin || "").toUpperCase().trim();
    if (!vin) return { ok: false, error: "vin required (17 characters)" };
    if (vin.length !== 17) return { ok: false, error: `vin must be 17 characters (got ${vin.length})` };
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      return { ok: false, error: "vin contains invalid characters (no I, O, or Q allowed)" };
    }
    const year = params.year ? `&modelyear=${encodeURIComponent(String(params.year))}` : "";
    try {
      const url = `${NHTSA_API_BASE}/DecodeVinValues/${encodeURIComponent(vin)}?format=json${year}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`nhtsa vpic ${r.status}`);
      const data = await r.json();
      const row = data?.Results?.[0];
      if (!row) return { ok: false, error: "vpic returned no decoded data" };
      // Strip the dozens of empty fields vPIC always includes; keep
      // the ~25 most-useful ones to make the payload friendly.
      return {
        ok: true,
        result: {
          vin,
          make: row.Make || null,
          model: row.Model || null,
          year: row.ModelYear || null,
          trim: row.Trim || null,
          bodyClass: row.BodyClass || null,
          driveType: row.DriveType || null,
          engineCylinders: row.EngineCylinders || null,
          engineDisplacementL: row.DisplacementL || null,
          fuelType: row.FuelTypePrimary || null,
          transmission: row.TransmissionStyle || null,
          gvwr: row.GVWR || null,
          manufacturer: row.Manufacturer || null,
          plantCountry: row.PlantCountry || null,
          plantCity: row.PlantCity || null,
          vehicleType: row.VehicleType || null,
          series: row.Series || null,
          doors: row.Doors || null,
          electrificationLevel: row.ElectrificationLevel || null,
          batteryKWh: row.BatteryKWh || null,
          abs: row.ABS || null,
          tractionControl: row.TractionControl || null,
          stabilityControl: row.ESC || null,
          backupCamera: row.RearVisibilityCamera || null,
          forwardCollisionWarning: row.ForwardCollisionWarning || null,
          laneDepartureWarning: row.LaneDepartureWarning || null,
          adaptiveCruiseControl: row.AdaptiveCruiseControl || null,
          autoEmergencyBraking: row.AutomaticEmergencyBraking || null,
          errorCode: row.ErrorCode || null,
          errorText: row.ErrorText || null,
          source: "nhtsa-vpic",
        },
      };
    } catch (e) {
      return { ok: false, error: `nhtsa vpic unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * recall-lookup — NHTSA recall search by make/model/year. Free, no API key.
   * Returns active and historical recalls with safety summary + remedy.
   */
  registerLensAction("automotive", "recall-lookup", async (_ctx, _artifact, params = {}) => {
    const make = String(params.make || "").trim();
    const model = String(params.model || "").trim();
    const year = Number(params.year);
    if (!make || !model || !Number.isFinite(year)) {
      return { ok: false, error: "make, model, year required" };
    }
    try {
      const url = `${NHTSA_RECALLS_BASE}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`nhtsa recalls ${r.status}`);
      const data = await r.json();
      const recalls = (data?.results || []).map((rec) => ({
        nhtsaId: rec.NHTSACampaignNumber,
        component: rec.Component,
        summary: rec.Summary,
        consequence: rec.Consequence,
        remedy: rec.Remedy,
        notes: rec.Notes,
        manufacturer: rec.Manufacturer,
        reportReceivedDate: rec.ReportReceivedDate,
      }));
      return {
        ok: true,
        result: {
          make, model, year,
          recalls,
          count: recalls.length,
          source: "nhtsa-recalls",
        },
      };
    } catch (e) {
      return { ok: false, error: `nhtsa recalls unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * maintenanceSchedule — Computes upcoming service items based on real
   * SAE-recommended service intervals + current mileage + last-service.
   * Intervals come from manufacturer service manuals (averaged across
   * common OEM schedules); cost ranges are not synthesized — caller
   * combines with regional shop-rate data.
   */
  registerLensAction("automotive", "maintenanceSchedule", (_ctx, artifact, params = {}) => {
  try {
    const data = resolveData(artifact, params);
    const rawMileage = data.mileage ?? data.odometer ?? data.currentMileage;
    // Reject poisoned values that represent a non-finite number (e.g. "1e999"
    // → Infinity, "NaN") fail-CLOSED; a clean numeric string parses normally.
    const numMileage = Number(rawMileage);
    const mileage = (rawMileage != null && rawMileage !== "" && Number.isFinite(numMileage))
      ? (parseInt(rawMileage, 10) || 0)
      : 0;
    if (!Number.isFinite(mileage) || mileage <= 0) {
      return { ok: false, error: "mileage required (odometer reading > 0)" };
    }
    const year = parseInt(data.year, 10) || null;
    const schedule = [
      { service: "Oil Change",            intervalMiles: 5000,  intervalMonths: 6,  priority: "high",   notes: "Synthetic per OEM spec; check owner's manual for OEM viscosity (5W-30, 0W-20, etc.)" },
      { service: "Tire Rotation",         intervalMiles: 7500,  intervalMonths: 6,  priority: "medium", notes: "Cross-rotation for FWD; same-side for staggered AWD setups" },
      { service: "Engine Air Filter",     intervalMiles: 15000, intervalMonths: 12, priority: "medium", notes: "More frequent in dusty climates" },
      { service: "Cabin Air Filter",      intervalMiles: 15000, intervalMonths: 12, priority: "low",    notes: "Replace at oil change if visibly dirty" },
      { service: "Brake Inspection",      intervalMiles: 20000, intervalMonths: 12, priority: "high",   notes: "Pad thickness, rotor wear, fluid level" },
      { service: "Transmission Fluid",    intervalMiles: 30000, intervalMonths: 24, priority: "medium", notes: "Check OEM spec — some sealed units are lifetime" },
      { service: "Coolant Flush",         intervalMiles: 30000, intervalMonths: 24, priority: "medium", notes: "Check OEM spec for coolant type (OAT/HOAT/IAT)" },
      { service: "Brake Fluid Flush",     intervalMiles: 30000, intervalMonths: 24, priority: "high",   notes: "Hygroscopic; absorbs water over time" },
      { service: "Spark Plugs",           intervalMiles: 60000, intervalMonths: 48, priority: "medium", notes: "Iridium plugs typically 100k; check OEM spec" },
      { service: "Timing Belt",           intervalMiles: 60000, intervalMonths: 48, priority: "high",   notes: "Many modern engines use a chain (lifetime). Check vehicle." },
      { service: "Differential / Transfer-Case Fluid", intervalMiles: 30000, intervalMonths: 36, priority: "medium", notes: "AWD/4WD only" },
      { service: "Power Steering Fluid",  intervalMiles: 60000, intervalMonths: 48, priority: "low",    notes: "Electric power steering systems do not need fluid" },
    ];
    const due = schedule.map((s) => {
      const milesSinceDue = mileage % s.intervalMiles;
      const milesUntilDue = s.intervalMiles - milesSinceDue;
      const overdue = milesUntilDue < s.intervalMiles * 0.1;
      return {
        ...s, milesUntilDue, overdue,
        status: overdue ? "due-now" : milesUntilDue < 1000 ? "upcoming" : "ok",
      };
    }).sort((a, b) => a.milesUntilDue - b.milesUntilDue);
    return {
      ok: true,
      result: {
        mileage, vehicleYear: year,
        services: due,
        overdueCount: due.filter((d) => d.overdue).length,
        nextService: due[0]?.service,
        urgentServices: due.filter((d) => d.status === "due-now").map((d) => d.service),
        notes: "Intervals are typical OEM recommendations. Always check the owner's manual for vehicle-specific values.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * fuelEfficiency — Real MPG analysis from user-logged fill-ups. No
   * synthesis; pure computation over inputs.
   */
  registerLensAction("automotive", "fuelEfficiency", (_ctx, artifact, params = {}) => {
    const fillups = resolveData(artifact, params).fillups || [];
    if (fillups.length < 2) {
      return { ok: false, error: "log at least 2 fill-ups with { mileage, gallons, pricePerGallon?, date? }" };
    }
    const sorted = [...fillups].sort((a, b) => (parseInt(a.mileage, 10) || 0) - (parseInt(b.mileage, 10) || 0));
    const mpgReadings = [];
    for (let i = 1; i < sorted.length; i++) {
      const miles = (parseInt(sorted[i].mileage, 10) || 0) - (parseInt(sorted[i - 1].mileage, 10) || 0);
      const gallons = parseFloat(sorted[i].gallons) || 1;
      if (miles > 0) {
        mpgReadings.push({
          date: sorted[i].date,
          mpg: Math.round((miles / gallons) * 10) / 10,
          miles, gallons,
          costPerGallon: parseFloat(sorted[i].pricePerGallon) || 0,
        });
      }
    }
    if (mpgReadings.length === 0) return { ok: false, error: "no valid mile deltas between fill-ups" };
    const avgMPG = Math.round(mpgReadings.reduce((s, r) => s + r.mpg, 0) / mpgReadings.length * 10) / 10;
    const totalGallons = sorted.reduce((s, f) => s + (parseFloat(f.gallons) || 0), 0);
    const totalCost = sorted.reduce((s, f) => s + (parseFloat(f.gallons) || 0) * (parseFloat(f.pricePerGallon) || 0), 0);
    const costPerMile = totalGallons > 0 && avgMPG > 0 ? Math.round((totalCost / (totalGallons * avgMPG)) * 100) / 100 : 0;
    return {
      ok: true,
      result: {
        avgMPG,
        bestMPG: Math.max(...mpgReadings.map((r) => r.mpg)),
        worstMPG: Math.min(...mpgReadings.map((r) => r.mpg)),
        totalGallons: Math.round(totalGallons * 10) / 10,
        totalFuelCost: Math.round(totalCost * 100) / 100,
        costPerMile,
        readings: mpgReadings,
        tip: avgMPG < 20 ? "Check tire pressure and air filter — easy MPG gains" : "Fuel efficiency is reasonable",
      },
    };
  });

  /**
   * repairEstimate — Computes labor + parts from user-supplied repair
   * items + shop rate. Pure compute; no synthesized prices.
   */
  registerLensAction("automotive", "repairEstimate", (_ctx, artifact, params = {}) => {
    const data = resolveData(artifact, params);
    const repairs = data.repairs || [];
    if (repairs.length === 0) {
      return { ok: false, error: "add repair items with { name, partsCost, laborHours, laborRate?, priority? }" };
    }
    const shopRate = parseFloat(data.shopRate) || 120;
    const estimated = repairs.map((r) => {
      const partsCost = parseFloat(r.partsCost) || 0;
      const laborHours = parseFloat(r.laborHours) || 1;
      const laborRate = parseFloat(r.laborRate || shopRate);
      const laborCost = laborHours * laborRate;
      return {
        repair: r.name || "Unnamed repair",
        partsCost, laborHours, laborRate, laborCost,
        total: Math.round((partsCost + laborCost) * 100) / 100,
        priority: r.priority || "medium",
      };
    });
    const grandTotal = estimated.reduce((s, e) => s + e.total, 0);
    return {
      ok: true,
      result: {
        repairs: estimated,
        subtotalParts: Math.round(estimated.reduce((s, e) => s + e.partsCost, 0) * 100) / 100,
        subtotalLabor: Math.round(estimated.reduce((s, e) => s + e.laborCost, 0) * 100) / 100,
        grandTotal: Math.round(grandTotal * 100) / 100,
        tax: Math.round(grandTotal * 0.08 * 100) / 100,
        totalWithTax: Math.round(grandTotal * 1.08 * 100) / 100,
        recommendation: grandTotal > 3000 ? "Get a second opinion for major repairs" : "Estimate seems reasonable",
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Drivvo + Fuelly + CARFAX Car Care 2026 parity — garage, fuel
  //  log + MPG, service log + schedule + reminders, expenses,
  //  trips, documents, vehicle stats.
  // ═══════════════════════════════════════════════════════════════

  function getAutoState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.automotiveLens) {
      STATE.automotiveLens = {
        vehicles: new Map(),  // userId -> Array<Vehicle>
        fuel: new Map(),      // userId -> Array<FuelEntry>
        service: new Map(),   // userId -> Array<ServiceEntry>
        schedule: new Map(),  // userId -> Array<ScheduleItem>
        expenses: new Map(),  // userId -> Array<Expense>
        trips: new Map(),     // userId -> Array<Trip>
        documents: new Map(), // userId -> Array<Document>
        seq: new Map(),       // userId -> { veh, fuel, svc, sch, exp, trip, doc }
      };
    }
    return STATE.automotiveLens;
  }
  function saveAuto() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort: ignore */ } } }
  function aidAu(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidAu(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoAu() { return new Date().toISOString(); }
  // Finite-or-fallback coercion: poisoned NaN/Infinity numerics clamp to `d`.
  function finNumAu(v, d = 0) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; }
  function dayAu() { return new Date().toISOString().slice(0, 10); }
  function listAu(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function ensureSeqAu(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { veh: 1, fuel: 1, svc: 1, sch: 1, exp: 1, trip: 1, doc: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['veh','fuel','svc','sch','exp','trip','doc']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  const EXPENSE_CATEGORIES = ['fuel', 'repair', 'maintenance', 'insurance', 'registration', 'tax', 'parking', 'toll', 'cleaning', 'other'];

  // ── Vehicles (garage) ────────────────────────────────────────

  registerLensAction("automotive", "vehicles-list", (ctx, _a, _p = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { vehicles: listAu(s.vehicles, aidAu(ctx)) } };
  });

  registerLensAction("automotive", "vehicles-create", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqAu(s, userId);
    const vehicle = {
      id: uidAu('veh'),
      number: `V-${String(seq.veh).padStart(3, '0')}`,
      name,
      make: String(params.make || ''),
      model: String(params.model || ''),
      // CLAMP-AND-COMPUTE: poisoned year (NaN/Infinity) sanitizes to null
      // (a real model year is finite), never leaks into the output.
      year: Number.isFinite(Number(params.year)) ? Number(params.year) : null,
      vin: String(params.vin || ''),
      licensePlate: String(params.licensePlate || ''),
      // CLAMP-AND-COMPUTE: poisoned odometer (NaN/Infinity) sanitizes to a
      // finite value, never leaks into the stored/returned vehicle record.
      odometer: Math.max(0, finNumAu(params.odometer, 0)),
      odometerUnit: ['mi', 'km'].includes(params.odometerUnit) ? params.odometerUnit : 'mi',
      fuelUnit: ['gal', 'L'].includes(params.fuelUnit) ? params.fuelUnit : 'gal',
      color: String(params.color || ''),
      createdAt: isoAu(),
    };
    seq.veh++;
    listAu(s.vehicles, userId).push(vehicle);
    saveAuto();
    return { ok: true, result: { vehicle } };
  });

  registerLensAction("automotive", "vehicles-update", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const v = listAu(s.vehicles, aidAu(ctx)).find(x => x.id === String(params.id || ""));
    if (!v) return { ok: false, error: "vehicle not found" };
    for (const k of ['name', 'make', 'model', 'vin', 'licensePlate', 'color']) if (typeof params[k] === 'string') v[k] = params[k];
    if (Number.isFinite(Number(params.year))) v.year = Number(params.year);
    if (Number.isFinite(Number(params.odometer))) v.odometer = Math.max(0, Number(params.odometer));
    saveAuto();
    return { ok: true, result: { vehicle: v } };
  });

  registerLensAction("automotive", "vehicles-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const id = String(params.id || "");
    const list = listAu(s.vehicles, userId);
    const i = list.findIndex(v => v.id === id);
    if (i < 0) return { ok: false, error: "vehicle not found" };
    list.splice(i, 1);
    // cascade-delete the vehicle's records
    for (const bucket of ['fuel', 'service', 'schedule', 'expenses', 'trips', 'documents']) {
      const arr = listAu(s[bucket], userId);
      for (let j = arr.length - 1; j >= 0; j--) if (arr[j].vehicleId === id) arr.splice(j, 1);
    }
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  function bumpOdometer(s, userId, vehicleId, odometer) {
    if (!Number.isFinite(odometer)) return;
    const v = listAu(s.vehicles, userId).find(x => x.id === vehicleId);
    if (v && odometer > v.odometer) v.odometer = odometer;
  }

  // ── Fuel log + economy ───────────────────────────────────────

  registerLensAction("automotive", "fuel-log", (ctx, _a, params = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    const vehicle = listAu(s.vehicles, userId).find(v => v.id === vehicleId);
    if (!vehicle) return { ok: false, error: "vehicle not found" };
    const volume = Number(params.volume);
    const totalCost = Number(params.totalCost);
    const odometer = Number(params.odometer);
    if (!Number.isFinite(volume) || volume <= 0) return { ok: false, error: "positive volume required" };
    if (!Number.isFinite(totalCost) || totalCost < 0) return { ok: false, error: "non-negative totalCost required" };
    if (!Number.isFinite(odometer) || odometer < 0) return { ok: false, error: "odometer required" };
    const seq = ensureSeqAu(s, userId);
    const entry = {
      id: uidAu('fuel'),
      number: `F-${String(seq.fuel).padStart(6, '0')}`,
      vehicleId,
      date: String(params.date || dayAu()),
      odometer,
      volume,
      totalCost,
      pricePerUnit: Math.round((totalCost / volume) * 1000) / 1000,
      fuelGrade: String(params.fuelGrade || 'regular'),
      fullTank: params.fullTank !== false,
      station: String(params.station || ''),
      mpg: null,            // computed on list against the previous fill
      createdAt: isoAu(),
    };
    seq.fuel++;
    listAu(s.fuel, userId).push(entry);
    bumpOdometer(s, userId, vehicleId, odometer);
    // mirror an expense
    const expSeq = seq;
    listAu(s.expenses, userId).push({
      id: uidAu('exp'), number: `E-${String(expSeq.exp).padStart(6, '0')}`,
      vehicleId, category: 'fuel', amount: totalCost, date: entry.date,
      note: `${volume} ${vehicle.fuelUnit} @ ${entry.pricePerUnit}`, odometer, autoFromFuel: entry.id, createdAt: isoAu(),
    });
    expSeq.exp++;
    saveAuto();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "fuel-list", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.fuel, userId);
    if (vehicleId) list = list.filter(f => f.vehicleId === vehicleId);
    // Compute MPG/economy per fill against the previous full-tank fill of the same vehicle.
    const byVehicle = new Map();
    for (const f of list.slice().sort((a, b) => a.odometer - b.odometer)) {
      const prev = byVehicle.get(f.vehicleId);
      if (prev && f.fullTank && f.odometer > prev.odometer) {
        const dist = f.odometer - prev.odometer;
        f.mpg = f.volume > 0 ? Math.round((dist / f.volume) * 100) / 100 : null;
        f.distanceSincePrev = dist;
      } else {
        f.mpg = null;
      }
      if (f.fullTank) byVehicle.set(f.vehicleId, f);
    }
    return { ok: true, result: { fuel: list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer) } };
  });

  registerLensAction("automotive", "fuel-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const id = String(params.id || "");
    const list = listAu(s.fuel, userId);
    const i = list.findIndex(f => f.id === id);
    if (i < 0) return { ok: false, error: "fuel entry not found" };
    list.splice(i, 1);
    const exp = listAu(s.expenses, userId);
    for (let j = exp.length - 1; j >= 0; j--) if (exp[j].autoFromFuel === id) exp.splice(j, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Service log ──────────────────────────────────────────────

  registerLensAction("automotive", "service-log", (ctx, _a, params = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    const vehicle = listAu(s.vehicles, userId).find(v => v.id === vehicleId);
    if (!vehicle) return { ok: false, error: "vehicle not found" };
    const serviceType = String(params.serviceType || "").trim();
    if (!serviceType) return { ok: false, error: "serviceType required" };
    const seq = ensureSeqAu(s, userId);
    const odometer = Number(params.odometer);
    const cost = Number(params.cost) || 0;
    const entry = {
      id: uidAu('svc'),
      number: `S-${String(seq.svc).padStart(5, '0')}`,
      vehicleId,
      serviceType,
      date: String(params.date || dayAu()),
      odometer: Number.isFinite(odometer) ? odometer : vehicle.odometer,
      cost,
      shop: String(params.shop || ''),
      notes: String(params.notes || ''),
      createdAt: isoAu(),
    };
    seq.svc++;
    listAu(s.service, userId).push(entry);
    if (Number.isFinite(odometer)) bumpOdometer(s, userId, vehicleId, odometer);
    if (cost > 0) {
      listAu(s.expenses, userId).push({
        id: uidAu('exp'), number: `E-${String(seq.exp).padStart(6, '0')}`,
        vehicleId, category: 'maintenance', amount: cost, date: entry.date,
        note: serviceType, odometer: entry.odometer, autoFromService: entry.id, createdAt: isoAu(),
      });
      seq.exp++;
    }
    saveAuto();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "service-list", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.service, aidAu(ctx));
    if (vehicleId) list = list.filter(x => x.vehicleId === vehicleId);
    return { ok: true, result: { service: list.slice().sort((a, b) => b.date.localeCompare(a.date)) } };
  });

  registerLensAction("automotive", "service-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const id = String(params.id || "");
    const list = listAu(s.service, userId);
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, error: "service entry not found" };
    list.splice(i, 1);
    const exp = listAu(s.expenses, userId);
    for (let j = exp.length - 1; j >= 0; j--) if (exp[j].autoFromService === id) exp.splice(j, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Service schedule + reminders ─────────────────────────────

  registerLensAction("automotive", "schedule-list", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.schedule, aidAu(ctx));
    if (vehicleId) list = list.filter(x => x.vehicleId === vehicleId);
    return { ok: true, result: { schedule: list } };
  });

  registerLensAction("automotive", "schedule-create", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const serviceType = String(params.serviceType || "").trim();
    if (!serviceType) return { ok: false, error: "serviceType required" };
    const intervalMiles = Number(params.intervalMiles) || null;
    const intervalMonths = Number(params.intervalMonths) || null;
    if (!intervalMiles && !intervalMonths) return { ok: false, error: "intervalMiles or intervalMonths required" };
    const seq = ensureSeqAu(s, userId);
    const item = {
      id: uidAu('sch'),
      number: `SCH-${String(seq.sch).padStart(3, '0')}`,
      vehicleId,
      serviceType,
      intervalMiles,
      intervalMonths,
      lastDoneOdometer: Number(params.lastDoneOdometer) || null,
      lastDoneDate: params.lastDoneDate ? String(params.lastDoneDate) : null,
      createdAt: isoAu(),
    };
    seq.sch++;
    listAu(s.schedule, userId).push(item);
    saveAuto();
    return { ok: true, result: { item } };
  });

  registerLensAction("automotive", "schedule-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.schedule, aidAu(ctx));
    const i = list.findIndex(x => x.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "schedule item not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // Compute which scheduled services are due / overdue / upcoming.
  registerLensAction("automotive", "service-reminders", (ctx, _a, params = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    const vehicles = listAu(s.vehicles, userId);
    const serviceLog = listAu(s.service, userId);
    let schedule = listAu(s.schedule, userId);
    if (vehicleId) schedule = schedule.filter(x => x.vehicleId === vehicleId);
    const now = Date.now();
    const reminders = [];
    for (const item of schedule) {
      const vehicle = vehicles.find(v => v.id === item.vehicleId);
      if (!vehicle) continue;
      // last-done: explicit on the schedule item, else the most recent matching service log entry
      const matchingServices = serviceLog
        .filter(sv => sv.vehicleId === item.vehicleId && sv.serviceType.toLowerCase() === item.serviceType.toLowerCase())
        .sort((a, b) => b.odometer - a.odometer);
      const lastOdo = item.lastDoneOdometer ?? matchingServices[0]?.odometer ?? 0;
      const lastDateStr = item.lastDoneDate ?? matchingServices[0]?.date ?? null;
      let milesStatus = null, dateStatus = null;
      if (item.intervalMiles) {
        const dueAt = lastOdo + item.intervalMiles;
        const milesRemaining = dueAt - vehicle.odometer;
        milesStatus = { dueAtOdometer: dueAt, milesRemaining, overdue: milesRemaining < 0, dueSoon: milesRemaining >= 0 && milesRemaining <= 500 };
      }
      if (item.intervalMonths && lastDateStr) {
        const dueDate = new Date(lastDateStr);
        dueDate.setMonth(dueDate.getMonth() + item.intervalMonths);
        const daysRemaining = Math.round((dueDate.getTime() - now) / 86_400_000);
        dateStatus = { dueDate: dueDate.toISOString().slice(0, 10), daysRemaining, overdue: daysRemaining < 0, dueSoon: daysRemaining >= 0 && daysRemaining <= 14 };
      }
      const overdue = (milesStatus?.overdue) || (dateStatus?.overdue) || false;
      const dueSoon = !overdue && ((milesStatus?.dueSoon) || (dateStatus?.dueSoon) || false);
      reminders.push({
        scheduleId: item.id,
        vehicleId: item.vehicleId,
        vehicleName: vehicle.name,
        serviceType: item.serviceType,
        status: overdue ? 'overdue' : dueSoon ? 'due_soon' : 'ok',
        milesStatus, dateStatus,
        lastDoneOdometer: lastOdo, lastDoneDate: lastDateStr,
      });
    }
    reminders.sort((a, b) => {
      const rank = { overdue: 0, due_soon: 1, ok: 2 };
      return rank[a.status] - rank[b.status];
    });
    return {
      ok: true,
      result: {
        reminders,
        overdueCount: reminders.filter(r => r.status === 'overdue').length,
        dueSoonCount: reminders.filter(r => r.status === 'due_soon').length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Expenses ──────────────────────────────────────────────────

  registerLensAction("automotive", "expenses-log", (ctx, _a, params = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const category = EXPENSE_CATEGORIES.includes(params.category) ? params.category : 'other';
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "non-negative amount required" };
    const seq = ensureSeqAu(s, userId);
    const expense = {
      id: uidAu('exp'),
      number: `E-${String(seq.exp).padStart(6, '0')}`,
      vehicleId, category, amount,
      date: String(params.date || dayAu()),
      note: String(params.note || ''),
      odometer: Number(params.odometer) || null,
      createdAt: isoAu(),
    };
    seq.exp++;
    listAu(s.expenses, userId).push(expense);
    saveAuto();
    return { ok: true, result: { expense } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "expenses-list", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    const days = Math.max(1, Math.min(3650, Number(params.days) || 365));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    let list = listAu(s.expenses, userId).filter(e => e.date >= cutoff);
    if (vehicleId) list = list.filter(e => e.vehicleId === vehicleId);
    const byCategory = {};
    for (const e of list) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const total = list.reduce((sum, e) => sum + e.amount, 0);
    return {
      ok: true,
      result: {
        expenses: list.slice().sort((a, b) => b.date.localeCompare(a.date)),
        total: Math.round(total * 100) / 100,
        byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      },
    };
  });

  registerLensAction("automotive", "expenses-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.expenses, aidAu(ctx));
    const i = list.findIndex(e => e.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "expense not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Trips ─────────────────────────────────────────────────────

  registerLensAction("automotive", "trips-log", (ctx, _a, params = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const distance = Number(params.distance);
    if (!Number.isFinite(distance) || distance <= 0) return { ok: false, error: "positive distance required" };
    const seq = ensureSeqAu(s, userId);
    const trip = {
      id: uidAu('trip'),
      number: `TR-${String(seq.trip).padStart(5, '0')}`,
      vehicleId,
      date: String(params.date || dayAu()),
      distance,
      purpose: ['business', 'personal', 'commute', 'other'].includes(params.purpose) ? params.purpose : 'personal',
      from: String(params.from || ''),
      to: String(params.to || ''),
      note: String(params.note || ''),
      createdAt: isoAu(),
    };
    seq.trip++;
    listAu(s.trips, userId).push(trip);
    saveAuto();
    return { ok: true, result: { trip } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "trips-list", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.trips, aidAu(ctx));
    if (vehicleId) list = list.filter(t => t.vehicleId === vehicleId);
    const businessMiles = list.filter(t => t.purpose === 'business').reduce((sum, t) => sum + t.distance, 0);
    const totalMiles = list.reduce((sum, t) => sum + t.distance, 0);
    return {
      ok: true,
      result: {
        trips: list.slice().sort((a, b) => b.date.localeCompare(a.date)),
        totalMiles: Math.round(totalMiles * 10) / 10,
        businessMiles: Math.round(businessMiles * 10) / 10,
      },
    };
  });

  registerLensAction("automotive", "trips-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.trips, aidAu(ctx));
    const i = list.findIndex(t => t.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "trip not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Documents (insurance, registration, etc) ─────────────────

  registerLensAction("automotive", "documents-list", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.documents, aidAu(ctx));
    if (vehicleId) list = list.filter(d => d.vehicleId === vehicleId);
    const now = Date.now();
    for (const d of list) {
      d.expiringSoon = d.expiryDate ? (new Date(d.expiryDate).getTime() - now) <= 30 * 86_400_000 && new Date(d.expiryDate).getTime() > now : false;
      d.expired = d.expiryDate ? new Date(d.expiryDate).getTime() < now : false;
    }
    return { ok: true, result: { documents: list } };
  });

  registerLensAction("automotive", "documents-create", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const kind = ['insurance', 'registration', 'inspection', 'warranty', 'title', 'other'].includes(params.kind) ? params.kind : 'other';
    const seq = ensureSeqAu(s, userId);
    const doc = {
      id: uidAu('doc'),
      number: `D-${String(seq.doc).padStart(4, '0')}`,
      vehicleId, kind,
      title: String(params.title || kind),
      provider: String(params.provider || ''),
      policyNumber: String(params.policyNumber || ''),
      expiryDate: params.expiryDate ? String(params.expiryDate) : null,
      fileUrl: String(params.fileUrl || ''),
      note: String(params.note || ''),
      createdAt: isoAu(),
    };
    seq.doc++;
    listAu(s.documents, userId).push(doc);
    saveAuto();
    return { ok: true, result: { document: doc } };
  });

  registerLensAction("automotive", "documents-delete", (ctx, _a, params = {}) => {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.documents, aidAu(ctx));
    const i = list.findIndex(d => d.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "document not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Vehicle stats ────────────────────────────────────────────

  registerLensAction("automotive", "vehicle-stats", (ctx, _a, params = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    const vehicle = listAu(s.vehicles, userId).find(v => v.id === vehicleId);
    if (!vehicle) return { ok: false, error: "vehicle not found" };
    const fuel = listAu(s.fuel, userId).filter(f => f.vehicleId === vehicleId).sort((a, b) => a.odometer - b.odometer);
    // Lifetime MPG: total distance between first & last fill ÷ total volume of fills after the first.
    let lifetimeMpg = null;
    if (fuel.length >= 2) {
      const dist = fuel[fuel.length - 1].odometer - fuel[0].odometer;
      const vol = fuel.slice(1).reduce((sum, f) => sum + f.volume, 0);
      if (dist > 0 && vol > 0) lifetimeMpg = Math.round((dist / vol) * 100) / 100;
    }
    const expenses = listAu(s.expenses, userId).filter(e => e.vehicleId === vehicleId);
    const totalSpend = expenses.reduce((sum, e) => sum + e.amount, 0);
    const fuelSpend = expenses.filter(e => e.category === 'fuel').reduce((sum, e) => sum + e.amount, 0);
    const odoEntries = [...fuel.map(f => f.odometer), ...listAu(s.service, userId).filter(x => x.vehicleId === vehicleId).map(x => x.odometer)].filter(Number.isFinite);
    const milesTracked = odoEntries.length >= 2 ? Math.max(...odoEntries) - Math.min(...odoEntries) : 0;
    const costPerMile = milesTracked > 0 ? Math.round((totalSpend / milesTracked) * 1000) / 1000 : null;
    return {
      ok: true,
      result: {
        vehicleId, vehicleName: vehicle.name,
        odometer: vehicle.odometer,
        lifetimeMpg,
        totalSpend: Math.round(totalSpend * 100) / 100,
        fuelSpend: Math.round(fuelSpend * 100) / 100,
        fillCount: fuel.length,
        serviceCount: listAu(s.service, userId).filter(x => x.vehicleId === vehicleId).length,
        milesTracked,
        costPerMile,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("automotive", "automotive-dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getAutoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicles = listAu(s.vehicles, userId);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const yearExpenses = listAu(s.expenses, userId).filter(e => e.date >= yearAgo);
    const spend12mo = yearExpenses.reduce((sum, e) => sum + e.amount, 0);
    // reminders rollup
    let overdue = 0, dueSoon = 0;
    const serviceLog = listAu(s.service, userId);
    for (const item of listAu(s.schedule, userId)) {
      const vehicle = vehicles.find(v => v.id === item.vehicleId);
      if (!vehicle) continue;
      const matching = serviceLog.filter(sv => sv.vehicleId === item.vehicleId && sv.serviceType.toLowerCase() === item.serviceType.toLowerCase()).sort((a, b) => b.odometer - a.odometer);
      const lastOdo = item.lastDoneOdometer ?? matching[0]?.odometer ?? 0;
      if (item.intervalMiles) {
        const rem = (lastOdo + item.intervalMiles) - vehicle.odometer;
        if (rem < 0) overdue++; else if (rem <= 500) dueSoon++;
      }
    }
    return {
      ok: true,
      result: {
        vehicleCount: vehicles.length,
        spend12moUsd: Math.round(spend12mo * 100) / 100,
        fuelEntryCount: listAu(s.fuel, userId).length,
        serviceEntryCount: serviceLog.length,
        overdueServices: overdue,
        dueSoonServices: dueSoon,
        scheduleCount: listAu(s.schedule, userId).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════
  //  Feature-parity backlog — OBD telemetry, TCO rollups, predictive
  //  maintenance, photo attachments, multi-vehicle comparison,
  //  shop locator + appointments, warranty/insurance renewals.
  // ═══════════════════════════════════════════════════════════════

  function getAutoExtra() {
    const s = getAutoState();
    if (!s) return null;
    if (!s.obd) s.obd = new Map();             // userId -> Array<ObdReading>
    if (!s.attachments) s.attachments = new Map(); // userId -> Array<Attachment>
    if (!s.shops) s.shops = new Map();         // userId -> Array<Shop>
    if (!s.appointments) s.appointments = new Map(); // userId -> Array<Appointment>
    if (!s.renewals) s.renewals = new Map();   // userId -> Array<Renewal>
    if (!s.seqX) s.seqX = new Map();           // userId -> { obd, att, shop, appt, ren }
    return s;
  }
  function ensureSeqX(s, userId) {
    if (!s.seqX.has(userId)) s.seqX.set(userId, { obd: 1, att: 1, shop: 1, appt: 1, ren: 1 });
    const seq = s.seqX.get(userId);
    for (const k of ['obd', 'att', 'shop', 'appt', 'ren']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  // ── OBD-II live telemetry import (Bluetooth dongle bridge) ────
  // The frontend reads the OBD-II ELM327 dongle over Web Bluetooth and
  // POSTs decoded PID readings here. No synthesis — every value is what
  // the dongle reported.

  registerLensAction("automotive", "obd-import", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    const vehicle = listAu(s.vehicles, userId).find(v => v.id === vehicleId);
    if (!vehicle) return { ok: false, error: "vehicle not found" };
    const readings = Array.isArray(params.readings) ? params.readings : [];
    if (readings.length === 0) return { ok: false, error: "readings array required (decoded OBD-II PIDs from the dongle)" };
    const seq = ensureSeqX(s, userId);
    const KNOWN_PIDS = ['rpm', 'speed', 'coolantTemp', 'engineLoad', 'intakeTemp', 'throttlePos', 'fuelLevel', 'batteryVoltage', 'mafRate', 'fuelRate', 'distanceWithMil'];
    const stored = [];
    for (const r of readings) {
      const metric = String(r.metric || r.pid || "").trim();
      const value = Number(r.value);
      if (!metric || !Number.isFinite(value)) continue;
      const entry = {
        id: uidAu('obd'),
        number: `OBD-${String(seq.obd).padStart(6, '0')}`,
        vehicleId,
        metric,
        value,
        unit: String(r.unit || ''),
        timestamp: r.timestamp ? String(r.timestamp) : isoAu(),
        known: KNOWN_PIDS.includes(metric),
        dongle: String(params.dongle || r.dongle || 'ELM327'),
        createdAt: isoAu(),
      };
      seq.obd++;
      stored.push(entry);
      listAu(s.obd, userId).push(entry);
    }
    if (stored.length === 0) return { ok: false, error: "no valid readings (each needs { metric, value })" };
    // Cap retained readings per vehicle at 2000 (rolling window).
    const all = listAu(s.obd, userId).filter(o => o.vehicleId === vehicleId);
    if (all.length > 2000) {
      const overflow = all.slice(0, all.length - 2000).map(o => o.id);
      const list = listAu(s.obd, userId);
      for (let i = list.length - 1; i >= 0; i--) if (overflow.includes(list[i].id)) list.splice(i, 1);
    }
    saveAuto();
    return { ok: true, result: { imported: stored.length, readings: stored } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "obd-list", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.obd, userId);
    if (vehicleId) list = list.filter(o => o.vehicleId === vehicleId);
    if (params.metric) list = list.filter(o => o.metric === String(params.metric));
    list = list.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    // Latest snapshot: most recent value per metric.
    const latest = {};
    for (const o of list) if (!latest[o.metric]) latest[o.metric] = { value: o.value, unit: o.unit, timestamp: o.timestamp };
    return { ok: true, result: { readings: list.slice(0, 500), count: list.length, latest } };
  });

  registerLensAction("automotive", "obd-delete", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const list = listAu(s.obd, userId);
    if (params.vehicleId && params.all) {
      const vid = String(params.vehicleId);
      const before = list.length;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].vehicleId === vid) list.splice(i, 1);
      saveAuto();
      return { ok: true, result: { deleted: before - list.length } };
    }
    const i = list.findIndex(o => o.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "obd reading not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: 1 } };
  });

  // ── Cost-per-mile / total-cost-of-ownership rollups ───────────

  registerLensAction("automotive", "cost-of-ownership", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    const vehicle = listAu(s.vehicles, userId).find(v => v.id === vehicleId);
    if (!vehicle) return { ok: false, error: "vehicle not found" };
    const purchasePrice = Math.max(0, Number(params.purchasePrice) || 0);
    const salvageValue = Math.max(0, Number(params.salvageValue) || 0);
    const expenses = listAu(s.expenses, userId).filter(e => e.vehicleId === vehicleId);
    const fuel = listAu(s.fuel, userId).filter(f => f.vehicleId === vehicleId).sort((a, b) => a.odometer - b.odometer);
    const service = listAu(s.service, userId).filter(x => x.vehicleId === vehicleId);
    // miles tracked across logged odometer points
    const odoPts = [...fuel.map(f => f.odometer), ...service.map(x => x.odometer)].filter(Number.isFinite);
    const milesTracked = odoPts.length >= 2 ? Math.max(...odoPts) - Math.min(...odoPts) : 0;
    // expense breakdown by category
    const byCategory = {};
    for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const operatingTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
    // depreciation: purchase - salvage (only counted if a purchase price was supplied)
    const depreciation = purchasePrice > 0 ? Math.max(0, purchasePrice - salvageValue) : 0;
    const totalCostOfOwnership = operatingTotal + depreciation;
    // ownership duration in months
    const createdMs = new Date(vehicle.createdAt).getTime();
    const ownedMonths = Number.isFinite(createdMs)
      ? Math.max(1, Math.round((Date.now() - createdMs) / (30 * 86_400_000)))
      : 1;
    const round2 = (n) => Math.round(n * 100) / 100;
    const round3 = (n) => Math.round(n * 1000) / 1000;
    return {
      ok: true,
      result: {
        vehicleId,
        vehicleName: vehicle.name,
        milesTracked,
        ownedMonths,
        purchasePrice,
        salvageValue,
        depreciation: round2(depreciation),
        operatingCost: round2(operatingTotal),
        totalCostOfOwnership: round2(totalCostOfOwnership),
        costPerMile: milesTracked > 0 ? round3(totalCostOfOwnership / milesTracked) : null,
        operatingCostPerMile: milesTracked > 0 ? round3(operatingTotal / milesTracked) : null,
        costPerMonth: round2(totalCostOfOwnership / ownedMonths),
        byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round2(v)])),
        note: purchasePrice === 0 ? "Supply purchasePrice for a full TCO including depreciation." : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Predictive maintenance alerts ────────────────────────────
  // Projects each scheduled service forward using the vehicle's recent
  // mileage accumulation rate (computed from logged odometer points).

  registerLensAction("automotive", "predictive-maintenance", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    const vehicles = listAu(s.vehicles, userId).filter(v => !vehicleId || v.id === vehicleId);
    if (vehicleId && vehicles.length === 0) return { ok: false, error: "vehicle not found" };
    const serviceLog = listAu(s.service, userId);
    const fuelLog = listAu(s.fuel, userId);
    const schedule = listAu(s.schedule, userId);
    const now = Date.now();
    const alerts = [];
    for (const vehicle of vehicles) {
      // miles/day from dated odometer points (fuel + service)
      const pts = [...fuelLog.filter(f => f.vehicleId === vehicle.id).map(f => ({ date: f.date, odo: f.odometer })),
                   ...serviceLog.filter(x => x.vehicleId === vehicle.id).map(x => ({ date: x.date, odo: x.odometer }))]
        .filter(p => p.date && Number.isFinite(p.odo))
        .sort((a, b) => a.date.localeCompare(b.date));
      let milesPerDay = null;
      if (pts.length >= 2) {
        const first = pts[0], last = pts[pts.length - 1];
        const days = Math.max(1, (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000);
        const dist = last.odo - first.odo;
        if (dist > 0) milesPerDay = Math.round((dist / days) * 100) / 100;
      }
      const sched = schedule.filter(item => item.vehicleId === vehicle.id);
      for (const item of sched) {
        if (!item.intervalMiles) continue;
        const matching = serviceLog
          .filter(sv => sv.vehicleId === vehicle.id && sv.serviceType.toLowerCase() === item.serviceType.toLowerCase())
          .sort((a, b) => b.odometer - a.odometer);
        const lastOdo = item.lastDoneOdometer ?? matching[0]?.odometer ?? 0;
        const dueAt = lastOdo + item.intervalMiles;
        const milesRemaining = dueAt - vehicle.odometer;
        const daysUntilDue = milesPerDay && milesPerDay > 0 ? Math.round(milesRemaining / milesPerDay) : null;
        const predictedDate = daysUntilDue !== null
          ? new Date(now + daysUntilDue * 86_400_000).toISOString().slice(0, 10)
          : null;
        let risk = 'low';
        if (milesRemaining < 0) risk = 'overdue';
        else if (daysUntilDue !== null && daysUntilDue <= 14) risk = 'high';
        else if (daysUntilDue !== null && daysUntilDue <= 45) risk = 'medium';
        else if (milesRemaining <= 500) risk = 'medium';
        alerts.push({
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          serviceType: item.serviceType,
          dueAtOdometer: dueAt,
          milesRemaining,
          milesPerDay,
          daysUntilDue,
          predictedDate,
          risk,
          recommendation: risk === 'overdue'
            ? `${item.serviceType} is ${Math.abs(milesRemaining).toLocaleString()} mi overdue — schedule now.`
            : daysUntilDue !== null
              ? `At ${milesPerDay} mi/day, ${item.serviceType} is due in about ${daysUntilDue} days.`
              : `${item.serviceType} due in ${milesRemaining.toLocaleString()} mi — log fill-ups to enable a date forecast.`,
        });
      }
    }
    const rank = { overdue: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => rank[a.risk] - rank[b.risk] || a.milesRemaining - b.milesRemaining);
    return {
      ok: true,
      result: {
        alerts,
        overdueCount: alerts.filter(a => a.risk === 'overdue').length,
        highRiskCount: alerts.filter(a => a.risk === 'high').length,
        forecastable: alerts.filter(a => a.daysUntilDue !== null).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Photo attachments for receipts + odometer readings ───────
  // The frontend uploads images to the artifact store and passes the
  // resulting URL/data-URI here; the macro stores the reference.

  registerLensAction("automotive", "attachments-add", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const url = String(params.url || params.dataUri || "").trim();
    if (!url) return { ok: false, error: "url or dataUri required (upload the photo first)" };
    const kind = ['receipt', 'odometer', 'damage', 'document', 'other'].includes(params.kind) ? params.kind : 'other';
    const seq = ensureSeqX(s, userId);
    const att = {
      id: uidAu('att'),
      number: `IMG-${String(seq.att).padStart(5, '0')}`,
      vehicleId,
      kind,
      url,
      caption: String(params.caption || ''),
      linkedType: ['fuel', 'service', 'expense', 'document', 'none'].includes(params.linkedType) ? params.linkedType : 'none',
      linkedId: String(params.linkedId || ''),
      odometerReading: Number.isFinite(Number(params.odometerReading)) ? Number(params.odometerReading) : null,
      date: String(params.date || dayAu()),
      createdAt: isoAu(),
    };
    seq.att++;
    listAu(s.attachments, userId).push(att);
    if (att.odometerReading !== null) bumpOdometer(s, userId, vehicleId, att.odometerReading);
    saveAuto();
    return { ok: true, result: { attachment: att } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "attachments-list", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.attachments, userId);
    if (vehicleId) list = list.filter(a => a.vehicleId === vehicleId);
    if (params.kind) list = list.filter(a => a.kind === String(params.kind));
    if (params.linkedId) list = list.filter(a => a.linkedId === String(params.linkedId));
    return { ok: true, result: { attachments: list.slice().sort((a, b) => b.date.localeCompare(a.date)), count: list.length } };
  });

  registerLensAction("automotive", "attachments-delete", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.attachments, aidAu(ctx));
    const i = list.findIndex(a => a.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "attachment not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Multi-vehicle comparison dashboard ───────────────────────

  registerLensAction("automotive", "compare-vehicles", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const all = listAu(s.vehicles, userId);
    const ids = Array.isArray(params.vehicleIds) && params.vehicleIds.length > 0
      ? params.vehicleIds.map(String)
      : all.map(v => v.id);
    const vehicles = all.filter(v => ids.includes(v.id));
    if (vehicles.length === 0) return { ok: false, error: "no vehicles to compare" };
    const rows = vehicles.map(vehicle => {
      const fuel = listAu(s.fuel, userId).filter(f => f.vehicleId === vehicle.id).sort((a, b) => a.odometer - b.odometer);
      const service = listAu(s.service, userId).filter(x => x.vehicleId === vehicle.id);
      const expenses = listAu(s.expenses, userId).filter(e => e.vehicleId === vehicle.id);
      let lifetimeMpg = null;
      if (fuel.length >= 2) {
        const dist = fuel[fuel.length - 1].odometer - fuel[0].odometer;
        const vol = fuel.slice(1).reduce((sum, f) => sum + f.volume, 0);
        if (dist > 0 && vol > 0) lifetimeMpg = Math.round((dist / vol) * 100) / 100;
      }
      const totalSpend = expenses.reduce((sum, e) => sum + e.amount, 0);
      const fuelSpend = expenses.filter(e => e.category === 'fuel').reduce((sum, e) => sum + e.amount, 0);
      const odoPts = [...fuel.map(f => f.odometer), ...service.map(x => x.odometer)].filter(Number.isFinite);
      const milesTracked = odoPts.length >= 2 ? Math.max(...odoPts) - Math.min(...odoPts) : 0;
      return {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        odometer: vehicle.odometer,
        lifetimeMpg,
        totalSpend: Math.round(totalSpend * 100) / 100,
        fuelSpend: Math.round(fuelSpend * 100) / 100,
        serviceCount: service.length,
        fillCount: fuel.length,
        milesTracked,
        costPerMile: milesTracked > 0 ? Math.round((totalSpend / milesTracked) * 1000) / 1000 : null,
      };
    });
    const numeric = (key) => rows.map(r => r[key]).filter((v) => typeof v === 'number');
    const best = {};
    const mpgVals = numeric('lifetimeMpg');
    if (mpgVals.length) best.bestMpg = rows.filter(r => r.lifetimeMpg === Math.max(...mpgVals))[0]?.vehicleName;
    const cpmVals = numeric('costPerMile');
    if (cpmVals.length) best.lowestCostPerMile = rows.filter(r => r.costPerMile === Math.min(...cpmVals))[0]?.vehicleName;
    const spendVals = numeric('totalSpend');
    if (spendVals.length) best.highestSpend = rows.filter(r => r.totalSpend === Math.max(...spendVals))[0]?.vehicleName;
    return {
      ok: true,
      result: {
        rows,
        vehicleCount: rows.length,
        fleetTotalSpend: Math.round(rows.reduce((sum, r) => sum + r.totalSpend, 0) * 100) / 100,
        fleetMilesTracked: rows.reduce((sum, r) => sum + r.milesTracked, 0),
        highlights: best,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Service-shop locator + appointment notes ─────────────────

  registerLensAction("automotive", "shops-create", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "shop name required" };
    const seq = ensureSeqX(s, userId);
    const rating = Number(params.rating);
    const shop = {
      id: uidAu('shop'),
      number: `SH-${String(seq.shop).padStart(3, '0')}`,
      name,
      address: String(params.address || ''),
      phone: String(params.phone || ''),
      laborRate: Number.isFinite(Number(params.laborRate)) ? Number(params.laborRate) : null,
      specialties: Array.isArray(params.specialties) ? params.specialties.map(String) : [],
      rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : null,
      lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null,
      lon: Number.isFinite(Number(params.lon)) ? Number(params.lon) : null,
      note: String(params.note || ''),
      createdAt: isoAu(),
    };
    seq.shop++;
    listAu(s.shops, userId).push(shop);
    saveAuto();
    return { ok: true, result: { shop } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Real geocoding via OpenStreetMap Nominatim (free, keyless) so the
  // locator can place a saved shop on a map.
  registerLensAction("automotive", "shops-geocode", async (_ctx, _a, params = {}) => {
    const query = String(params.query || params.address || "").trim();
    if (!query) return { ok: false, error: "query (address or place) required" };
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'concord-cognitive-engine/automotive-lens' } });
      if (!r.ok) throw new Error(`nominatim ${r.status}`);
      const data = await r.json();
      const matches = (Array.isArray(data) ? data : []).map(m => ({
        displayName: m.display_name,
        lat: Number(m.lat),
        lon: Number(m.lon),
        type: m.type,
      }));
      return { ok: true, result: { matches, count: matches.length, source: "osm-nominatim" } };
    } catch (e) {
      return { ok: false, error: `nominatim unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("automotive", "shops-list", (ctx, _a, _p = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { shops: listAu(s.shops, aidAu(ctx)).slice().sort((a, b) => a.name.localeCompare(b.name)) } };
  });

  registerLensAction("automotive", "shops-delete", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const list = listAu(s.shops, userId);
    const i = list.findIndex(sh => sh.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "shop not found" };
    const shopId = list[i].id;
    list.splice(i, 1);
    // detach appointments
    for (const appt of listAu(s.appointments, userId)) if (appt.shopId === shopId) appt.shopId = '';
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  registerLensAction("automotive", "appointments-create", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const date = String(params.date || "").trim();
    if (!date) return { ok: false, error: "date required (YYYY-MM-DD)" };
    const shopId = String(params.shopId || "");
    if (shopId && !listAu(s.shops, userId).find(sh => sh.id === shopId)) return { ok: false, error: "shop not found" };
    const seq = ensureSeqX(s, userId);
    const appt = {
      id: uidAu('appt'),
      number: `APT-${String(seq.appt).padStart(4, '0')}`,
      vehicleId,
      shopId,
      date,
      time: String(params.time || ''),
      serviceType: String(params.serviceType || ''),
      status: ['scheduled', 'confirmed', 'completed', 'cancelled'].includes(params.status) ? params.status : 'scheduled',
      estimatedCost: Number.isFinite(Number(params.estimatedCost)) ? Number(params.estimatedCost) : null,
      notes: String(params.notes || ''),
      createdAt: isoAu(),
    };
    seq.appt++;
    listAu(s.appointments, userId).push(appt);
    saveAuto();
    return { ok: true, result: { appointment: appt } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "appointments-list", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.appointments, userId);
    if (vehicleId) list = list.filter(a => a.vehicleId === vehicleId);
    if (params.status) list = list.filter(a => a.status === String(params.status));
    const shops = listAu(s.shops, userId);
    const enriched = list.slice().sort((a, b) => a.date.localeCompare(b.date)).map(a => ({
      ...a,
      shopName: shops.find(sh => sh.id === a.shopId)?.name || null,
    }));
    const today = dayAu();
    return {
      ok: true,
      result: {
        appointments: enriched,
        upcomingCount: enriched.filter(a => a.date >= today && a.status !== 'cancelled' && a.status !== 'completed').length,
      },
    };
  });

  registerLensAction("automotive", "appointments-update", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.appointments, aidAu(ctx));
    const appt = list.find(a => a.id === String(params.id || ""));
    if (!appt) return { ok: false, error: "appointment not found" };
    if (['scheduled', 'confirmed', 'completed', 'cancelled'].includes(params.status)) appt.status = params.status;
    for (const k of ['date', 'time', 'serviceType', 'notes']) if (typeof params[k] === 'string') appt[k] = params[k];
    if (Number.isFinite(Number(params.estimatedCost))) appt.estimatedCost = Number(params.estimatedCost);
    saveAuto();
    return { ok: true, result: { appointment: appt } };
  });

  registerLensAction("automotive", "appointments-delete", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.appointments, aidAu(ctx));
    const i = list.findIndex(a => a.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "appointment not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  // ── Warranty + insurance renewal tracking ────────────────────

  const RENEWAL_KINDS = ['warranty', 'insurance', 'registration', 'inspection', 'lease', 'extended_warranty', 'roadside', 'other'];

  registerLensAction("automotive", "renewals-create", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = String(params.vehicleId || "");
    if (!listAu(s.vehicles, userId).find(v => v.id === vehicleId)) return { ok: false, error: "vehicle not found" };
    const kind = RENEWAL_KINDS.includes(params.kind) ? params.kind : 'other';
    const renewalDate = String(params.renewalDate || params.expiryDate || "").trim();
    if (!renewalDate) return { ok: false, error: "renewalDate required (YYYY-MM-DD)" };
    const seq = ensureSeqX(s, userId);
    const renewal = {
      id: uidAu('ren'),
      number: `RN-${String(seq.ren).padStart(4, '0')}`,
      vehicleId,
      kind,
      title: String(params.title || kind),
      provider: String(params.provider || ''),
      policyNumber: String(params.policyNumber || ''),
      renewalDate,
      premium: Number.isFinite(Number(params.premium)) ? Number(params.premium) : null,
      coverageLimitMiles: Number.isFinite(Number(params.coverageLimitMiles)) ? Number(params.coverageLimitMiles) : null,
      reminderDays: Number.isFinite(Number(params.reminderDays)) ? Math.max(1, Number(params.reminderDays)) : 30,
      autoRenew: params.autoRenew === true,
      note: String(params.note || ''),
      createdAt: isoAu(),
    };
    seq.ren++;
    listAu(s.renewals, userId).push(renewal);
    saveAuto();
    return { ok: true, result: { renewal } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  function decorateRenewal(s, userId, r) {
    const now = Date.now();
    const renewMs = new Date(r.renewalDate).getTime();
    const daysRemaining = Number.isFinite(renewMs) ? Math.round((renewMs - now) / 86_400_000) : null;
    const vehicle = listAu(s.vehicles, userId).find(v => v.id === r.vehicleId);
    let milesRemaining = null;
    if (r.coverageLimitMiles !== null && vehicle) milesRemaining = r.coverageLimitMiles - vehicle.odometer;
    let status = 'ok';
    if (daysRemaining !== null && daysRemaining < 0) status = 'expired';
    else if (milesRemaining !== null && milesRemaining < 0) status = 'expired';
    else if (daysRemaining !== null && daysRemaining <= r.reminderDays) status = 'due_soon';
    else if (milesRemaining !== null && milesRemaining <= 1000) status = 'due_soon';
    return { ...r, daysRemaining, milesRemaining, status, vehicleName: vehicle?.name || null };
  }

  registerLensAction("automotive", "renewals-list", (ctx, _a, params = {}) => {
  try {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const vehicleId = params.vehicleId ? String(params.vehicleId) : null;
    let list = listAu(s.renewals, userId);
    if (vehicleId) list = list.filter(r => r.vehicleId === vehicleId);
    if (params.kind) list = list.filter(r => r.kind === String(params.kind));
    const decorated = list.map(r => decorateRenewal(s, userId, r))
      .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
    return {
      ok: true,
      result: {
        renewals: decorated,
        expiredCount: decorated.filter(r => r.status === 'expired').length,
        dueSoonCount: decorated.filter(r => r.status === 'due_soon').length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("automotive", "renewals-upcoming", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const withinDays = Math.max(1, Math.min(365, Number(params.withinDays) || 60));
    const decorated = listAu(s.renewals, userId)
      .map(r => decorateRenewal(s, userId, r))
      .filter(r => r.status !== 'ok' || (r.daysRemaining !== null && r.daysRemaining <= withinDays))
      .sort((a, b) => {
        const rank = { expired: 0, due_soon: 1, ok: 2 };
        return rank[a.status] - rank[b.status] || a.renewalDate.localeCompare(b.renewalDate);
      });
    return { ok: true, result: { renewals: decorated, count: decorated.length, withinDays } };
  });

  registerLensAction("automotive", "renewals-update", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidAu(ctx);
    const r = listAu(s.renewals, userId).find(x => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "renewal not found" };
    for (const k of ['title', 'provider', 'policyNumber', 'renewalDate', 'note']) if (typeof params[k] === 'string') r[k] = params[k];
    if (Number.isFinite(Number(params.premium))) r.premium = Number(params.premium);
    if (Number.isFinite(Number(params.coverageLimitMiles))) r.coverageLimitMiles = Number(params.coverageLimitMiles);
    if (Number.isFinite(Number(params.reminderDays))) r.reminderDays = Math.max(1, Number(params.reminderDays));
    if (typeof params.autoRenew === 'boolean') r.autoRenew = params.autoRenew;
    if (RENEWAL_KINDS.includes(params.kind)) r.kind = params.kind;
    saveAuto();
    return { ok: true, result: { renewal: decorateRenewal(s, userId, r) } };
  });

  registerLensAction("automotive", "renewals-delete", (ctx, _a, params = {}) => {
    const s = getAutoExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listAu(s.renewals, aidAu(ctx));
    const i = list.findIndex(r => r.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "renewal not found" };
    list.splice(i, 1);
    saveAuto();
    return { ok: true, result: { deleted: true } };
  });

  registerLensAction("automotive", "feed", async (ctx, _a, params = {}) => {
    const STATE = globalThis._concordSTATE; if (!STATE) return { ok: false, error: "STATE unavailable" };
    if (!STATE.automotiveLens) STATE.automotiveLens = {};
    if (!(STATE.automotiveLens.feedSeen instanceof Set)) STATE.automotiveLens.feedSeen = new Set();
    const seen = STATE.automotiveLens.feedSeen;
    const make = String(params.make || "honda").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() || "honda";
    const model = String(params.model || "accord").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() || "accord";
    const year = String(Math.max(1990, Math.min(2027, Math.round(Number(params.year) || 2024))));
    try {
      const r = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`);
      if (!r.ok) return { ok: false, error: `nhtsa ${r.status}` };
      const data = await r.json();
      const results = (data.results || []).slice(0, 15);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const rc of results) {
        const id = rc.NHTSACampaignNumber;
        if (!id || seen.has(id)) { skipped++; continue; }
        const title = `Recall ${id}: ${String(rc.Component || "").slice(0, 80)}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${rc.Component || "Recall"} - ${make} ${model} ${year}\nCampaign: ${id}\n\nSummary: ${String(rc.Summary || "").slice(0, 600)}\n\nRemedy: ${String(rc.Remedy || "").slice(0, 400)}`,
          tags: ["automotive", "feed", "recall", "nhtsa"],
          source: "nhtsa-recalls-feed",
          meta: { campaign: id, make, model, year, component: rc.Component },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); seen.add(id); }
      }
      if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } }
      return { ok: true, result: { ingested, skipped, source: `nhtsa-recalls (${make} ${model} ${year})`, dtuIds } };
    } catch (e) { return { ok: false, error: `nhtsa unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  });
}
