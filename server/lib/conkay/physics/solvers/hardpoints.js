// server/lib/conkay/physics/solvers/hardpoints.js
//
// structure.hardpoints: the tub's axle-line pickups and the members that
// carry them. Does not add S550 arm geometry.

import { registerSolver } from "../registry.js";
import { getComponent } from "../../components/index.js";
import { hardpoints } from "../../structural/hardpoints.js";

function suspensionOf(ctx, nodeId) {
  const id = ctx.get(nodeId, "props.component");
  if (!id) return null;
  const c = getComponent(id);
  if (!c) return null;
  return {
    node: nodeId,
    component: id,
    axle: c.applicability?.axle || null,
    dimensions: c.dimensions?.state || "missing",
    springNote: c.ratings?.springRateNPerMm?.note || (c.ratings?.springRateNPerMm?.value == null ? "not published" : null),
    requires: c.applicability?.requires || [],
  };
}

export const hardpointSolver = registerSolver({
  id: "structure.hardpoints",
  version: "1.0.0",
  domain: "structural.frame",
  fidelity: 1,
  method: "list the tub axle-line nodes and the members that meet them; split the static axle loads evenly. S550 arm coordinates are not published and are not invented.",
  reference: "server/lib/conkay/structural/hardpoints.js",
  regime: "static, level, no aero, rigid supports",
  units: { inputs: "m, N", outputs: "m, N" },
  screening: true,
  targets: (g) => [...g.nodes.values()]
    .filter((n) => Array.isArray(n.props?.frameModel?.nodes) && n.props.frameModel.nodes.some((nd) => nd.id === "FA.L"))
    .map((n) => n.id),
  run(ctx, id) {
    const fm = ctx.get(id, "props.frameModel");
    const ax = ctx.result("vehicle.axle-loads", "VEH");
    const front = ax?.outputs?.frontAxleLoad?.value;
    const rear = ax?.outputs?.rearAxleLoad?.value;
    const suspension = ["SUSPENSION_FRONT", "SUSPENSION_REAR"].map((n) => suspensionOf(ctx, n)).filter(Boolean);
    const result = hardpoints({
      nodes: fm.nodes,
      members: fm.members,
      frontAxleLoadN: Number.isFinite(front) ? front : null,
      rearAxleLoadN: Number.isFinite(rear) ? rear : null,
      loadSource: ax ? ax.runId : "vehicle.axle-loads did not run",
      suspension,
    });
    if (!Number.isFinite(front) || !Number.isFinite(rear)) {
      result.warnings.push("Axle loads were not available, so the pickup forces are not computed.");
    }
    return {
      inputs: {
        frontAxleLoadN: { value: Number.isFinite(front) ? front : null, unit: "N", source: result.loadSource || ax?.runId },
        rearAxleLoadN: { value: Number.isFinite(rear) ? rear : null, unit: "N" },
      },
      outputs: {
        armsLocated: { value: false, note: "S550 dimensions are not published" },
        hardpoints: { value: result },
      },
      margins: [],
      warnings: result.warnings,
      assumptions: result.assumptions,
    };
  },
});
