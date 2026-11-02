'use client';

import { MusicWorkspace } from '@/components/music/MusicWorkspace';
import { SignedOutMusicBrowse } from '@/components/public/SignedOutMusicBrowse';
import { useAnonBrowse } from '@/lib/anon-browse';

/** /lenses/music: the full workspace for members, the read-only public catalog for a signed-out visitor. */
export function MusicLensEntry() {
  const anon = useAnonBrowse();
  return anon ? <SignedOutMusicBrowse /> : <MusicWorkspace />;
}

export default MusicLensEntry;
