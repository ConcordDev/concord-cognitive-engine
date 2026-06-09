'use client';

/**
 * EventMediaManager — attach images / video / audio / link media to a
 * single timeline event. Wires history.event-add-media /
 * event-remove-media. Media URLs are user-supplied; nothing is hardcoded.
 */

import { useCallback, useState } from 'react';
import { Image as ImageIcon, Plus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface EventMedia {
  id: string;
  url: string;
  kind: 'image' | 'video' | 'audio' | 'link';
  caption: string;
  credit: string;
}
type MediaKind = EventMedia['kind'];

export function EventMediaManager({
  timelineId,
  eventId,
  media,
  onChanged,
}: {
  timelineId: string;
  eventId: string;
  media: EventMedia[];
  onChanged?: () => void;
}) {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<MediaKind>('image');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [error, setError] = useState('');

  const add = useCallback(async () => {
    setError('');
    if (!url.trim()) { setError('Media URL required'); return; }
    const r = await lensRun('history', 'event-add-media', {
      timelineId, eventId, url: url.trim(), kind, caption: caption.trim(), credit: credit.trim(),
    });
    if (!r.data?.ok) { setError(r.data?.error || 'Could not add media'); return; }
    setUrl(''); setCaption(''); setCredit('');
    onChanged?.();
  }, [timelineId, eventId, url, kind, caption, credit, onChanged]);

  const remove = useCallback(async (mediaId: string) => {
    const r = await lensRun('history', 'event-remove-media', { timelineId, eventId, mediaId });
    if (r.data?.ok) onChanged?.();
  }, [timelineId, eventId, onChanged]);

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
        <ImageIcon className="w-3 h-3 text-amber-400" /> Media ({media.length})
      </p>
      {media.length > 0 && (
        <ul className="space-y-1">
          {media.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5 text-[10px] bg-zinc-950/80 rounded px-1.5 py-1">
              <span className="px-1 rounded bg-zinc-800 text-zinc-400 uppercase">{m.kind}</span>
              <a href={m.url} target="_blank" rel="noopener noreferrer"
                className="flex-1 truncate text-amber-400 hover:underline">{m.caption || m.url}</a>
              {m.credit && <span className="text-zinc-600 truncate max-w-[80px]">{m.credit}</span>}
              <button aria-label="Remove media" onClick={() => remove(m.id)} className="text-rose-400 hover:text-rose-300">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1">
        <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind)}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200">
          <option value="image">image</option>
          <option value="video">video</option>
          <option value="audio">audio</option>
          <option value="link">link</option>
        </select>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… media URL"
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200" />
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="caption"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200" />
        <input value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="credit"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200" />
        <button aria-label="Add" onClick={add} disabled={!url.trim()}
          className="px-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">
          <Plus className="w-3 h-3" />
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}
