// server/lib/conkay/powertrain/ev-pack.js
//
// The traction battery of the canonical ConKay car (an EV, Dutch 2026-10-15):
// a designed pack of sourced cells. Everything about the cell comes from its
// data sheet (hashed below); everything about the pack is a design choice or
// is computed from those two:
//
//   electrical  V = series × cell V (charge / nominal / discharge), capacity
//               and energy = parallel × cell, continuous current = parallel ×
//               cell continuous current, DC resistance = series × R_dc / parallel,
//               conduction loss I² R.
//   mass        cells (sourced, count × 70 g max) + enclosure (computed: the
//               box's surface × sheet thickness × 6061 density). The BMS,
//               contactors, fuses, HV junction box, busbars and cooling plates
//               are NOT in the design: listed as not included, never assumed.
//   geometry    cylindrical cells packed square in an axis-aligned volume
//               (a cell's length along one axis, a pitch of diameter + gap on
//               the other two); the best of the three orientations. Square
//               packing, no hexagonal nesting, no cooling channels: a count
//               for screening, not a module design.
// Out of the data sheet: no pulse or peak discharge rating is published, so
// the pack's power ceiling uses the 45 A continuous figure only.

export const EV_PACK_VERSION = "1.0.0";

export const CELL_P45B = Object.freeze({
  id: "cell.molicel.inr-21700-p45b",
  model: "Molicel INR-21700-P45B",
  capacityAh: 4.5, capacityMinAh: 4.3,
  energyWh: 16.2, energyMinWh: 15.5,
  nominalV: 3.6, maxV: 4.2, minV: 2.5,
  maxContinuousA: 45, maxChargeA: 13.5, standardChargeA: 4.5,
  dcResistanceOhm: 0.015, acImpedanceOhm: 0.007,
  chargeTempC: [0, 60], dischargeTempC: [-40, 60],
  diameterM: 0.02155, lengthM: 0.07015, massKg: 0.07,
  source: {
    title: "Molicel INR-21700-P45B Product Data Sheet v1.2",
    url: "https://www.molicel.com/wp-content/uploads/INR21700P45B_1.2_Product-Data-Sheet-of-INR-21700-P45B-80109.pdf",
    retrieved: "2026-10-15",
    sha256: "8b08963c0a198fd391ed7e62388be12cbd14c38d7b587982f9800b15c6821b4a",
    excerpt: "Capacity Typical 4500 mAh 16.2 Wh, Minimum 4300 mAh 15.5 Wh; Cell Voltage Nominal 3.6 V, Charge 4.2 V, Discharge 2.5 V; Charge Current Standard 4.5 A, Maximum 13.5 A; Discharge Current Continuous 45 A (80oC cut-off); Typical Impedance AC (30%SOC) 7 mΩ, DC (50%SOC) 15 mΩ; Diameter 21.55 mm (Max); Height 70.15 mm (Max); Weight 70 g (Max)",
    note: "maximum diameter, height and weight are used (the sheet gives maxima): the pack's mass and size are upper bounds on that account",
  },
});

/** Pack design choices, each with its basis. */
export const PACK_DESIGN_CHOICES = Object.freeze({
  series: { value: 192, basis: "design choice: 192 cells in series, 806 V at full charge (192 × 4.2 V) under the iM-375's 850 V maximum (CM350DZ inverter); 480 V at the cell discharge limit" },
  parallel: { value: 10, basis: "design choice: 10 strings, 450 A continuous (10 × 45 A): 216 kW at the 480 V discharge limit, above the iM-375's 175 kW continuous rating" },
  cellGapM: { value: 0.001, basis: "design choice: 1 mm between cells (holder ribs); no cooling channels counted" },
  enclosureSheetM: { value: 0.002, basis: "design choice: 2 mm 6061-T6 sheet box around the cell block" },
  enclosureClearanceM: { value: 0.01, basis: "design choice: 10 mm inside the box around the cell block for interconnects and sense leads" },
  usableFraction: { value: 0.8, state: "estimated", range: [0.7, 0.9], basis: "usable state-of-charge window: not on the cell data sheet; to be measured by a rundown" },
});

const DENSITY_6061 = 2700; // kg/m3 (ASTM B221 6061-T6 typical, conkay/materials)

export const NOT_INCLUDED = Object.freeze([
  "battery management system (BMS) and cell sense leads",
  "contactors, pre-charge circuit, main fuse and HV junction box",
  "busbars and cell-to-cell interconnects",
  "cooling plates or channels and their coolant",
  "on-board charger and DC-DC converter (not sourced yet)",
]);

/** The pack's electrical figures for series × parallel cells. */
export function packElectrical({ series, parallel, cell = CELL_P45B }) {
  if (!(Number.isInteger(series) && series > 0 && Number.isInteger(parallel) && parallel > 0)) throw new Error("series and parallel must be positive integers");
  const cells = series * parallel;
  const rOhm = (series * cell.dcResistanceOhm) / parallel;
  return {
    cells,
    voltage: { maxV: series * cell.maxV, nominalV: series * cell.nominalV, minV: series * cell.minV },
    capacityAh: parallel * cell.capacityAh,
    energyWh: { typical: cells * cell.energyWh, minimum: cells * cell.energyMinWh },
    continuousCurrentA: parallel * cell.maxContinuousA,
    continuousPowerW: { atMinV: parallel * cell.maxContinuousA * series * cell.minV, atNominalV: parallel * cell.maxContinuousA * series * cell.nominalV },
    maxChargeCurrentA: parallel * cell.maxChargeA,
    dcResistanceOhm: rOhm,
    lossAtW: (powerW, atV = series * cell.nominalV) => { const i = powerW / atV; return i * i * rOhm; },
  };
}

/**
 * How many cylindrical cells fit in an axis-aligned box { lx, ly, lz } (m), square-packed, best orientation.
 * Returns { count, orientation: "x"|"y"|"z" (the cell's axis), grid: [nx, ny, nz] }.
 */
export function cellsInBox({ lx, ly, lz }, { cell = CELL_P45B, gapM = PACK_DESIGN_CHOICES.cellGapM.value, clearanceM = PACK_DESIGN_CHOICES.enclosureClearanceM.value, sheetM = PACK_DESIGN_CHOICES.enclosureSheetM.value } = {}) {
  const inner = [lx, ly, lz].map((v) => v - 2 * (clearanceM + sheetM));
  if (inner.some((v) => v <= 0)) return { count: 0, orientation: null, grid: [0, 0, 0] };
  const pitch = cell.diameterM + gapM, len = cell.lengthM + gapM;
  let best = { count: 0, orientation: null, grid: [0, 0, 0] };
  for (const [axis, i] of [["x", 0], ["y", 1], ["z", 2]]) {
    const grid = inner.map((v, k) => Math.floor(k === i ? v / len : v / pitch));
    const count = grid[0] * grid[1] * grid[2];
    if (count > best.count) best = { count, orientation: axis, grid };
  }
  return best;
}

/**
 * Place `cells` into the candidate volumes in order (each { id, center: [x,y,z], size: [lx,ly,lz] }):
 * fill each until the pack is complete. A volume holds a block of the cells it can take, shrunk along x
 * (fore-aft) to the cells it holds. Returns { placed, short, blocks: [{ id, cells, center, size, orientation }] }.
 */
export function placePack(cells, volumes, opts = {}) {
  let left = cells;
  const blocks = [];
  for (const v of volumes) {
    if (left <= 0) break;
    const [lx, ly, lz] = v.size;
    const fit = cellsInBox({ lx, ly, lz }, opts);
    if (!fit.count) continue;
    const take = Math.min(left, fit.count);
    // shrink the block fore-aft to what it holds: rows along x needed for `take` cells
    const perRow = fit.count / fit.grid[0];
    const rows = Math.ceil(take / perRow);
    const used = (lx * rows) / fit.grid[0];
    blocks.push({ id: v.id, cells: take, capacity: fit.count, orientation: fit.orientation, grid: fit.grid, center: [v.center[0] - lx / 2 + used / 2, v.center[1], v.center[2]], size: [used, ly, lz] });
    left -= take;
  }
  return { placed: cells - Math.max(0, left), short: Math.max(0, left), blocks };
}

/** Enclosure mass of the blocks (box surfaces × sheet × 6061 density), kg. */
export function enclosureMassKg(blocks, sheetM = PACK_DESIGN_CHOICES.enclosureSheetM.value) {
  return blocks.reduce((m, b) => { const [a, c, d] = b.size; return m + 2 * (a * c + a * d + c * d) * sheetM * DENSITY_6061; }, 0);
}
