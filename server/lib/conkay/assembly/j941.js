// server/lib/conkay/assembly/j941.js
//
// SAE J941 (MAR2010) driver eyellipse, Class A, 95th-percentile tangent cutoff,
// 50/50 gender mix, adjustable seat. Axis lengths are Table 2 for seat-track
// travel > 133 mm. The side-view tilt is Equation 1: β = 12° (front tipped down).
//
// Centroid (Eqs. 2–4). The public PDF's typeset equations extract as flattened
// text. The appendix restates the same algebra, which is what is implemented:
//   Xc = L1 − 12.5·t + 664 + 0.587·L6 − 0.176·H30
//   Zc = H8 + H30 + 638
//   Ycl = W20 − 32.5,  Ycr = W20 + 32.5,  mid-eye on W20
// All inputs in millimetres. t = 1 with a clutch pedal, else 0.
// Labeled transcription: a licensed typeset copy is the authority if it disagrees.
//
// Source: SAE J941 MAR2010, public copy
// https://engineeringcheatsheet.com/wp-content/uploads/2022/09/saej941v002.pdf
// (Table 2, Eq. 1, section 4.3 and Appendix A).

export const J941_SOURCE = Object.freeze({
  title: "SAE J941 MAR2010 Motor Vehicle Drivers' Eye Locations, Table 2 and Eqs. 1–4",
  url: "https://engineeringcheatsheet.com/wp-content/uploads/2022/09/saej941v002.pdf",
  retrieved: "2026-10-11",
});

export const J941_AXES_MM = Object.freeze({
  x: 206.4, y: 60.3, z: 93.4,
  seatTrack: ">133 mm", percentile: 95,
  note: "Table 2 true-view axis lengths of one eye (left and right ellipses are identical). Full lengths, not semi-axes.",
});

/**
 * @param {{ L1mm: number, L6mm: number, H30mm: number, H8mm: number, W20mm: number, clutch: boolean }} p
 * L1 PRP x, L6 PRP to steering-wheel centre, H30 SgRP above AHP, H8 AHP z, W20 seat centreline y.
 */
export function j941Centroid(p) {
  const t = p.clutch ? 1 : 0;
  const Xc = p.L1mm - 12.5 * t + 664 + 0.587 * p.L6mm - 0.176 * p.H30mm;
  const Zc = p.H8mm + p.H30mm + 638;
  const mid = { xMm: Xc, yMm: p.W20mm, zMm: Zc };
  return {
    mid,
    left: { xMm: Xc, yMm: p.W20mm - 32.5, zMm: Zc },
    right: { xMm: Xc, yMm: p.W20mm + 32.5, zMm: Zc },
    axesMm: { ...J941_AXES_MM },
    betaDeg: 12,
    betaNote: "Eq. 1: side-view x-axis tipped down at the front, 12 degrees from horizontal",
    provenance: {
      state: "sourced",
      transcription: "centroid algebra transcribed from the flattened public-PDF text and the appendix restatement; axis lengths and β are Table 2 and Eq. 1 as printed",
      source: J941_SOURCE.url,
    },
  };
}

/** Eyellipse as an oriented box the assembly can place (semi-axes, metres). */
export function j941Envelope(p) {
  const c = j941Centroid(p);
  const m = 0.001;
  return {
    center: [c.mid.xMm * m, c.mid.yMm * m, c.mid.zMm * m],
    semiAxesM: { x: J941_AXES_MM.x / 2 * m, y: J941_AXES_MM.y / 2 * m, z: J941_AXES_MM.z / 2 * m },
    betaDeg: c.betaDeg,
    centroid: c,
  };
}
