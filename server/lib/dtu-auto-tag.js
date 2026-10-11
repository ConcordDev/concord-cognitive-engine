/**
 * Board reports and other authored DTUs name their own tags. Auto-classify
 * matches keywords as substrings ("definition" → schema and defi → crypto,
 * "Updated:" → news). Callers that already chose tags set skipAutoTag so
 * that pass does not attach unrelated domains.
 */
export function dtuSkipsAutoTag(dtu) {
  if (!dtu || typeof dtu !== "object") return true;
  if (dtu._skipAutoTag === true || dtu.skipAutoTag === true) return true;
  const meta = dtu.meta;
  if (meta && typeof meta === "object" && (meta.skipAutoTag === true || meta._skipAutoTag === true)) return true;
  return false;
}
