'use client';

import { LinerNotesApp } from '@/components/music/liner/LinerNotesApp';
import { SignedOutMusicBrowse } from '@/components/public/SignedOutMusicBrowse';
import { useAnonBrowse } from '@/lib/anon-browse';

/** /lenses/music: Liner Notes for members, the read-only public catalog for a signed-out visitor. */
export function MusicLensEntry() {
  const anon = useAnonBrowse();
  return anon ? <SignedOutMusicBrowse /> : <LinerNotesApp />;
}

export default MusicLensEntry;
