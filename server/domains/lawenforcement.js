// server/domains/lawenforcement.js
export default function registerLawEnforcementActions(registerLensAction) {
  registerLensAction("law-enforcement", "caseAnalysis", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const evidence = data.evidence || [];
    const witnesses = data.witnesses || [];
    const suspects = data.suspects || [];
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
    const incidents = artifact.data?.incidents || [];
    if (incidents.length === 0) return { ok: true, result: { message: "Add incident data to generate statistics." } };
    const byType = {};
    for (const i of incidents) { const t = i.type || "other"; byType[t] = (byType[t] || 0) + 1; }
    const resolved = incidents.filter(i => i.resolved || i.status === "closed").length;
    return { ok: true, result: { totalIncidents: incidents.length, byType: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ type: t, count: c })), clearanceRate: Math.round((resolved / incidents.length) * 100), mostCommon: Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || "none", trend: incidents.length > 100 ? "high-volume" : "normal" } };
  });
}
