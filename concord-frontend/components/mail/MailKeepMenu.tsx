'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  dtuReadBackCall,
  dtuReadBackMatches,
  dtuRecordId,
  mailDtuCall,
  sendMailDtuOutcome,
  sendMailDtuToTimelineCall,
  type KeptMail,
} from './mailKeep';

export function MailKeepMenu({ mail }: { mail: KeptMail }) {
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    const call = mailDtuCall(mail);
    if (!call) {
      setNote('Not saved. This mail has no id.');
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
        setNote(`Not saved. ${reason}`);
        return;
      }
      const read = await lensRun(dtuReadBackCall(id));
      if (!dtuReadBackMatches(id, read.data)) {
        setSavedDtuId(null);
        setNote(`Not saved. DTU ${id} could not be read back.`);
        return;
      }
      setSavedDtuId(id);
      setNote(`Saved as private DTU ${id}. Gmail was not used.`);
    } catch (err) {
      setSavedDtuId(null);
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (busy || !savedDtuId) return;
    const call = sendMailDtuToTimelineCall(mail, savedDtuId);
    if (!call) {
      setNote('Not sent. This DTU is not a saved mail message.');
      return;
    }
    setBusy('send');
    setNote(null);
    try {
      const response = await lensRun({ domain: call.domain, name: call.action, input: call.input });
      const outcome = sendMailDtuOutcome(savedDtuId, response.data);
      if (outcome.claimed) setPostId(outcome.postId);
      setNote(outcome.text);
    } catch (err) {
      setNote(`Not sent. ${err instanceof Error ? err.message : 'Request failed.'}`);
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
          {busy === 'save' ? 'Saving mail…' : 'Save this mail as DTU'}
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
