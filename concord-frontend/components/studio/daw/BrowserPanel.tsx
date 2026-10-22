'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Piano, Drum, Music2, FolderOpen, Search, Upload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject } from '@/lib/daw/types';
import { instrumentOptions } from '@/lib/daw/presets';
import { MUSIC_FILE_ACCEPT } from '@/lib/daw/music-filter';
import { browseMusicLibrary, type LibraryItem } from '@/lib/daw/studio-api';

type Tab = 'instruments' | 'sounds' | 'files';

export interface BrowserPayload {
  type: 'instrument' | 'library';
  instrumentId?: string;
  item?: LibraryItem;
}

export interface BrowserPanelProps {
  project: DAWProject;
  onAddInstrument: (instrumentId: string) => void;
  onPlaceItem: (item: LibraryItem) => void;
  onImportFiles: (files: File[]) => void;
  importing: boolean;
}

/** Kinds the Sounds list can actually place on the timeline (audio decode or MIDI import). */
const PLACEABLE: ReadonlySet<string> = new Set(['audio', 'loop', 'stem', 'sample', 'midi']);

/** Only items that carry a file and land on the timeline when clicked or dragged. */
export function placeableItems(items: LibraryItem[]): LibraryItem[] {
  return items.filter((i) => !!i.url && PLACEABLE.has(i.kind));
}

export function BrowserPanel({ project, onAddInstrument, onPlaceItem, onImportFiles, importing }: BrowserPanelProps) {
  const [tab, setTab] = useState<Tab>('instruments');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const opts = useMemo(() => instrumentOptions(project.synthPresets), [project.synthPresets]);

  // Reload every time Sounds opens, so a mix just saved from Export shows up.
  useEffect(() => {
    if (tab !== 'sounds') return;
    let alive = true;
    void browseMusicLibrary().then((mine) => {
      if (!alive) return;
      // Server already filters to music; keep only files that can be placed.
      setItems(placeableItems(mine));
    });
    return () => { alive = false; };
  }, [tab]);

  const filtered = (items || []).filter((i) => !q || i.title.toLowerCase().includes(q.toLowerCase()));
  const tabs: Array<[Tab, string, typeof Piano]> = [['instruments', 'Instruments', Piano], ['sounds', 'Sounds', Music2], ['files', 'Import', FolderOpen]];

  return (
    <div className="flex h-full w-56 flex-shrink-0 flex-col border-r border-white/5 bg-[#111117]" data-testid="studio-browser">
      <div className="flex border-b border-white/5">
        {tabs.map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)} className={cn('flex flex-1 items-center justify-center gap-1 py-2 text-[11px]', tab === t ? 'border-b-2 border-violet-400 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>
      {tab !== 'files' && (
        <div className="flex items-center gap-1 border-b border-white/5 px-2 py-1.5">
          <Search className="h-3 w-3 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="flex-1 bg-transparent text-xs text-zinc-200 outline-none" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {tab === 'instruments' && (
          <>
            {opts.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase())).map((o) => (
              <button
                key={o.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/x-concord-music', JSON.stringify({ type: 'instrument', instrumentId: o.id } satisfies BrowserPayload))}
                onClick={() => onAddInstrument(o.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/5"
                title="Click to add a track with this sound, or drag onto a track"
                data-testid="studio-browser-instrument"
              >
                {o.kind === 'drums' ? <Drum className="h-3.5 w-3.5 text-amber-300" /> : <Piano className="h-3.5 w-3.5 text-violet-300" />}
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-[9px] uppercase text-zinc-600">{o.category}</span>
              </button>
            ))}
          </>
        )}
        {tab === 'sounds' && (
          items === null ? (
            <div className="flex items-center gap-1 p-2 text-xs text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading your sounds…</div>
          ) : filtered.length ? filtered.map((i) => (
            <button
              key={`${i.kind}-${i.id}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-concord-music', JSON.stringify({ type: 'library', item: i } satisfies BrowserPayload))}
              onClick={() => onPlaceItem(i)}
              title="Click to place at the playhead, or drag onto a track"
              data-testid="studio-browser-sound"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/5"
            >
              <Music2 className="h-3.5 w-3.5 text-cyan-300" />
              <span className="flex-1 truncate">{i.title}</span>
              <span className="text-[9px] uppercase text-zinc-600">{i.kind}{i.bpm ? ` · ${i.bpm}` : ''}</span>
            </button>
          )) : (
            <div className="p-2 text-[11px] leading-relaxed text-zinc-500">
              Your audio and MIDI files appear here: imports, saved mixes and stems from your Concord library. Click or drag one onto the timeline.
            </div>
          )
        )}
        {tab === 'files' && (
          <div className="space-y-2 p-2">
            <button onClick={() => fileRef.current?.click()} disabled={importing} className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-white/15 py-6 text-xs text-zinc-300 hover:border-white/30" data-testid="studio-import">
              {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              {importing ? 'Importing…' : 'Import audio, MIDI, stems or presets'}
            </button>
            <input ref={fileRef} type="file" multiple accept={MUSIC_FILE_ACCEPT} className="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) onImportFiles(f); }} />
            <p className="text-[10px] leading-relaxed text-zinc-500">WAV, AIFF, FLAC, MP3, M4A, OGG and MIDI. Audio goes onto the selected audio track at the playhead (or a new track). MIDI makes instrument tracks. You can also drag files straight onto the timeline.</p>
          </div>
        )}
      </div>
    </div>
  );
}
