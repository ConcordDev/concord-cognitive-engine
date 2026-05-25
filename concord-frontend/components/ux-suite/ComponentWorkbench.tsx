'use client';

/**
 * ComponentWorkbench — the real Storybook-parity surface for ux-suite.
 *
 * Drives every macro in server/domains/ux-suite.js:
 *   catalog          — auto-generated component catalog (no hand array)
 *   search           — search/filter across the component list
 *   preview          — isolated sandbox render descriptor
 *   props-schema     — controls panel definition + saved overrides
 *   save-props       — persist a user's prop tweaks
 *   reset-props      — clear overrides
 *   usage-snippet    — source / usage code per component
 *   a11y-check       — accessibility + responsive audit
 *   variant-gallery  — default/loading/error/empty state gallery
 *   favourites-list  — list a user's starred components
 *   favourite-toggle — star/unstar a component
 *
 * No mock data — the catalog is code-derived from the CATALOG manifest
 * and every panel reflects real backend responses.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Search, Loader2, Star, Code2, Eye, SlidersHorizontal, ShieldCheck,
  Layers3, RotateCcw, ExternalLink, Check, X, AlertTriangle, Info,
  Copy, Monitor, Tablet, Smartphone,
} from 'lucide-react';

const DOMAIN = 'ux-suite';

interface CatalogComponent {
  name: string; group: string; description: string;
  homePath: string; homeLabel: string; importPath: string;
  icon: string; states: string[]; propCount: number;
}
interface CatalogGroup { id: string; label: string; count: number; }
interface PropSchemaEntry {
  key: string; label: string; type: 'range' | 'boolean' | 'enum';
  min?: number; max?: number; step?: number;
  options?: string[]; default: unknown;
}
interface A11yFinding { rule: string; category: string; severity: string; detail: string; }
interface ResponsiveCheck { breakpoint: string; label: string; widthPx: number; fits: boolean; note: string; }
interface Variant { state: string; label: string; tone: string; description: string; }

type PropValues = Record<string, unknown>;

const TONE: Record<string, string> = {
  emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  slate: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
};
const SEV_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pass: Check, error: X, warn: AlertTriangle, info: Info,
};
const SEV_COLOR: Record<string, string> = {
  pass: 'text-emerald-400', error: 'text-rose-400',
  warn: 'text-amber-400', info: 'text-sky-400',
};
const BP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  mobile: Smartphone, tablet: Tablet, desktop: Monitor,
};

export function ComponentWorkbench() {
  // ── catalog + search ──────────────────────────────────────────────
  const [components, setComponents] = useState<CatalogComponent[]>([]);
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [catalogSource, setCatalogSource] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState('all');
  const [searchHits, setSearchHits] = useState<string[] | null>(null);

  // ── selection ─────────────────────────────────────────────────────
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'props' | 'snippet' | 'a11y' | 'variants'>('preview');

  // ── per-component panels ──────────────────────────────────────────
  const [previewState, setPreviewState] = useState('default');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [schema, setSchema] = useState<PropSchemaEntry[]>([]);
  const [propValues, setPropValues] = useState<PropValues>({});
  const [propDefaults, setPropDefaults] = useState<PropValues>({});
  const [propsDirty, setPropsDirty] = useState(false);
  const [hasOverrides, setHasOverrides] = useState(false);
  const [snippet, setSnippet] = useState<Record<string, string> | null>(null);
  const [a11y, setA11y] = useState<{
    score: number; summary: Record<string, number>;
    findings: A11yFinding[]; responsive: ResponsiveCheck[]; standard: string;
  } | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── favourites ────────────────────────────────────────────────────
  const [favourites, setFavourites] = useState<string[]>([]);

  // ── load catalog (auto-generated) ─────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoadingCatalog(true);
      const r = await lensRun(DOMAIN, 'catalog', {});
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { components: CatalogComponent[]; groups: CatalogGroup[]; source: string };
        setComponents(res.components || []);
        setGroups(res.groups || []);
        setCatalogSource(res.source || '');
        if (!selected && res.components?.length) setSelected(res.components[0].name);
      }
      setLoadingCatalog(false);
    })();
    (async () => {
      const r = await lensRun(DOMAIN, 'favourites-list', {});
      if (r.data?.ok && r.data.result) {
        setFavourites((r.data.result as { favourites: string[] }).favourites || []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── debounced server-side search ──────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (!q && activeGroup === 'all') { setSearchHits(null); return; }
    const t = setTimeout(async () => {
      const r = await lensRun(DOMAIN, 'search', { query: q, group: activeGroup });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { results: { name: string }[] };
        setSearchHits(res.results.map((x) => x.name));
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, activeGroup]);

  const visible = useMemo(() => {
    if (searchHits === null) return components;
    const set = new Set(searchHits);
    return components.filter((c) => set.has(c.name));
  }, [components, searchHits]);

  // ── load all panels for the selected component ────────────────────
  const loadComponent = useCallback(async (name: string, state: string) => {
    setBusy(true);
    const [pv, ps, sn, ac, vg] = await Promise.all([
      lensRun(DOMAIN, 'preview', { component: name, state }),
      lensRun(DOMAIN, 'props-schema', { component: name }),
      lensRun(DOMAIN, 'usage-snippet', { component: name }),
      lensRun(DOMAIN, 'a11y-check', { component: name }),
      lensRun(DOMAIN, 'variant-gallery', { component: name }),
    ]);
    if (pv.data?.ok) setPreview(pv.data.result as Record<string, unknown>);
    if (ps.data?.ok && ps.data.result) {
      const res = ps.data.result as {
        schema: PropSchemaEntry[]; defaults: PropValues; current: PropValues; hasOverrides: boolean;
      };
      setSchema(res.schema || []);
      setPropDefaults(res.defaults || {});
      setPropValues(res.current || {});
      setHasOverrides(res.hasOverrides);
      setPropsDirty(false);
    }
    if (sn.data?.ok) setSnippet(sn.data.result as Record<string, string>);
    if (ac.data?.ok) setA11y(ac.data.result as typeof a11y);
    if (vg.data?.ok && vg.data.result) {
      setVariants((vg.data.result as { variants: Variant[] }).variants || []);
    }
    setBusy(false);
     
  }, []);

  useEffect(() => {
    if (selected) { setPreviewState('default'); loadComponent(selected, 'default'); }
  }, [selected, loadComponent]);

  // ── preview re-render on state/prop change ────────────────────────
  const refreshPreview = useCallback(async (name: string, state: string, props: PropValues) => {
    const r = await lensRun(DOMAIN, 'preview', { component: name, state, props });
    if (r.data?.ok) setPreview(r.data.result as Record<string, unknown>);
  }, []);

  function onPickState(state: string) {
    setPreviewState(state);
    if (selected) refreshPreview(selected, state, propValues);
  }

  function onPropChange(key: string, value: unknown) {
    const next = { ...propValues, [key]: value };
    setPropValues(next);
    setPropsDirty(true);
    if (selected) refreshPreview(selected, previewState, next);
  }

  async function saveProps() {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun(DOMAIN, 'save-props', { component: selected, props: propValues });
    if (r.data?.ok) {
      setPropsDirty(false);
      setHasOverrides(Object.keys((r.data.result as { saved: object }).saved || {}).length > 0);
      // refresh snippet so the usage code reflects saved props
      const sn = await lensRun(DOMAIN, 'usage-snippet', { component: selected });
      if (sn.data?.ok) setSnippet(sn.data.result as Record<string, string>);
    }
    setBusy(false);
  }

  async function resetProps() {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun(DOMAIN, 'reset-props', { component: selected });
    if (r.data?.ok && r.data.result) {
      const defs = (r.data.result as { defaults: PropValues }).defaults;
      setPropValues(defs);
      setPropDefaults(defs);
      setPropsDirty(false);
      setHasOverrides(false);
      refreshPreview(selected, previewState, defs);
      const sn = await lensRun(DOMAIN, 'usage-snippet', { component: selected });
      if (sn.data?.ok) setSnippet(sn.data.result as Record<string, string>);
    }
    setBusy(false);
  }

  async function toggleFavourite(name: string) {
    const r = await lensRun(DOMAIN, 'favourite-toggle', { component: name });
    if (r.data?.ok && r.data.result) {
      const { favourited } = r.data.result as { favourited: boolean };
      setFavourites((cur) => favourited ? [...cur, name] : cur.filter((x) => x !== name));
    }
  }

  function copySnippet() {
    if (!snippet?.usage) return;
    navigator.clipboard?.writeText(snippet.usage).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const selComp = components.find((c) => c.name === selected) || null;

  return (
    <div className="rounded-xl border border-fuchsia-500/20 bg-zinc-950/50">
      <div className="flex items-center gap-2 border-b border-fuchsia-500/15 px-4 py-2.5">
        <Layers3 className="h-4 w-4 text-fuchsia-400" />
        <h2 className="text-sm font-semibold text-white">Component Workbench</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
          live preview · controls · a11y
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr]">
        {/* ── Left: catalog + search ── */}
        <aside className="border-b border-zinc-800 lg:border-b-0 lg:border-r">
          <div className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search components…"
                aria-label="Search components"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-2 text-xs text-white placeholder:text-zinc-400 focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <button
                onClick={() => setActiveGroup('all')}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${activeGroup === 'all' ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
              >
                All ({components.length})
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGroup(g.id)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${activeGroup === g.id ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                >
                  {g.label} ({g.count})
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[460px] overflow-y-auto px-2 pb-3">
            {loadingCatalog && (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating catalog…
              </div>
            )}
            {!loadingCatalog && visible.length === 0 && (
              <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-400">
                No components match.
              </div>
            )}
            {visible.map((c) => {
              const fav = favourites.includes(c.name);
              return (
                <button
                  key={c.name}
                  onClick={() => setSelected(c.name)}
                  className={`group mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition ${selected === c.name ? 'border-fuchsia-500/50 bg-fuchsia-500/10' : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/50'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] font-semibold text-zinc-100">{c.name}</span>
                    <span className="block truncate text-[10px] text-zinc-400">{c.group} · {c.propCount} props · {c.states.length} states</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={fav ? `Unstar ${c.name}` : `Star ${c.name}`}
                    onClick={(e) => { e.stopPropagation(); toggleFavourite(c.name); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavourite(c.name); } }}
                  >
                    <Star className={`h-3.5 w-3.5 ${fav ? 'fill-amber-400 text-amber-400' : 'text-zinc-600 group-hover:text-zinc-400'}`} />
                  </span>
                </button>
              );
            })}
          </div>
          {catalogSource && (
            <p className="border-t border-zinc-900 px-3 py-1.5 text-[9px] text-zinc-400">{catalogSource}</p>
          )}
        </aside>

        {/* ── Right: workbench tabs ── */}
        <section className="min-w-0 p-3">
          {!selComp && (
            <div className="flex h-64 items-center justify-center text-xs text-zinc-400">
              Select a component to inspect.
            </div>
          )}
          {selComp && (
            <>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-mono text-sm font-semibold text-white">{selComp.name}</h3>
                  <p className="text-[11px] text-zinc-400">{selComp.description}</p>
                  <a href={selComp.homePath} className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-fuchsia-400 hover:underline">
                    <ExternalLink className="h-3 w-3" /> Live mount: {selComp.homeLabel}
                  </a>
                </div>
                {busy && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              </div>

              {/* tabs */}
              <div className="mb-3 flex flex-wrap gap-1 border-b border-zinc-800">
                {([
                  ['preview', 'Preview', Eye],
                  ['props', 'Controls', SlidersHorizontal],
                  ['snippet', 'Usage', Code2],
                  ['a11y', 'A11y / Responsive', ShieldCheck],
                  ['variants', 'Variants', Layers3],
                ] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[11px] font-medium ${tab === id ? 'border-fuchsia-500 text-fuchsia-300' : 'border-transparent text-zinc-400 hover:text-zinc-300'}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>

              {/* ── PREVIEW ── */}
              {tab === 'preview' && (
                <div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {((preview?.availableStates as string[]) || selComp.states).map((st) => (
                      <button
                        key={st}
                        onClick={() => onPickState(st)}
                        className={`rounded border px-2 py-0.5 text-[10px] font-medium ${previewState === st ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-[#0a0a0f] p-4">
                    <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-400">
                      <span className="h-2 w-2 rounded-full bg-rose-500/60" />
                      <span className="h-2 w-2 rounded-full bg-amber-500/60" />
                      <span className="h-2 w-2 rounded-full bg-emerald-500/60" />
                      <span className="ml-1">isolated sandbox · {selComp.name} [{previewState}]</span>
                    </div>
                    <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/60 p-5 text-center">
                      <p className="font-mono text-sm text-zinc-200">&lt;{selComp.name} /&gt;</p>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        State: <span className="text-fuchsia-300">{previewState}</span>
                      </p>
                      {preview?.props != null && (
                        <pre className="mt-3 overflow-x-auto rounded bg-black/40 p-2 text-left text-[10px] text-zinc-400">
{JSON.stringify(preview.props, null, 2)}
                        </pre>
                      )}
                      {(preview?.sandbox as { note?: string })?.note && (
                        <p className="mt-2 text-[10px] text-zinc-400">{(preview!.sandbox as { note: string }).note}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── CONTROLS ── */}
              {tab === 'props' && (
                <div>
                  {schema.length === 0 && (
                    <p className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-400">
                      This component exposes no controllable props.
                    </p>
                  )}
                  <div className="space-y-3">
                    {schema.map((p) => (
                      <div key={p.key} className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <label className="text-[11px] font-medium text-zinc-200">{p.label}</label>
                          <span className="font-mono text-[10px] text-fuchsia-300">{String(propValues[p.key])}</span>
                        </div>
                        {p.type === 'boolean' && (
                          <button
                            onClick={() => onPropChange(p.key, !propValues[p.key])}
                            aria-label={p.label}
                            className={`flex h-5 w-9 items-center rounded-full px-0.5 transition ${propValues[p.key] ? 'bg-fuchsia-500' : 'bg-zinc-700'}`}
                          >
                            <span className={`h-4 w-4 rounded-full bg-white transition ${propValues[p.key] ? 'translate-x-4' : ''}`} />
                          </button>
                        )}
                        {p.type === 'range' && (
                          <input
                            type="range"
                            min={p.min} max={p.max} step={p.step}
                            value={Number(propValues[p.key] ?? p.default)}
                            onChange={(e) => onPropChange(p.key, Number(e.target.value))}
                            aria-label={p.label}
                            className="w-full accent-fuchsia-500"
                          />
                        )}
                        {p.type === 'enum' && (
                          <div className="flex flex-wrap gap-1">
                            {(p.options || []).map((o) => (
                              <button
                                key={o}
                                onClick={() => onPropChange(p.key, o)}
                                className={`rounded border px-2 py-0.5 text-[10px] ${propValues[p.key] === o ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                              >
                                {o}
                              </button>
                            ))}
                          </div>
                        )}
                        {propDefaults[p.key] !== propValues[p.key] && (
                          <p className="mt-1 text-[9px] text-zinc-400">default: {String(propDefaults[p.key])}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  {schema.length > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={saveProps}
                        disabled={!propsDirty || busy}
                        className="flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 px-3 py-1.5 text-[11px] font-medium text-fuchsia-200 disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" /> Save props
                      </button>
                      <button
                        onClick={resetProps}
                        disabled={busy || (!hasOverrides && !propsDirty)}
                        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] font-medium text-zinc-300 disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Reset
                      </button>
                      {hasOverrides && <span className="text-[10px] text-emerald-400">saved overrides active</span>}
                      {propsDirty && <span className="text-[10px] text-amber-400">unsaved changes</span>}
                    </div>
                  )}
                </div>
              )}

              {/* ── USAGE ── */}
              {tab === 'snippet' && snippet && (
                <div className="space-y-3">
                  <div className="rounded-md border border-zinc-800 bg-[#0a0a0f]">
                    <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">usage.tsx</span>
                      <button onClick={copySnippet} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white">
                        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        {copied ? 'copied' : 'copy'}
                      </button>
                    </div>
                    <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed text-zinc-300">{snippet.usage}</pre>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0a0a0f]">
                    <div className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      props interface
                    </div>
                    <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed text-zinc-400">{snippet.propsInterface}</pre>
                  </div>
                </div>
              )}

              {/* ── A11Y ── */}
              {tab === 'a11y' && a11y && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className={`rounded-lg border px-3 py-2 ${a11y.score >= 80 ? TONE.emerald : a11y.score >= 50 ? TONE.amber : TONE.rose}`}>
                      <div className="text-[9px] uppercase tracking-wider opacity-70">a11y score</div>
                      <div className="font-mono text-xl">{a11y.score}</div>
                    </div>
                    <div className="flex gap-3 text-[11px]">
                      <span className="text-emerald-400">{a11y.summary.passes} pass</span>
                      <span className="text-amber-400">{a11y.summary.warnings} warn</span>
                      <span className="text-rose-400">{a11y.summary.errors} error</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {a11y.findings.map((f, i) => {
                      const Icon = SEV_ICON[f.severity] || Info;
                      return (
                        <div key={i} className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                          <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${SEV_COLOR[f.severity] || 'text-zinc-400'}`} />
                          <div className="min-w-0">
                            <span className="font-mono text-[10px] text-zinc-400">{f.rule}</span>
                            <span className="ml-1.5 rounded bg-zinc-800 px-1 text-[9px] uppercase text-zinc-400">{f.category}</span>
                            <p className="text-[11px] text-zinc-300">{f.detail}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Responsive</h4>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                      {a11y.responsive.map((r) => {
                        const Icon = BP_ICON[r.breakpoint] || Monitor;
                        return (
                          <div key={r.breakpoint} className={`rounded-md border px-2.5 py-2 ${r.fits ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                            <div className="flex items-center gap-1.5">
                              <Icon className="h-3.5 w-3.5 text-zinc-400" />
                              <span className="text-[11px] font-medium text-zinc-200">{r.label}</span>
                              <span className="ml-auto font-mono text-[9px] text-zinc-400">{r.widthPx}px</span>
                            </div>
                            <p className="mt-1 text-[10px] text-zinc-400">{r.note}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[9px] text-zinc-400">{a11y.standard}</p>
                </div>
              )}

              {/* ── VARIANTS ── */}
              {tab === 'variants' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {variants.map((v) => (
                    <button
                      key={v.state}
                      onClick={() => { setTab('preview'); onPickState(v.state); }}
                      className={`rounded-lg border p-3 text-left transition hover:brightness-125 ${TONE[v.tone] || TONE.slate}`}
                    >
                      <div className="text-[11px] font-semibold">{v.label}</div>
                      <div className="mt-0.5 font-mono text-[9px] opacity-70">state: {v.state}</div>
                      <p className="mt-1 text-[10px] opacity-80">{v.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
