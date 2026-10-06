import { describe, it, expect } from 'vitest';
import {
  tripSentence,
  tripBody,
  tripReportDtuCall,
  tripThreadDraftCall,
  tripThreadDraftOutcome,
  indexTripDrafts,
  type TripFacts,
} from '@/components/travel/travelTripReport';

const facts: TripFacts = {
  detail: {
    trip: { id: 'trip_001', name: 'Tokyo Trip', destination: 'Tokyo', startDate: '2026-11-01', endDate: '2026-11-07', travelers: 2, durationDays: 7 },
    itineraryCount: 5,
    bookings: [
      { id: 'bk_1', type: 'flight', provider: 'JAL', confirmationCode: 'JL001', cost: 1200, date: '2026-11-01' },
      { id: 'bk_2', type: 'hotel', provider: 'Park Hyatt', cost: 800, date: '2026-11-01' },
    ],
    bookedCost: 2000,
    checklistOpen: 3,
  },
};

describe('travel trip report', () => {
  it('states only the figures the backend reported', () => {
    const s = tripSentence(facts)!;
    expect(s).toContain('Tokyo Trip');
    expect(s).toContain('Tokyo');
    expect(s).toContain('2026-11-01 → 2026-11-07');
    expect(s).toContain('2 travelers');
    expect(s).toContain('5 itinerary items');
    expect(s).toContain('2 bookings');
    expect(s).toContain('$2,000 booked');
    expect(s).toContain('3 checklist items open');
  });

  it('refuses to summarise a trip with no identity', () => {
    expect(tripSentence({ detail: null })).toBeNull();
    expect(tripSentence({ detail: { trip: { id: '', name: '' } } })).toBeNull();
    expect(tripBody({ detail: null })).toBe('');
    expect(tripReportDtuCall({ detail: null })).toBeNull();
  });

  it('says so when the trip has no details, instead of inventing figures', () => {
    const bare: TripFacts = { detail: { trip: { id: 'trip_2', name: 'Empty Trip' } } };
    expect(tripSentence(bare)).toContain('no details yet');
  });

  it('builds a private trip-report DTU carrying the same numbers', () => {
    const call = tripReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('travel-lens:trip-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'travel_trip_report',
      tripId: 'trip_001',
      tripName: 'Tokyo Trip',
      destination: 'Tokyo',
      travelers: 2,
      durationDays: 7,
      itineraryCount: 5,
      bookingCount: 2,
      bookedCost: 2000,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(tripThreadDraftCall(facts, '')).toBeNull();
    expect(tripThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = tripThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('No flight was booked');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(tripThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });
    expect(tripThreadDraftOutcome({ ok: false }, 'dtu_abc123')).toBeNull();
    expect(tripThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(tripThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexTripDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexTripDrafts(null)).toEqual({});
  });

  it('body names the source and says no flight was booked', () => {
    const body = tripBody(facts);
    expect(body).toContain('Every figure here came from the Travel domain');
    expect(body).toContain('No flight was booked');
    expect(body).toContain('Nothing was published by saving this');
  });
});