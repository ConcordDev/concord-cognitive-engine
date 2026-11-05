// server/lib/hvac-materials.js
//
// The HVAC Materials catalog — common trade materials with typical US
// REFERENCE prices. Prices are mid-range shelf prices a small shop would
// recognise in 2026; refrigerant prices move with the HFC phasedown and
// every price moves by supplier and region, so the surface labels them
// reference prices, not quotes. The catalog is reference data: a shop's
// own stock records live on the desk (the Materials records list).

export const HVAC_MATERIALS_PRICE_NOTE =
  "Typical US reference prices (2026) — they vary by supplier, region and season, and refrigerant prices move with the HFC phasedown. Reference only, not a quote.";

export const HVAC_MATERIALS_CATALOG = [
  { name: "Pleated air filter 20×25×1 (MERV 8)", category: "Filters", unit: "each", referencePriceUsd: 12 },
  { name: "Media air filter 20×25×4 (MERV 11)", category: "Filters", unit: "each", referencePriceUsd: 38 },
  { name: "Dual run capacitor 45/5 µF", category: "Electrical", unit: "each", referencePriceUsd: 18 },
  { name: "Contactor, 2-pole 30A", category: "Electrical", unit: "each", referencePriceUsd: 22 },
  { name: "Hard-start kit (potential relay + capacitor)", category: "Electrical", unit: "each", referencePriceUsd: 32 },
  { name: "Disconnect switch, 60A non-fused", category: "Electrical", unit: "each", referencePriceUsd: 28 },
  { name: "Liquid-tight whip kit, 6 ft", category: "Electrical", unit: "each", referencePriceUsd: 24 },
  { name: "Refrigerant R-410A", category: "Refrigerant", unit: "per lb", referencePriceUsd: 18 },
  { name: "Refrigerant R-454B", category: "Refrigerant", unit: "per lb", referencePriceUsd: 32 },
  { name: "Refrigerant R-22 (reclaimed)", category: "Refrigerant", unit: "per lb", referencePriceUsd: 45 },
  { name: "Copper line set 3/8″ × 3/4″, 25 ft", category: "Copper & piping", unit: "per set", referencePriceUsd: 210 },
  { name: "ACR copper tubing 3/4″", category: "Copper & piping", unit: "per ft", referencePriceUsd: 4.2 },
  { name: "PVC condensate pipe 3/4″", category: "Copper & piping", unit: "per ft", referencePriceUsd: 0.9 },
  { name: "Condensate pump (115V, 22 ft lift)", category: "Drainage", unit: "each", referencePriceUsd: 65 },
  { name: "Condensate safety switch (SS2)", category: "Drainage", unit: "each", referencePriceUsd: 24 },
  { name: "Programmable thermostat (5-1-1)", category: "Controls", unit: "each", referencePriceUsd: 85 },
  { name: "Smart thermostat (Wi-Fi, learning)", category: "Controls", unit: "each", referencePriceUsd: 169 },
  { name: "Flexible duct R-8, 8″ × 25 ft", category: "Ductwork", unit: "per box", referencePriceUsd: 78 },
  { name: "Galvanized round duct 8″ × 5 ft", category: "Ductwork", unit: "each", referencePriceUsd: 16 },
  { name: "Duct mastic, water-based", category: "Ductwork", unit: "per gallon", referencePriceUsd: 28 },
  { name: "Foil tape, UL-181 listed", category: "Ductwork", unit: "per roll", referencePriceUsd: 14 },
  { name: "Blower motor, 1/2 hp PSC", category: "Motors", unit: "each", referencePriceUsd: 185 },
  { name: "Condenser fan motor, 1/4 hp", category: "Motors", unit: "each", referencePriceUsd: 145 },
];

/** Case-insensitive search over name and category. */
export function searchHvacMaterials(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return HVAC_MATERIALS_CATALOG.slice();
  const tokens = q.split(/\s+/).filter(Boolean);
  return HVAC_MATERIALS_CATALOG.filter((m) => {
    const blob = `${m.name} ${m.category}`.toLowerCase();
    return tokens.every((t) => blob.includes(t));
  });
}
