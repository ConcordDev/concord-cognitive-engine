/**
 * /book/[slug] — public Calendly-style booking page.
 *
 * Read-only fetch of the link metadata + available slots; on confirm,
 * sends booking_link_book to create the event + attendee. Backed by
 * calendar-moats macros (Sprint C).
 */

'use client';

import { useEffect, useState, useCallback, useMemo, use } from 'react';
import { Loader2, Check, Calendar as CalendarIcon } from 'lucide-react';

interface Link { id: string; slug: string; title: string; description?: string | null; duration_minutes: number; }
interface Slot { startAt: number; endAt: number; }

interface PageProps { params: Promise<{ slug: string }>; }

export default function BookingPage({ params }: PageProps) {
  const { slug } = use(params);
  const [link, setLink] = useState<Link | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<{ eventId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'calendar', name: 'booking_link_get', input: { slug } }),
        });
        const j = await r.json();
        const inner = j?.result || j;
        if (inner?.link) setLink(inner.link);
        else setError(inner?.reason || 'not_found');
      } catch (e: unknown) { setError((e as Error)?.message || 'load_failed'); }
    })();
  }, [slug]);

  useEffect(() => {
    if (!link) return;
    (async () => {
      const r = await fetch('/api/lens/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'calendar', name: 'booking_link_slots', input: { slug } }),
      });
      const j = await r.json();
      const inner = j?.result || j;
      setSlots(inner?.slots || []);
    })();
  }, [link, slug]);

  const slotsByDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const d = new Date(s.startAt * 1000).toISOString().slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(s);
    }
    return m;
  }, [slots]);

  const confirm = useCallback(async () => {
    if (!activeSlot || !email.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'calendar', name: 'booking_link_book',
          input: { slug, startAt: activeSlot.startAt, guestName: name, guestEmail: email, message },
        }),
      });
      const j = await r.json();
      const inner = j?.result || j;
      if (inner?.ok) setConfirmed({ eventId: inner.eventId });
      else setError(inner?.reason || 'book_failed');
    } finally { setBusy(false); }
  }, [activeSlot, name, email, message, slug]);

  if (error) return <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center"><div className="text-white/60">{error === 'not_found' ? 'Booking link not found' : `Error: ${error}`}</div></main>;
  if (!link) return <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></main>;

  if (confirmed) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-semibold">Booked!</h1>
          <p className="text-white/70">Your {link.duration_minutes}-min {link.title} is confirmed.</p>
          <p className="text-xs text-white/40 font-mono break-all">{confirmed.eventId}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-6">
        <div className="flex items-center gap-3">
          <CalendarIcon className="w-8 h-8 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-semibold">{link.title}</h1>
            <p className="text-sm text-white/60">{link.duration_minutes} minutes</p>
          </div>
        </div>
        {link.description && <p className="text-white/80">{link.description}</p>}

        <div>
          <h2 className="text-sm uppercase tracking-wide text-white/40 mb-3">Pick a time</h2>
          {slotsByDay.size === 0 ? (
            <div className="text-white/40 text-sm">No slots available in the booking window.</div>
          ) : (
            <div className="space-y-4">
              {Array.from(slotsByDay.entries()).slice(0, 14).map(([day, daySlots]) => (
                <div key={day}>
                  <div className="text-xs text-white/40 mb-1">{new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                  <div className="flex flex-wrap gap-1">
                    {daySlots.slice(0, 12).map((s) => (
                      <button
                        key={s.startAt}
                        onClick={() => setActiveSlot(s)}
                        className={`px-3 py-1.5 text-sm rounded border ${
                          activeSlot?.startAt === s.startAt
                            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                            : 'border-white/10 hover:border-white/30 text-white/80'
                        }`}
                      >
                        {new Date(s.startAt * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {activeSlot && (
          <div className="border border-cyan-500/30 rounded-lg p-4 space-y-3 bg-cyan-500/5">
            <h3 className="text-sm font-semibold">Confirm {new Date(activeSlot.startAt * 1000).toLocaleString()}</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded text-white" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" type="email" className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded text-white" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Anything to share?" className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded text-white resize-none" />
            <button onClick={confirm} disabled={busy || !email.trim()} className="w-full py-2 rounded bg-cyan-500/30 hover:bg-cyan-500/40 text-cyan-100 font-medium disabled:opacity-40 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Confirm booking
            </button>
          </div>
        )}
        <footer className="text-xs text-white/40 pt-6 border-t border-white/10">
          Powered by Concord — <a href="/lenses/calendar" className="hover:text-cyan-400">make your own</a>
        </footer>
      </div>
    </main>
  );
}
