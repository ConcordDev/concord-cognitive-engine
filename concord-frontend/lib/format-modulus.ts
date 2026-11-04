/**
 * formatModulus — the ONE rendering of a material's elastic modulus.
 *
 * The materials library (engineering.materialLibrary) holds E in MPa
 * and serves both doors of the shared store — Engineering's Materials
 * library and ConKay's workspace. The doors disagreed in precision:
 * ConKay printed the library's exact value ("3,500 MPa" for PLA)
 * while Engineering's panel printed `(E / 1000).toFixed(0)` GPa —
 * "4 GPa" for the same 3,500 MPa, a rounded figure that reads as a
 * different material property (F15). Both doors now render through
 * this formatter: the library's exact value, in MPa, at one precision.
 */
export function formatModulus(eMPa: number): string {
  return `${eMPa.toLocaleString('en-US')} MPa`;
}
