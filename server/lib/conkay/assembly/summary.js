// Short lines for the acceptance report and the ConKay chat reply.

export function frameTorsionSummary(frame) {
  const k = frame?.outputs?.["stiffness.torsional"];
  if (!k || !Number.isFinite(k.perDegree)) return "Frame/torsion: not computed for this design.";
  const jr = frame.outputs["stiffness.torsional.jointRange"]?.value;
  const bits = [`Frame/torsion: rigid-joint ${Math.round(k.perDegree)} N·m/deg (upper bound, status ${frame.status})`];
  if (jr && Number.isFinite(jr.lowComputedPerDegree)) bits.push(`lowest computed bond-line ${Math.round(jr.lowComputedPerDegree)} N·m/deg`);
  if (jr && Number.isFinite(jr.lowEstimatedPerDegree)) bits.push(`estimated joint-wall bound ${Math.round(jr.lowEstimatedPerDegree)} N·m/deg (EN 1993-1-8 classification used as a bound, not a measured joint)`);
  return `${bits.join("; ")}.`;
}

export function carChatSummary(session) {
  const frame = session.result("structure.frame@CHASSIS");
  const asm = session.result("assembly.vehicle@VEH");
  const fit = asm?.outputs?.fit?.value;
  const fitLine = fit?.text || "Packaging fit: not computed (this design has no assembly).";
  return `${frameTorsionSummary(frame)} ${fitLine}`;
}
