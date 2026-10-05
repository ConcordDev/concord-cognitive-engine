/**
 * A travel trip report exists because the Travel domain's `trip-create`,
 * `itinerary-add`, `booking-add`, and `trip-detail` macros returned the real
 * trip with its itinerary, bookings, and budget. This module turns exactly
 * that result into a sentence, saves it as a private DTU, reads that DTU
 * back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface TripRef {
  id: string;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  durationDays?: number;
  notes?: string;
  status?: string;
}

export interface TripBooking {
  id: string;
  type: string;
  provider: string | null;
  confirmationCode?: string | null;
  cost?: number;
  date?: string | null;
}

export interface TripItineraryItem {
  id: string;
  title: string;
  day?: number;
  time?: string;
  category?: string;
  location?: string;
}

export interface TripDetail {
  trip: TripRef;
  itineraryCount?: number;
  bookings?: TripBooking[];
  bookedCost?: number;
  checklistOpen?: number;
}

export interface TripFacts {
  detail: TripDetail | null;
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${(Math.round(v * 100) / 100).toLocaleString()}`;
}

/**
 * The trip sentence, built only from the real detail. Null when there is no
 * trip at all.
 */
export function tripSentence(facts: TripFacts): string | null {
  const t = facts.detail?.trip;
  const id = String(t?.id || '').trim();
  const name = String(t?.name || '').trim();
  if (!id || !name) return null;

  const parts: string[] = [];
  if (t?.destination) parts.push(t.destination);
  if (t?.startDate && t?.endDate) parts.push(`${t.startDate} → ${t.endDate}`);
  if (t?.travelers && t.travelers > 0) parts.push(`${t.travelers} traveler${t.travelers === 1 ? '' : 's'}`);
  const d = facts.detail;
  if (d?.itineraryCount != null && d.itineraryCount > 0) parts.push(`${d.itineraryCount} itinerary items`);
  if (d?.bookings && d.bookings.length > 0) parts.push(`${d.bookings.length} bookings`);
  if (d?.bookedCost != null && d.bookedCost > 0) parts.push(`${money(d.bookedCost)} booked`);
  if (d?.checklistOpen != null && d.checklistOpen > 0) parts.push(`${d.checklistOpen} checklist items open`);

  return `${name}: ${parts.length > 0 ? parts.join(', ') : 'no details yet'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function tripBody(facts: TripFacts): string {
  const sentence = tripSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const t = facts.detail?.trip;
  if (t?.destination) lines.push(`Destination: ${t.destination}.`);
  if (t?.startDate && t?.endDate) lines.push(`Dates: ${t.startDate} to ${t.endDate}.`);
  if (t?.durationDays) lines.push(`Duration: ${t.durationDays} days.`);
  if (t?.travelers) lines.push(`Travelers: ${t.travelers}.`);
  if (t?.notes) lines.push(`Notes: ${t.notes}.`);
  const d = facts.detail;
  if (d?.bookings && d.bookings.length > 0) {
    lines.push(`Bookings: ${d.bookings.map((b) => `${b.type} ${b.provider}${b.confirmationCode ? ` (${b.confirmationCode})` : ''}${b.cost ? ` ${money(b.cost)}` : ''}`).join('; ')}.`);
  }
  if (d?.bookedCost != null && d.bookedCost > 0) {
    lines.push(`Total booked: ${money(d.bookedCost)}.`);
  }
  lines.push('Every figure here came from the Travel domain in Concord. No flight was booked. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same trip, structured. */
export function tripMachine(facts: TripFacts): Record<string, unknown> | null {
  if (!tripSentence(facts)) return null;
  const t = facts.detail?.trip;
  const d = facts.detail;
  return {
    kind: 'travel_trip_report',
    tripId: String(t?.id || ''),
    tripName: String(t?.name || ''),
    destination: String(t?.destination || ''),
    startDate: String(t?.startDate || ''),
    endDate: String(t?.endDate || ''),
    travelers: Number(t?.travelers) || 0,
    durationDays: Number(t?.durationDays) || 0,
    itineraryCount: d?.itineraryCount ?? 0,
    bookingCount: d?.bookings?.length ?? 0,
    bookedCost: Number(d?.bookedCost) || 0,
    checklistOpen: d?.checklistOpen ?? 0,
  };
}

/** The private DTU that records this trip. Null when nothing can be saved. */
export function tripReportDtuCall(facts: TripFacts): ReceiptCall | null {
  const body = tripBody(facts);
  const sentence = tripSentence(facts);
  const machine = tripMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['travel', 'trip-report', String(facts.detail?.trip?.id || 'trip').toLowerCase()],
      source: 'travel-lens:trip-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'travel',
        travel: {
          tripId: String(facts.detail?.trip?.id || ''),
          tripName: String(facts.detail?.trip?.name || ''),
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that trip report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function tripThreadDraftCall(
  facts: TripFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = tripSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(facts.detail?.trip?.name || 'Travel trip').slice(0, 120),
      content: tripBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface TripDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function tripThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): TripDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexTripDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}