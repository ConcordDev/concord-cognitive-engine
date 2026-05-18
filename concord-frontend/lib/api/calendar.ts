/**
 * Calendar lens — typed macro helper. Wraps POST /api/lens/run so
 * callers get the unwrapped envelope directly.
 */

import { api } from '@/lib/api/client';

export async function callCalendarMacro<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T & { ok?: boolean; reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'calendar', name, input });
  const env = (r?.data ?? {}) as { ok?: boolean; result?: T };
  const inner = (env.result ?? env) as T & { ok?: boolean; reason?: string };
  return inner;
}

export interface Calendar {
  id: string;
  owner_id: string;
  name: string;
  kind: string;
  color?: string;
  icon?: string;
  visibility: string;
  enabled: number;
  project_id?: string | null;
  source_kind?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  organizer_id: string;
  title: string;
  description_html?: string | null;
  location?: string | null;
  start_at: number;
  end_at: number;
  all_day: number;
  timezone?: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled';
  visibility: string;
  category?: string | null;
  color?: string | null;
  rrule?: string | null;
  conferencing_url?: string | null;
  external_uid?: string | null;
  recurring_parent_id?: string | null;
  is_recurring_instance?: boolean;
  instance_id?: string;
  original_start_at?: number;
  attendees?: Attendee[];
  reminders?: Reminder[];
  created_at: number;
  updated_at: number;
}

export interface Attendee {
  event_id: string;
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  role: 'organizer' | 'required' | 'optional' | 'resource';
  rsvp: 'needs_action' | 'accepted' | 'declined' | 'tentative';
  responded_at?: number | null;
  invited_at: number;
}

export interface Reminder {
  id: number;
  event_id: string;
  user_id: string;
  minutes_before: number;
  method: 'push' | 'email' | 'in_app';
  fire_at?: number | null;
  fired_at?: number | null;
}
