'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  calendarDtuCall,
  dtuReadBackCall,
  dtuReadBackMatches,
  dtuRecordId,
  sendEventDtuOutcome,
  sendEventDtuToTimelineCall,
  type KeptEvent,
} from './calendarKeep';

export function CalendarKeepMenu({ event, onSaved }: { event: KeptEvent; onSaved?: (id: string) => void }) {
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    const call = calendarDtuCall(event);
    if (!call) {
      setNote('Not saved. This event has no id. Google Calendar was not used.');
      return;
    }
    setBusy('save');
    setNote(null);
    try {
      const response = await lensRun({
        domain: call.domain,
        name: call.action,
        input: withContentLicense(call.input, 'knowledge', ['private']),
      });
      const id = dtuRecordId(response.data);
      if (!response.data?.ok || !id) {
        setSavedDtuId(null);
        const reason = String(response.data?.error || 'No DTU id returned.').replace(/_/g, ' ');
        setNote(`Not saved. ${reason}. Google Calendar was not used.`);
        return;
      }
      const read = await lensRun(dtuReadBackCall(id));
      if (!dtuReadBackMatches(id, read.data)) {
        setSavedDtuId(null);
        setNote(`Not saved. DTU ${id} could not be read back. Google Calendar was not used.`);
        return;
      }
      setSavedDtuId(id);
      onSaved?.(id);
      setNote(`Saved as private DTU ${id}. Google Calendar was not used.`);
    } catch (err) {
      setSavedDtuId(null);
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Request failed.'} Google Calendar was not used.`);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (busy || !savedDtuId) return;
    const call = sendEventDtuToTimelineCall(event, savedDtuId);
    if (!call) {
      setNote('Not sent. This DTU is not a saved calendar event. Google Calendar was not updated.');
      return;
    }
    setBusy('send');
    setNote(null);
    try {
      const response = await lensRun({ domain: call.domain, name: call.action, input: call.input });
      const outcome = sendEventDtuOutcome(savedDtuId, response.data);
      if (outcome.claimed) setPostId(outcome.postId);
      setNote(outcome.text);
    } catch (err) {
      setNote(`Not sent. ${err instanceof Error ? err.message : 'Request failed.'} Google Calendar was not updated.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void save(); }}
          disabled={busy !== null}
          className="text-[11px] text-teal-300 hover:underline disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving event…' : 'Save this event as DTU'}
        </button>
        {savedDtuId && (
          <button
            type="button"
            onClick={() => { void send(); }}
            disabled={busy !== null}
            className="text-[11px] text-teal-300 hover:underline disabled:opacity-40"
          >
            {busy === 'send' ? 'Sending…' : 'Send this DTU to Timeline'}
          </button>
        )}
        {postId && (
          <Link href="/lenses/timeline?tab=feed" className="text-[11px] text-zinc-300 hover:underline">
            Open Timeline post {postId}
          </Link>
        )}
      </div>
      {note && <p className="text-[11px] text-zinc-300" role="status">{note}</p>}
    </div>
  );
}
