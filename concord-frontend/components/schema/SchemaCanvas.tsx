'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The Schema lens canvas: every registered schema as an entity card (fields +
 * types), with reference fields linking to their target card. Data comes from
 * the real `schema.erDiagram` macro over the user's registry; nothing is drawn
 * that the macro didn't return.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Link2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface CanvasRegistryEntry {
  id: string;
  name: string;
  latestVersion: string;
  versionCount: number;
}

interface ErField { name: string; type: string; required: boolean; ref: string | null }
interface ErNode { id: string; label: string; fieldCount: number; fields: ErField[] }
interface ErEdge { from: string; to: string; field: string; kind: string; resolved: boolean }

export function SchemaCanvas({
  registry,
  loading,
  err,
  onOpen,
  onImport,
}: {
  registry: CanvasRegistryEntry[];
  loading: boolean;
  err: string | null;
  onOpen: (id: string) => void;
  onImport: () => void;
}) {
  const [nodes, setNodes] = useState<ErNode[]>([]);
  const [edges, setEdges] = useState<ErEdge[]>([]);
  const [busy, setBusy] = useState(false);
  const [erErr, setErrState] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = registry.map((r) => `${r.id}@${r.latestVersion}`).join('|');
  useEffect(() => {
    if (!registry.length) { setNodes([]); setEdges([]); return; }
    let cancelled = false;
    (async () => {
      setBusy(true);
      setErrState(null);
      const r = await lensRun('schema', 'erDiagram', {});
      if (cancelled) return;
      if (r.data?.ok && r.data.result) {
        setNodes((r.data.result.nodes as ErNode[]) || []);
        setEdges((r.data.result.edges as ErEdge[]) || []);
      } else {
        setErrState(r.data?.error || 'Could not load the schema diagram');
      }
      setBusy(false);
    })();
    return () => { cancelled = true; };
    // registry identity is captured by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { if (litTimer.current) clearTimeout(litTimer.current); }, []);

  const byName = new Map(registry.map((r) => [r.name, r]));
  const edgeFor = (from: string, field: string) => edges.find((e) => e.from === from && e.field === field);

  const jumpTo = (name: string) => {
    const el = cardRefs.current[name];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setLit(name);
    if (litTimer.current) clearTimeout(litTimer.current);
    litTimer.current = setTimeout(() => setLit(null), 1600);
  };

  if (loading && !registry.length) {
    return <div className="flex items-center gap-2 text-[14px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading schemas…</div>;
  }
  if (err) {
    return <p className="text-[14px] text-red-300">{err}</p>;
  }
  if (!registry.length) {
    return (
      <div className="max-w-md pt-6">
        <p className="text-[15px] text-zinc-400">No schemas yet. Define one with <span className="text-zinc-200">+ New schema</span>, or infer one from existing JSON or SQL.</p>
        <button type="button" onClick={onImport} className="mt-3 text-[14px] text-teal-300 transition-colors hover:text-teal-200">Infer from sample data →</button>
      </div>
    );
  }

  const dangling = edges.filter((e) => !e.resolved);

  return (
    <div>
      {erErr && <p className="mb-3 text-[13px] text-red-300">{erErr}</p>}
      {busy && !nodes.length && <div className="flex items-center gap-2 text-[14px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading fields…</div>}
      {dangling.length > 0 && (
        <p className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {dangling.length} reference{dangling.length !== 1 ? 's' : ''} point at a schema that isn’t registered
        </p>
      )}
      <div className="grid gap-5 pb-28 sm:grid-cols-2 xl:grid-cols-3">
        {nodes.map((n) => {
          const entry = byName.get(n.label);
          return (
            <div
              key={n.id}
              ref={(el) => { cardRefs.current[n.id] = el; }}
              className={cn(
                'overflow-hidden rounded-2xl border bg-[#111] transition-colors',
                lit === n.id ? 'border-teal-400/70' : 'border-white/10 hover:border-white/20',
              )}
            >
              <button
                type="button"
                onClick={() => entry && onOpen(entry.id)}
                disabled={!entry}
                title="Edit this schema"
                className="flex w-full items-baseline justify-between gap-3 border-b border-white/10 px-4 py-3 text-left"
              >
                <span className="truncate text-[15px] font-semibold text-zinc-100">{n.label}</span>
                {entry && <span className="shrink-0 font-mono text-[11px] text-zinc-500">v{entry.latestVersion}</span>}
              </button>
              <ul>
                {n.fields.map((f) => {
                  const e = edgeFor(n.id, f.name);
                  const target = f.ref || e?.to || null;
                  return (
                    <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                      <span className="truncate text-zinc-200">
                        {f.name}
                        {f.required && <span className="ml-1 text-teal-400" title="required">*</span>}
                      </span>
                      {target ? (
                        <button
                          type="button"
                          onClick={() => e?.resolved !== false && jumpTo(target)}
                          title={e?.resolved === false ? `${target} isn’t registered` : `Jump to ${target}`}
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px]',
                            e?.resolved === false ? 'bg-amber-400/10 text-amber-300' : 'bg-teal-400/10 text-teal-300 hover:bg-teal-400/20',
                          )}
                        >
                          <Link2 className="h-3 w-3" />
                          {target}
                        </button>
                      ) : (
                        <span className="shrink-0 text-zinc-500">{f.type}</span>
                      )}
                    </li>
                  );
                })}
                {n.fields.length === 0 && <li className="px-4 py-3 text-[13px] text-zinc-600">No fields yet</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
