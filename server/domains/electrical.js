// server/domains/electrical.js
//
// Electrical lens backend — NEC calculation suite + ServiceTitan-style
// contractor ops. Pure-math macros (load calc, voltage drop, conduit
// fill, box fill, wire sizing) plus persistent per-user artifacts
// (panel schedules, estimates, invoices, inspection checklists, one-line
// diagrams, material price list) stored in globalThis._concordSTATE.
//
// Every handler is try/catch wrapped and returns { ok, result?, error? }.

// ── NEC reference tables ──────────────────────────────────────────────

// Copper THHN/THWN-2 ampacity @ 75°C (NEC Table 310.16), AWG → amps.
const AMPACITY_75C = {
  14: 20, 12: 25, 10: 35, 8: 50, 6: 65, 4: 85, 3: 100,
  2: 115, 1: 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230,
};
// Copper conductor resistance Ω per 1000 ft (NEC Chapter 9 Table 8, DC 75°C).
const RES_PER_1000FT = {
  14: 3.07, 12: 1.93, 10: 1.21, 8: 0.764, 6: 0.491, 4: 0.308,
  3: 0.245, 2: 0.194, 1: 0.154, '1/0': 0.122, '2/0': 0.0967,
  '3/0': 0.0766, '4/0': 0.0608,
};
// Approx area (in²) of THHN conductors incl. insulation (NEC Ch.9 Table 5).
const THHN_AREA = {
  14: 0.0097, 12: 0.0133, 10: 0.0211, 8: 0.0366, 6: 0.0507,
  4: 0.0824, 3: 0.0973, 2: 0.1158, 1: 0.1562, '1/0': 0.1855,
  '2/0': 0.2223, '3/0': 0.2679, '4/0': 0.3237,
};
// Conduit internal area (in²) — 40% fill column (NEC Ch.9 Table 4) for EMT.
const CONDUIT_40PCT = {
  '1/2': 0.122, '3/4': 0.213, '1': 0.346, '1-1/4': 0.598,
  '1-1/2': 0.814, '2': 1.342, '2-1/2': 2.343, '3': 3.538,
  '3-1/2': 4.738, '4': 6.119,
};
// Conductor total internal area (100%) for fill-% reporting.
const CONDUIT_100PCT = {
  '1/2': 0.304, '3/4': 0.533, '1': 0.864, '1-1/4': 1.496,
  '1-1/2': 2.036, '2': 3.356, '2-1/2': 5.858, '3': 8.846,
  '3-1/2': 11.545, '4': 14.753,
};
const CONDUIT_SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4'];
// Box fill volume allowance per conductor by AWG (NEC Table 314.16(B), in³).
const BOX_FILL_VOL = { 18: 1.5, 16: 1.75, 14: 2.0, 12: 2.25, 10: 2.5, 8: 3.0, 6: 5.0 };
const STD_BREAKERS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];

function wireForAmps(amps) {
  for (const awg of [14, 12, 10, 8, 6, 4, 3, 2, 1, '1/0', '2/0', '3/0', '4/0']) {
    if (AMPACITY_75C[awg] >= amps) return awg;
  }
  return '4/0';
}
function breakerForAmps(amps) {
  for (const b of STD_BREAKERS) if (b >= amps) return b;
  return 200;
}
function round(n, d = 2) {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** d; return Math.round(n * f) / f;
}
// Fail-closed numeric sanitizer: poisoned values (NaN / Infinity / "abc" /
// null / undefined) coerce to `fallback`; negatives clamp to 0 unless the
// caller opts into signed values. A safety calculator must NEVER emit a
// non-finite or nonsensical-negative ampacity / area / volume.
function num(v, fallback = 0, { min = 0, allowZero = true } = {}) {
  let n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) n = fallback;
  if (Number.isFinite(min) && n < min) n = min;
  if (!allowZero && n === 0) n = fallback;
  return n;
}
// Fail-CLOSED guard: a field PRESENT but non-finite (Infinity/NaN/1e999) must
// reject rather than silently coerce to a default — otherwise a poisoned input
// is laundered into a confident, wrong (and safety-relevant) calculator result.
function badNum(v) {
  return v !== undefined && v !== null && v !== '' && !Number.isFinite(Number(v));
}

export default function registerElectricalActions(registerLensAction) {
  // ── persistent per-user state ───────────────────────────────────────
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.electricalLens) {
      STATE.electricalLens = {
        panels: new Map(),       // userId -> Array<PanelSchedule>
        estimates: new Map(),    // userId -> Array<Estimate>
        invoices: new Map(),     // userId -> Array<Invoice>
        checklists: new Map(),   // userId -> Array<Checklist>
        diagrams: new Map(),     // userId -> Array<OneLineDiagram>
        priceList: new Map(),    // userId -> Array<MaterialPrice>
        seq: 1,
      };
    }
    return STATE.electricalLens;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === 'function') {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* noop */ }
    }
  }
  function uid(ctx) { return ctx?.actor?.userId || ctx?.userId || 'anon'; }
  function gid(prefix, st) { return `${prefix}_${(st.seq++).toString(36)}_${Date.now().toString(36)}`; }
  function list(map, id) { if (!map.has(id)) map.set(id, []); return map.get(id); }
  function nowIso() { return new Date().toISOString(); }

  // Standard contractor material catalog used when a user has not built
  // their own price list — real US-trade ballpark unit prices (2026).
  function defaultPriceList() {
    return [
      { name: 'Romex 14/2 (250ft roll)', unit: 'roll', price: 89, category: 'wire' },
      { name: 'Romex 12/2 (250ft roll)', unit: 'roll', price: 124, category: 'wire' },
      { name: 'Romex 10/3 (125ft roll)', unit: 'roll', price: 168, category: 'wire' },
      { name: 'THHN #12 (per ft)', unit: 'ft', price: 0.28, category: 'wire' },
      { name: 'THHN #10 (per ft)', unit: 'ft', price: 0.44, category: 'wire' },
      { name: 'EMT 3/4" (10ft stick)', unit: 'stick', price: 11.5, category: 'conduit' },
      { name: 'EMT 1" (10ft stick)', unit: 'stick', price: 17.8, category: 'conduit' },
      { name: '20A duplex receptacle', unit: 'each', price: 3.2, category: 'device' },
      { name: 'GFCI receptacle', unit: 'each', price: 18.5, category: 'device' },
      { name: 'Single-pole switch', unit: 'each', price: 2.6, category: 'device' },
      { name: '20A single-pole breaker', unit: 'each', price: 9.4, category: 'breaker' },
      { name: '20A AFCI breaker', unit: 'each', price: 46, category: 'breaker' },
      { name: '200A main panel (40-space)', unit: 'each', price: 285, category: 'panel' },
      { name: 'Single-gang box', unit: 'each', price: 1.1, category: 'box' },
      { name: '4" octagon box', unit: 'each', price: 2.4, category: 'box' },
      { name: 'LED recessed fixture', unit: 'each', price: 14.5, category: 'fixture' },
    ];
  }

  // ════════════════════════════════════════════════════════════════════
  //  PURE-MATH NEC MACROS (existing — preserved)
  // ════════════════════════════════════════════════════════════════════

  registerLensAction('electrical', 'loadCalculation', (ctx, artifact, _params) => {
    try {
      const circuits = artifact?.data?.circuits || [];
      if (circuits.length === 0) {
        return { ok: true, result: { message: 'Add circuits with wattage to calculate electrical load.' } };
      }
      const analyzed = circuits.map((c) => {
        // Fail-closed: poisoned watts/voltage sanitise to safe finite values.
        // Watts/amps clamp at 0 — a load is never negative (safety-relevant).
        const watts = num(c.watts, 0);
        const voltage = num(c.voltage, 120, { allowZero: false });
        const amps = watts / voltage;
        return {
          name: c.name, watts, voltage, amps: round(amps),
          breakerSize: breakerForAmps(amps * 1.25),
          wireGauge: `${wireForAmps(amps * 1.25)} AWG`,
        };
      });
      const totalWatts = analyzed.reduce((s, c) => s + c.watts, 0);
      const totalAmps = analyzed.reduce((s, c) => s + c.amps, 0);
      const panelSize = totalAmps <= 100 ? 100 : totalAmps <= 150 ? 150 : 200;
      return {
        ok: true,
        result: {
          circuits: analyzed, totalWatts, totalAmps: round(totalAmps, 1),
          panelSizeRecommended: `${panelSize}A`,
          utilization: Math.round((totalAmps / panelSize) * 100),
          safetyMargin: Math.round((1 - totalAmps / (panelSize * 0.8)) * 100),
          nec80PercentRule: totalAmps <= panelSize * 0.8
            ? 'PASS' : 'FAIL — exceeds 80% continuous load rating',
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'voltageDropCalc', (ctx, artifact, _params) => {
    try {
      const data = artifact?.data || {};
      // Fail-CLOSED: a present-but-poisoned numeric rejects rather than silently
      // defaulting (a wrong voltage-drop verdict is a safety lie).
      if (badNum(data.amps)) return { ok: false, error: 'invalid_amps' };
      if (badNum(data.distanceFeet)) return { ok: false, error: 'invalid_distanceFeet' };
      if (badNum(data.voltage)) return { ok: false, error: 'invalid_voltage' };
      if (badNum(data.wireGauge)) return { ok: false, error: 'invalid_wireGauge' };
      // Fail-closed: non-finite amps/distance/voltage sanitise to safe defaults
      // (never leak NaN/Infinity into a voltage-drop percentage).
      const amps = num(data.amps, 15, { allowZero: false });
      const distanceFeet = num(data.distanceFeet, 100, { allowZero: false });
      const wireGauge = data.wireGauge ?? 12;
      const voltage = num(data.voltage, 120, { allowZero: false });
      const phase = data.phase === '3' || data.phase === 3 ? 3 : 1;
      const rPer1000 = RES_PER_1000FT[wireGauge] ?? RES_PER_1000FT[12];
      // 1-phase: 2× one-way; 3-phase: ×1.732.
      const factor = phase === 3 ? 1.732 : 2;
      const drop = (rPer1000 / 1000) * distanceFeet * amps * factor;
      const dropPercent = (drop / voltage) * 100;
      // Upgrade = the next HEAVIER conductor (lower AWG number = thicker = less
      // resistance = less drop). The ladder runs thin→thick; the next entry is
      // the heavier gauge. Earlier code walked the WRONG way (toward thinner
      // wire) and never advised an upgrade for the smallest gauges, so a 30%
      // drop printed "within acceptable limits" — a dangerous lie for a safety
      // calculator. Fixed: honest advice whenever drop > 3%.
      const ladder = [14, 12, 10, 8, 6, 4, 3, 2, 1];
      const curG = typeof wireGauge === 'number' ? wireGauge : parseInt(wireGauge);
      const ladderIdx = ladder.indexOf(curG);
      const heavier = ladderIdx >= 0 && ladderIdx + 1 < ladder.length
        ? ladder[ladderIdx + 1] : null;
      const recommendation = dropPercent <= 3
        ? 'Within acceptable limits'
        : heavier
          ? `Upgrade to ${heavier} AWG to reduce drop`
          : 'Excessive drop — shorten the run or raise the system voltage';
      return {
        ok: true,
        result: {
          wireGauge: `${wireGauge} AWG`, distance: `${distanceFeet} ft`,
          current: `${amps}A`, voltage: `${voltage}V`, phase: `${phase}-phase`,
          voltageDrop: `${round(drop)}V`, dropPercent: `${round(dropPercent)}%`,
          dropPercentValue: round(dropPercent),
          acceptable: dropPercent <= 3,
          necLimit: '3% for branch circuits, 5% total feeder+branch',
          recommendation,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'circuitTrace', (ctx, artifact, _params) => {
    try {
      const panels = artifact?.data?.panels || [];
      const circuits = artifact?.data?.circuits || [];
      const mapped = circuits.map((c) => ({
        circuit: c.name || c.number, panel: c.panel || 'Main',
        breaker: c.breaker || '20A', room: c.room || c.location,
        devices: Array.isArray(c.devices) ? c.devices : [],
        wireRun: num(c.wireRunFeet, 0, { min: 0 }),
      }));
      return {
        ok: true,
        result: {
          panels: panels.length || 1, totalCircuits: mapped.length,
          circuitMap: mapped, unassigned: mapped.filter((c) => !c.room).length,
          avgDevicesPerCircuit: mapped.length > 0
            ? round(mapped.reduce((s, c) => s + (c.devices.length || 0), 0) / mapped.length, 1)
            : 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'safetyInspection', (ctx, artifact, _params) => {
    try {
      const items = artifact?.data?.inspectionItems || [];
      if (items.length === 0) return { ok: true, result: { message: 'Add inspection items to check.' } };
      const results = items.map((i) => ({
        item: i.name || i.description, code: i.necCode || 'NEC',
        passed: i.passed !== false,
        severity: i.passed === false ? (i.critical ? 'critical' : 'minor') : 'ok',
        notes: i.notes || '',
      }));
      const passed = results.filter((r) => r.passed).length;
      const critical = results.filter((r) => r.severity === 'critical').length;
      return {
        ok: true,
        result: {
          results, total: results.length, passed, failed: results.length - passed,
          criticalFailures: critical,
          passRate: Math.round((passed / results.length) * 100),
          overallResult: critical > 0 ? 'FAIL — critical safety issues'
            : passed === results.length ? 'PASS' : 'CONDITIONAL — minor issues to address',
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  //  NEW NEC CALCULATORS
  // ════════════════════════════════════════════════════════════════════

  // Conduit fill + wire-size calculator (NEC Ch.9 Tables 1, 4, 5).
  registerLensAction('electrical', 'conduitFill', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const conductors = data.conductors || [];
      if (conductors.length === 0) {
        return { ok: true, result: { message: 'Add conductors (AWG + count) to size the conduit.' } };
      }
      let totalArea = 0;
      let totalCount = 0;
      const detail = conductors.map((c) => {
        const awg = c.awg ?? c.gauge ?? 12;
        // Count is a physical conductor tally — never negative, never NaN.
        const count = Math.max(1, Math.round(num(c.count, 1, { min: 0 })) || 1);
        const each = THHN_AREA[awg] ?? THHN_AREA[12];
        const a = each * count;
        totalArea += a;
        totalCount += count;
        return { awg: `${awg} AWG`, count, areaEach: round(each, 4), areaTotal: round(a, 4) };
      });
      // NEC fill limits: 1 wire 53%, 2 wires 31%, 3+ wires 40%.
      const fillPct = totalCount === 1 ? 0.53 : totalCount === 2 ? 0.31 : 0.40;
      let recommended = null;
      let recommendedActualFill = null;
      for (const size of CONDUIT_SIZES) {
        const allowed = CONDUIT_100PCT[size] * fillPct;
        if (allowed >= totalArea) {
          recommended = size;
          recommendedActualFill = round((totalArea / CONDUIT_100PCT[size]) * 100, 1);
          break;
        }
      }
      const requested = data.conduitSize;
      let requestedResult = null;
      if (requested && CONDUIT_100PCT[requested]) {
        const allowed = CONDUIT_100PCT[requested] * fillPct;
        requestedResult = {
          size: requested,
          actualFillPercent: round((totalArea / CONDUIT_100PCT[requested]) * 100, 1),
          allowedFillPercent: Math.round(fillPct * 100),
          pass: totalArea <= allowed,
        };
      }
      return {
        ok: true,
        result: {
          conductors: detail, totalConductors: totalCount,
          totalConductorArea: round(totalArea, 4),
          conduitType: data.conduitType || 'EMT',
          necFillLimitPercent: Math.round(fillPct * 100),
          fillRule: totalCount === 1 ? '1 conductor — 53%'
            : totalCount === 2 ? '2 conductors — 31%' : '3+ conductors — 40%',
          recommendedConduitSize: recommended ? `${recommended}"` : 'over 4" — split runs',
          recommendedActualFillPercent: recommendedActualFill,
          requested: requestedResult,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Box fill calculator (NEC 314.16).
  registerLensAction('electrical', 'boxFill', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      // Fail-CLOSED: a present-but-poisoned numeric rejects rather than silently
      // defaulting (an Infinity box volume must never fabricate a PASS verdict).
      if (badNum(data.largestAwg ?? data.awg)) return { ok: false, error: 'invalid_largestAwg' };
      if (badNum(data.currentCarrying)) return { ok: false, error: 'invalid_currentCarrying' };
      if (badNum(data.groundConductors)) return { ok: false, error: 'invalid_groundConductors' };
      if (badNum(data.devices)) return { ok: false, error: 'invalid_devices' };
      if (badNum(data.supportFittings)) return { ok: false, error: 'invalid_supportFittings' };
      if (badNum(data.boxVolumeCubicInches)) return { ok: false, error: 'invalid_boxVolumeCubicInches' };
      const largestAwg = data.largestAwg ?? data.awg ?? 14;
      const vol = BOX_FILL_VOL[largestAwg] ?? BOX_FILL_VOL[14];
      // Fail-closed: every count clamps to a non-negative finite integer; box
      // volume clamps to a non-negative finite value (an Infinity volume must
      // never produce a fake PASS verdict on a too-small box).
      const hots = Math.round(num(data.currentCarrying, 0, { min: 0 }));   // counts as 1 each
      const grounds = num(data.groundConductors, 0, { min: 0 }) > 0 ? 1 : 0; // all grounds = 1
      const clamps = data.internalClamps ? 1 : 0;          // all clamps = 1
      const devices = Math.round(num(data.devices, 0, { min: 0 }));          // each device = 2
      const supportFittings = Math.round(num(data.supportFittings, 0, { min: 0 })); // each = 1
      const boxVolume = num(data.boxVolumeCubicInches, 0, { min: 0 });
      const conductorEquivalents = hots + grounds + clamps + (devices * 2) + supportFittings;
      const requiredVolume = round(conductorEquivalents * vol, 2);
      const breakdown = [
        { item: `Current-carrying conductors (${largestAwg} AWG)`, equivalents: hots },
        { item: 'Equipment grounds (all = 1)', equivalents: grounds },
        { item: 'Internal cable clamps (all = 1)', equivalents: clamps },
        { item: `Devices/yokes (×2 each, ${devices})`, equivalents: devices * 2 },
        { item: 'Support fittings', equivalents: supportFittings },
      ];
      return {
        ok: true,
        result: {
          largestConductor: `${largestAwg} AWG`,
          volumePerConductor: vol,
          breakdown,
          totalConductorEquivalents: conductorEquivalents,
          requiredBoxVolume: requiredVolume,
          providedBoxVolume: boxVolume,
          pass: boxVolume > 0 ? boxVolume >= requiredVolume : null,
          verdict: boxVolume <= 0 ? 'Enter box volume (in³) to verify'
            : boxVolume >= requiredVolume
              ? 'PASS — box volume adequate'
              : `FAIL — need ${round(requiredVolume - boxVolume, 2)} in³ more`,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Wire-size recommendation per NEC ampacity + 125% continuous + drop check.
  registerLensAction('electrical', 'wireSize', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      // Fail-CLOSED: a present-but-poisoned numeric rejects rather than silently
      // defaulting (a fabricated wire size is a safety lie).
      if (badNum(data.loadAmps)) return { ok: false, error: 'invalid_loadAmps' };
      if (badNum(data.distanceFeet)) return { ok: false, error: 'invalid_distanceFeet' };
      if (badNum(data.voltage)) return { ok: false, error: 'invalid_voltage' };
      // Fail-closed: a poisoned (NaN/Infinity/"abc") or non-positive load must
      // NOT fabricate a wire recommendation — it returns the honest prompt.
      const loadAmps = num(data.loadAmps, 0, { min: 0 });
      const continuous = data.continuous !== false;
      const distanceFeet = num(data.distanceFeet, 50, { allowZero: false });
      const voltage = num(data.voltage, 120, { allowZero: false });
      if (loadAmps <= 0) {
        return { ok: true, result: { message: 'Enter the circuit load in amps.' } };
      }
      const designAmps = continuous ? loadAmps * 1.25 : loadAmps;
      const ampacityWire = wireForAmps(designAmps);
      // Walk up gauges until voltage drop ≤ 3%.
      const ladder = [14, 12, 10, 8, 6, 4, 3, 2, 1, '1/0', '2/0', '3/0', '4/0'];
      let finalWire = ampacityWire;
      let finalDrop = null;
      for (let i = ladder.indexOf(ampacityWire); i < ladder.length; i++) {
        const g = ladder[i];
        const r = RES_PER_1000FT[g];
        const drop = (r / 1000) * distanceFeet * loadAmps * 2;
        const dp = (drop / voltage) * 100;
        if (dp <= 3 || i === ladder.length - 1) { finalWire = g; finalDrop = round(dp, 2); break; }
      }
      return {
        ok: true,
        result: {
          loadAmps, continuous, designAmps: round(designAmps, 1),
          ampacityRequiredWire: `${ampacityWire} AWG`,
          minBreaker: `${breakerForAmps(designAmps)}A`,
          recommendedWire: `${finalWire} AWG`,
          recommendedAmpacity: AMPACITY_75C[finalWire],
          voltageDropAtRecommended: finalDrop != null ? `${finalDrop}%` : 'n/a',
          upsizedForVoltageDrop: finalWire !== ampacityWire,
          basis: 'NEC 310.16 @ 75°C copper, 125% continuous, ≤3% drop',
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  //  PANEL SCHEDULE BUILDER  (persistent)
  // ════════════════════════════════════════════════════════════════════

  registerLensAction('electrical', 'panelCreate', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const panel = {
        id: gid('panel', st),
        name: data.name || 'New Panel',
        mainBreaker: parseInt(data.mainBreaker) || 200,
        voltage: parseInt(data.voltage) || 240,
        spaces: parseInt(data.spaces) || 40,
        circuits: [],
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      list(st.panels, uid(ctx)).push(panel);
      save();
      return { ok: true, result: panel };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'panelList', (ctx, _artifact, _params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      return { ok: true, result: { panels: list(st.panels, uid(ctx)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'panelAddCircuit', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const panel = list(st.panels, uid(ctx)).find((p) => p.id === data.panelId);
      if (!panel) return { ok: false, error: 'panel not found' };
      if (panel.circuits.length >= panel.spaces) {
        return { ok: false, error: `panel full — ${panel.spaces} spaces used` };
      }
      const watts = parseFloat(data.watts) || 0;
      const cktVoltage = parseInt(data.voltage) || 120;
      const amps = watts / cktVoltage;
      const breaker = parseInt(data.breaker) || breakerForAmps(amps * 1.25);
      const circuit = {
        id: gid('ckt', st),
        position: panel.circuits.length + 1,
        name: data.name || `Circuit ${panel.circuits.length + 1}`,
        description: data.description || '',
        watts, voltage: cktVoltage,
        amps: round(amps),
        breaker,
        poles: cktVoltage >= 240 ? 2 : 1,
        wireGauge: `${wireForAmps(amps * 1.25)} AWG`,
        phase: data.phase === 'B' ? 'B' : 'A',
      };
      panel.circuits.push(circuit);
      panel.updatedAt = nowIso();
      save();
      return { ok: true, result: { panel, circuit } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'panelRemoveCircuit', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const panel = list(st.panels, uid(ctx)).find((p) => p.id === data.panelId);
      if (!panel) return { ok: false, error: 'panel not found' };
      const before = panel.circuits.length;
      panel.circuits = panel.circuits.filter((c) => c.id !== data.circuitId);
      panel.circuits.forEach((c, i) => { c.position = i + 1; });
      panel.updatedAt = nowIso();
      save();
      return { ok: true, result: { panel, removed: before - panel.circuits.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'panelDelete', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const arr = list(st.panels, uid(ctx));
      const before = arr.length;
      st.panels.set(uid(ctx), arr.filter((p) => p.id !== data.panelId));
      save();
      return { ok: true, result: { deleted: before - st.panels.get(uid(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Compute load summary + per-leg phase balance for a saved panel.
  registerLensAction('electrical', 'panelSchedule', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const panel = list(st.panels, uid(ctx)).find((p) => p.id === data.panelId);
      if (!panel) return { ok: false, error: 'panel not found' };
      const totalWatts = panel.circuits.reduce((s, c) => s + (c.watts || 0), 0);
      const legA = panel.circuits.filter((c) => c.phase === 'A')
        .reduce((s, c) => s + (c.amps || 0), 0);
      const legB = panel.circuits.filter((c) => c.phase === 'B')
        .reduce((s, c) => s + (c.amps || 0), 0);
      const totalAmps = totalWatts / panel.voltage;
      const maxLeg = Math.max(legA, legB);
      const imbalance = maxLeg > 0 ? round((Math.abs(legA - legB) / maxLeg) * 100, 1) : 0;
      return {
        ok: true,
        result: {
          panelId: panel.id, name: panel.name,
          mainBreaker: panel.mainBreaker, voltage: panel.voltage,
          spacesUsed: panel.circuits.length, spacesTotal: panel.spaces,
          circuits: panel.circuits,
          totalConnectedWatts: totalWatts,
          totalDemandAmps: round(totalAmps, 1),
          legA_amps: round(legA, 1), legB_amps: round(legB, 1),
          phaseImbalancePercent: imbalance,
          utilizationPercent: Math.round((totalAmps / panel.mainBreaker) * 100),
          nec80PercentRule: totalAmps <= panel.mainBreaker * 0.8
            ? 'PASS' : 'FAIL — exceeds 80% continuous rating',
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  //  ESTIMATE → INVOICE FLOW  (persistent)
  // ════════════════════════════════════════════════════════════════════

  registerLensAction('electrical', 'estimateCreate', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const est = {
        id: gid('est', st),
        client: data.client || 'New Client',
        address: data.address || '',
        title: data.title || 'Electrical Estimate',
        status: 'draft',
        laborLines: [],
        materialLines: [],
        taxRate: parseFloat(data.taxRate) || 0,
        invoiceId: null,
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      list(st.estimates, uid(ctx)).push(est);
      save();
      return { ok: true, result: est };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'estimateList', (ctx, _artifact, _params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const ests = list(st.estimates, uid(ctx)).map((e) => ({ ...e, ...estTotals(e) }));
      return { ok: true, result: { estimates: ests } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  function estTotals(e) {
    const laborTotal = e.laborLines.reduce((s, l) => s + (l.hours || 0) * (l.rate || 0), 0);
    const materialTotal = e.materialLines.reduce((s, m) => s + (m.quantity || 0) * (m.unitPrice || 0), 0);
    const subtotal = laborTotal + materialTotal;
    const tax = subtotal * ((e.taxRate || 0) / 100);
    return {
      laborTotal: round(laborTotal), materialTotal: round(materialTotal),
      subtotal: round(subtotal), tax: round(tax), total: round(subtotal + tax),
    };
  }

  registerLensAction('electrical', 'estimateAddLine', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const est = list(st.estimates, uid(ctx)).find((e) => e.id === data.estimateId);
      if (!est) return { ok: false, error: 'estimate not found' };
      if (data.lineType === 'labor') {
        est.laborLines.push({
          id: gid('lab', st),
          description: data.description || 'Labor',
          hours: parseFloat(data.hours) || 0,
          rate: parseFloat(data.rate) || 0,
        });
      } else {
        est.materialLines.push({
          id: gid('mat', st),
          description: data.description || 'Material',
          quantity: parseFloat(data.quantity) || 0,
          unitPrice: parseFloat(data.unitPrice) || 0,
          unit: data.unit || 'each',
        });
      }
      est.updatedAt = nowIso();
      save();
      return { ok: true, result: { ...est, ...estTotals(est) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'estimateRemoveLine', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const est = list(st.estimates, uid(ctx)).find((e) => e.id === data.estimateId);
      if (!est) return { ok: false, error: 'estimate not found' };
      est.laborLines = est.laborLines.filter((l) => l.id !== data.lineId);
      est.materialLines = est.materialLines.filter((m) => m.id !== data.lineId);
      est.updatedAt = nowIso();
      save();
      return { ok: true, result: { ...est, ...estTotals(est) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'estimateDelete', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const arr = list(st.estimates, uid(ctx));
      const before = arr.length;
      st.estimates.set(uid(ctx), arr.filter((e) => e.id !== data.estimateId));
      save();
      return { ok: true, result: { deleted: before - st.estimates.get(uid(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Convert an estimate into an invoice (carries line items + totals).
  registerLensAction('electrical', 'estimateToInvoice', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const est = list(st.estimates, uid(ctx)).find((e) => e.id === data.estimateId);
      if (!est) return { ok: false, error: 'estimate not found' };
      if (est.invoiceId) return { ok: false, error: 'estimate already invoiced' };
      const totals = estTotals(est);
      const invoices = list(st.invoices, uid(ctx));
      const invoice = {
        id: gid('inv', st),
        invoiceNumber: `INV-${String(1000 + invoices.length + 1)}`,
        estimateId: est.id,
        client: est.client, address: est.address, title: est.title,
        laborLines: est.laborLines.map((l) => ({ ...l })),
        materialLines: est.materialLines.map((m) => ({ ...m })),
        taxRate: est.taxRate,
        ...totals,
        status: 'unpaid',
        issuedDate: nowIso(),
        dueDate: data.dueDate || null,
        paidDate: null,
      };
      invoices.push(invoice);
      est.status = 'invoiced';
      est.invoiceId = invoice.id;
      est.updatedAt = nowIso();
      save();
      return { ok: true, result: invoice };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'invoiceList', (ctx, _artifact, _params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const invoices = list(st.invoices, uid(ctx));
      const totalBilled = invoices.reduce((s, i) => s + (i.total || 0), 0);
      const outstanding = invoices.filter((i) => i.status === 'unpaid')
        .reduce((s, i) => s + (i.total || 0), 0);
      return {
        ok: true,
        result: {
          invoices,
          summary: {
            count: invoices.length,
            totalBilled: round(totalBilled),
            outstanding: round(outstanding),
            paid: round(totalBilled - outstanding),
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'invoiceMarkPaid', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const inv = list(st.invoices, uid(ctx)).find((i) => i.id === data.invoiceId);
      if (!inv) return { ok: false, error: 'invoice not found' };
      inv.status = 'paid';
      inv.paidDate = nowIso();
      save();
      return { ok: true, result: inv };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  //  ONE-LINE DIAGRAM  (persistent — nodes + connections)
  // ════════════════════════════════════════════════════════════════════

  registerLensAction('electrical', 'diagramCreate', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const diag = {
        id: gid('diag', st),
        name: data.name || 'One-Line Diagram',
        nodes: [], edges: [],
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      list(st.diagrams, uid(ctx)).push(diag);
      save();
      return { ok: true, result: diag };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'diagramList', (ctx, _artifact, _params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      return { ok: true, result: { diagrams: list(st.diagrams, uid(ctx)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'diagramAddNode', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const diag = list(st.diagrams, uid(ctx)).find((d) => d.id === data.diagramId);
      if (!diag) return { ok: false, error: 'diagram not found' };
      const validKinds = ['utility', 'meter', 'main_panel', 'subpanel', 'transformer',
        'disconnect', 'circuit', 'load', 'generator', 'ground'];
      const kind = validKinds.includes(data.kind) ? data.kind : 'load';
      const node = {
        id: gid('node', st),
        kind,
        label: data.label || kind,
        rating: data.rating || '',
        parentId: data.parentId || null,
      };
      diag.nodes.push(node);
      if (node.parentId) {
        diag.edges.push({ from: node.parentId, to: node.id });
      }
      diag.updatedAt = nowIso();
      save();
      return { ok: true, result: { diagram: diag, node } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'diagramRemoveNode', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const diag = list(st.diagrams, uid(ctx)).find((d) => d.id === data.diagramId);
      if (!diag) return { ok: false, error: 'diagram not found' };
      diag.nodes = diag.nodes.filter((n) => n.id !== data.nodeId);
      diag.edges = diag.edges.filter((e) => e.from !== data.nodeId && e.to !== data.nodeId);
      diag.updatedAt = nowIso();
      save();
      return { ok: true, result: diag };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'diagramDelete', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const arr = list(st.diagrams, uid(ctx));
      const before = arr.length;
      st.diagrams.set(uid(ctx), arr.filter((d) => d.id !== data.diagramId));
      save();
      return { ok: true, result: { deleted: before - st.diagrams.get(uid(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  //  INSPECTION CHECKLIST TEMPLATES  (persistent)
  // ════════════════════════════════════════════════════════════════════

  // Authored NEC checklist templates per job type.
  function checklistTemplates() {
    return {
      rough_in: {
        label: 'Rough-In Inspection',
        items: [
          { name: 'Box fill within NEC 314.16 limits', necCode: '314.16' },
          { name: 'Cable secured within 12" of boxes, every 4.5ft', necCode: '334.30' },
          { name: 'Wire stapled, no damaged insulation', necCode: '300.4' },
          { name: 'Proper conductor count per circuit', necCode: '210.19' },
          { name: 'Ground conductors continuous & bonded', necCode: '250.148' },
          { name: 'Boxes flush with finished surface allowance', necCode: '314.20' },
          { name: 'Bored holes 1-1/4" from framing edge / nail plates', necCode: '300.4(A)' },
        ],
      },
      service: {
        label: 'Service / Panel Inspection',
        items: [
          { name: 'Main bonding jumper installed', necCode: '250.28' },
          { name: 'Grounding electrode system complete', necCode: '250.50' },
          { name: 'Service conductors sized for load', necCode: '230.42' },
          { name: 'Working clearance 36" depth maintained', necCode: '110.26' },
          { name: 'Breaker amperage matches wire ampacity', necCode: '240.4' },
          { name: 'Neutrals & grounds separated in subpanels', necCode: '408.40' },
          { name: 'Panel directory legibly filled out', necCode: '408.4' },
        ],
      },
      final: {
        label: 'Final Inspection',
        items: [
          { name: 'GFCI protection at required locations', necCode: '210.8' },
          { name: 'AFCI protection on dwelling branch circuits', necCode: '210.12' },
          { name: 'Tamper-resistant receptacles installed', necCode: '406.12' },
          { name: 'All devices & cover plates installed', necCode: '406.6' },
          { name: 'Smoke / CO detectors operational', necCode: '210.70' },
          { name: 'Receptacle spacing 12ft / 6ft rule', necCode: '210.52' },
          { name: 'Lighting outlets in required rooms', necCode: '210.70' },
        ],
      },
      ev_charger: {
        label: 'EV Charger Inspection',
        items: [
          { name: 'Circuit sized at 125% of charger rating', necCode: '625.41' },
          { name: 'GFCI/EVSE personnel protection present', necCode: '625.54' },
          { name: 'Disconnect within sight where required', necCode: '625.43' },
          { name: 'EVSE listed & labeled', necCode: '625.6' },
          { name: 'Load calculation accounts for EVSE', necCode: '220.57' },
        ],
      },
    };
  }

  registerLensAction('electrical', 'checklistTemplates', (_ctx, _artifact, _params) => {
    try {
      const t = checklistTemplates();
      return {
        ok: true,
        result: {
          templates: Object.entries(t).map(([key, v]) => ({
            key, label: v.label, itemCount: v.items.length,
          })),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'checklistCreate', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const templates = checklistTemplates();
      const tpl = templates[data.template];
      if (!tpl) {
        return { ok: false, error: `unknown template — pick one of: ${Object.keys(templates).join(', ')}` };
      }
      const checklist = {
        id: gid('chk', st),
        template: data.template,
        label: tpl.label,
        jobName: data.jobName || tpl.label,
        items: tpl.items.map((it) => ({
          id: gid('item', st),
          name: it.name, necCode: it.necCode,
          passed: null, critical: false, notes: '',
        })),
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      list(st.checklists, uid(ctx)).push(checklist);
      save();
      return { ok: true, result: checklist };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'checklistList', (ctx, _artifact, _params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      return { ok: true, result: { checklists: list(st.checklists, uid(ctx)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'checklistSetItem', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const chk = list(st.checklists, uid(ctx)).find((c) => c.id === data.checklistId);
      if (!chk) return { ok: false, error: 'checklist not found' };
      const item = chk.items.find((i) => i.id === data.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      if (data.passed !== undefined) item.passed = data.passed;
      if (data.critical !== undefined) item.critical = !!data.critical;
      if (data.notes !== undefined) item.notes = String(data.notes);
      chk.updatedAt = nowIso();
      save();
      const checked = chk.items.filter((i) => i.passed !== null);
      const passed = chk.items.filter((i) => i.passed === true).length;
      const critical = chk.items.filter((i) => i.passed === false && i.critical).length;
      return {
        ok: true,
        result: {
          checklist: chk,
          progress: {
            checked: checked.length, total: chk.items.length,
            passed, failed: checked.length - passed, criticalFailures: critical,
            verdict: checked.length < chk.items.length ? 'IN PROGRESS'
              : critical > 0 ? 'FAIL — critical issues'
                : passed === chk.items.length ? 'PASS' : 'CONDITIONAL',
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'checklistDelete', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const arr = list(st.checklists, uid(ctx));
      const before = arr.length;
      st.checklists.set(uid(ctx), arr.filter((c) => c.id !== data.checklistId));
      save();
      return { ok: true, result: { deleted: before - st.checklists.get(uid(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  //  MATERIAL PRICE LIST  (persistent — seeds from real-trade catalog)
  // ════════════════════════════════════════════════════════════════════

  registerLensAction('electrical', 'priceListGet', (ctx, _artifact, _params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const arr = st.priceList.get(uid(ctx));
      if (!arr) {
        // First access — seed the user's editable list from the catalog.
        const seeded = defaultPriceList().map((m) => ({ ...m, id: gid('mp', st) }));
        st.priceList.set(uid(ctx), seeded);
        save();
        return { ok: true, result: { materials: seeded, source: 'default-catalog' } };
      }
      return { ok: true, result: { materials: arr, source: 'user' } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'priceListUpsert', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      if (!st.priceList.has(uid(ctx))) {
        st.priceList.set(uid(ctx), defaultPriceList().map((m) => ({ ...m, id: gid('mp', st) })));
      }
      const arr = st.priceList.get(uid(ctx));
      if (data.id) {
        const m = arr.find((x) => x.id === data.id);
        if (!m) return { ok: false, error: 'material not found' };
        if (data.name !== undefined) m.name = String(data.name);
        if (data.unit !== undefined) m.unit = String(data.unit);
        if (data.price !== undefined) m.price = parseFloat(data.price) || 0;
        if (data.category !== undefined) m.category = String(data.category);
      } else {
        arr.push({
          id: gid('mp', st),
          name: data.name || 'New Material',
          unit: data.unit || 'each',
          price: parseFloat(data.price) || 0,
          category: data.category || 'misc',
        });
      }
      save();
      return { ok: true, result: { materials: arr } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction('electrical', 'priceListRemove', (ctx, artifact, params) => {
    try {
      const st = getState(); if (!st) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const arr = st.priceList.get(uid(ctx)) || [];
      const before = arr.length;
      st.priceList.set(uid(ctx), arr.filter((m) => m.id !== data.id));
      save();
      return { ok: true, result: { removed: before - st.priceList.get(uid(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
