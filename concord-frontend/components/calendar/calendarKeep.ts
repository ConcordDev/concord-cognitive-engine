/**
 * A Concord calendar event can be saved as a private DTU and cited on the
 * author's private Timeline. Google Calendar is a separate connector and
 * is never described as updated by this path.
 */

export interface KeptEvent {
  id: string;
  title: string;
  start?: string;
  end?: string;
  location?: string;
}

export interface CalendarKeepCall {
  domain: string;
  action: string;
  input: Record<string, unknown>;
}

const DTU_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

function cleanId(id: string | null | undefined): string {
  const value = String(id || '').trim();
  if (!value || value.startsWith('pending_')) return '';
  return value;
}

/** Sentence for a create the server already accepted. */
export function eventSavedSentence(id: string | null | undefined): string | null {
  const value = cleanId(id);
  if (!value) return null;
  return `Event saved. ${value}. Google Calendar was not used.`;
}

/** Sentence for an update the server already accepted. */
export function eventUpdatedSentence(id: string | null | undefined): string | null {
  const value = cleanId(id);
  if (!value) return null;
  return `Event updated. ${value}. Google Calendar was not used.`;
}

/** Sentence for an event the calendar list already returned. */
export function eventOnCalendarSentence(id: string | null | undefined): string | null {
  const value = cleanId(id);
  if (!value) return null;
  return `On your calendar. ${value}`;
}

export function eventNotSavedSentence(reason: string): string {
  const clean = String(reason || 'The server refused this.').replace(/_/g, ' ');
  return `Not saved. ${clean}. Google Calendar was not used.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function payloadOf(data: { result?: unknown }): Record<string, unknown> | null {
  let node = asRecord(data.result);
  if (!node) return null;
  const inner = asRecord(node.result);
  if (inner && ('dtu' in inner || 'post' in inner || 'event' in inner || 'id' in inner)) node = inner;
  return node;
}

export function eventIdFromResult(data: { ok?: boolean; result?: unknown }): string {
  if (data.ok === false) return '';
  const payload = payloadOf(data);
  const event = asRecord(payload?.event);
  return cleanId(String(event?.id || ''));
}

export function eventBody(event: KeptEvent): string {
  return [
    `Event ${event.id}.`,
    `Title: ${event.title}`,
    `Start: ${event.start || 'unspecified'}`,
    `End: ${event.end || 'unspecified'}`,
    event.location ? `Location: ${event.location}` : '',
    '',
    'This is a Concord calendar event. Google Calendar was not used.',
  ].filter((line) => line !== '').join('\n');
}

export function calendarDtuCall(event: KeptEvent): CalendarKeepCall | null {
  const id = cleanId(event?.id);
  const title = String(event?.title || '').trim();
  if (!id || !title) return null;
  const body = eventBody({ ...event, id, title });
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: title.slice(0, 80),
      tags: ['calendar', 'event'],
      source: 'calendar-lens:event',
      human: { summary: body.slice(0, 8000) },
      core: {
        definitions: [`Concord calendar event ${id}.`],
        claims: [body.slice(0, 240)],
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'calendar',
        event: {
          id,
          title,
          start: event.start || '',
          end: event.end || '',
          location: event.location || '',
        },
      },
    },
  };
}

export function dtuRecordId(data: { ok?: boolean; result?: unknown }): string {
  if (data.ok === false) return '';
  const payload = payloadOf(data);
  if (!payload) return '';
  const dtu = asRecord(payload.dtu);
  return String(dtu?.id || payload.id || '');
}

export function dtuReadBackMatches(id: string, data: { ok?: boolean; result?: unknown }): boolean {
  return Boolean(id) && dtuRecordId(data) === id;
}

export function dtuReadBackCall(id: string): CalendarKeepCall {
  return { domain: 'dtu', action: 'get', input: { id } };
}

export function sendEventDtuToTimelineCall(event: KeptEvent, dtuId: string): CalendarKeepCall | null {
  const id = dtuId.trim();
  const eventId = cleanId(event?.id);
  if (!DTU_ID.test(id) || !eventId) return null;
  const content = [
    `Event ${eventId}.`,
    `Title: ${String(event.title || '').slice(0, 120)}`,
    `From DTU ${id}.`,
    'Concord calendar event. Google Calendar was not updated.',
  ].join('\n').slice(0, 5000);
  return {
    domain: 'timeline',
    action: 'post-create',
    input: { content, privacy: 'private', media: [], citedDtuId: id },
  };
}

export function sendEventDtuOutcome(
  dtuId: string,
  data: { ok?: boolean; result?: unknown; error?: string | null },
): { claimed: boolean; text: string; postId: string } {
  if (data.ok === false) {
    return { claimed: false, postId: '', text: `Not sent. ${data.error || 'The server refused this.'} Google Calendar was not updated.` };
  }
  const payload = payloadOf(data);
  const post = asRecord(payload?.post);
  const postId = String(post?.id || '');
  const privacy = String(post?.privacy || '');
  const cited = String(post?.citedDtuId || '');
  if (!postId) return { claimed: false, postId: '', text: 'Not sent. Timeline returned no post id. Google Calendar was not updated.' };
  if (privacy !== 'private') {
    return { claimed: false, postId, text: `Timeline stored post ${postId} as ${privacy || 'unknown'}. DTU ${dtuId} was not sent as a private post. Google Calendar was not updated.` };
  }
  if (cited !== dtuId) {
    return { claimed: false, postId, text: `Timeline stored private post ${postId} without DTU ${dtuId}. Google Calendar was not updated.` };
  }
  return {
    claimed: true,
    postId,
    text: `Sent DTU ${dtuId} to your Timeline as private post ${postId}. Google Calendar was not updated.`,
  };
}
