/** Destination Reference reads. A list that arrived is shown.
 *  A missing list is a failure. An empty list is the only "none" state. */

export interface ParkRow {
  parkCode?: string;
  name?: string;
  description?: string;
  designation?: string;
  states?: string;
  url?: string;
  imageUrl?: string | null;
}

export interface ParksEnvelope {
  ok?: boolean;
  result?: { parks?: ParkRow[] | null; total?: number } | null;
  error?: string | null;
  reason?: string;
  envVar?: string;
  signupUrl?: string;
}

export type ParksView =
  | { kind: "missing_key"; envVar?: string; signupUrl?: string }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "list"; parks: ParkRow[]; total: number | null };

export function parksView(data: ParksEnvelope | null): ParksView {
  if (!data) return { kind: "error", message: "NPS unreachable" };
  if (!data.ok) {
    if (data.reason === "missing_api_key") {
      return { kind: "missing_key", envVar: data.envVar, signupUrl: data.signupUrl };
    }
    return { kind: "error", message: data.error || data.reason || "NPS unreachable" };
  }
  const parks = data.result?.parks;
  if (!Array.isArray(parks)) return { kind: "error", message: "NPS returned no park list" };
  if (parks.length === 0) return { kind: "empty" };
  const total = typeof data.result?.total === "number" ? data.result.total : parks.length;
  return { kind: "list", parks, total };
}

export interface PlaceRow {
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
  stateAbbrev: string | null;
}

export interface PostalEnvelope {
  ok?: boolean;
  result?: { places?: PlaceRow[] | null; postalCode?: string; country?: string } | null;
  error?: string | null;
  reason?: string;
}

export type PostalView =
  | { kind: "error"; message: string }
  | { kind: "none" }
  | { kind: "places"; places: PlaceRow[]; postalCode: string; country: string };

export function postalView(data: PostalEnvelope | null, fallbackPostal: string, fallbackCountry: string): PostalView {
  if (!data) return { kind: "error", message: "Postal lookup failed" };
  if (!data.ok) {
    const code = data.error || data.reason || "fetch_failed";
    if (code === "fetch_failed") return { kind: "error", message: "No match (postal code not found)" };
    return { kind: "error", message: `Zippopotam unreachable (${code})` };
  }
  const places = data.result?.places;
  if (!Array.isArray(places)) return { kind: "error", message: "Postal lookup returned no place list" };
  if (places.length === 0) return { kind: "none" };
  return {
    kind: "places",
    places,
    postalCode: data.result?.postalCode || fallbackPostal,
    country: data.result?.country || fallbackCountry,
  };
}
