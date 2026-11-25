'use client';

/**
 * The cinema: released films. One-sheets on the wall; a film's page has its
 * poster, logline, credits and the picture. Free films play in full. A priced
 * film plays its preview until you buy it (the stream enforces the cut-off);
 * once it is yours it plays in full and you can hold a screening of it.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ticket, Users } from 'lucide-react';
import { PartyRoom } from './PartyRoom';
import { cc, fs, runtime, type Release } from './fo';

type Shelf = 'showing' | 'library';

export function Cinema({ initialId, onConsumedInitial }: { initialId?: string | null; onConsumedInitial?: () => void }) {
  const [shelf, setShelf] = useState<Shelf>('showing');
  const [films, setFilms] = useState<Release[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId || null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => { if (initialId) { setOpenId(initialId); onConsumedInitial?.(); } }, [initialId, onConsumedInitial]);

  const load = useCallback(async () => {
    setErr(null);
    const r = await fs<{ releases: Release[] }>('film-release-list', shelf === 'library' ? { owned: true } : {});
    if (!r.ok) { setErr(r.error); setFilms([]); return; }
    setFilms(r.result?.releases || []);
  }, [shelf]);
  useEffect(() => { void load(); }, [load]);

  const join = async () => {
    setErr(null);
    const r = await fs<{ party: { id: string } }>('party-join', { code: code.trim() });
    if (!r.ok) { setErr(r.error); return; }
    setCode('');
    setPartyId(r.result?.party.id || null);
  };

  if (partyId) return <PartyRoom partyId={partyId} onLeave={() => setPartyId(null)} />;
  if (openId) return <FilmPage id={openId} onBack={() => { setOpenId(null); void load(); }} onScreen={setPartyId} />;

  return (
    <div className="space-y-4" data-testid="fo-cinema">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="fo-chip !border-[#55575c] !text-[#e9e4d6]" aria-pressed={shelf === 'showing'} onClick={() => setShelf('showing')}>Now showing</button>
        <button type="button" className="fo-chip !border-[#55575c] !text-[#e9e4d6]" aria-pressed={shelf === 'library'} onClick={() => setShelf('library')}>My films</button>
        <div className="ml-auto flex items-center gap-2">
          <input className="fo-input fo-type !w-40 uppercase" placeholder="FILM-…" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void join(); }} aria-label="Screening code" />
          <button type="button" className="fo-btn !border-[#e9e4d6] !text-[#e9e4d6]" onClick={() => { void join(); }} disabled={!code.trim()}>Join a screening</button>
        </div>
      </div>
      {err && <p className="fo-error" role="alert">{err}</p>}
      {films === null ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="aspect-[27/40] rounded bg-[#2b2c30]" />)}</div>
      ) : films.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-[#a9a49a]">{shelf === 'library' ? 'Films you buy or are given appear here.' : 'No films are showing yet. Release one from a production’s Release room.'}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="fo-films">
          {films.map((f) => (
            <li key={f.id}>
              <button type="button" className="fo-onesheet fo-rise block w-full text-left transition-transform hover:-translate-y-0.5" onClick={() => setOpenId(f.id)} aria-label={`${f.title}, ${f.priceCC > 0 ? cc(f.priceCC) : 'free'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {f.poster ? <img src={f.poster} alt="" loading="lazy" /> : <span className="fo-slate absolute inset-0 flex items-center justify-center p-3 text-center text-[20px] text-[#d8d1bf]">{f.title}</span>}
                <span className="fo-onesheet-title block">
                  <span className="fo-slate block text-[15px] leading-tight">{f.title}</span>
                  <span className="text-[11.5px] text-[#d9d4c8]">{f.filmmaker.name} · {f.owned || f.filmmaker.isMe ? 'yours' : f.priceCC > 0 ? cc(f.priceCC) : 'free'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilmPage({ id, onBack, onScreen }: { id: string; onBack: () => void; onScreen: (partyId: string) => void }) {
  const [film, setFilm] = useState<Release | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bought, setBought] = useState(false);
  const [previewEnded, setPreviewEnded] = useState(false);

  const load = useCallback(async () => {
    const r = await fs<{ release: Release }>('film-release-get', { id });
    if (!r.ok) { setErr(r.error); return; }
    setFilm(r.result!.release);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const buy = async () => {
    if (!film) return;
    setBusy(true); setErr(null);
    const r = await fs('film-release-buy', { id: film.id });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setBought(true);
    await load();
  };
  const screen = async () => {
    if (!film) return;
    setErr(null);
    const r = await fs<{ party: { id: string } }>('film-release-party', { id: film.id });
    if (!r.ok) { setErr(r.error); return; }
    onScreen(r.result!.party.id);
  };

  if (!film) return (
    <div>
      <button type="button" className="fo-btn !border-[#e9e4d6] !text-[#e9e4d6]" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Cinema</button>
      {err ? <p className="fo-error mt-4" role="alert">{err}</p> : <div className="mt-4 h-64 rounded bg-[#1d1e21]" role="status" aria-label="Loading the film" />}
    </div>
  );
  const preview = !film.canWatchFull && film.priceCC > 0;

  return (
    <article className="space-y-5 text-[#e9e4d6]" data-testid="fo-film-page">
      <button type="button" className="fo-btn !border-[#e9e4d6] !text-[#e9e4d6]" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Cinema</button>
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="fo-onesheet">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {film.poster ? <img src={film.poster} alt={`${film.title} poster`} /> : <span className="fo-slate absolute inset-0 flex items-center justify-center p-3 text-center text-[24px] text-[#d8d1bf]">{film.title}</span>}
        </div>
        <div className="min-w-0 space-y-3">
          <h2 className="fo-slate text-[34px] leading-none text-[#f5f2e8]">{film.title}</h2>
          <p className="text-[13px] text-[#a9a49a]">A film by {film.filmmaker.isMe ? 'you' : film.filmmaker.name} · {runtime(film.runtimeSec)}{film.status !== 'published' ? ' · withdrawn' : ''}</p>
          {film.logline && <p className="max-w-[60ch] text-[15px] leading-relaxed">{film.logline}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {preview && film.status === 'published' && (
              <button type="button" className="fo-btn fo-btn-tape" onClick={() => { void buy(); }} disabled={busy} data-testid="fo-film-buy"><Ticket className="h-4 w-4" /> {busy ? 'Buying…' : `Buy · ${cc(film.priceCC)}`}</button>
            )}
            {film.canWatchFull && <button type="button" className="fo-btn !border-[#e9e4d6] !text-[#e9e4d6]" onClick={() => { void screen(); }} data-testid="fo-film-screen"><Users className="h-4 w-4" /> Hold a screening</button>}
            {film.owned && <span className="fo-chip !border-[#5be3a5] !text-[#b7f0d2]">{bought ? 'Bought. It’s yours.' : 'In your library'}</span>}
            {film.filmmaker.isMe && film.buyers != null && film.priceCC > 0 && <span className="text-[12px] text-[#a9a49a]">{film.buyers} bought</span>}
          </div>
          {err && <p className="fo-error" role="alert">{err}</p>}
        </div>
      </div>

      <section className="fo-dark p-3" aria-label="The film">
        <div className="fo-screen">
          <video key={`${film.id}:${film.canWatchFull}`} src={film.streamUrl} controls playsInline preload="metadata" data-testid="fo-film-video"
            onTimeUpdate={(e) => {
              // The server only sends the preview's bytes; stop cleanly at its end
              // instead of letting the player stall where the bytes run out.
              const v = e.currentTarget;
              if (preview && film.previewSec && v.currentTime >= film.previewSec) { v.pause(); v.currentTime = film.previewSec; setPreviewEnded(true); }
            }} />
          {preview && <span className="fo-slug">Preview · first {film.previewSec} s</span>}
          {preview && previewEnded && film.status === 'published' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-center" data-testid="fo-preview-ended">
              <p className="fo-slate text-[22px] text-[#f5f2e8]">That&rsquo;s the preview.</p>
              <button type="button" className="fo-btn fo-btn-tape" onClick={() => { void buy(); }} disabled={busy}><Ticket className="h-4 w-4" /> Watch all {runtime(film.runtimeSec)} · {cc(film.priceCC)}</button>
            </div>
          )}
        </div>
        {preview && <p className="mt-2 text-[12.5px] text-[#a9a49a]">You&rsquo;re watching the first {film.previewSec} seconds. Buy it to watch all {runtime(film.runtimeSec)}.</p>}
      </section>

      {(film.credits.cast.length > 0 || film.credits.crew.length > 0) && (
        <section aria-label="Credits" className="grid gap-6 sm:grid-cols-2">
          {film.credits.cast.length > 0 && <Credits title="Cast" rows={film.credits.cast} />}
          {film.credits.crew.length > 0 && <Credits title="Crew" rows={film.credits.crew} />}
        </section>
      )}
    </article>
  );
}

function Credits({ title, rows }: { title: string; rows: { name: string; role: string | null }[] }) {
  return (
    <div>
      <h3 className="fo-label !text-[#9b9588]">{title}</h3>
      <dl className="mt-2 grid grid-cols-[1fr_1fr] gap-x-4 gap-y-1 text-[13.5px]">
        {rows.map((r, i) => (
          <div key={i} className="contents"><dt className="text-right text-[#a9a49a]">{r.role || '—'}</dt><dd>{r.name}</dd></div>
        ))}
      </dl>
    </div>
  );
}
