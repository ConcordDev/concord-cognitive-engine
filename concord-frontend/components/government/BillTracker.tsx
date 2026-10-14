'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, ExternalLink, Star, StarOff } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/** Canonical UI bill shape after normalizing the congress.gov macro payload. */
export interface Bill {
  id: string;
  number: string;
  congress: number;
  title: string;
  summary?: string;
  introducedDate: string;
  latestActionDate?: string;
  latestActionText?: string;
  status: BillStatus;
  sponsor?: { name: string; party: string; state: string };
  cosponsors?: number;
  subjects?: string[];
  url?: string;
}

export type BillStatus =
  | 'introduced'
  | 'committee'
  | 'floor'
  | 'passed_chamber'
  | 'passed_both'
  | 'signed'
  | 'vetoed'
  | 'failed'
  | 'unknown';

/** Raw row from government.bills-list (congress.gov) — no status/id. */
export type BillsListRow = {
  billId?: string;
  id?: string;
  congress?: number;
  type?: string;
  number?: string | number;
  title?: string;
  introducedDate?: string | null;
  latestAction?: string | null;
  latestActionDate?: string | null;
  latestActionText?: string | null;
  status?: string | null;
  originChamber?: string | null;
  url?: string | null;
  summary?: string;
  sponsor?: Bill['sponsor'];
  cosponsors?: number;
  subjects?: string[];
};

const STORAGE_KEY = 'concord:gov:bill-watch:v1';
function loadWatch(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveWatch(ids: string[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* noop */ }
}

const STATUS_COLOR: Record<BillStatus, string> = {
  introduced: 'bg-gray-500/20 text-gray-300',
  committee: 'bg-blue-500/20 text-blue-200',
  floor: 'bg-cyan-500/20 text-cyan-200',
  passed_chamber: 'bg-yellow-500/20 text-yellow-200',
  passed_both: 'bg-orange-500/20 text-orange-200',
  signed: 'bg-green-500/20 text-green-300',
  vetoed: 'bg-red-500/20 text-red-300',
  failed: 'bg-red-500/20 text-red-300',
  unknown: 'bg-gray-500/20 text-gray-400',
};

const KNOWN_STATUSES = new Set<string>(Object.keys(STATUS_COLOR));

/** Infer a coarse status from latest-action text when the macro omits status. */
export function deriveBillStatus(latestAction: string | null | undefined): BillStatus {
  if (!latestAction) return 'unknown';
  const t = latestAction.toLowerCase();
  if (/\bveto/.test(t)) return 'vetoed';
  if (/\bfailed\b|\brejected\b/.test(t)) return 'failed';
  if (/\bsigned\b|\bbecame public law\b|\benacted\b/.test(t)) return 'signed';
  if (/\bpassed\b.*\b(house|senate)\b.*\b(house|senate)\b|\bcleared (for|both)/.test(t)) return 'passed_both';
  if (/\bpassed\b/.test(t)) return 'passed_chamber';
  if (/\bfloor\b|\bconsidered\b|\bdebate\b/.test(t)) return 'floor';
  if (/\bcommittee\b|\breferred\b/.test(t)) return 'committee';
  if (/\bintroduced\b|\bread twice\b/.test(t)) return 'introduced';
  return 'unknown';
}

export function normalizeBill(raw: BillsListRow): Bill {
  const latestActionText = raw.latestActionText ?? raw.latestAction ?? undefined;
  const rawStatus = typeof raw.status === 'string' && raw.status.trim() ? raw.status.trim() : '';
  const status: BillStatus = KNOWN_STATUSES.has(rawStatus)
    ? (rawStatus as BillStatus)
    : deriveBillStatus(latestActionText);
  const type = raw.type || '';
  const number = raw.number != null ? String(raw.number) : '';
  const id = String(raw.id || raw.billId || `${type}${number}-${raw.congress || ''}` || cryptoRandomId());
  return {
    id,
    number: number ? `${type}${number}` : id,
    congress: Number(raw.congress) || 0,
    title: raw.title || id,
    summary: raw.summary,
    introducedDate: raw.introducedDate || '',
    latestActionDate: raw.latestActionDate || undefined,
    latestActionText: latestActionText || undefined,
    status,
    sponsor: raw.sponsor,
    cosponsors: raw.cosponsors,
    subjects: raw.subjects,
    url: raw.url || undefined,
  };
}

function cryptoRandomId(): string {
  return `bill_${Math.random().toString(36).slice(2, 10)}`;
}

export function statusLabel(status: string | null | undefined): string {
  const s = typeof status === 'string' && status.trim() ? status : 'unknown';
  return s.replace(/_/g, ' ');
}

export function BillTracker() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'watched' | BillStatus>('all');
  const [topic, setTopic] = useState('');
  const [watched, setWatched] = useState<string[]>([]);

  useEffect(() => { setWatched(loadWatch()); refresh(''); }, []);

  async function refresh(searchTopic: string) {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'bills-list', input: { topic: searchTopic, limit: 40 } });
      const rows = (res.data?.result?.bills || []) as BillsListRow[];
      setBills(rows.map(normalizeBill));
    } catch (e) { console.error('[Bills] failed', e); }
    finally { setLoading(false); }
  }

  function toggleWatch(id: string) {
    setWatched(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      saveWatch(next);
      return next;
    });
  }

  const visible = bills.filter(b => {
    if (filter === 'watched') return watched.includes(b.id);
    if (filter !== 'all' && b.status !== filter) return false;
    return true;
  });

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Bill tracker · 119th Congress</span>
        <span className="ml-auto text-[10px] text-gray-400">{watched.length} watching</span>
      </header>
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 flex-wrap text-xs">
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') refresh(topic); }}
          placeholder="Search by topic (climate, AI, healthcare…)"
          className="flex-1 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button onClick={() => refresh(topic)} className="px-3 py-1 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Search</button>
        <select value={filter} onChange={e => setFilter(e.target.value as 'all' | 'watched' | BillStatus)} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="all">All status</option>
          <option value="watched">Watched only</option>
          <option value="introduced">Introduced</option>
          <option value="committee">In committee</option>
          <option value="floor">On floor</option>
          <option value="passed_chamber">Passed chamber</option>
          <option value="passed_both">Passed both</option>
          <option value="signed">Signed</option>
          <option value="vetoed">Vetoed</option>
          <option value="failed">Failed</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading bills…</div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">No bills match.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(b => (
              <li key={b.id} className="px-3 py-3 hover:bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <button onClick={() => toggleWatch(b.id)} className="mt-1 text-gray-400 hover:text-yellow-400" title={watched.includes(b.id) ? 'Unwatch' : 'Watch'}>
                    {watched.includes(b.id) ? <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" /> : <StarOff className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-cyan-300 text-xs">{b.number}</span>
                      <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold', STATUS_COLOR[b.status] || STATUS_COLOR.unknown)}>{statusLabel(b.status)}</span>
                      {b.url && (
                        <a href={b.url} target="_blank" rel="noreferrer noopener" className="ml-auto text-[10px] text-cyan-300 hover:text-cyan-100 inline-flex items-center gap-0.5">
                          congress.gov <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-sm text-white">{b.title}</div>
                    {b.summary && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{b.summary}</p>}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                      {b.sponsor && <span>{b.sponsor.name} ({b.sponsor.party}-{b.sponsor.state})</span>}
                      {b.cosponsors != null && <span>{b.cosponsors} co-sponsors</span>}
                      {b.latestActionDate && <span>Last action {new Date(b.latestActionDate).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default BillTracker;
