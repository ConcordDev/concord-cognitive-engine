/** Trip Planner run decisions. A filled destination is looked up.
 *  A blank field is named. Visa is asked only for a two-letter code.
 *  A null visa flag is not "visa-free". */

export type PlannerStart =
  | { kind: "field"; error: "Destination is required." }
  | { kind: "lookup" };

export function plannerStart(destination: string): PlannerStart {
  if (!destination.trim()) return { kind: "field", error: "Destination is required." };
  return { kind: "lookup" };
}

/** ISO-2 only. A name, a blank, or a one-letter fragment is not a visa destination. */
export function visaDestination(iso2: unknown): string | null {
  if (typeof iso2 !== "string") return null;
  const code = iso2.trim();
  return /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}

export function visaHeadline(visaRequired: boolean | null | undefined): "Visa required" | "Visa-free" | null {
  if (visaRequired === true) return "Visa required";
  if (visaRequired === false) return "Visa-free";
  return null;
}

export function tripPlanTags(iso2: unknown): string[] {
  const code = visaDestination(iso2);
  return code ? ["travel", "trip-plan", code.toLowerCase()] : ["travel", "trip-plan"];
}

export function visaSaveLine(
  visa: { arrangement?: string | null; visaRequired?: boolean | null; maxFreeStay?: string | null } | null,
  passport: string,
  iso2: string,
  days: number | "",
): string {
  if (!visa || visa.visaRequired == null) {
    return `Visa (${passport} → ${iso2}, ${days}d): no bilateral entry on file`;
  }
  const word = visa.visaRequired ? "visa required" : "visa-free";
  return `Visa (${passport} → ${iso2}, ${days}d): ${visa.arrangement || "check embassy"} — ${word} (${visa.maxFreeStay || "?"})`;
}

export function formatConverted(converted: unknown): string | null {
  if (typeof converted !== "number" || !Number.isFinite(converted)) return null;
  return converted.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
