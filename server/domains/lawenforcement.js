// server/domains/lawenforcement.js
//
// law-enforcement lens — RMS/CAD parity (Axon Records / Mark43).
//
// Adds, on top of the original pure-compute analytics macros
// (caseAnalysis, patrolOptimize, incidentReport, crimeStats), a full
// records-management + computer-aided-dispatch substrate:
//   - CAD: live call queue, unit status board, dispatch routing
//   - Evidence chain-of-custody with transfers + locker tracking
//   - Officer roster / shift scheduling with overtime detection
//   - Crime mapping: geospatial incident store + hotspot detection
//   - Warrant lifecycle: issue / service attempts / return / expiry
//   - Report writing with statute auto-population + supervisor approval
//   - Field interview / arrest booking forms
//
// Persistence: per-process Maps hung off globalThis._concordSTATE, keyed
// by userId, so a user's CAD calls / evidence / officers / warrants
// survive across requests within the process. No DB schema, no
// migrations. Every value returned is real (user input or deterministic
// computation) — no seed/mock/demo data.

import crypto from "node:crypto";

// ---- store ---------------------------------------------------------------

function store() {
  const STATE = (globalThis._concordSTATE = globalThis._concordSTATE || {});
  if (!STATE._lawEnforcement) {
    STATE._lawEnforcement = {
      calls: new Map(),     // userId -> Map(callId    -> CAD call)
      units: new Map(),     // userId -> Map(unitId    -> unit record)
      evidence: new Map(),  // userId -> Map(evidenceId-> evidence + custody[])
      officers: new Map(),  // userId -> Map(officerId -> officer + shifts[])
      mapIncidents: new Map(), // userId -> Map(incidentId -> geo incident)
      warrants: new Map(),  // userId -> Map(warrantId  -> warrant + attempts[])
      reports: new Map(),   // userId -> Map(reportId   -> narrative report)
      bookings: new Map(),  // userId -> Map(bookingId  -> field-interview/arrest)
    };
  }
  return STATE._lawEnforcement;
}

function userMap(bucket, userId) {
  const s = store();
  if (!s[bucket].has(userId)) s[bucket].set(userId, new Map());
  return s[bucket].get(userId);
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function asNum(v, dflt = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

// ---- statute reference (real US-style statute scaffolding) ---------------
// Maps an offense keyword to a representative statute code + class. This is
// reference data the report writer auto-populates from — not user content.
const STATUTE_TABLE = {
  homicide:       { code: "PC 187", title: "Murder", class: "felony" },
  assault:        { code: "PC 240", title: "Assault", class: "misdemeanor" },
  battery:        { code: "PC 242", title: "Battery", class: "misdemeanor" },
  robbery:        { code: "PC 211", title: "Robbery", class: "felony" },
  burglary:       { code: "PC 459", title: "Burglary", class: "felony" },
  theft:          { code: "PC 484", title: "Theft", class: "misdemeanor" },
  "grand theft":  { code: "PC 487", title: "Grand Theft", class: "felony" },
  vandalism:      { code: "PC 594", title: "Vandalism", class: "misdemeanor" },
  dui:            { code: "VC 23152", title: "Driving Under the Influence", class: "misdemeanor" },
  narcotics:      { code: "HS 11350", title: "Possession of Controlled Substance", class: "felony" },
  trespassing:    { code: "PC 602", title: "Trespassing", class: "infraction" },
  fraud:          { code: "PC 532", title: "Fraud", class: "felony" },
  arson:          { code: "PC 451", title: "Arson", class: "felony" },
  kidnapping:     { code: "PC 207", title: "Kidnapping", class: "felony" },
  "domestic violence": { code: "PC 273.5", title: "Corporal Injury to Spouse", class: "felony" },
  disturbance:    { code: "PC 415", title: "Disturbing the Peace", class: "infraction" },
  weapons:        { code: "PC 25400", title: "Carrying a Concealed Firearm", class: "felony" },
};

function lookupStatute(text) {
  const lower = str(text).toLowerCase();
  if (!lower) return null;
  // Longest-keyword-first so "grand theft" beats "theft".
  const keys = Object.keys(STATUTE_TABLE).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lower.includes(k)) return { keyword: k, ...STATUTE_TABLE[k] };
  }
  return null;
}

// Haversine distance in km between two lat/lon points.
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function registerLawEnforcementActions(registerLensAction) {
  // ======================================================================
  // ORIGINAL pure-compute analytics macros (preserved verbatim).
  // ======================================================================
  registerLensAction("law-enforcement", "caseAnalysis", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const evidence = Array.isArray(data.evidence) ? data.evidence : [];
    const witnesses = Array.isArray(data.witnesses) ? data.witnesses : [];
    const suspects = Array.isArray(data.suspects) ? data.suspects : [];
    const evidenceScore = Math.min(100, evidence.length * 15);
    const witnessScore = Math.min(100, witnesses.length * 20);
    const suspectLinks = suspects.reduce((s, su) => s + ((su.evidenceLinks || []).length), 0);
    const caseStrength = Math.round(evidenceScore * 0.4 + witnessScore * 0.3 + Math.min(100, suspectLinks * 25) * 0.3);
    return { ok: true, result: { caseId: data.caseId || artifact.title, evidenceCount: evidence.length, witnessCount: witnesses.length, suspectCount: suspects.length, caseStrength, prosecutable: caseStrength >= 60, status: caseStrength >= 80 ? "strong-case" : caseStrength >= 50 ? "developing" : "insufficient-evidence", nextSteps: caseStrength < 60 ? ["Collect additional evidence", "Interview more witnesses", "Analyze forensics"] : ["Prepare prosecution brief"] } };
  });
  registerLensAction("law-enforcement", "patrolOptimize", (ctx, artifact, _params) => {
    const zones = artifact.data?.zones || [];
    if (zones.length === 0) return { ok: true, result: { message: "Add patrol zones with crime data." } };
    const analyzed = zones.map(z => ({ zone: z.name, crimeRate: parseFloat(z.crimeRate) || 0, population: parseInt(z.population) || 0, currentPatrols: parseInt(z.currentPatrols) || 0, recommended: Math.ceil((parseFloat(z.crimeRate) || 0) / 10) }));
    return { ok: true, result: { zones: analyzed, totalUnitsNeeded: analyzed.reduce((s, z) => s + z.recommended, 0), totalCurrentUnits: analyzed.reduce((s, z) => s + z.currentPatrols, 0), hotspots: analyzed.filter(z => z.crimeRate > 50).map(z => z.zone) } };
  });
  registerLensAction("law-enforcement", "incidentReport", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const required = ["type", "date", "location", "description"];
    const missing = required.filter(f => !data[f]);
    return { ok: true, result: { reportId: `IR-${Date.now().toString(36).toUpperCase()}`, complete: missing.length === 0, missingFields: missing, type: data.type || "unspecified", date: data.date || new Date().toISOString(), location: data.location || "unspecified", severity: data.severity || "standard", status: "filed", chain_of_custody: { filed: new Date().toISOString(), officer: data.officer || ctx?.userId || "system" } } };
  });
  registerLensAction("law-enforcement", "crimeStats", (ctx, artifact, _params) => {
    const incidents = Array.isArray(artifact.data?.incidents) ? artifact.data.incidents : [];
    if (incidents.length === 0) return { ok: true, result: { message: "Add incident data to generate statistics." } };
    const byType = {};
    for (const i of incidents) { const t = i.type || "other"; byType[t] = (byType[t] || 0) + 1; }
    const resolved = incidents.filter(i => i.resolved || i.status === "closed").length;
    return { ok: true, result: { totalIncidents: incidents.length, byType: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ type: t, count: c })), clearanceRate: Math.round((resolved / incidents.length) * 100), mostCommon: Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || "none", trend: incidents.length > 100 ? "high-volume" : "normal" } };
  });

  // ======================================================================
  // CAD — computer-aided dispatch: call queue + unit board + routing.
  // ======================================================================
  const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

  registerLensAction("law-enforcement", "cadCreateCall", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const callType = str(p.callType);
      const location = str(p.location);
      if (!callType) return { ok: false, error: "callType is required" };
      if (!location) return { ok: false, error: "location is required" };
      const priority = ["P1", "P2", "P3", "P4"].includes(p.priority) ? p.priority : "P3";
      const calls = userMap("calls", actorId(ctx));
      const id = uid("call");
      const call = {
        id,
        callType,
        location,
        lat: p.lat != null ? asNum(p.lat) : null,
        lon: p.lon != null ? asNum(p.lon) : null,
        priority,
        callerName: str(p.callerName),
        callerPhone: str(p.callerPhone),
        narrative: str(p.narrative),
        status: "pending",
        assignedUnit: null,
        createdAt: nowISO(),
        dispatchedAt: null,
        clearedAt: null,
      };
      calls.set(id, call);
      return { ok: true, result: { call } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "cadCallQueue", (ctx, _artifact, _params) => {
    try {
      const calls = [...userMap("calls", actorId(ctx)).values()];
      const active = calls
        .filter((c) => c.status !== "cleared")
        .sort(
          (a, b) =>
            (PRIORITY_RANK[a.priority] || 9) - (PRIORITY_RANK[b.priority] || 9) ||
            a.createdAt.localeCompare(b.createdAt)
        );
      const byPriority = { P1: 0, P2: 0, P3: 0, P4: 0 };
      for (const c of active) if (byPriority[c.priority] != null) byPriority[c.priority]++;
      return {
        ok: true,
        result: {
          queue: active,
          activeCount: active.length,
          pendingCount: active.filter((c) => c.status === "pending").length,
          byPriority,
          totalCalls: calls.length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "cadRegisterUnit", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const callSign = str(p.callSign);
      if (!callSign) return { ok: false, error: "callSign is required" };
      const units = userMap("units", actorId(ctx));
      const id = uid("unit");
      const unit = {
        id,
        callSign,
        officerName: str(p.officerName),
        beat: str(p.beat),
        unitType: str(p.unitType) || "patrol",
        status: "available", // available | dispatched | enroute | onscene | unavailable
        lat: p.lat != null ? asNum(p.lat) : null,
        lon: p.lon != null ? asNum(p.lon) : null,
        currentCallId: null,
        registeredAt: nowISO(),
      };
      units.set(id, unit);
      return { ok: true, result: { unit } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "cadUnitBoard", (ctx, _artifact, _params) => {
    try {
      const units = [...userMap("units", actorId(ctx)).values()];
      const byStatus = { available: 0, dispatched: 0, enroute: 0, onscene: 0, unavailable: 0 };
      for (const u of units) if (byStatus[u.status] != null) byStatus[u.status]++;
      return {
        ok: true,
        result: {
          units: units.sort((a, b) => a.callSign.localeCompare(b.callSign)),
          totalUnits: units.length,
          availableCount: byStatus.available,
          byStatus,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "cadDispatchUnit", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const callId = str(p.callId);
      const calls = userMap("calls", actorId(ctx));
      const units = userMap("units", actorId(ctx));
      const call = calls.get(callId);
      if (!call) return { ok: false, error: "call not found" };
      let unit = p.unitId ? units.get(str(p.unitId)) : null;
      // Auto-route: nearest available unit when lat/lon present, else any free.
      if (!unit) {
        const free = [...units.values()].filter((u) => u.status === "available");
        if (free.length === 0) return { ok: false, error: "no available units" };
        if (call.lat != null && call.lon != null) {
          const located = free.filter((u) => u.lat != null && u.lon != null);
          const pool = located.length ? located : free;
          unit = pool
            .map((u) => ({
              u,
              d:
                u.lat != null && u.lon != null
                  ? haversineKm({ lat: call.lat, lon: call.lon }, { lat: u.lat, lon: u.lon })
                  : Infinity,
            }))
            .sort((a, b) => a.d - b.d)[0].u;
        } else {
          unit = free[0];
        }
      }
      if (unit.status !== "available") return { ok: false, error: "unit is not available" };
      call.assignedUnit = unit.id;
      call.status = "dispatched";
      call.dispatchedAt = nowISO();
      unit.status = "dispatched";
      unit.currentCallId = call.id;
      const eta =
        call.lat != null && call.lon != null && unit.lat != null && unit.lon != null
          ? Math.round(
              (haversineKm({ lat: call.lat, lon: call.lon }, { lat: unit.lat, lon: unit.lon }) /
                40) *
                60
            )
          : null;
      return { ok: true, result: { call, unit, etaMinutes: eta, routed: !p.unitId } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "cadUpdateStatus", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const VALID = ["enroute", "onscene", "cleared", "available", "unavailable"];
      const status = str(p.status);
      if (!VALID.includes(status)) return { ok: false, error: `status must be one of ${VALID.join(", ")}` };
      const units = userMap("units", actorId(ctx));
      const calls = userMap("calls", actorId(ctx));
      const unit = units.get(str(p.unitId));
      if (!unit) return { ok: false, error: "unit not found" };
      const call = unit.currentCallId ? calls.get(unit.currentCallId) : null;
      if (status === "cleared") {
        if (call) {
          call.status = "cleared";
          call.clearedAt = nowISO();
          call.assignedUnit = null;
        }
        unit.status = "available";
        unit.currentCallId = null;
      } else if (status === "available" || status === "unavailable") {
        unit.status = status;
        unit.currentCallId = null;
      } else {
        unit.status = status;
        if (call) call.status = status === "onscene" ? "on_scene" : "en_route";
      }
      return { ok: true, result: { unit, call } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ======================================================================
  // Evidence chain-of-custody — intake, transfers, locker tracking.
  // ======================================================================
  registerLensAction("law-enforcement", "evidenceIntake", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const description = str(p.description);
      if (!description) return { ok: false, error: "description is required" };
      const evidence = userMap("evidence", actorId(ctx));
      const id = uid("ev");
      const barcode = `EVD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const intakeOfficer = str(p.officer) || actorId(ctx);
      const rec = {
        id,
        barcode,
        caseNumber: str(p.caseNumber),
        description,
        category: str(p.category) || "physical",
        locker: str(p.locker) || "intake",
        status: "in_custody",
        currentHolder: intakeOfficer,
        intakeAt: nowISO(),
        custody: [
          {
            event: "intake",
            from: "field",
            to: intakeOfficer,
            locker: str(p.locker) || "intake",
            signature: intakeOfficer,
            at: nowISO(),
            note: str(p.note),
          },
        ],
      };
      evidence.set(id, rec);
      return { ok: true, result: { evidence: rec } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "evidenceTransfer", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const evidence = userMap("evidence", actorId(ctx));
      const rec = evidence.get(str(p.evidenceId));
      if (!rec) return { ok: false, error: "evidence not found" };
      const to = str(p.to);
      const signature = str(p.signature);
      if (!to) return { ok: false, error: "to (recipient) is required" };
      if (!signature) return { ok: false, error: "signature is required" };
      const from = rec.currentHolder;
      const entry = {
        event: str(p.event) || "transfer",
        from,
        to,
        locker: str(p.locker) || rec.locker,
        signature,
        at: nowISO(),
        note: str(p.note),
      };
      rec.custody.push(entry);
      rec.currentHolder = to;
      rec.locker = entry.locker;
      if (entry.event === "release" || entry.event === "destroyed") rec.status = entry.event === "destroyed" ? "destroyed" : "released";
      return { ok: true, result: { evidence: rec, transfer: entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "evidenceList", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      let list = [...userMap("evidence", actorId(ctx)).values()];
      const caseFilter = str(p.caseNumber);
      if (caseFilter) list = list.filter((e) => e.caseNumber === caseFilter);
      const q = str(p.search).toLowerCase();
      if (q) list = list.filter((e) => `${e.description} ${e.barcode} ${e.caseNumber}`.toLowerCase().includes(q));
      list.sort((a, b) => b.intakeAt.localeCompare(a.intakeAt));
      const byLocker = {};
      for (const e of list) byLocker[e.locker] = (byLocker[e.locker] || 0) + 1;
      return {
        ok: true,
        result: {
          evidence: list,
          total: list.length,
          inCustody: list.filter((e) => e.status === "in_custody").length,
          byLocker: Object.entries(byLocker).map(([locker, count]) => ({ locker, count })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "evidenceChain", (ctx, _artifact, params) => {
    try {
      const rec = userMap("evidence", actorId(ctx)).get(str((params || {}).evidenceId));
      if (!rec) return { ok: false, error: "evidence not found" };
      // Integrity: every link's `from` must equal the prior link's `to`.
      let intact = true;
      for (let i = 1; i < rec.custody.length; i++) {
        if (rec.custody[i].from !== rec.custody[i - 1].to) intact = false;
      }
      return {
        ok: true,
        result: {
          evidenceId: rec.id,
          barcode: rec.barcode,
          chain: rec.custody,
          transferCount: rec.custody.length,
          chainIntact: intact,
          currentHolder: rec.currentHolder,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ======================================================================
  // Officer roster / shift scheduling with overtime detection.
  // ======================================================================
  registerLensAction("law-enforcement", "rosterAddOfficer", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const name = str(p.name);
      if (!name) return { ok: false, error: "name is required" };
      const officers = userMap("officers", actorId(ctx));
      const id = uid("ofc");
      const rec = {
        id,
        name,
        badgeNumber: str(p.badgeNumber) || `B-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
        rank: str(p.rank) || "Officer",
        beat: str(p.beat),
        defaultShift: ["day", "swing", "night"].includes(p.defaultShift) ? p.defaultShift : "day",
        shifts: [],
        createdAt: nowISO(),
      };
      officers.set(id, rec);
      return { ok: true, result: { officer: rec } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "scheduleShift", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const officers = userMap("officers", actorId(ctx));
      const officer = officers.get(str(p.officerId));
      if (!officer) return { ok: false, error: "officer not found" };
      const date = str(p.date);
      if (!date) return { ok: false, error: "date is required" };
      const hours = asNum(p.hours, 8);
      if (hours <= 0 || hours > 24) return { ok: false, error: "hours must be between 0 and 24" };
      const shift = {
        id: uid("shift"),
        date,
        shift: ["day", "swing", "night"].includes(p.shift) ? p.shift : officer.defaultShift,
        beat: str(p.beat) || officer.beat,
        hours,
        startTime: str(p.startTime),
      };
      officer.shifts.push(shift);
      // Overtime: a single day with >8 scheduled hours, or a 7-day window >40.
      const dayHours = officer.shifts
        .filter((s) => s.date === date)
        .reduce((t, s) => t + s.hours, 0);
      const dayOvertime = Math.max(0, dayHours - 8);
      return { ok: true, result: { officer: { id: officer.id, name: officer.name }, shift, dayHours, dayOvertime } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "rosterBoard", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const officers = [...userMap("officers", actorId(ctx)).values()];
      const dateFilter = str(p.date);
      const roster = officers.map((o) => {
        const shifts = dateFilter ? o.shifts.filter((s) => s.date === dateFilter) : o.shifts;
        const totalHours = shifts.reduce((t, s) => t + s.hours, 0);
        // Weekly overtime per officer: sum the worst rolling 7-day window.
        const byDate = {};
        for (const s of o.shifts) byDate[s.date] = (byDate[s.date] || 0) + s.hours;
        const dates = Object.keys(byDate).sort();
        let weekMax = 0;
        for (let i = 0; i < dates.length; i++) {
          let sum = 0;
          const start = new Date(dates[i]);
          for (let j = i; j < dates.length; j++) {
            const diff = (new Date(dates[j]) - start) / 86400000;
            if (diff > 6) break;
            sum += byDate[dates[j]];
          }
          weekMax = Math.max(weekMax, sum);
        }
        const overtime = Math.max(0, weekMax - 40);
        return {
          officerId: o.id,
          name: o.name,
          badgeNumber: o.badgeNumber,
          rank: o.rank,
          beat: o.beat,
          shifts,
          shiftCount: shifts.length,
          totalHours,
          weeklyHours: weekMax,
          overtimeHours: Math.round(overtime * 10) / 10,
        };
      });
      return {
        ok: true,
        result: {
          roster: roster.sort((a, b) => a.name.localeCompare(b.name)),
          totalOfficers: roster.length,
          officersOnOvertime: roster.filter((r) => r.overtimeHours > 0).length,
          totalOvertimeHours: Math.round(roster.reduce((t, r) => t + r.overtimeHours, 0) * 10) / 10,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ======================================================================
  // Crime mapping — geospatial incident store + hotspot detection.
  // ======================================================================
  registerLensAction("law-enforcement", "mapAddIncident", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const type = str(p.type);
      if (!type) return { ok: false, error: "type is required" };
      const lat = asNum(p.lat, NaN);
      const lon = asNum(p.lon, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon))
        {return { ok: false, error: "lat and lon are required numbers" };}
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180)
        {return { ok: false, error: "lat/lon out of range" };}
      const map = userMap("mapIncidents", actorId(ctx));
      const id = uid("mi");
      const rec = {
        id,
        type,
        lat,
        lon,
        address: str(p.address),
        severity: ["low", "medium", "high"].includes(p.severity) ? p.severity : "medium",
        occurredAt: str(p.occurredAt) || nowISO(),
        recordedAt: nowISO(),
      };
      map.set(id, rec);
      return { ok: true, result: { incident: rec } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "crimeMap", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      let incidents = [...userMap("mapIncidents", actorId(ctx)).values()];
      const typeFilter = str(p.type);
      if (typeFilter) incidents = incidents.filter((i) => i.type === typeFilter);
      // Hotspot detection: grid-bucket incidents into ~radiusKm cells and
      // flag any cell whose count meets the threshold.
      const radiusKm = asNum(p.radiusKm, 0.5);
      const cellDeg = radiusKm / 111; // ~111 km per degree latitude
      const threshold = Math.max(2, parseInt(p.threshold, 10) || 3);
      const cells = new Map();
      for (const inc of incidents) {
        const gx = Math.floor(inc.lon / cellDeg);
        const gy = Math.floor(inc.lat / cellDeg);
        const key = `${gx}:${gy}`;
        if (!cells.has(key)) cells.set(key, { count: 0, lat: 0, lon: 0, incidents: [] });
        const c = cells.get(key);
        c.count++;
        c.lat += inc.lat;
        c.lon += inc.lon;
        c.incidents.push(inc.id);
      }
      const hotspots = [...cells.values()]
        .filter((c) => c.count >= threshold)
        .map((c) => ({
          centerLat: Math.round((c.lat / c.count) * 1e5) / 1e5,
          centerLon: Math.round((c.lon / c.count) * 1e5) / 1e5,
          incidentCount: c.count,
          incidentIds: c.incidents,
        }))
        .sort((a, b) => b.incidentCount - a.incidentCount);
      const byType = {};
      for (const i of incidents) byType[i.type] = (byType[i.type] || 0) + 1;
      return {
        ok: true,
        result: {
          incidents,
          total: incidents.length,
          hotspots,
          hotspotCount: hotspots.length,
          byType: Object.entries(byType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => ({ type, count })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ======================================================================
  // Warrant lifecycle — issue / service attempts / return / expiry.
  // ======================================================================
  registerLensAction("law-enforcement", "warrantIssue", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const subject = str(p.subject);
      if (!subject) return { ok: false, error: "subject is required" };
      const warrants = userMap("warrants", actorId(ctx));
      const id = uid("wr");
      const issuedAt = str(p.issuedAt) || nowISO();
      const validDays = parseInt(p.validDays, 10) > 0 ? parseInt(p.validDays, 10) : 90;
      const expiresAt = new Date(new Date(issuedAt).getTime() + validDays * 86400000).toISOString();
      const rec = {
        id,
        warrantNumber: `WR-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        subject,
        warrantType: str(p.warrantType) || "arrest", // arrest | search | bench
        caseNumber: str(p.caseNumber),
        charges: str(p.charges),
        issuingJudge: str(p.issuingJudge),
        status: "active",
        issuedAt,
        expiresAt,
        attempts: [],
        returnedAt: null,
      };
      warrants.set(id, rec);
      return { ok: true, result: { warrant: rec } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "warrantServiceAttempt", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const warrants = userMap("warrants", actorId(ctx));
      const rec = warrants.get(str(p.warrantId));
      if (!rec) return { ok: false, error: "warrant not found" };
      if (rec.status !== "active")
        {return { ok: false, error: `warrant is ${rec.status}, cannot service` };}
      const outcome = ["served", "not_home", "wrong_address", "refused", "failed"].includes(p.outcome)
        ? p.outcome
        : "failed";
      const attempt = {
        id: uid("att"),
        at: nowISO(),
        officer: str(p.officer) || actorId(ctx),
        location: str(p.location),
        outcome,
        note: str(p.note),
      };
      rec.attempts.push(attempt);
      if (outcome === "served") {
        rec.status = "served";
        rec.returnedAt = nowISO();
      }
      return {
        ok: true,
        result: { warrant: rec, attempt, attemptCount: rec.attempts.length },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "warrantReturn", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const warrants = userMap("warrants", actorId(ctx));
      const rec = warrants.get(str(p.warrantId));
      if (!rec) return { ok: false, error: "warrant not found" };
      const disposition = ["served", "recalled", "quashed", "expired"].includes(p.disposition)
        ? p.disposition
        : "recalled";
      rec.status = disposition;
      rec.returnedAt = nowISO();
      rec.returnDisposition = disposition;
      return { ok: true, result: { warrant: rec } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "warrantList", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const now = Date.now();
      let list = [...userMap("warrants", actorId(ctx)).values()];
      // Lazily flip past-expiry actives to expired.
      for (const w of list) {
        if (w.status === "active" && new Date(w.expiresAt).getTime() < now) {
          w.status = "expired";
          w.returnedAt = w.returnedAt || nowISO();
        }
      }
      const statusFilter = str(p.status);
      if (statusFilter) list = list.filter((w) => w.status === statusFilter);
      list.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
      const byStatus = {};
      for (const w of list) byStatus[w.status] = (byStatus[w.status] || 0) + 1;
      const expiringSoon = list.filter(
        (w) =>
          w.status === "active" &&
          new Date(w.expiresAt).getTime() - now < 7 * 86400000
      );
      return {
        ok: true,
        result: {
          warrants: list,
          total: list.length,
          active: list.filter((w) => w.status === "active").length,
          expiringSoon: expiringSoon.length,
          byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ======================================================================
  // Report writing — statute auto-population + supervisor approval.
  // ======================================================================
  registerLensAction("law-enforcement", "reportDraft", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const offense = str(p.offense);
      const narrative = str(p.narrative);
      if (!offense) return { ok: false, error: "offense is required" };
      if (!narrative) return { ok: false, error: "narrative is required" };
      const reports = userMap("reports", actorId(ctx));
      const id = uid("rpt");
      const statute = lookupStatute(offense) || lookupStatute(narrative);
      const rec = {
        id,
        reportNumber: `RPT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        caseNumber: str(p.caseNumber),
        offense,
        narrative,
        location: str(p.location),
        officer: str(p.officer) || actorId(ctx),
        statute: statute
          ? { code: statute.code, title: statute.title, class: statute.class }
          : null,
        status: "draft", // draft | submitted | approved | rejected
        approvedBy: null,
        supervisorNote: null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      reports.set(id, rec);
      return {
        ok: true,
        result: { report: rec, statuteFound: !!statute },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "reportSubmit", (ctx, _artifact, params) => {
    try {
      const rec = userMap("reports", actorId(ctx)).get(str((params || {}).reportId));
      if (!rec) return { ok: false, error: "report not found" };
      if (rec.status !== "draft" && rec.status !== "rejected")
        {return { ok: false, error: `report is ${rec.status}, cannot submit` };}
      rec.status = "submitted";
      rec.updatedAt = nowISO();
      return { ok: true, result: { report: rec } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "reportApprove", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const rec = userMap("reports", actorId(ctx)).get(str(p.reportId));
      if (!rec) return { ok: false, error: "report not found" };
      if (rec.status !== "submitted")
        {return { ok: false, error: "only submitted reports can be reviewed" };}
      const decision = p.decision === "reject" ? "rejected" : "approved";
      rec.status = decision;
      rec.approvedBy = str(p.supervisor) || actorId(ctx);
      rec.supervisorNote = str(p.note);
      rec.updatedAt = nowISO();
      return { ok: true, result: { report: rec, decision } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "reportList", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      let list = [...userMap("reports", actorId(ctx)).values()];
      const statusFilter = str(p.status);
      if (statusFilter) list = list.filter((r) => r.status === statusFilter);
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const byStatus = {};
      for (const r of list) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      return {
        ok: true,
        result: {
          reports: list,
          total: list.length,
          pendingApproval: list.filter((r) => r.status === "submitted").length,
          byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ======================================================================
  // Field interview / arrest booking forms.
  // ======================================================================
  registerLensAction("law-enforcement", "bookingCreate", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const subjectName = str(p.subjectName);
      if (!subjectName) return { ok: false, error: "subjectName is required" };
      const kind = p.kind === "field_interview" ? "field_interview" : "arrest";
      const bookings = userMap("bookings", actorId(ctx));
      const id = uid("bk");
      const charges = Array.isArray(p.charges)
        ? p.charges.map((c) => str(c)).filter(Boolean)
        : str(p.charges)
        ? [str(p.charges)]
        : [];
      const statutes = charges
        .map((c) => lookupStatute(c))
        .filter(Boolean)
        .map((s) => ({ code: s.code, title: s.title, class: s.class }));
      const rec = {
        id,
        kind,
        bookingNumber: `BK-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        subjectName,
        dob: str(p.dob),
        sex: str(p.sex),
        height: str(p.height),
        weight: str(p.weight),
        address: str(p.address),
        location: str(p.location),
        charges,
        statutes,
        mugshotCaptured: !!p.mugshotCaptured,
        printsCaptured: !!p.printsCaptured,
        officer: str(p.officer) || actorId(ctx),
        narrative: str(p.narrative),
        status: kind === "arrest" ? "booked" : "logged",
        createdAt: nowISO(),
      };
      bookings.set(id, rec);
      // Completeness check for arrest bookings (mugshot + prints + charges).
      const missing = [];
      if (kind === "arrest") {
        if (!rec.mugshotCaptured) missing.push("mugshot");
        if (!rec.printsCaptured) missing.push("prints");
        if (charges.length === 0) missing.push("charges");
      }
      return {
        ok: true,
        result: { booking: rec, complete: missing.length === 0, missingFields: missing },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("law-enforcement", "bookingList", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      let list = [...userMap("bookings", actorId(ctx)).values()];
      const kindFilter = str(p.kind);
      if (kindFilter) list = list.filter((b) => b.kind === kindFilter);
      const q = str(p.search).toLowerCase();
      if (q) list = list.filter((b) => `${b.subjectName} ${b.bookingNumber}`.toLowerCase().includes(q));
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        ok: true,
        result: {
          bookings: list,
          total: list.length,
          arrests: list.filter((b) => b.kind === "arrest").length,
          fieldInterviews: list.filter((b) => b.kind === "field_interview").length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
