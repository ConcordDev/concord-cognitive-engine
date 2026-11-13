// Significant wave height H is crest-to-trough. For a deep-water wave the
// energy density is 1/8 ρ g H² (ρ = 1025 kg/m³, g = 9.81). Treating H as
// the amplitude (1/2 ρ g H²) reports four times the energy.
const RHO = 1025;
const G = 9.81;

export function waveEnergyDensity(heightMeters) {
  const h = Number(heightMeters);
  if (!Number.isFinite(h) || h <= 0) return null;
  return (1 / 8) * RHO * G * h * h;
}
