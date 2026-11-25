'use client';

/**
 * The screening room. A version is a real cut: a piece of uploaded footage
 * (an export) or a sequence played as cut. Notes are pinned to the exact
 * timecode the reviewer was watching; clicking one jumps the picture there.
 * Screenings put the same version in front of other people by code.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clapperboard, MessageSquarePlus, Users } from 'lucide-react';
import { ProgramMonitor, type MonitorHandle } from './ProgramMonitor';
import { PartyRoom } from './PartyRoom';
import { fs, tc, type Footage } from './fo';

interface Version { id: string; label: string; stage: string; status?: string; mediaId: string | null; sequenceId: string | null; streamUrl: string | null; noteCount: number; openNotes: number; createdAt: string }
interface Note { id: string; timecodeSec: number; body: string; author: string; resolved: boolean }
interface Party { id: string; title: string; code: string; versionId: string | null; releaseId?: string | null; isHost: boolean; participants?: string[] }
interface Sequence { id: string; name: string }

const STAGES: [string, string][] = [['assembly', 'Assembly'], ['rough_cut', 'Rough cut'], ['fine_cut', 'Fine cut'], ['picture_lock', 'Picture lock'], ['final', 'Final']];
const stageLabel = (s: string) => STAGES.find(([k]) => k === s)?.[1] || s;

export function ScreeningRoom({ projectId }: { projectId: string }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [footage, setFootage] = useState<Footage[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', source: '', stage: 'rough_cut' });
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [v, m, q, p] = await Promise.all([
      fs<{ versions: Version[] }>('version-list', { projectId }),
      fs<{ media: Footage[] }>('media-list', { projectId }),
      fs<{ sequences: Sequence[] }>('sequence-list', { projectId }),
      fs<{ parties: Party[] }>('party-list', { projectId, includeJoined: true }),
    ]);
    if (!v.ok) { setErr(v.error); setVersions([]); return; }
    setVersions(v.result?.versions || []);
    setFootage((m.result?.media || []).filter((f) => f.streamUrl && f.kind === 'video'));
    setSequences(q.result?.sequences || []);
    setParties(p.result?.parties || []);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setErr(null);
    const label = form.label.trim();
    if (!label) { setErr('Name the version (for example “Rough cut 2”).'); return; }
    if (!form.source) { setErr('Choose what this version is: an uploaded export or a sequence.'); return; }
    const [kind, id] = form.source.split(':');
    const r = await fs<{ version: Version }>('version-create', { projectId, label, stage: form.stage, ...(kind === 'm' ? { mediaId: id } : { sequenceId: id }) });
    if (!r.ok) { setErr(r.error); return; }
    setForm({ label: '', source: '', stage: form.stage });
    await load();
    setOpenId(r.result?.version.id || null);
  };

  const join = async () => {
    setErr(null);
    const r = await fs<{ party: Party }>('party-join', { code: code.trim() });
    if (!r.ok) { setErr(r.error); return; }
    setCode('');
    await load();
    setPartyId(r.result?.party.id || null);
  };

  if (partyId) return <PartyRoom partyId={partyId} onLeave={() => { setPartyId(null); void load(); }} />;
  const open = versions?.find((v) => v.id === openId) || null;

  return (
    <div className="space-y-5" data-testid="fo-screening-room">
      {err && <p className="fo-error" role="alert">{err}</p>}
      {open ? (
        <VersionViewer version={open} onBack={() => { setOpenId(null); void load(); }} onScreen={async (title) => {
          const r = await fs<{ party: Party }>('party-create', { projectId, title, versionId: open.id });
          if (!r.ok) { setErr(r.error); return; }
          setPartyId(r.result?.party.id || null);
        }} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="fo-sheet p-4" aria-label="Versions">
            <h3 className="fo-slate text-[17px]">Versions</h3>
            {versions === null ? <div className="fo-skeleton mt-3 h-28" /> : versions.length === 0 ? (
              <p className="mt-2 text-[13px] text-[var(--fo-muted)]">No versions yet. Make one from an uploaded export or a sequence, then watch it and leave notes on the picture.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--fo-rule)]" data-testid="fo-versions">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-[var(--fo-paper-2)]" onClick={() => setOpenId(v.id)}>
                      <Clapperboard className="h-4 w-4 shrink-0 text-[var(--fo-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{v.label}</span>
                        <span className="text-[12px] text-[var(--fo-muted)]">{stageLabel(v.stage)} · {v.mediaId ? 'export' : v.sequenceId ? 'sequence' : 'no picture'}</span>
                      </span>
                      <span className="fo-chip">{v.openNotes} open / {v.noteCount} notes</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid gap-2 border-t border-[var(--fo-rule)] pt-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <input className="fo-input" placeholder="Version name" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Version name" data-testid="fo-version-label" />
              <select className="fo-input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Version picture" data-testid="fo-version-source">
                <option value="">Picture from…</option>
                {footage.length > 0 && <optgroup label="Uploaded exports">{footage.map((f) => <option key={f.id} value={`m:${f.id}`}>{f.name}</option>)}</optgroup>}
                {sequences.length > 0 && <optgroup label="Sequences (played as cut)">{sequences.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>}
              </select>
              <select className="fo-input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} aria-label="Stage">
                {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="button" className="fo-btn fo-btn-tape" onClick={() => { void create(); }} data-testid="fo-version-create">Make version</button>
            </div>
          </section>

          <aside className="fo-sheet p-4" aria-label="Screenings">
            <h3 className="fo-slate text-[17px]">Screenings</h3>
            {parties.length === 0 ? <p className="mt-2 text-[13px] text-[var(--fo-muted)]">Open a version and press “Hold a screening” to watch it together. Guests join with the code.</p> : (
              <ul className="mt-2 space-y-1.5">
                {parties.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-center gap-2 rounded border border-[var(--fo-rule)] bg-[var(--fo-input)] px-2.5 py-2 text-left text-[13px] hover:border-[var(--fo-ink)]" onClick={() => setPartyId(p.id)}>
                      <Users className="h-3.5 w-3.5 text-[var(--fo-muted)]" />
                      <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
                      <span className="fo-type text-[12px]">{p.isHost ? p.code : 'guest'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-[var(--fo-rule)] pt-3">
              <label className="fo-label" htmlFor="fo-join-code">Join with a code</label>
              <div className="mt-1 flex gap-2">
                <input id="fo-join-code" className="fo-input fo-type uppercase" placeholder="FILM-…" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void join(); }} data-testid="fo-join-code" />
                <button type="button" className="fo-btn" onClick={() => { void join(); }} disabled={!code.trim()}>Join</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function VersionViewer({ version, onBack, onScreen }: { version: Version; onBack: () => void; onScreen: (title: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const monitor = useRef<MonitorHandle>(null);

  const load = useCallback(async () => {
    const r = await fs<{ notes: Note[] }>('note-list', { versionId: version.id });
    if (r.ok) setNotes(r.result?.notes || []); else setErr(r.error);
  }, [version.id]);
  useEffect(() => { void load(); }, [load]);

  const seek = (sec: number) => {
    if (video.current) { video.current.currentTime = sec; return; }
    monitor.current?.seek(sec);
  };
  const add = async () => {
    const text = body.trim();
    if (!text) return;
    const at = video.current ? video.current.currentTime : now;
    video.current?.pause();
    const r = await fs<{ note: Note }>('note-add', { versionId: version.id, body: text, timecodeSec: at });
    if (!r.ok) { setErr(r.error); return; }
    setBody('');
    await load();
  };
  const resolve = async (n: Note) => {
    setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, resolved: !n.resolved } : x)));
    const r = await fs('note-resolve', { id: n.id, resolved: !n.resolved });
    if (!r.ok) { setErr(r.error); await load(); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="fo-version-viewer">
      <section className="fo-dark p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" className="fo-btn !min-h-[30px] !px-2.5 text-[12px]" onClick={onBack}>All versions</button>
          <h3 className="fo-slate text-[18px] text-[#f5f2e8]">{version.label}</h3>
          <span className="text-[12px] text-[#9b9588]">{stageLabel(version.stage)}</span>
          <button type="button" className="fo-btn ml-auto !min-h-[30px] text-[12px]" onClick={() => onScreen(`${version.label} screening`)} data-testid="fo-hold-screening"><Users className="h-3.5 w-3.5" /> Hold a screening</button>
        </div>
        {version.streamUrl ? (
          <>
            <div className="fo-screen">
              <video ref={video} src={version.streamUrl} controls playsInline onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} data-testid="fo-version-video" />
              <span className="fo-slug">{tc(now)}</span>
            </div>
            {dur > 0 && (
              <div className="relative mt-2 h-3" aria-hidden>
                {notes.map((n) => <span key={n.id} className="fo-note-pin" style={{ left: `${(n.timecodeSec / dur) * 100}%`, opacity: n.resolved ? 0.35 : 1 }} />)}
              </div>
            )}
          </>
        ) : version.sequenceId ? (
          <ProgramMonitor ref={monitor} sequenceId={version.sequenceId} onTime={setNow} pins={notes.map((n) => ({ sec: n.timecodeSec, open: !n.resolved }))} />
        ) : <p className="text-[13px] text-[#9a9a9a]">This version has no picture attached.</p>}
      </section>

      <aside className="fo-sheet flex flex-col p-4" aria-label="Notes">
        <h3 className="fo-slate text-[17px]">Notes</h3>
        {err && <p className="fo-error mt-2" role="alert">{err}</p>}
        <div className="mt-2 flex gap-2">
          <span className="fo-tc mt-2 shrink-0 text-[12px] text-[var(--fo-muted)]">{tc(now)}</span>
          <textarea className="fo-input min-h-[60px]" placeholder="A note at this frame…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(); }} aria-label="Note at the current timecode" data-testid="fo-note-body" />
        </div>
        <button type="button" className="fo-btn fo-btn-tape mt-2 self-end" onClick={() => { void add(); }} disabled={!body.trim()} data-testid="fo-note-add"><MessageSquarePlus className="h-4 w-4" /> Pin note</button>
        {notes.length === 0 ? <p className="mt-3 text-[13px] text-[var(--fo-muted)]">No notes yet. Pause on a frame and write what needs to change.</p> : (
          <ol className="mt-3 space-y-1.5 overflow-y-auto" data-testid="fo-notes">
            {notes.map((n) => (
              <li key={n.id} className={`flex items-start gap-2 rounded border border-[var(--fo-rule)] bg-[var(--fo-input)] p-2 text-[13px] ${n.resolved ? 'opacity-55' : ''}`}>
                <button type="button" className="fo-tc shrink-0 rounded bg-[var(--fo-ink)] px-1.5 py-0.5 text-[11px] text-[var(--fo-paper)]" onClick={() => seek(n.timecodeSec)} aria-label={`Go to ${tc(n.timecodeSec)}`}>{tc(n.timecodeSec)}</button>
                <span className={`min-w-0 flex-1 ${n.resolved ? 'line-through' : ''}`}>{n.body}</span>
                <button type="button" className="shrink-0 rounded p-0.5 text-[var(--fo-muted)] hover:text-[var(--fo-good)]" onClick={() => { void resolve(n); }} aria-label={n.resolved ? 'Reopen note' : 'Mark note done'} aria-pressed={n.resolved}><Check className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
