'use client';

import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, Cpu, Activity } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

/**
 * One brain slot as GET /api/brain/status actually returns it.
 * `getBrainStatus()` stores brains as a map keyed by slot name
 * (`conscious`, `utility`, …) with `enabled` plus `stats`. A member
 * view strips `model` and `url`. An array of slot objects is accepted
 * too — calling `.filter` on the map itself throws and takes the lens
 * down (`n.filter is not a function`).
 */
export interface BrainSlotView {
  slot: string;
  model?: string;
  role?: string;
  url?: string;
  host?: string;
  /** `enabled` on the live payload. `reachable` / `ok` are older aliases. */
  enabled?: boolean;
  avgResponseMs?: number;
  requests?: number;
  errors?: number;
  dtusGenerated?: number;
}

const BRAIN_DTU_TAGS = ['expert-mode', 'concord', 'brain-pool'];

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readEnabled(rec: Record<string, unknown>): boolean | undefined {
  if (typeof rec.enabled === 'boolean') return rec.enabled;
  if (typeof rec.reachable === 'boolean') return rec.reachable;
  if (typeof rec.ok === 'boolean') return rec.ok;
  return undefined;
}

function readSlot(rec: Record<string, unknown>, fallback: string): string {
  if (typeof rec.slot === 'string' && rec.slot) return rec.slot;
  if (typeof rec.name === 'string' && rec.name) return rec.name;
  return fallback;
}

function viewFrom(slot: string, value: unknown): BrainSlotView {
  const rec = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const stats = rec.stats && typeof rec.stats === 'object' && !Array.isArray(rec.stats)
    ? rec.stats as Record<string, unknown>
    : null;
  return {
    slot,
    model: typeof rec.model === 'string' && rec.model ? rec.model : undefined,
    role: typeof rec.role === 'string' && rec.role ? rec.role : undefined,
    url: typeof rec.url === 'string' && rec.url ? rec.url : undefined,
    host: typeof rec.host === 'string' && rec.host ? rec.host : undefined,
    enabled: readEnabled(rec),
    avgResponseMs: finite(rec.avgResponseMs),
    requests: stats ? finite(stats.requests) : finite(rec.totalRequests),
    errors: stats ? finite(stats.errors) : finite(rec.totalErrors),
    dtusGenerated: stats ? finite(stats.dtusGenerated) : undefined,
  };
}

/**
 * Normalize `brains` from GET /api/brain/status.
 * Returns [] when the field is absent, a slot list for a map or an array,
 * and null when a value is present but is neither (string, number, …).
 */
export function brainSlotsFromStatus(raw: unknown): BrainSlotView[] | null {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const rec = item as Record<string, unknown>;
      return [viewFrom(readSlot(rec, `brain-${i + 1}`), rec)];
    });
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
      const rec = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      return viewFrom(readSlot(rec, name), value);
    });
  }
  return null;
}

function sumPresent(brains: BrainSlotView[], key: 'requests' | 'errors'): number | null {
  let seen = false;
  let total = 0;
  for (const brain of brains) {
    const n = brain[key];
    if (typeof n === 'number') {
      seen = true;
      total += n;
    }
  }
  return seen ? total : null;
}

function slotLine(brain: BrainSlotView): string {
  const bits = [brain.slot];
  if (brain.model) bits.push(brain.model);
  if (brain.role) bits.push(brain.role);
  if (brain.enabled === true) bits.push('enabled');
  else if (brain.enabled === false) bits.push('disabled');
  if (typeof brain.requests === 'number') bits.push(`req ${brain.requests}`);
  if (typeof brain.errors === 'number') bits.push(`err ${brain.errors}`);
  if (typeof brain.avgResponseMs === 'number') bits.push(`avg ${brain.avgResponseMs}ms`);
  if (brain.host || brain.url) bits.push(brain.host || brain.url || '');
  return bits.join(' · ');
}

export function BrainPoolStatus() {
  const status = useQuery({
    queryKey: ['brain-status'],
    queryFn: async (): Promise<unknown> => {
      const r = await api.get('/api/brain/status');
      return r?.data ?? null;
    },
    refetchInterval: 15000,
  });

  const payload = status.data && typeof status.data === 'object'
    ? status.data as Record<string, unknown>
    : null;

  let slots: BrainSlotView[] | null = [];
  let unexpected = false;
  if (status.isSuccess) {
    if (status.data != null && typeof status.data !== 'object') {
      unexpected = true;
      slots = null;
    } else {
      slots = brainSlotsFromStatus(payload ? payload.brains : undefined);
      unexpected = slots === null;
    }
  }
  const brains = slots ?? [];
  const reportedOnline = payload && finite(payload.onlineCount);
  const enabledCount = brains.reduce((n, brain) => n + (brain.enabled === true ? 1 : 0), 0);
  const online = reportedOnline ?? enabledCount;
  const totalRequests = sumPresent(brains, 'requests');
  const totalErrors = sumPresent(brains, 'errors');
  const mode = payload && typeof payload.mode === 'string' ? payload.mode : null;

  return (
    <div className="space-y-4" data-testid="expert-brain-pool">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-fuchsia-400" />
          <h2 className="text-sm font-semibold text-white">Brain pool status</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/brain/status · live</span>
          {mode && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300">{mode}</span>
          )}
        </div>
        {brains.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-brain-status"
            title={`Brain pool snapshot — ${online}/${brains.length} enabled`}
            content={brains.map(slotLine).join('\n')}
            extraTags={BRAIN_DTU_TAGS}
            rawData={status.data as Record<string, unknown>}
          />
        )}
      </header>
      {status.isError && (
        <div role="alert" className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          /api/brain/status unreachable.
        </div>
      )}
      {unexpected && (
        <div role="alert" className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Brain status returned an unexpected shape.
        </div>
      )}
      {status.isSuccess && !unexpected && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5" data-testid="brain-enabled-count">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Enabled</div>
            <div className="mt-0.5 font-mono text-lg text-fuchsia-300">{online} <span className="text-[10px] text-zinc-400">/ {brains.length}</span></div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Requests</div>
            <div className="mt-0.5 font-mono text-lg text-fuchsia-300">{totalRequests == null ? '—' : totalRequests.toLocaleString()}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Errors</div>
            <div className="mt-0.5 font-mono text-lg text-fuchsia-300">{totalErrors == null ? '—' : totalErrors.toLocaleString()}</div>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        {brains.map((brain) => (
          <div
            key={brain.slot}
            data-testid={`brain-slot-${brain.slot}`}
            className={`rounded-lg border p-2.5 ${brain.enabled === false ? 'border-rose-500/30 bg-rose-500/5' : 'border-fuchsia-500/20 bg-fuchsia-500/5'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className={`h-3.5 w-3.5 ${brain.enabled === false ? 'text-rose-400' : 'text-fuchsia-400'}`} />
                <span className="font-mono text-sm text-zinc-100">{brain.slot}</span>
                {brain.model && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{brain.model}</span>}
              </div>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${brain.enabled === true ? 'bg-emerald-500/20 text-emerald-200' : brain.enabled === false ? 'bg-rose-500/30 text-rose-200' : 'bg-zinc-800 text-zinc-400'}`}>
                {brain.enabled === true ? 'Online' : brain.enabled === false ? 'Offline' : 'Unknown'}
              </span>
            </div>
            {brain.role && <p className="mt-1 text-[10px] text-zinc-400">{brain.role}</p>}
            <div className="mt-1 grid grid-cols-3 gap-1.5 text-[10px] text-zinc-400">
              <span className="flex items-center gap-0.5"><Activity className="h-3 w-3" />req {brain.requests ?? '—'}</span>
              <span>err {brain.errors ?? '—'}</span>
              <span>avg {brain.avgResponseMs ?? '—'}{typeof brain.avgResponseMs === 'number' ? 'ms' : ''}</span>
            </div>
            {(brain.host || brain.url) && <p className="mt-0.5 line-clamp-1 font-mono text-[9px] text-zinc-400">{brain.host || brain.url}</p>}
          </div>
        ))}
        {brains.length === 0 && !status.isPending && !status.isError && !unexpected && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No brains reported. Backend may be initializing.</div>
        )}
      </div>
      {status.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling brain pool…</div>}
    </div>
  );
}
