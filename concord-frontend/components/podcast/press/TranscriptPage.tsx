'use client';

/**
 * The Transcript Page — the Podcast lens. A masthead with four sections
 * (Front page · Shows · Library · Your show); an episode opens as a page
 * you can read along with; one press bar plays across all of them. The
 * address (?room=&show=&ep=) is the state, so links, back and reload work.
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { pressFontVars } from './pressFonts';
import { PlayerProvider } from './PressBar';
import { Reader } from './Reader';
import { FrontPage, ShowsRoom } from './Rooms';
import { LibraryRoom } from './Library';
import { StudioRoom } from './Studio';
import { ROOMS, readAddress, writeAddress, type Room } from './pc';
import './press.css';

export function TranscriptPage() {
  const [addr, setAddr] = useState(() => readAddress());
  useEffect(() => {
    const sync = () => setAddr(readAddress());
    window.addEventListener('popstate', sync);
    window.addEventListener('tp:address', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('tp:address', sync); };
  }, []);
  // Opening a page or a room starts at its top.
  useEffect(() => { document.getElementById('tp-top')?.scrollIntoView({ block: 'start' }); }, [addr.room, addr.show, addr.ep]);

  const go = useCallback((room: Room) => writeAddress({ room, show: null, ep: null }), []);
  useLensCommand(
    ROOMS.map((r) => ({ id: `tp-${r.id}`, keys: r.key, description: `Podcasts: ${r.label}`, category: 'navigation' as const, action: () => go(r.id) })),
    { lensId: 'podcast' },
  );

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={cn('tp flex min-h-[calc(100dvh-4.5rem)] flex-col', pressFontVars)} data-testid="tp-app" data-lens="podcast">
      <PlayerProvider>
        <div id="tp-top" className="mx-auto w-full max-w-[1180px] flex-1 px-4 sm:px-8">
          <header className="tp-mast pt-5">
            <div className="flex items-end justify-between gap-4">
              <h1 className="tp-display text-[40px] leading-none sm:text-[56px]">Podcasts</h1>
              <p className="tp-label mb-1 hidden sm:block">{today}</p>
            </div>
            <nav className="mt-3 flex gap-5 overflow-x-auto" aria-label="Sections">
              {ROOMS.map((r) => (
                <button key={r.id} type="button" className="tp-section" aria-current={addr.room === r.id && !addr.ep ? 'page' : undefined} onClick={() => go(r.id)}>
                  {r.label} <kbd className="tp-mono ml-1 hidden text-[10px] text-[color:var(--tp-faint)] sm:inline">{r.key}</kbd>
                </button>
              ))}
            </nav>
          </header>
          <main className="py-8">
            {addr.ep ? <Reader key={addr.ep} episodeId={addr.ep} />
              : addr.room === 'shows' ? <ShowsRoom showId={addr.show} />
              : addr.room === 'library' ? <LibraryRoom />
              : addr.room === 'studio' ? <StudioRoom />
              : <FrontPage />}
          </main>
        </div>
      <LensAgentFab lensId="podcast" lensPrompt="You're inside Concord's Podcast lens, the Transcript Page: episodes read like magazine features with the transcript following the audio. Listeners follow shows, queue and keep episodes, tip creators and buy supporter passes; creators publish episodes, upload WebVTT/SRT transcripts and get a public RSS feed for Apple Podcasts and Spotify. Help with finding shows, listening and making a show." />
      </PlayerProvider>
    </div>
  );
}

/** The lens entry. */
export default function PodcastLens() {
  useLensNav('podcast');
  return <TranscriptPage />;
}
