/**
 * The private DTU a ConKay beam study is kept as. Built only from a real
 * solve: the sim job id, inputs, the solver's numbers and the hand check.
 */

import type { ReceiptCall } from '@/components/wallet/walletReceipt';
import { SUPPORT_LABELS, formatForce, type BeamStudyResult } from './workspace-commands';

function spanClaimsMm(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|foot)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'mm') out.push(n);
    else if (u === 'cm') out.push(n * 10);
    else if (u === 'm') out.push(n * 1000);
    else out.push(n * 304.8);
  }
  return out;
}

/** Lead with the solved span when the study name claims a different one. */
export function beamReportHeadline(r: BeamStudyResult): string {
  const claims = spanClaimsMm(r.name || '');
  if (!r.name || claims.some((mm) => Math.abs(mm - r.dims.length) > 1)) return `${r.dims.length} mm span`;
  return r.name;
}

export function beamReportSentence(r: BeamStudyResult): string {
  const d = r.dims;
  return `${beamReportHeadline(r)}: ${d.height}×${d.flangeWidth} I-beam (t_f ${d.flangeThickness}, t_w ${d.webThickness} mm), `
    + `${d.length} mm ${SUPPORT_LABELS[r.support].toLowerCase()}, ${formatForce(r.loadN)} — `
    + `${r.maxStressMPa.toFixed(1)} MPa, ${(r.utilization * 100).toFixed(1)}% of ${r.material.label} yield, `
    + `${r.pass ? 'passes' : 'fails'}.`;
}

export function beamReportBody(r: BeamStudyResult): string {
  const d = r.dims;
  return [
    beamReportSentence(r),
    '',
    `Inputs: L=${d.length} mm, D=${d.height} mm, W=${d.flangeWidth} mm, t_f=${d.flangeThickness} mm, t_w=${d.webThickness} mm.`,
    `Support: ${SUPPORT_LABELS[r.support]}. Point load ${formatForce(r.loadN)}${r.support === 'cantilever' ? ' at the free end' : ' at midspan'}.`,
    `Material: ${r.material.label} (E=${r.material.E} MPa, yield=${r.material.yield} MPa).`,
    `Section: A=${r.section.areaMm2.toFixed(0)} mm², Ix=${r.section.IxMm4.toExponential(3)} mm⁴.`,
    '',
    `FEA (sim job ${r.jobId ?? 'n/a'}): max stress ${r.maxStressMPa.toFixed(2)} MPa (axial + bending at the extreme fibre), `
      + `max deflection ${r.maxDeflectionMm.toFixed(4)} mm, utilization ${(r.utilization * 100).toFixed(1)}%, safety factor ${r.safetyFactor.toFixed(2)}.`,
    `Hand check: ${r.handCheck.maxStressMPa.toFixed(2)} MPa, ${r.handCheck.maxDeflectionMm.toFixed(4)} mm — `
      + `${r.handCheck.agrees ? 'agrees' : 'does not agree'} with the solver (tolerance ${(r.handCheck.tolerance * 100).toFixed(0)}%).`,
    '',
    'Linear-elastic beam theory; not a stamped design. Buckling, shear and connections are not checked.',
  ].join('\n');
}

export function beamReportDtuCall(r: BeamStudyResult | null): ReceiptCall | null {
  if (!r || !r.jobId) return null;
  const sentence = beamReportSentence(r);
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      // Exact-title duplicates are blocked store-wide; the sim job id keeps
      // two runs of the same beam distinct.
      title: `${sentence.slice(0, 90)} · ${r.jobId.slice(0, 40)}`,
      tags: ['engineering', 'fea', 'conkay', 'beam-study'],
      source: 'conkay-workspace:beam-study',
      human: { summary: beamReportBody(r) },
      core: { definitions: [sentence], claims: [sentence] },
      machine: {
        kind: 'conkay_beam_study',
        jobId: r.jobId,
        dims: r.dims,
        support: r.support,
        loadN: r.loadN,
        material: r.material.id,
        maxStressMPa: r.maxStressMPa,
        maxDeflectionMm: r.maxDeflectionMm,
        utilization: r.utilization,
        safetyFactor: r.safetyFactor,
        pass: r.pass,
        handCheckAgrees: r.handCheck.agrees,
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'conkay',
      },
    },
  };
}
