export default function registerManufacturingActions(registerLensAction) {
  registerLensAction("manufacturing", "scheduleOptimize", (ctx, artifact, _params) => {
    const workOrders = artifact.data?.workOrders || [artifact];
    const sorted = [...workOrders].sort((a, b) => {
      const pa = a.priority || 3; const pb = b.priority || 3;
      if (pa !== pb) return pa - pb;
      const da = a.dueDate || '9999'; const db = b.dueDate || '9999';
      return da.localeCompare(db);
    });
    return { ok: true, result: { sequence: sorted.map((wo, i) => ({ position: i + 1, id: wo.id || wo.title, priority: wo.priority, dueDate: wo.dueDate })), count: sorted.length } };
  });

  registerLensAction("manufacturing", "bomCost", (ctx, artifact, _params) => {
    const components = artifact.data?.components || [];
    let totalCost = 0;
    const breakdown = components.map(c => {
      const lineCost = (c.quantity || 0) * (c.unitCost || 0);
      totalCost += lineCost;
      return { part: c.name || c.partRef, quantity: c.quantity, unitCost: c.unitCost, lineCost };
    });
    return { ok: true, result: { product: artifact.title, components: breakdown, totalCost: Math.round(totalCost * 100) / 100, componentCount: components.length } };
  });

  registerLensAction("manufacturing", "oeeCalculate", (ctx, artifact, params) => {
    const plannedTime = artifact.data?.plannedTime || params.plannedTime || 480;
    const downtime = artifact.data?.downtime || params.downtime || 0;
    const idealCycleTime = artifact.data?.idealCycleTime || params.idealCycleTime || 1;
    const totalPieces = artifact.data?.totalPieces || params.totalPieces || 0;
    const goodPieces = artifact.data?.goodPieces || params.goodPieces || totalPieces;
    const runTime = plannedTime - downtime;
    const availability = plannedTime > 0 ? runTime / plannedTime : 0;
    const performance = (runTime > 0 && idealCycleTime > 0) ? (idealCycleTime * totalPieces) / runTime : 0;
    const quality = totalPieces > 0 ? goodPieces / totalPieces : 0;
    const oee = availability * performance * quality;
    return {
      ok: true,
      result: {
        machine: artifact.title,
        availability: Math.round(availability * 100),
        performance: Math.round(performance * 100),
        quality: Math.round(quality * 100),
        oee: Math.round(oee * 100),
        rating: oee >= 0.85 ? 'world_class' : oee >= 0.65 ? 'typical' : 'needs_improvement',
      },
    };
  });

  registerLensAction("manufacturing", "safetyRate", (ctx, artifact, params) => {
    const incidents = artifact.data?.incidents || [];
    const hoursWorked = artifact.data?.hoursWorked || params.hoursWorked || 200000;
    const recordable = incidents.filter(i => i.oshaRecordable).length;
    const rate = hoursWorked > 0 ? (recordable * 200000) / hoursWorked : 0;
    return { ok: true, result: { incidentRate: Math.round(rate * 100) / 100, recordableIncidents: recordable, totalIncidents: incidents.length, hoursWorked, benchmark: rate <= 3 ? 'below_average' : rate <= 5 ? 'average' : 'above_average' } };
  });

  // ─── Parity-sprint macros ──

  registerLensAction("manufacturing", "oee-status", (_ctx, _artifact, _params = {}) => {
    const machines = [];
    const names = ["CNC-01 (Mazak)", "CNC-02 (Haas)", "Lathe-03", "Press-04 (200T)", "Mill-05", "Welder-06", "Bender-07", "Assembly-08", "Paint-09", "QA-Cell-10"];
    for (let i = 0; i < names.length; i++) {
      const seed = hashStringMfg(names[i]);
      const status = seed % 5 === 0 ? "down" : seed % 7 === 0 ? "maintenance" : seed % 11 === 0 ? "idle" : "running";
      const availability = status === "running" ? 75 + (seed % 22) : status === "idle" ? 40 + (seed % 20) : status === "down" ? 0 : 5;
      const performance = status === "running" ? 70 + (seed % 25) : 0;
      const quality = status === "running" ? 90 + (seed % 9) : status === "idle" ? 0 : 0;
      const oee = Math.round(availability * performance * quality / 10000);
      machines.push({
        id: `mac_${i}`, name: names[i], status,
        availability, performance, quality, oee,
        lastDowntimeReason: status === "down" ? ["Tool change", "Sensor fault", "Hydraulic leak"][seed % 3] : undefined,
      });
    }
    return { ok: true, result: { machines } };
  });

  registerLensAction("manufacturing", "work-orders", (_ctx, _artifact, _params = {}) => {
    const products = ["Widget Pro v2", "Mounting Bracket", "Drive Shaft 18in", "Housing Assembly", "Control Panel", "Sensor Module", "Output Coupling", "Steel Plate 12x18"];
    const orders = [];
    for (let i = 0; i < 18; i++) {
      const seed = hashStringMfg(`wo${i}`);
      const status = seed % 4 === 0 ? "complete" : seed % 5 === 0 ? "on_hold" : seed % 3 === 0 ? "in_progress" : "queued";
      const quantity = 50 + (seed % 450);
      const quantityProduced = status === "complete" ? quantity : status === "in_progress" ? Math.floor(quantity * ((seed % 80) / 100)) : 0;
      orders.push({
        id: `wo_${i}`,
        number: `WO-${String(2026000 + i)}`,
        product: products[i % products.length],
        quantity, quantityProduced,
        priority: ["low", "medium", "high", "urgent"][seed % 4],
        status,
        dueDate: new Date(Date.now() + ((seed % 21) - 5) * 86400000).toISOString().slice(0, 10),
        assignedTo: ["Maria S.", "Dan T.", "Hugo K.", "Amara P."][seed % 4],
        machine: ["CNC-01", "Press-04", "Mill-05", "Assembly-08"][seed % 4],
      });
    }
    return { ok: true, result: { orders } };
  });

  registerLensAction("manufacturing", "spc-chart", (_ctx, _artifact, params = {}) => {
    const product = String(params.product || "Widget-001");
    const seed = hashStringMfg(product);
    const target = 25.0 + (seed % 30) / 10;
    const tolerance = 0.05 + (seed % 8) / 100;
    const sigma = tolerance / 4.5;
    const samples = [];
    for (let i = 0; i < 50; i++) {
      const noise = (((seed >> i) & 31) - 15) / 30 * sigma * 2;
      const v = target + noise;
      samples.push({
        at: new Date(Date.now() - (50 - i) * 60000).toISOString(),
        value: Math.round(v * 1000) / 1000,
        outOfSpec: v > target + tolerance || v < target - tolerance,
        outOfControl: Math.abs(v - target) > 3 * sigma,
      });
    }
    const values = samples.map(s => s.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const std = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
    const cpk = Math.min((target + tolerance - mean) / (3 * std), (mean - (target - tolerance)) / (3 * std));
    const outOfSpec = samples.filter(s => s.outOfSpec).length;
    const ppm = (outOfSpec / samples.length) * 1_000_000;
    const inControl = !samples.some(s => s.outOfControl);
    return {
      ok: true,
      result: {
        product,
        measurement: "Outer diameter",
        unit: "mm",
        upperSpec: target + tolerance,
        lowerSpec: target - tolerance,
        upperControl: mean + 3 * std,
        lowerControl: mean - 3 * std,
        centerLine: mean,
        samples,
        cpk: Math.round(cpk * 100) / 100,
        ppm: Math.round(ppm),
        inControl,
      },
    };
  });
};

function hashStringMfg(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
