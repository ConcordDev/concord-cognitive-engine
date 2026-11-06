'use client';

import { useState } from 'react';
import { HardHat, Search, ExternalLink } from 'lucide-react';

/**
 * OSHA / federal construction datasets — external search launcher.
 *
 * F4 (construction full build): this view previously fetched
 * catalog.data.gov's CKAN package_search in the browser under a
 * "CATALOG.DATA.GOV CKAN · LIVE" badge. That API no longer exists —
 * verified first-hand 2026-11-04: every /api/3/action/* path on
 * catalog.data.gov returns 404 (data.gov retired its classic catalog
 * API), inventory.data.gov's CKAN denies anonymous access, and no
 * keyless successor answers. The re-arm's second arm therefore applies:
 * the live-feed claim is retired to what the surface can honestly do —
 * run the same search on the federal catalog itself, one click out,
 * beside OSHA's own data pages. No in-app feed is claimed.
 */
const CATALOG_SEARCH = 'https://catalog.data.gov/dataset?q=';
const OSHA_LINKS = [
  { label: 'OSHA construction industry guidance', href: 'https://www.osha.gov/construction' },
  { label: 'OSHA enforcement & inspection data', href: 'https://www.osha.gov/ords/imis/establishment.html' },
  { label: 'Federal catalog — OSHA datasets', href: 'https://catalog.data.gov/dataset?q=osha&organization=osha' },
];

export function OshaIncidentSearch() {
  const [query, setQuery] = useState('construction fatality');

  const openCatalog = () => {
    const q = encodeURIComponent(`osha ${query}`.trim());
    window.open(`${CATALOG_SEARCH}${q}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">OSHA / federal construction datasets</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">catalog.data.gov · external search</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) openCatalog(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search OSHA / construction safety datasets…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim()} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          <ExternalLink className="h-3.5 w-3.5" />
          Search on catalog.data.gov
        </button>
      </form>
      <div className="rounded border border-dashed border-zinc-800 p-4 text-[11px] leading-relaxed text-zinc-400">
        Dataset results open on the federal catalog itself. This lens used to query data.gov&apos;s
        catalog API in-app; data.gov retired that API, so no live in-app feed is claimed here —
        the search above runs the same query against the catalog&apos;s own search, and the
        official OSHA pages below carry the underlying safety data.
      </div>
      <div className="space-y-1">
        {OSHA_LINKS.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
            <span className="text-sm text-white">{l.label}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
          </a>
        ))}
      </div>
    </div>
  );
}
