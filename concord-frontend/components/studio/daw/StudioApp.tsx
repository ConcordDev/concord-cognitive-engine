'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { DAWProject } from '@/lib/daw/types';
import { loadProject, resolveAudio } from '@/lib/daw/persistence';
import { studioTransport, browserLocalStore } from '@/lib/daw/studio-api';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { showToast } from '@/components/common/Toasts';
import { Opener } from './Opener';
import { StudioEditor, LAST_PROJECT_KEY } from './Editor';

type Open = { project: DAWProject; rev: number; key: number } | null;

export function StudioApp() {
  const [open, setOpen] = useState<Open>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const openProject = useCallback(async (id: string): Promise<boolean> => {
    setOpening(id);
    try {
      const loaded = await loadProject(id, studioTransport, browserLocalStore);
      if (!loaded) { showToast('error', 'That project could not be found.'); return false; }
      const { audio, missing } = await resolveAudio(loaded.project, studioTransport, browserLocalStore);
      const engine = getStudioEngine();
      audio.forEach((a, aid) => engine.setAudio(aid, a));
      if (loaded.recovered) showToast('info', 'Recovered unsaved changes from this device.');
      if (missing.length) showToast('warning', `${missing.length} recording${missing.length > 1 ? 's' : ''} could not be loaded yet (still uploading from another device?).`);
      setOpen({ project: loaded.project, rev: loaded.rev, key: Date.now() });
      return true;
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Could not open the project');
      return false;
    } finally {
      setOpening(null);
    }
  }, []);

  // Reload / crash recovery: reopen the project named in the URL (or the last one this session).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('project');
    if (!id) { setBooting(false); return; }
    void openProject(id).finally(() => setBooting(false));
  }, [openProject]);

  const back = useCallback(() => {
    setOpen(null);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('project');
      window.history.replaceState(window.history.state, '', u.toString());
      localStorage.removeItem(LAST_PROJECT_KEY);
    } catch { /* noop */ }
  }, []);

  if (booting) return <div className="flex h-full items-center justify-center bg-[#0c0c11] text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (open) return <StudioEditor key={open.key} initial={open.project} initialRev={open.rev} onBack={back} />;
  return (
    <Opener
      opening={opening}
      onOpenProject={(id) => void openProject(id)}
      onNew={(p) => { void getStudioEngine().resume(); setOpen({ project: p, rev: 0, key: Date.now() }); }}
    />
  );
}
