'use client';

/**
 * A screening. Everyone watches the same file. The host's play, pause and
 * seek are sent to the server (party-sync); guests read the server's position
 * every two seconds and follow it, correcting when they drift more than a
 * second and a half. Chat is signed by the signed-in person.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, LogOut, Send } from 'lucide-react';
import { fs, tc } from './fo';

interface PartyState { id: string; title: string; code: string; playing: boolean; positionSec: number; participantCount: number; isHost: boolean; streamUrl: string | null; releaseId: string | null }
interface Message { id: string; author: string; authorId?: string; text: string; atSec: number; createdAt?: string }

export function PartyRoom({ partyId, onLeave }: { partyId: string; onLeave: () => void }) {
  const [st, setSt] = useState<PartyState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const applying = useRef(false);

  const poll = useCallback(async () => {
    const r = await fs<{ party: PartyState }>('party-state', { id: partyId });
    if (!r.ok) { setErr(r.error); return; }
    const p = r.result!.party;
    setSt(p);
    const v = video.current;
    if (!v || p.isHost || !p.streamUrl) return;
    applying.current = true;
    if (Math.abs(v.currentTime - p.positionSec) > 1.5) v.currentTime = p.positionSec;
    if (p.playing && v.paused) void v.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    if (!p.playing && !v.paused) v.pause();
    setTimeout(() => { applying.current = false; }, 50);
  }, [partyId]);
  const loadChat = useCallback(async () => {
    const r = await fs<{ messages: Message[] }>('party-chat-list', { id: partyId });
    if (r.ok) setMsgs(r.result?.messages || []);
  }, [partyId]);

  useEffect(() => {
    void poll(); void loadChat();
    const a = setInterval(() => { void poll(); }, 2000);
    const b = setInterval(() => { void loadChat(); }, 3000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [poll, loadChat]);

  const send = async (playing: boolean) => {
    const v = video.current;
    if (!st?.isHost || !v || applying.current) return;
    const r = await fs('party-sync', { id: partyId, playing, positionSec: Math.round(v.currentTime * 100) / 100 });
    if (!r.ok) setErr(r.error);
  };
  const post = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const r = await fs('party-chat-post', { id: partyId, text: t, atSec: video.current?.currentTime || 0 });
    if (!r.ok) { setErr(r.error); setText(t); return; }
    void loadChat();
  };
  const copy = async () => {
    if (!st) return;
    try { await navigator.clipboard.writeText(st.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="fo-party-room">
      <section className="fo-dark p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" className="fo-btn !min-h-[30px] !px-2.5 text-[12px]" onClick={onLeave}><LogOut className="h-3.5 w-3.5" /> Leave</button>
          <h3 className="fo-slate text-[18px] text-[#f5f2e8]">{st?.title || 'Screening'}</h3>
          {st && <span className="text-[12px] text-[#9b9588]">{st.participantCount} watching · {st.isHost ? 'you are the host' : 'the host controls playback'}</span>}
          {st?.isHost && (
            <button type="button" className="fo-btn ml-auto !min-h-[30px] text-[12px]" onClick={() => { void copy(); }} data-testid="fo-party-code">
              <Copy className="h-3.5 w-3.5" /> <span className="fo-type">{st.code}</span> {copied ? '· copied' : ''}
            </button>
          )}
        </div>
        {err && <p className="fo-error mb-2" role="alert">{err}</p>}
        {!st ? <div className="fo-screen" role="status" aria-label="Joining the screening" /> : st.streamUrl ? (
          <div className="fo-screen">
            <video ref={video} src={st.streamUrl} playsInline controls={st.isHost}
              onPlay={() => { void send(true); }} onPause={() => { void send(false); }} onSeeked={() => { if (video.current && !video.current.paused) void send(true); else void send(false); }}
              data-testid="fo-party-video" />
            {!st.isHost && blocked && (
              <button type="button" className="absolute inset-0 m-auto h-12 w-56 rounded bg-[var(--fo-tape)] text-[14px] font-bold text-white" onClick={() => { void video.current?.play().then(() => setBlocked(false)).catch(() => {}); }}>
                Tap to join the picture
              </button>
            )}
            <span className="fo-slug">{st.playing ? 'Playing' : 'Paused'} · {tc(st.positionSec)}</span>
          </div>
        ) : <p className="text-[13px] text-[#9a9a9a]">This screening has no picture you can play.</p>}
      </section>

      <aside className="fo-sheet flex max-h-[520px] flex-col p-4" aria-label="Screening chat">
        <h3 className="fo-slate text-[17px]">In the room</h3>
        <ol className="mt-2 flex-1 space-y-1.5 overflow-y-auto" data-testid="fo-party-chat">
          {msgs.length === 0 && <li className="text-[13px] text-[var(--fo-muted)]">No messages yet.</li>}
          {msgs.map((m) => (
            <li key={m.id} className="text-[13px]">
              <span className="fo-tc mr-1.5 text-[11px] text-[var(--fo-faint)]">{tc(m.atSec)}</span>
              <span className="font-semibold">{m.author}</span> <span className="text-[var(--fo-ink-2)]">{m.text}</span>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex gap-2">
          <input className="fo-input" placeholder="Say something" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void post(); }} aria-label="Message the room" data-testid="fo-party-message" />
          <button type="button" className="fo-btn" onClick={() => { void post(); }} disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
        </div>
      </aside>
    </div>
  );
}
