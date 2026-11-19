'use client';

/**
 * ArtExplorer — bespoke museum artwork browse surface for the art lens.
 * Backed by art.met-search + art.met-object + art.aic-search (Met
 * Museum + Art Institute of Chicago, both free + CC0 / public-domain
 * subset prominent).
 *
 * Per category-leader UX research against Met, Art Institute, Google
 * Arts & Culture, Artsy, MoMA, Tate:
 *
 *   • Source toggle (Met / Art Institute) with single search input
 *   • Cover-art grid (responsive 2/3/4 cols, aspect-square object-cover)
 *   • Click → detail card: hero image + 6-axis metadata block
 *     (artist / dated / medium / dimensions / department / classification)
 *     + public-domain badge + Save-as-DTU
 *   • Magnifier-lens zoom on hover (no openseadragon — pure CSS
 *     background-position math)
 *   • Met requires a 2-step search → fetch flow (search returns ids,
 *     object-fetch returns details); AIC search returns full data in
 *     one call. Component abstracts both.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, Search, Loader2, ExternalLink, ArrowLeft,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

type Source = 'met' | 'aic';

interface MetSearch { objectIds: number[]; total: number; source: string }
interface MetObject {
  objectId: number; title?: string; artist?: string; artistBio?: string;
  artistNationality?: string; artistRole?: string;
  dated?: string; beginDate?: number; endDate?: number;
  medium?: string; dimensions?: string;
  classification?: string; department?: string;
  culture?: string; period?: string;
  primaryImage?: string; primaryImageSmall?: string;
  objectUrl?: string;
  publicDomain?: boolean;
  tags?: string[];
}
interface AicArt {
  id: number; title: string;
  artist?: string; artistDisplay?: string;
  dated?: string; beginDate?: number; endDate?: number;
  medium?: string; dimensions?: string;
  classification?: string; department?: string;
  placeOfOrigin?: string; style?: string;
  publicDomain?: boolean;
  imageUrl?: string | null;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('art', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function ArtExplorer() {
  const [source, setSource] = useState<Source>('met');
  const [queryInput, setQueryInput] = useState('');
  const [aicResults, setAicResults] = useState<AicArt[]>([]);
  const [metObjects, setMetObjects] = useState<MetObject[]>([]);
  const [selected, setSelected] = useState<{ kind: Source; data: MetObject | AicArt } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const metSearchMutation = useMutation({
    mutationFn: async (q: string) => callMacro<MetSearch>('met-search', { query: q, hasImages: true }),
    onSuccess: async (env) => {
      if (env.ok && env.result) {
        const ids = env.result.objectIds.slice(0, 12);
        setErrorMsg(null);
        // Fetch first 12 objects in parallel
        const fetched = await Promise.all(ids.map((id) => callMacro<MetObject>('met-object', { objectId: id })));
        setMetObjects(fetched.filter((f) => f.ok && f.result).map((f) => f.result!));
      } else {
        setMetObjects([]);
        setErrorMsg(env.error || 'No matches');
      }
    },
  });

  const aicSearchMutation = useMutation({
    mutationFn: async (q: string) => callMacro<{ artworks: AicArt[] }>('aic-search', { query: q, limit: 24 }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setAicResults(env.result.artworks); setErrorMsg(null); }
      else { setAicResults([]); setErrorMsg(env.error || 'No matches'); }
    },
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = queryInput.trim();
    if (q.length < 2) return;
    setSelected(null);
    if (source === 'met') metSearchMutation.mutate(q);
    else aicSearchMutation.mutate(q);
  };

  const isPending = source === 'met' ? metSearchMutation.isPending : aicSearchMutation.isPending;
  const hasResults = source === 'met' ? metObjects.length > 0 : aicResults.length > 0;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-[color:var(--at-blue)] pb-3">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-[color:var(--at-blue)]" />
          <h2 className="text-sm font-semibold text-[color:var(--at-ink)]">Art Explorer</h2>
          <span className="rounded bg-[var(--at-raised)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--at-muted)]">
            met + art-institute-of-chicago
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[color:var(--at-rule)] bg-[var(--at-sunk)] p-0.5">
          {(['met', 'aic'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setSource(s); setSelected(null); }}
              className={`rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                source === s ? 'bg-[var(--at-blue)] text-[color:var(--at-blue)]' : 'text-[color:var(--at-muted)] hover:text-[color:var(--at-ink-2)]'
              }`}
            >
              {s === 'met' ? 'Met' : 'Art Inst.'}
            </button>
          ))}
        </div>
      </header>

      {!selected && (
        <form onSubmit={submit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--at-muted)]" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search — van gogh, sunflowers, ukiyo-e, mary cassatt…"
              className="w-full rounded-md border border-[color:var(--at-rule)] bg-[var(--at-sunk)] py-1.5 pl-8 pr-3 text-sm text-[color:var(--at-ink)] placeholder:text-[color:var(--at-faint)] focus:border-[color:var(--at-blue)] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={queryInput.trim().length < 2 || isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--at-blue)] bg-[var(--at-blue)] px-3 py-1.5 text-xs font-medium text-[color:var(--at-blue)] transition-colors hover:bg-[var(--at-blue)] disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </form>
      )}

      {errorMsg && !hasResults && !selected && (
        <div className="rounded-md border border-[color:var(--at-bad)] bg-[var(--at-bad)] px-3 py-2 text-xs text-[color:var(--at-bad)]">
          {errorMsg}
        </div>
      )}

      {!hasResults && !isPending && !errorMsg && !selected && (
        <div className="rounded-md border border-dashed border-[color:var(--at-rule)] bg-[var(--at-sunk)] px-3 py-8 text-center text-xs text-[color:var(--at-muted)]">
          Browse 500k+ Met objects (492k public-domain) and 113k Art Institute artworks
          (~52k CC0). Click any cover to expand into the detail card with Save-as-DTU.
        </div>
      )}

      {hasResults && !selected && (
        <div className="grid grid-cols-2 gap-2">
          {(source === 'met' ? metObjects : aicResults).map((a) => (
            <CoverCard
              key={`${source}-${'objectId' in a ? a.objectId : a.id}`}
              source={source}
              art={a}
              onSelect={() => setSelected({ kind: source, data: a })}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <DetailCard
            key={`d-${selected.kind}-${'objectId' in selected.data ? selected.data.objectId : selected.data.id}`}
            kind={selected.kind}
            data={selected.data}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CoverCard({ source, art, onSelect }: { source: Source; art: MetObject | AicArt; onSelect: () => void }) {
  const img = source === 'met' ? (art as MetObject).primaryImageSmall || (art as MetObject).primaryImage : (art as AicArt).imageUrl;
  const title = art.title || '(untitled)';
  const artist = source === 'met' ? (art as MetObject).artist : (art as AicArt).artist;
  const pd = (art as { publicDomain?: boolean }).publicDomain;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col overflow-hidden rounded-md border border-[color:var(--at-rule)] bg-[var(--at-sunk)] text-left transition-colors hover:border-[color:var(--at-blue)]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-[var(--at-gesso)]">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Palette className="h-8 w-8 text-[color:var(--at-faint)]" />
          </div>
        )}
        {pd && (
          <span className="absolute right-1 top-1 rounded bg-[var(--at-good)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--at-good)]">
            CC0
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <div className="line-clamp-2 text-xs text-[color:var(--at-ink)]">{title}</div>
        {artist && <div className="line-clamp-1 text-[10px] text-[color:var(--at-muted)]">{artist}</div>}
      </div>
    </button>
  );
}

function DetailCard({ kind, data, onClose }: { kind: Source; data: MetObject | AicArt; onClose: () => void }) {
  const isMet = kind === 'met';
  const met = isMet ? (data as MetObject) : null;
  const aic = !isMet ? (data as AicArt) : null;

  const img = isMet ? (met?.primaryImage || met?.primaryImageSmall) : aic?.imageUrl;
  const title = data.title || '(untitled)';
  const artist = isMet ? met?.artist : aic?.artist;
  const dated = isMet ? met?.dated : aic?.dated;
  const medium = isMet ? met?.medium : aic?.medium;
  const dimensions = isMet ? met?.dimensions : aic?.dimensions;
  const department = isMet ? met?.department : aic?.department;
  const classification = isMet ? met?.classification : aic?.classification;
  const externalUrl = isMet ? met?.objectUrl : aic ? `https://www.artic.edu/artworks/${aic.id}` : undefined;
  const isPublic = (data as { publicDomain?: boolean }).publicDomain;

  // Magnifier-lens: track mouse position in viewport-relative coords
  const [lensPos, setLensPos] = useState<{ x: number; y: number } | null>(null);
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!img) return;
    const r = e.currentTarget.getBoundingClientRect();
    setLensPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  const fullId = isMet ? (data as MetObject).objectId : (data as AicArt).id;

  const dtuTitle = `${title}${artist ? ' — ' + artist : ''}`;
  const dtuContent = [
    `Title: ${title}`,
    artist ? `Artist: ${artist}` : '',
    dated ? `Date: ${dated}` : '',
    medium ? `Medium: ${medium}` : '',
    dimensions ? `Dimensions: ${dimensions}` : '',
    department ? `Department: ${department}` : '',
    classification ? `Classification: ${classification}` : '',
    isMet ? `Source: Metropolitan Museum of Art (objectID ${fullId})` : `Source: Art Institute of Chicago (id ${fullId})`,
    externalUrl ? `URL: ${externalUrl}` : '',
    isPublic ? 'License: Public Domain (CC0)' : '',
  ].filter(Boolean).join('\n');

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="space-y-3 rounded-lg border border-[color:var(--at-blue)] bg-[var(--at-sunk)] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--at-muted)] transition-colors hover:bg-[var(--at-raised)] hover:text-[color:var(--at-ink)]"
        >
          <ArrowLeft className="h-3 w-3" /> Back to results
        </button>
        <SaveAsDtuButton
          defaultContentClass="media"
          apiSource={isMet ? 'met-museum' : 'art-institute-chicago'}
          apiUrl={externalUrl}
          title={dtuTitle}
          content={dtuContent}
          extraTags={['art', isMet ? 'met' : 'aic', classification?.toLowerCase() || 'artwork', ...(isMet ? met?.tags || [] : []).slice(0, 4)]}
          rawData={data}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="md:col-span-2">
          {img ? (
            <div
              className="relative overflow-hidden rounded-md border border-[color:var(--at-rule)] bg-[var(--at-sunk)]"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setLensPos(null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img}
                alt={title}
                className="w-full object-contain"
                style={{ maxHeight: '70vh' }}
              />
              {lensPos && (
                <div
                  className="pointer-events-none absolute h-32 w-32 rounded-full border-2 border-[color:var(--at-blue)] bg-no-repeat shadow-xl"
                  style={{
                    left: `calc(${lensPos.x}% - 64px)`,
                    top: `calc(${lensPos.y}% - 64px)`,
                    backgroundImage: `url('${img}')`,
                    backgroundSize: '300% 300%',
                    backgroundPosition: `${lensPos.x}% ${lensPos.y}%`,
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-md border border-[color:var(--at-rule)] bg-[var(--at-sunk)] text-[color:var(--at-muted)]">
              No image available
            </div>
          )}
        </div>
        <aside className="space-y-2">
          <div>
            <h3 className="text-lg font-semibold text-[color:var(--at-ink)]">{title}</h3>
            {artist && <p className="mt-1 text-sm text-[color:var(--at-blue)]">{artist}</p>}
            {isMet && met?.artistBio && <p className="text-[11px] italic text-[color:var(--at-muted)]">{met.artistBio}</p>}
          </div>

          <dl className="space-y-1.5 rounded-md border border-[color:var(--at-blue)] bg-[var(--at-blue)] p-2.5 text-xs">
            {dated && <Row label="Date" value={dated} />}
            {medium && <Row label="Medium" value={medium} />}
            {dimensions && <Row label="Dimensions" value={dimensions} />}
            {department && <Row label="Department" value={department} />}
            {classification && <Row label="Classification" value={classification} />}
            {(isMet ? met?.culture : aic?.placeOfOrigin) && (
              <Row label={isMet ? 'Culture' : 'Origin'} value={(isMet ? met?.culture : aic?.placeOfOrigin) || '—'} />
            )}
            {!isMet && aic?.style && <Row label="Style" value={aic.style} />}
            <Row label={isMet ? 'Object ID' : 'Artwork ID'} value={String(fullId)} mono />
            {isPublic && (
              <Row label="License" value="Public Domain · CC0" mono />
            )}
          </dl>

          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[color:var(--at-blue)] bg-[var(--at-blue)] px-2 py-1.5 text-[11px] font-medium text-[color:var(--at-blue)] transition-colors hover:bg-[var(--at-blue)]"
            >
              <ExternalLink className="h-3 w-3" />
              {isMet ? 'Open on Metmuseum.org' : 'Open on Artic.edu'}
            </a>
          )}
        </aside>
      </div>
    </motion.div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-[color:var(--at-muted)]">{label}</dt>
      <dd className={`text-right text-[color:var(--at-ink)] ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</dd>
    </div>
  );
}
