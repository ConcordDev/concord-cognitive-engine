/**
 * One modulus format for the shared materials library (ConKay F15): the
 * library carries ONE value per material (server MATERIAL_LIBRARY, E in
 * MPa), and every door renders it with this formatter — GPa to one
 * decimal — so ConKay's Library and Engineering's Materials can never
 * state different precision for the same material again (PLA read
 * "3,500 MPa" in one lens and "4 GPa" in the other).
 */
export function formatModulus(eMPa: number): string {
  if (!Number.isFinite(eMPa)) return '—';
  const gpa = eMPa / 1000;
  return `${gpa.toFixed(1).replace(/\.0$/, '')} GPa`;
}
