// server/domains/telecommunications.js
//
// Telecom network-planning domain. Four legacy single-shot calculators
// (networkCapacity / signalQuality / coverageMap / costPerLine) plus a
// full planning suite implementing the docs/lens-specs backlog:
//   - RF propagation (Hata/COST-231 path-loss + terrain attenuation)
//   - interference / cell-overlap analysis
//   - subscriber-growth capacity projection
//   - network topology (towers + backhaul + core links)
//   - spectrum / frequency-band allocation planner
//   - outage / fault dashboard + SLA tracking
//   - drive-test measurement import vs predicted coverage
//
// Persistent per-user state lives in globalThis._concordSTATE Maps keyed by
// userId. Every handler returns { ok:boolean, result?, error? } and never throws.

function ensureState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const S = g._concordSTATE;
  if (!S.telecom) {
    S.telecom = {
      towers: new Map(),     // userId -> Array<tower>
      spectrum: new Map(),   // userId -> Array<allocation>
      outages: new Map(),    // userId -> Array<outage>
      driveTests: new Map(), // userId -> Array<measurement>
      seq: new Map(),        // userId -> { tower, spec, out, dt }
    };
  }
  return S.telecom;
}

function uid(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function list(map, userId) {
  if (!map.has(userId)) map.set(userId, []);
  return map.get(userId);
}

function nextSeq(s, userId, key) {
  if (!s.seq.has(userId)) s.seq.set(userId, { tower: 1, spec: 1, out: 1, dt: 1 });
  const seq = s.seq.get(userId);
  const n = seq[key]++;
  return n;
}

function num(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---- RF physics helpers -----------------------------------------------------

// Great-circle distance in km (haversine).
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// COST-231 Hata path loss (dB) for distance d (km), frequency f (MHz),
// base height hb (m), mobile height hm (m). Valid 1500-2000 MHz, extended
// gracefully outside. terrain: 'urban'|'suburban'|'rural'.
function pathLossDb(d, f, hb, hm, terrain) {
  const dk = Math.max(0.01, d);
  const fM = Math.max(150, f);
  // mobile antenna correction
  const aHm =
    (1.1 * Math.log10(fM) - 0.7) * hm - (1.56 * Math.log10(fM) - 0.8);
  // environment correction
  let cm = 0;
  if (terrain === "urban") cm = 3;
  else if (terrain === "suburban") cm = 0;
  else cm = -4; // rural / open
  const base =
    46.3 +
    33.9 * Math.log10(fM) -
    13.82 * Math.log10(Math.max(30, hb)) -
    aHm +
    (44.9 - 6.55 * Math.log10(Math.max(30, hb))) * Math.log10(dk) +
    cm;
  return base;
}

// Solve max range (km) for an allowed path loss budget.
function rangeForBudget(budgetDb, f, hb, hm, terrain) {
  // binary search on distance 0.05..60 km
  let lo = 0.05;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const loss = pathLossDb(mid, f, hb, hm, terrain);
    if (loss > budgetDb) hi = mid;
    else lo = mid;
  }
  return Math.round(lo * 1000) / 1000;
}

const TERRAIN_ATTEN = { urban: 0.62, suburban: 0.82, rural: 1.0, water: 1.08 };

export default function registerTelecommunicationsActions(registerLensAction) {
  // ===========================================================================
  // Legacy calculators (kept — wired by TelecommunicationsActionPanel)
  // ===========================================================================
  registerLensAction("telecommunications", "networkCapacity", (ctx, artifact, _params) => {
    try {
      const data = artifact?.data || {};
      for (const f of ["bandwidthGbps", "utilizationPercent", "activeUsers"]) {
        if (data[f] !== undefined && data[f] !== null && !Number.isFinite(Number(data[f]))) {
          return { ok: false, error: `invalid_${f}` };
        }
      }
      const bandwidth = num(data.bandwidthGbps, 10);
      const utilization = num(data.utilizationPercent, 60);
      const users = parseInt(data.activeUsers, 10) || 1000;
      const perUserMbps = (bandwidth * 1000 * (1 - utilization / 100)) / Math.max(users, 1);
      return {
        ok: true,
        result: {
          totalBandwidth: `${bandwidth} Gbps`,
          utilization: `${utilization}%`,
          activeUsers: users,
          availablePerUser: `${Math.round(perUserMbps * 10) / 10} Mbps`,
          headroom: `${Math.round(100 - utilization)}%`,
          status: utilization > 85 ? "critical" : utilization > 70 ? "high" : "normal",
          upgrade: utilization > 80 ? "Capacity upgrade recommended" : "Sufficient capacity",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "signalQuality", (ctx, artifact, _params) => {
    try {
      const data = artifact?.data || {};
      for (const f of ["snrDb", "bitErrorRate", "latencyMs", "jitterMs"]) {
        if (data[f] !== undefined && data[f] !== null && !Number.isFinite(Number(data[f]))) {
          return { ok: false, error: `invalid_${f}` };
        }
      }
      const snr = num(data.snrDb, 20);
      const ber = num(data.bitErrorRate, 1e-6);
      const latency = num(data.latencyMs, 30);
      const jitter = num(data.jitterMs, 5);
      const mosScore = Math.min(
        5,
        Math.max(1, 4.5 - latency / 100 - jitter / 20 - (ber > 1e-4 ? 2 : 0)),
      );
      return {
        ok: true,
        result: {
          snr: `${snr} dB`,
          bitErrorRate: ber,
          latencyMs: latency,
          jitterMs: jitter,
          mosScore: Math.round(mosScore * 10) / 10,
          voiceQuality:
            mosScore >= 4 ? "excellent" : mosScore >= 3.5 ? "good" : mosScore >= 3 ? "fair" : "poor",
          videoCapable: latency < 100 && jitter < 30,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "coverageMap", (ctx, artifact, _params) => {
    try {
      const towers = artifact?.data?.towers || [];
      if (towers.length === 0) {
        return { ok: true, result: { message: "Add tower locations to map coverage." } };
      }
      const analyzed = towers.map((t) => ({
        name: t.name || t.id,
        lat: num(t.lat, 0),
        lon: num(t.lon, 0),
        rangeKm: num(t.rangeKm, 5),
        technology: t.technology || "4G",
        status: t.status || "active",
      }));
      const totalCoverageKm2 = analyzed.reduce(
        (s, t) => s + Math.PI * t.rangeKm * t.rangeKm,
        0,
      );
      return {
        ok: true,
        result: {
          towers: analyzed.length,
          activeTowers: analyzed.filter((t) => t.status === "active").length,
          totalCoverageKm2: Math.round(totalCoverageKm2),
          technologies: [...new Set(analyzed.map((t) => t.technology))],
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "costPerLine", (ctx, artifact, _params) => {
    try {
      const data = artifact?.data || {};
      for (const f of ["infrastructureCost", "monthlyOpsCost", "subscribers", "arpu"]) {
        if (data[f] !== undefined && data[f] !== null && !Number.isFinite(Number(data[f]))) {
          return { ok: false, error: `invalid_${f}` };
        }
      }
      const infrastructure = num(data.infrastructureCost, 0);
      const operations = num(data.monthlyOpsCost, 0);
      const subscribers = parseInt(data.subscribers, 10) || 1;
      const arpu = num(data.arpu, 50);
      const costPerSub = (infrastructure / 60 + operations) / subscribers;
      const margin = arpu - costPerSub;
      return {
        ok: true,
        result: {
          subscribers,
          arpu,
          costPerSubscriber: Math.round(costPerSub * 100) / 100,
          margin: Math.round(margin * 100) / 100,
          marginPercent: Math.round((margin / arpu) * 100),
          profitable: margin > 0,
          breakeven:
            Math.ceil(infrastructure / (arpu - operations / subscribers) / 12) + " months",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Tower CRUD — persistent per-user site inventory feeding every analysis
  // ===========================================================================
  registerLensAction("telecommunications", "towerList", (ctx, _artifact, _params) => {
    try {
      const s = ensureState();
      return { ok: true, result: { towers: list(s.towers, uid(ctx)) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "towerSave", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const towers = list(s.towers, userId);
      const p = params || {};
      const lat = num(p.lat, NaN);
      const lon = num(p.lon, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, error: "lat and lon are required numbers" };
      }
      const tower = {
        id: p.id && towers.some((t) => t.id === p.id) ? p.id : `twr_${nextSeq(s, userId, "tower")}`,
        name: String(p.name || `Site ${towers.length + 1}`),
        lat,
        lon,
        heightM: Math.max(5, num(p.heightM, 30)),
        powerWatts: Math.max(0.1, num(p.powerWatts, 40)),
        gainDbi: num(p.gainDbi, 16),
        freqMhz: Math.max(150, num(p.freqMhz, 1800)),
        technology: String(p.technology || "4G"),
        terrain: ["urban", "suburban", "rural", "water"].includes(p.terrain)
          ? p.terrain
          : "suburban",
        status: ["active", "maintenance", "planned", "decommissioned"].includes(p.status)
          ? p.status
          : "active",
        backhaul: ["fiber", "microwave", "satellite"].includes(p.backhaul)
          ? p.backhaul
          : "fiber",
        sectors: Math.max(1, Math.min(6, parseInt(p.sectors, 10) || 3)),
        updatedAt: Date.now(),
      };
      const idx = towers.findIndex((t) => t.id === tower.id);
      if (idx >= 0) towers[idx] = { ...towers[idx], ...tower };
      else towers.push(tower);
      return { ok: true, result: { tower, count: towers.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "towerDelete", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const towers = list(s.towers, userId);
      const id = String(params?.id || "");
      const before = towers.length;
      s.towers.set(userId, towers.filter((t) => t.id !== id));
      return { ok: true, result: { removed: before - s.towers.get(userId).length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // RF propagation model — Hata/COST-231 path-loss, terrain-aware coverage
  // ===========================================================================
  registerLensAction("telecommunications", "propagationModel", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      let towers = list(s.towers, uid(ctx));
      if (Array.isArray(params?.towers) && params.towers.length) {
        towers = params.towers;
      }
      if (!towers.length) {
        return { ok: false, error: "No towers — save towers first or pass params.towers" };
      }
      for (const f of ["rxSensitivityDbm", "mobileHeightM", "fadeMarginDb"]) {
        if (params?.[f] !== undefined && params[f] !== null && !Number.isFinite(Number(params[f]))) {
          return { ok: false, error: `invalid_${f}` };
        }
      }
      const rxSensitivityDbm = num(params?.rxSensitivityDbm, -100); // typical handset
      const mobileHeightM = num(params?.mobileHeightM, 1.5);
      const fadeMarginDb = num(params?.fadeMarginDb, 8);

      const cells = towers.map((t) => {
        const ptDbm = 10 * Math.log10(Math.max(0.1, num(t.powerWatts, 40)) * 1000);
        const eirpDbm = ptDbm + num(t.gainDbi, 16);
        // allowable path loss = EIRP - rxSensitivity - fade margin
        const budgetDb = eirpDbm - rxSensitivityDbm - fadeMarginDb;
        const terrain = t.terrain || "suburban";
        const f = num(t.freqMhz, 1800);
        const hb = num(t.heightM, 30);
        const rawRangeKm = rangeForBudget(budgetDb, f, hb, mobileHeightM, terrain);
        const atten = TERRAIN_ATTEN[terrain] ?? 0.85;
        const effRangeKm = Math.round(rawRangeKm * atten * 1000) / 1000;
        // received power at cell edge
        const edgeLoss = pathLossDb(effRangeKm, f, hb, mobileHeightM, terrain);
        const rsrpEdgeDbm = Math.round((eirpDbm - edgeLoss) * 10) / 10;
        return {
          id: t.id || t.name,
          name: t.name || t.id,
          lat: num(t.lat, 0),
          lon: num(t.lon, 0),
          terrain,
          freqMhz: f,
          eirpDbm: Math.round(eirpDbm * 10) / 10,
          linkBudgetDb: Math.round(budgetDb * 10) / 10,
          effectiveRangeKm: effRangeKm,
          coverageKm2: Math.round(Math.PI * effRangeKm * effRangeKm * 100) / 100,
          edgeRsrpDbm: rsrpEdgeDbm,
          edgeQuality: rsrpEdgeDbm > -90 ? "good" : rsrpEdgeDbm > -100 ? "fair" : "weak",
        };
      });
      const totalKm2 = Math.round(cells.reduce((a, c) => a + c.coverageKm2, 0) * 100) / 100;
      return {
        ok: true,
        result: {
          model: "COST-231 Hata + terrain attenuation",
          cells,
          totalCoverageKm2: totalKm2,
          assumptions: { rxSensitivityDbm, mobileHeightM, fadeMarginDb },
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Interference / cell-overlap analysis between towers
  // ===========================================================================
  registerLensAction("telecommunications", "interferenceAnalysis", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      let towers = list(s.towers, uid(ctx));
      if (Array.isArray(params?.towers) && params.towers.length) towers = params.towers;
      if (towers.length < 2) {
        return { ok: false, error: "Need at least 2 towers for interference analysis" };
      }
      // derive each tower's effective range via the propagation model
      const mobileHeightM = 1.5;
      const ranged = towers.map((t) => {
        const ptDbm = 10 * Math.log10(Math.max(0.1, num(t.powerWatts, 40)) * 1000);
        const eirpDbm = ptDbm + num(t.gainDbi, 16);
        const budgetDb = eirpDbm - -100 - 8;
        const terrain = t.terrain || "suburban";
        const f = num(t.freqMhz, 1800);
        const r =
          rangeForBudget(budgetDb, f, num(t.heightM, 30), mobileHeightM, terrain) *
          (TERRAIN_ATTEN[terrain] ?? 0.85);
        return {
          id: t.id || t.name,
          name: t.name || t.id,
          lat: num(t.lat, 0),
          lon: num(t.lon, 0),
          rangeKm: r,
          freqMhz: f,
          eirpDbm,
        };
      });
      const pairs = [];
      let coChannelCount = 0;
      for (let i = 0; i < ranged.length; i++) {
        for (let j = i + 1; j < ranged.length; j++) {
          const a = ranged[i];
          const b = ranged[j];
          const d = haversineKm(a.lat, a.lon, b.lat, b.lon);
          const sumR = a.rangeKm + b.rangeKm;
          if (d >= sumR) continue; // no overlap
          // lens-area overlap of two circles
          const r1 = a.rangeKm;
          const r2 = b.rangeKm;
          let overlapKm2;
          if (d <= Math.abs(r1 - r2)) {
            overlapKm2 = Math.PI * Math.min(r1, r2) ** 2;
          } else {
            const part1 =
              r1 ** 2 * Math.acos((d ** 2 + r1 ** 2 - r2 ** 2) / (2 * d * r1));
            const part2 =
              r2 ** 2 * Math.acos((d ** 2 + r2 ** 2 - r1 ** 2) / (2 * d * r2));
            const part3 =
              0.5 *
              Math.sqrt(
                Math.max(
                  0,
                  (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2),
                ),
              );
            overlapKm2 = part1 + part2 - part3;
          }
          const freqGapMhz = Math.abs(a.freqMhz - b.freqMhz);
          const coChannel = freqGapMhz < 5;
          if (coChannel) coChannelCount++;
          // crude C/I: closer + co-channel = worse
          const overlapFrac =
            overlapKm2 / (Math.PI * Math.min(r1, r2) ** 2 || 1);
          const ciDb = coChannel
            ? Math.round((25 - overlapFrac * 30) * 10) / 10
            : Math.round((25 - overlapFrac * 12) * 10) / 10;
          pairs.push({
            towerA: a.name,
            towerB: b.name,
            separationKm: Math.round(d * 100) / 100,
            overlapKm2: Math.round(overlapKm2 * 100) / 100,
            overlapPercent: Math.round(Math.min(1, overlapFrac) * 100),
            coChannel,
            freqGapMhz,
            ciDb,
            severity: ciDb < 6 ? "critical" : ciDb < 12 ? "high" : ciDb < 18 ? "moderate" : "low",
          });
        }
      }
      pairs.sort((x, y) => x.ciDb - y.ciDb);
      return {
        ok: true,
        result: {
          pairsAnalyzed: (ranged.length * (ranged.length - 1)) / 2,
          overlappingPairs: pairs.length,
          coChannelConflicts: coChannelCount,
          worstCiDb: pairs.length ? pairs[0].ciDb : null,
          conflicts: pairs,
          recommendation: coChannelCount
            ? `Re-plan ${coChannelCount} co-channel pair(s) — assign ≥5 MHz frequency gap or down-tilt antennas.`
            : "No co-channel conflicts. Soft handover overlap is acceptable.",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Capacity planning over time — subscriber-growth projection vs headroom
  // ===========================================================================
  registerLensAction("telecommunications", "capacityProjection", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const bandwidthGbps = Math.max(0.1, num(p.bandwidthGbps, 10));
      const startSubs = Math.max(1, parseInt(p.currentSubscribers, 10) || 1000);
      const monthlyGrowthPct = num(p.monthlyGrowthPercent, 4);
      const months = Math.max(1, Math.min(120, parseInt(p.months, 10) || 24));
      const mbpsPerSubBusyHour = Math.max(0.05, num(p.mbpsPerSubscriber, 1.5));
      const targetUtilPct = Math.max(10, Math.min(95, num(p.targetUtilizationPercent, 80)));

      const capacityMbps = bandwidthGbps * 1000;
      const series = [];
      let breachMonth = null;
      let subs = startSubs;
      for (let m = 0; m <= months; m++) {
        const demandMbps = subs * mbpsPerSubBusyHour;
        const utilPct = Math.round((demandMbps / capacityMbps) * 1000) / 10;
        if (breachMonth === null && utilPct >= targetUtilPct) breachMonth = m;
        series.push({
          month: m,
          subscribers: Math.round(subs),
          demandMbps: Math.round(demandMbps),
          utilizationPercent: utilPct,
          headroomPercent: Math.round((100 - utilPct) * 10) / 10,
        });
        subs *= 1 + monthlyGrowthPct / 100;
      }
      // bandwidth needed to stay under target at horizon
      const finalDemand = series[series.length - 1].demandMbps;
      const requiredGbps =
        Math.ceil((finalDemand / (targetUtilPct / 100) / 1000) * 10) / 10;
      return {
        ok: true,
        result: {
          horizonMonths: months,
          series,
          targetUtilizationPercent: targetUtilPct,
          breachMonth,
          breachWarning: breachMonth
            ? `Headroom exhausted at month ${breachMonth} — order capacity upgrade ~${Math.max(0, breachMonth - 6)} months out.`
            : `Capacity holds through the ${months}-month horizon.`,
          recommendedBandwidthGbps: requiredGbps,
          additionalGbps: Math.max(0, Math.round((requiredGbps - bandwidthGbps) * 10) / 10),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Network topology — towers, backhaul links, core nodes
  // ===========================================================================
  registerLensAction("telecommunications", "topology", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      let towers = list(s.towers, uid(ctx));
      if (Array.isArray(params?.towers) && params.towers.length) towers = params.towers;
      if (!towers.length) {
        return { ok: false, error: "No towers — save towers to build a topology" };
      }
      const coreName = String(params?.coreNodeName || "Core / EPC");
      // group towers into backhaul aggregation hubs (one per backhaul type)
      const byBackhaul = {};
      for (const t of towers) {
        const bh = t.backhaul || "fiber";
        (byBackhaul[bh] = byBackhaul[bh] || []).push(t);
      }
      const nodes = [{ id: "core", label: coreName, kind: "core" }];
      const links = [];
      const BACKHAUL_LATENCY = { fiber: 1, microwave: 3, satellite: 280 };
      let totalBackhaulGbps = 0;
      for (const [bh, group] of Object.entries(byBackhaul)) {
        const hubId = `hub_${bh}`;
        nodes.push({ id: hubId, label: `${bh} aggregation`, kind: "aggregation" });
        links.push({
          from: "core",
          to: hubId,
          kind: bh,
          latencyMs: BACKHAUL_LATENCY[bh] ?? 5,
        });
        for (const t of group) {
          const id = t.id || t.name;
          nodes.push({
            id: `twr_${id}`,
            label: t.name || id,
            kind: "tower",
            technology: t.technology || "4G",
            status: t.status || "active",
          });
          // assume 1 Gbps per active sector of backhaul demand
          const gbps = (t.status === "active" ? 1 : 0.25) * (parseInt(t.sectors, 10) || 3);
          totalBackhaulGbps += gbps;
          links.push({
            from: hubId,
            to: `twr_${id}`,
            kind: bh,
            latencyMs: BACKHAUL_LATENCY[bh] ?? 5,
            demandGbps: Math.round(gbps * 10) / 10,
          });
        }
      }
      // tree shape for TreeDiagram consumption
      const tree = {
        id: "core",
        label: coreName,
        children: Object.entries(byBackhaul).map(([bh, group]) => ({
          id: `hub_${bh}`,
          label: `${bh} aggregation`,
          children: group.map((t) => ({
            id: `twr_${t.id || t.name}`,
            label: t.name || t.id,
          })),
        })),
      };
      return {
        ok: true,
        result: {
          nodes,
          links,
          tree,
          towerCount: towers.length,
          aggregationHubs: Object.keys(byBackhaul).length,
          totalBackhaulGbps: Math.round(totalBackhaulGbps * 10) / 10,
          satelliteHops: links.filter((l) => l.kind === "satellite").length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Spectrum / frequency-band allocation planner
  // ===========================================================================
  registerLensAction("telecommunications", "spectrumList", (ctx, _artifact, _params) => {
    try {
      const s = ensureState();
      return { ok: true, result: { allocations: list(s.spectrum, uid(ctx)) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "spectrumAllocate", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const allocs = list(s.spectrum, userId);
      const p = params || {};
      const startMhz = num(p.startMhz, NaN);
      const widthMhz = num(p.widthMhz, NaN);
      if (!Number.isFinite(startMhz) || !Number.isFinite(widthMhz) || widthMhz <= 0) {
        return { ok: false, error: "startMhz and positive widthMhz are required" };
      }
      const endMhz = startMhz + widthMhz;
      // overlap detection against existing allocations
      const conflicts = allocs
        .filter((a) => a.id !== p.id)
        .filter((a) => startMhz < a.endMhz && endMhz > a.startMhz)
        .map((a) => a.band || a.id);
      if (conflicts.length && !p.allowOverlap) {
        return {
          ok: false,
          error: `Frequency overlap with: ${conflicts.join(", ")}. Pass allowOverlap to force.`,
        };
      }
      const alloc = {
        id:
          p.id && allocs.some((a) => a.id === p.id)
            ? p.id
            : `spec_${nextSeq(s, userId, "spec")}`,
        band: String(p.band || `Band ${allocs.length + 1}`),
        startMhz,
        widthMhz,
        endMhz,
        technology: String(p.technology || "5G"),
        licenseType: ["licensed", "unlicensed", "shared"].includes(p.licenseType)
          ? p.licenseType
          : "licensed",
        region: String(p.region || "national"),
        guardBandMhz: Math.max(0, num(p.guardBandMhz, 1)),
        updatedAt: Date.now(),
      };
      const idx = allocs.findIndex((a) => a.id === alloc.id);
      if (idx >= 0) allocs[idx] = alloc;
      else allocs.push(alloc);
      const totalMhz = allocs.reduce((a, x) => a + x.widthMhz, 0);
      return {
        ok: true,
        result: {
          allocation: alloc,
          totalAllocatedMhz: Math.round(totalMhz * 100) / 100,
          allocationCount: allocs.length,
          conflictsForced: conflicts.length ? conflicts : undefined,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "spectrumDelete", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const allocs = list(s.spectrum, userId);
      const id = String(params?.id || "");
      const before = allocs.length;
      s.spectrum.set(userId, allocs.filter((a) => a.id !== id));
      return { ok: true, result: { removed: before - s.spectrum.get(userId).length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "spectrumPlan", (ctx, _artifact, _params) => {
    try {
      const s = ensureState();
      const allocs = [...list(s.spectrum, uid(ctx))].sort((a, b) => a.startMhz - b.startMhz);
      if (!allocs.length) {
        return { ok: false, error: "No allocations — add spectrum blocks first" };
      }
      // detect gaps and guard-band violations
      const gaps = [];
      const guardViolations = [];
      for (let i = 1; i < allocs.length; i++) {
        const prev = allocs[i - 1];
        const cur = allocs[i];
        const gap = cur.startMhz - prev.endMhz;
        if (gap > 0.01) {
          gaps.push({
            afterBand: prev.band,
            beforeBand: cur.band,
            startMhz: prev.endMhz,
            widthMhz: Math.round(gap * 100) / 100,
          });
        }
        const requiredGuard = Math.max(prev.guardBandMhz, cur.guardBandMhz);
        if (gap >= 0 && gap < requiredGuard) {
          guardViolations.push({
            bandA: prev.band,
            bandB: cur.band,
            actualGapMhz: Math.round(gap * 100) / 100,
            requiredGuardMhz: requiredGuard,
          });
        }
      }
      const totalMhz = allocs.reduce((a, x) => a + x.widthMhz, 0);
      const span = allocs[allocs.length - 1].endMhz - allocs[0].startMhz;
      return {
        ok: true,
        result: {
          allocations: allocs,
          totalAllocatedMhz: Math.round(totalMhz * 100) / 100,
          spectralSpanMhz: Math.round(span * 100) / 100,
          utilizationPercent: span > 0 ? Math.round((totalMhz / span) * 100) : 100,
          gaps,
          guardBandViolations: guardViolations,
          byTechnology: [...new Set(allocs.map((a) => a.technology))].map((tech) => ({
            technology: tech,
            mhz:
              Math.round(
                allocs
                  .filter((a) => a.technology === tech)
                  .reduce((s2, a) => s2 + a.widthMhz, 0) * 100,
              ) / 100,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Outage / fault dashboard + SLA tracking
  // ===========================================================================
  registerLensAction("telecommunications", "outageList", (ctx, _artifact, _params) => {
    try {
      const s = ensureState();
      return { ok: true, result: { outages: list(s.outages, uid(ctx)) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "outageReport", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const outages = list(s.outages, userId);
      const p = params || {};
      const startedAt = num(p.startedAt, Date.now());
      const resolvedAt = p.resolvedAt != null ? num(p.resolvedAt, null) : null;
      const outage = {
        id:
          p.id && outages.some((o) => o.id === p.id)
            ? p.id
            : `out_${nextSeq(s, userId, "out")}`,
        site: String(p.site || "unknown"),
        cause: String(p.cause || "unspecified"),
        severity: ["critical", "major", "minor"].includes(p.severity) ? p.severity : "minor",
        affectedSubscribers: Math.max(0, parseInt(p.affectedSubscribers, 10) || 0),
        startedAt,
        resolvedAt: Number.isFinite(resolvedAt) ? resolvedAt : null,
        status: Number.isFinite(resolvedAt) ? "resolved" : "open",
        updatedAt: Date.now(),
      };
      const idx = outages.findIndex((o) => o.id === outage.id);
      if (idx >= 0) outages[idx] = outage;
      else outages.push(outage);
      return { ok: true, result: { outage, openCount: outages.filter((o) => o.status === "open").length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "outageResolve", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const outages = list(s.outages, uid(ctx));
      const o = outages.find((x) => x.id === String(params?.id || ""));
      if (!o) return { ok: false, error: "outage not found" };
      o.resolvedAt = num(params?.resolvedAt, Date.now());
      o.status = "resolved";
      o.updatedAt = Date.now();
      return { ok: true, result: { outage: o } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "slaReport", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const outages = list(s.outages, uid(ctx));
      for (const f of ["windowDays", "slaTargetPercent"]) {
        if (params?.[f] !== undefined && params[f] !== null && !Number.isFinite(Number(params[f]))) {
          return { ok: false, error: `invalid_${f}` };
        }
      }
      const windowDays = Math.max(1, parseInt(params?.windowDays, 10) || 30);
      const slaTargetPct = num(params?.slaTargetPercent, 99.9);
      const windowMs = windowDays * 24 * 3600 * 1000;
      const now = Date.now();
      const since = now - windowMs;
      const inWindow = outages.filter((o) => (o.resolvedAt || now) >= since);
      let downtimeMs = 0;
      let mttrSum = 0;
      let resolvedCount = 0;
      for (const o of inWindow) {
        const start = Math.max(o.startedAt, since);
        const end = o.resolvedAt || now;
        downtimeMs += Math.max(0, end - start);
        if (o.resolvedAt) {
          mttrSum += o.resolvedAt - o.startedAt;
          resolvedCount++;
        }
      }
      const availabilityPct =
        Math.round((1 - downtimeMs / windowMs) * 100000) / 1000;
      const mttrHours = resolvedCount
        ? Math.round((mttrSum / resolvedCount / 3600000) * 100) / 100
        : null;
      const breachMs = Math.max(0, windowMs * (1 - slaTargetPct / 100) - downtimeMs) * -1;
      return {
        ok: true,
        result: {
          windowDays,
          slaTargetPercent: slaTargetPct,
          availabilityPercent: availabilityPct,
          downtimeHours: Math.round((downtimeMs / 3600000) * 100) / 100,
          incidents: inWindow.length,
          openIncidents: inWindow.filter((o) => o.status === "open").length,
          mttrHours,
          slaMet: availabilityPct >= slaTargetPct,
          breachBudgetHours:
            breachMs > 0 ? Math.round((breachMs / 3600000) * 100) / 100 : 0,
          bySeverity: ["critical", "major", "minor"].map((sev) => ({
            severity: sev,
            count: inWindow.filter((o) => o.severity === sev).length,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Drive-test / measurement import — validate predicted vs measured coverage
  // ===========================================================================
  registerLensAction("telecommunications", "driveTestImport", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const store = list(s.driveTests, userId);
      const rows = Array.isArray(params?.measurements) ? params.measurements : [];
      if (!rows.length) {
        return { ok: false, error: "params.measurements array required" };
      }
      let imported = 0;
      for (const r of rows) {
        const lat = num(r.lat, NaN);
        const lon = num(r.lon, NaN);
        const rsrp = num(r.rsrpDbm, NaN);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(rsrp)) continue;
        store.push({
          id: `dt_${nextSeq(s, userId, "dt")}`,
          lat,
          lon,
          measuredRsrpDbm: rsrp,
          measuredSinrDb: num(r.sinrDb, null),
          technology: String(r.technology || "4G"),
          importedAt: Date.now(),
        });
        imported++;
      }
      return { ok: true, result: { imported, total: store.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "driveTestList", (ctx, _artifact, _params) => {
    try {
      const s = ensureState();
      return { ok: true, result: { measurements: list(s.driveTests, uid(ctx)) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("telecommunications", "driveTestValidate", (ctx, _artifact, params) => {
    try {
      const s = ensureState();
      const userId = uid(ctx);
      const measurements = list(s.driveTests, userId);
      let towers = list(s.towers, userId);
      if (Array.isArray(params?.towers) && params.towers.length) towers = params.towers;
      if (!measurements.length) return { ok: false, error: "No drive-test measurements imported" };
      if (!towers.length) return { ok: false, error: "No towers to predict against" };

      const mobileHeightM = 1.5;
      const points = measurements.map((m) => {
        // predicted RSRP = best server among towers
        let bestPred = -Infinity;
        let server = null;
        for (const t of towers) {
          const ptDbm = 10 * Math.log10(Math.max(0.1, num(t.powerWatts, 40)) * 1000);
          const eirpDbm = ptDbm + num(t.gainDbi, 16);
          const d = haversineKm(m.lat, m.lon, num(t.lat, 0), num(t.lon, 0));
          const loss = pathLossDb(
            d,
            num(t.freqMhz, 1800),
            num(t.heightM, 30),
            mobileHeightM,
            t.terrain || "suburban",
          );
          const pred = eirpDbm - loss;
          if (pred > bestPred) {
            bestPred = pred;
            server = t.name || t.id;
          }
        }
        const predicted = Math.round(bestPred * 10) / 10;
        const error = Math.round((m.measuredRsrpDbm - predicted) * 10) / 10;
        return {
          id: m.id,
          lat: m.lat,
          lon: m.lon,
          measuredDbm: m.measuredRsrpDbm,
          predictedDbm: predicted,
          errorDbm: error,
          server,
        };
      });
      const errors = points.map((p) => p.errorDbm);
      const n = errors.length;
      const meanErr = errors.reduce((a, b) => a + b, 0) / n;
      const rmse = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / n);
      const meanAbs = errors.reduce((a, e) => a + Math.abs(e), 0) / n;
      // calibration suggestion: shift model by mean error
      return {
        ok: true,
        result: {
          points,
          sampleCount: n,
          meanErrorDbm: Math.round(meanErr * 100) / 100,
          rmseDbm: Math.round(rmse * 100) / 100,
          meanAbsErrorDbm: Math.round(meanAbs * 100) / 100,
          calibrationOffsetDbm: Math.round(meanErr * 100) / 100,
          modelGrade:
            rmse < 6 ? "good fit" : rmse < 10 ? "acceptable" : "needs re-calibration",
          recommendation:
            rmse >= 6
              ? `Apply ${Math.round(meanErr * 10) / 10} dB calibration offset and re-tune terrain attenuation.`
              : "Predicted coverage matches measured drive-test data within tolerance.",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
