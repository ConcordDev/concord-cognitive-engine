'use client';

/**
 * Music north star — what is actually in the library. Pull feed is the
 * only way an empty library fills. The desks stay under More.
 */

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { StudioFamilyPill } from '@/components/studio/StudioFamilyChrome';
import { MusicWorkspace } from '@/components/music/MusicWorkspace';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export function MusicNorthStar() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const tracks = useLensData('music', 'track', { noSeed: true });
  const playlists = useLensData('music', 'playlist', { noSeed: true });
  const [desk, setDesk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const pull = async () => {
    setBusy(true);
    setNote('');
    const r = await lensRun('music', 'feed', {});
    if (r.data?.ok) {
      const result = r.data.result as { ingested?: number; source?: string } | null;
      const n = result?.ingested;
      setNote(typeof n === 'number'
        ? `Ingested ${n} from ${result?.source || 'the feed'}.`
        : 'Feed returned.');
      await tracks.refetch();
      await playlists.refetch();
    } else {
      setNote(r.data?.error || 'Feed unavailable.');
    }
    setBusy(false);
  };

  if (desk) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-black">
        <div className="px-6 pt-4">
          <button type="button" onClick={() => setDesk(false)} className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
            Music
          </button>
        </div>
        <MusicWorkspace />
      </div>
    );
  }

  const trackCount = tracks.items.length;
  const playlistCount = playlists.items.length;
  const empty = trackCount === 0 && playlistCount === 0;

  return (
    <LensShell lensId="music" asMain={false} disableAgentFab>
      <div data-lens-theme="music" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Music" title={who ? `What are we hearing, ${who}` : 'What are we hearing'} />
            <StudioFamilyPill active="music" />
          </div>
          <QuietMore items={[{ id: 'library', label: 'Library desks' }]} onPick={() => setDesk(true)} />
        </div>

        <section className="mt-8 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <p className="text-[15px] text-zinc-200">{empty ? 'Library is empty' : 'In the library'}</p>
          <p className="mt-2 text-[13px] text-zinc-500">
            {trackCount} tracks · {playlistCount} playlists. Pull a feed when you want one.
          </p>
          {!empty && (
            <ul className="mt-4 space-y-1">
              {tracks.items.slice(0, 12).map((item) => (
                <li key={item.id} className="text-[14px] text-zinc-300">{item.title || 'Untitled track'}</li>
              ))}
              {playlists.items.slice(0, 8).map((item) => (
                <li key={item.id} className="text-[14px] text-zinc-400">{item.title || 'Untitled playlist'}</li>
              ))}
            </ul>
          )}
          {note && <p role="status" className="mt-3 text-[13px] text-zinc-400">{note}</p>}
        </section>

        <button type="button" className={northCtaClass} disabled={busy} onClick={() => { void pull(); }}>
          {busy ? 'Pulling…' : 'Pull feed'}
        </button>
      </div>
    </LensShell>
  );
}
