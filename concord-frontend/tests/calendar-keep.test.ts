import { describe, expect, it } from 'vitest';
import {
  calendarDtuCall,
  dtuReadBackMatches,
  eventIdFromResult,
  eventNotSavedSentence,
  eventOnCalendarSentence,
  eventSavedSentence,
  eventUpdatedSentence,
  draftEventInThreadCall,
  draftEventInThreadOutcome,
  sendEventDtuOutcome,
  sendEventDtuToTimelineCall,
} from '@/components/calendar/calendarKeep';

const event = {
  id: 'evt_abc',
  title: 'Standup',
  start: '2026-10-04T17:00:00.000Z',
  end: '2026-10-04T18:00:00.000Z',
  location: 'Room 2',
};

describe('calendar keep', () => {
  it('names a saved event only when the server returned an id', () => {
    expect(eventSavedSentence('evt_abc')).toBe('Event saved. evt_abc. Google Calendar was not used.');
    expect(eventUpdatedSentence('evt_abc')).toBe('Event updated. evt_abc. Google Calendar was not used.');
    expect(eventOnCalendarSentence('evt_abc')).toBe('On your calendar. evt_abc');
    expect(eventSavedSentence('')).toBeNull();
    expect(eventSavedSentence('pending_1')).toBeNull();
    expect(eventNotSavedSentence('title required')).toBe('Not saved. title required. Google Calendar was not used.');
    expect(eventIdFromResult({ ok: true, result: { event: { id: 'evt_abc' } } })).toBe('evt_abc');
    expect(eventIdFromResult({ ok: false, result: null })).toBe('');
  });

  it('builds a private event DTU and a private Timeline cite', () => {
    const dtu = calendarDtuCall(event);
    expect(dtu?.domain).toBe('dtu');
    expect(dtu?.action).toBe('create');
    expect(dtu?.input).toMatchObject({
      source: 'calendar-lens:event',
      meta: { visibility: 'private', createdFrom: 'calendar' },
    });
    expect(String((dtu?.input.human as { summary: string }).summary)).toMatch(/Google Calendar was not used/);
    expect(String((dtu?.input.human as { summary: string }).summary)).toMatch(/evt_abc/);
    const send = sendEventDtuToTimelineCall(event, 'dtu_9');
    expect(send?.input).toMatchObject({ privacy: 'private', citedDtuId: 'dtu_9' });
    expect(String(send?.input.content)).toMatch(/Google Calendar was not updated/);
    expect(sendEventDtuToTimelineCall(event, 'not an id')).toBeNull();
    expect(calendarDtuCall({ ...event, id: '' })).toBeNull();
  });

  it('says sent only when Timeline stored a private post that cites the DTU', () => {
    const ok = sendEventDtuOutcome('dtu_9', {
      ok: true,
      result: { post: { id: 'pst_1', privacy: 'private', citedDtuId: 'dtu_9' } },
    });
    expect(ok.text).toBe('Sent DTU dtu_9 to your Timeline as private post pst_1. Google Calendar was not updated.');
    expect(sendEventDtuOutcome('dtu_9', { ok: false, error: 'refused' }).text).toMatch(/^Not sent/);
    expect(sendEventDtuOutcome('dtu_9', {
      ok: true,
      result: { post: { id: 'pst_2', privacy: 'public', citedDtuId: 'dtu_9' } },
    }).text).toMatch(/was not sent as a private post/);
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'dtu_9' } } })).toBe(true);
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'other' } } })).toBe(false);
  });

  it('drafts in Thread only when the draft cites the saved DTU', () => {
    const call = draftEventInThreadCall(event, 'dtu_9');
    expect(call?.domain).toBe('thread');
    expect(call?.action).toBe('thread-draft');
    expect(call?.input.citedDtuId).toBe('dtu_9');
    expect(String(call?.input.content)).toMatch(/Standup/);
    expect(draftEventInThreadCall(event, 'bad id')).toBeNull();
    const ok = draftEventInThreadOutcome('dtu_9', {
      ok: true,
      result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_9' } },
    });
    expect(ok.claimed).toBe(true);
    expect(ok.text).toMatch(/Drafted in Thread as th_1, citing dtu_9/);
    expect(draftEventInThreadOutcome('dtu_9', {
      ok: true,
      result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'other' } },
    }).claimed).toBe(false);
    expect(draftEventInThreadOutcome('dtu_9', { ok: false, error: 'refused' }).text).toMatch(/^Not drafted/);
  });
});
