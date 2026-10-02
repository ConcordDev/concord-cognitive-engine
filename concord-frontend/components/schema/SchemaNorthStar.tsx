'use client';

/**
 * Schema north star — the shape of registered schemas.
 * Tables render only fields the registry stored. The workbench stays under More.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { GraphFamilyPill, SHAPE_LINKS } from '@/components/graph/GraphFamilyChrome';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

type SchemaRow = { id: string; name: string; fieldCount?: number };
type FieldDef = { type?: string };
type SchemaEntry = {
  id: string;
  name: string;
  versions?: { schema?: { fields?: Record<string, FieldDef> } }[];
};

const TYPES = ['string', 'number', 'bool', 'enum', 'json'];

export function SchemaNorthStar({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<{ name: string; type: string }[]>([{ name: '', type: 'string' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const list = useQuery({
    queryKey: ['schema-north', 'list'],
    queryFn: async () => {
      const r = await lensRun<{ schemas?: SchemaRow[] }>('schema', 'registryList', {});
      if (!r.data?.ok) throw new Error(r.data?.error || 'Schema list failed');
      return r.data.result?.schemas ?? [];
    },
  });

  const ids = (list.data ?? []).slice(0, 3).map((s) => s.id).join(',');
  const shapes = useQuery({
    queryKey: ['schema-north', 'shapes', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const picked = (list.data ?? []).slice(0, 3);
      const out: SchemaEntry[] = [];
      for (const row of picked) {
        const r = await lensRun<SchemaEntry>('schema', 'registryGet', { id: row.id });
        if (r.data?.ok && r.data.result) out.push(r.data.result);
      }
      return out;
    },
  });

  const save = async () => {
    const title = name.trim();
    if (!title) {
      setError('Name the schema.');
      return;
    }
    const fields: Record<string, { type: string }> = {};
    for (const row of rows) {
      const key = row.name.trim();
      if (key) fields[key] = { type: row.type || 'string' };
    }
    setSaving(true);
    setError('');
    const r = await lensRun('schema', 'registryCreate', { name: title, schema: { fields } });
    setSaving(false);
    if (!r.data?.ok) {
      setError(r.data?.error || 'Schema was not saved.');
      return;
    }
    setComposing(false);
    setName('');
    setRows([{ name: '', type: 'string' }]);
    await qc.invalidateQueries({ queryKey: ['schema-north'] });
  };

  const tables = shapes.data ?? [];

  return (
    <LensShell lensId="schema" asMain={false} disableAgentFab>
      <div data-lens-theme="schema" className="relative min-h-[calc(100vh-3rem)] px-8 pb-28 pt-8">
        <div className="absolute right-8 top-8">
          <QuietMore items={[{ id: 'desk', label: 'Schema workbench' }]} onPick={() => onOpenDesk()} />
        </div>
        <NorthGreeting kicker="Schema" title={`The shape of the data${who ? `, ${who}` : ''}`} />
        <GraphFamilyPill active="schema" links={SHAPE_LINKS} />

        {list.isError && (
          <p role="alert" className="mt-8 text-[14px] text-rose-300">Schema list didn’t load.</p>
        )}
        {list.isSuccess && tables.length === 0 && !list.isFetching && (
          <p className="mt-10 text-[15px] text-zinc-500">No schemas yet.</p>
        )}

        {tables.length > 0 && (
          <div className="mt-10 flex flex-wrap items-start gap-6">
            {tables.map((entry, i) => {
              const latest = entry.versions?.[entry.versions.length - 1];
              const fields = Object.entries(latest?.schema?.fields ?? {});
              return (
                <div key={entry.id} className="flex items-start gap-6">
                  {i > 0 && <div aria-hidden className="mt-8 h-px w-10 bg-teal-400/70" />}
                  <div className="min-w-[240px] rounded-xl border border-white/10 bg-white/[0.03]">
                    <div className="border-b border-white/10 px-4 py-2.5 text-[14px] font-medium text-zinc-100">{entry.name}</div>
                    {fields.length === 0 ? (
                      <p className="px-4 py-3 text-[13px] text-zinc-500">No fields stored.</p>
                    ) : fields.slice(0, 8).map(([field, def]) => (
                      <div key={field} className="flex items-center justify-between gap-6 border-b border-white/5 px-4 py-2 text-[13px] last:border-0">
                        <span className="text-zinc-200">{field}</span>
                        <span className="text-zinc-500">{def?.type || 'string'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {composing && (
          <form className="mt-8 max-w-md space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input
              aria-label="Schema name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Schema name"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
            {rows.map((row, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  aria-label={`Field ${idx + 1} name`}
                  value={row.name}
                  onChange={(e) => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))}
                  placeholder="field"
                  className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
                />
                <select
                  aria-label={`Field ${idx + 1} type`}
                  value={row.type}
                  onChange={(e) => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, type: e.target.value } : r))}
                  className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[14px] text-zinc-200"
                >
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ))}
            <button type="button" onClick={() => setRows((prev) => [...prev, { name: '', type: 'string' }])} className="text-[13px] text-zinc-400 hover:text-zinc-100">
              Add field
            </button>
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-[14px] text-rose-300">{error}</p>}
        <button type="button" className={northCtaClass} disabled={saving} onClick={() => { if (composing) void save(); else setComposing(true); }}>
          {composing ? (saving ? 'Saving…' : 'Save schema') : '+ New schema'}
        </button>
      </div>
    </LensShell>
  );
}
