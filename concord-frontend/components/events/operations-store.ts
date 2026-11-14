/** Standalone Tickets, Run of show, and Guests read the Operations store.
 *  An empty artifact list is not an empty event. */

export interface OpsEvent {
  id: string;
  name: string;
}

export interface OpsTier {
  id: string;
  name: string;
  price: number;
  quantity: number;
  sold: number;
}

export interface OpsSegment {
  id: string;
  title: string;
  startTime: string;
  durationMin: number;
  owner: string;
}

export interface OpsGuest {
  id: string;
  name: string;
  email: string;
  tierName: string;
}

export function tierRows(events: OpsEvent[], byEvent: Record<string, OpsTier[] | undefined>): Array<OpsEvent & { tiers: OpsTier[] }> {
  return events.map((event) => ({ ...event, tiers: byEvent[event.id] || [] }));
}

export function segmentRows(events: OpsEvent[], byEvent: Record<string, OpsSegment[] | undefined>): Array<OpsEvent & { segments: OpsSegment[] }> {
  return events.map((event) => ({ ...event, segments: byEvent[event.id] || [] }));
}

export function guestRows(events: OpsEvent[], byEvent: Record<string, OpsGuest[] | undefined>): Array<OpsEvent & { guests: OpsGuest[] }> {
  return events.map((event) => ({ ...event, guests: byEvent[event.id] || [] }));
}

export function storeEmptyCopy(kind: "tiers" | "segments" | "guests", eventCount: number, rowCount: number): string | null {
  if (rowCount > 0) return null;
  if (eventCount === 0) {
    return "No events yet. Host one, and its tiers, segments, and guests show here.";
  }
  if (kind === "tiers") return "No ticket tiers yet.";
  if (kind === "segments") return "No segments yet.";
  return "No guests yet. Register one on a ticket tier.";
}
