'use client';

/** Small Liner Notes building blocks: cover art, release tiles, the playing indicator, section headers. */

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TYPE_LABEL, type Release } from './linerApi';
import { useCoverTint } from './tint';

export function Cover({ url, title, size = 'md', className }: { url: string | null; title: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!url && failed !== url;
  const tint = useCoverTint(showImage ? url : null);
  const dims = { sm: 'h-11 w-11', md: 'aspect-square w-full', lg: 'h-56 w-56 sm:h-64 sm:w-64', xl: 'h-64 w-64 sm:h-72 sm:w-72' }[size];
  return (
    <div className={cn('ln-cover relative flex-shrink-0', dims, className)} style={{ ['--ln-tint' as string]: tint }}>
      {showImage ? (
        // A cover that cannot load (removed, or no longer shared) falls back to the tinted initial.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url!} alt={`Cover of ${title}`} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(url!)} />
      ) : (
        <span className="ln-serif absolute inset-0 flex items-center justify-center text-[length:min(40%,5rem)] text-white/90" aria-hidden>
          {title.trim().charAt(0).toUpperCase() || '♪'}
        </span>
      )}
    </div>
  );
}

export function Eq({ playing }: { playing: boolean }) {
  return (
    <span className="ln-eq inline-flex items-end" data-playing={playing ? 'true' : 'false'} aria-label={playing ? 'Playing' : 'Paused'} role="img">
      <span /><span /><span />
    </span>
  );
}

export function ReleaseTile({ release, onOpen, onArtist, showArtist = true }: {
  release: Release;
  onOpen: (id: string) => void;
  onArtist?: () => void;
  showArtist?: boolean;
}) {
  const year = (release.releaseDate || '').slice(0, 4);
  return (
    <div className="ln-rise group min-w-0" data-testid="ln-release-tile">
      <button type="button" onClick={() => onOpen(release.id)} className="block w-full text-left transition-transform group-hover:-translate-y-0.5" aria-label={`Open ${release.title} by ${release.artist.name}`}>
        <Cover url={release.coverUrl} title={release.title} />
      </button>
      <button type="button" onClick={() => onOpen(release.id)} className="ln-link mt-2 block w-full truncate text-left text-sm font-semibold">{release.title}</button>
      <div className="flex items-center gap-1 truncate text-xs text-[color:var(--ln-muted)]">
        {showArtist && onArtist ? <button type="button" onClick={onArtist} className="ln-link truncate">{release.artist.name}</button> : <span>{TYPE_LABEL[release.type]}{year ? ` · ${year}` : ''}</span>}
        {release.owned && !release.artist.isMe && <span className="ml-auto rounded-full bg-[var(--ln-go-soft)] px-1.5 text-[10px] font-semibold text-[color:var(--ln-go)]">Owned</span>}
        {!release.owned && release.priceCC > 0 && <span className="ln-mono ml-auto flex-shrink-0 text-[10px]">{release.priceCC} CC</span>}
      </div>
    </div>
  );
}

export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="mb-10" aria-labelledby={id}>
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b ln-rule pb-2">
        <h2 id={id} className="ln-serif text-2xl">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ln-card px-6 py-10 text-center">
      <p className="ln-serif text-xl">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-[color:var(--ln-muted)]">{children}</div>}
    </div>
  );
}

export function TileSkeleton({ n = 5 }: { n?: number }) {
  return (
    <Grid>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="animate-pulse" role="status" aria-label="Loading">
          <div className="aspect-square w-full rounded-md bg-[var(--ln-paper-2)]" />
          <div className="mt-2 h-3 w-3/4 rounded bg-[var(--ln-paper-2)]" />
        </div>
      ))}
    </Grid>
  );
}
