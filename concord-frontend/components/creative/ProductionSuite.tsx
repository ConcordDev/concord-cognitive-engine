'use client';

/**
 * ProductionSuite — the StudioBinder + Frame.io parity surface for the
 * creative lens. Wires seven production-management features end-to-end
 * against the `creative` domain macros:
 *   1. Frame-accurate review comments (review-asset-* / review-comment-*)
 *   2. Call sheet generator (callsheet-*)
 *   3. Script breakdown (breakdown-*)
 *   4. Version stacking on deliverables (deliverable-*)
 *   5. Approval workflow (deliverable-submit / deliverable-decide)
 *   6. Production calendar (calendar-*)
 *   7. Shareable client-proof links + external comments (prooflink-*)
 *
 * Every value rendered comes from a real macro response. No seed data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import {
  Clapperboard, MessageSquare, ClipboardList, Layers, CalendarDays, Link2,
  Plus, Trash2, X, CheckCircle2, Clock, Send, RotateCcw, Film, Image as ImageIcon,
  Copy, Check, ChevronRight, Tag, Users, MapPin,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SuiteTab = 'review' | 'callsheets' | 'breakdown' | 'deliverables' | 'calendar' | 'prooflinks';

interface ReviewAsset {
  id: string; name: string; kind: 'video' | 'image'; src: string | null;
  durationSec: number; project: string | null; commentCount: number; openCount: number;
}
interface ReviewComment {
  id: string; assetId: string; author: string; body: string;
  timestampSec: number | null; x: number | null; y: number | null;
  resolved: boolean; createdAt: string;
}
interface CallSheetRow { id: string; [k: string]: unknown; }
interface CallSheet {
  id: string; project: string; shootDate: string; dayNumber: number; generalCall: string;
  cast: CallSheetRow[]; crew: CallSheetRow[]; locations: CallSheetRow[]; schedule: CallSheetRow[];
  notes: string; castCount?: number; crewCount?: number; locationCount?: number; sceneCount?: number;
}
interface BreakdownTag { id: string; value: string; }
interface Breakdown {
  id: string; title: string; project: string | null; script: string;
  tags: Record<string, BreakdownTag[]>;
  scriptLength?: number; tagCount?: number; createdAt?: string; updatedAt?: string;
}
interface BreakdownSuggestions { cast: string[]; locations: string[]; }
interface DeliverableVersion {
  version: number; src: string | null; note: string; uploadedBy: string; uploadedAt: string;
}
interface Deliverable {
  id: string; name: string; project: string | null; versions: DeliverableVersion[];
  currentVersion: number; status: string; reviewer: string | null;
  decisionNote: string | null; decidedAt: string | null; submittedAt: string | null;
  versionCount?: number;
}
interface CalendarEvent {
  id: string; title: string; date: string; kind: string; project: string | null;
  endDate: string | null; notes: string; done: boolean;
}
interface ProofLink {
  id: string; token: string; assetId: string; label: string;
  allowComments: boolean; active: boolean; shareUrl: string; externalCommentCount: number;
}
interface ExtComment { id: string; token: string; authorName: string; body: string; timestampSec: number | null; createdAt: string; }

const SUITE_TABS: { id: SuiteTab; label: string; icon: typeof Clapperboard }[] = [
  { id: 'review', label: 'Review', icon: Film },
  { id: 'callsheets', label: 'Call Sheets', icon: ClipboardList },
  { id: 'breakdown', label: 'Script Breakdown', icon: Tag },
  { id: 'deliverables', label: 'Deliverables', icon: Layers },
  { id: 'calendar', label: 'Production Calendar', icon: CalendarDays },
  { id: 'prooflinks', label: 'Proof Links', icon: Link2 },
];

const BD_CATEGORIES = ['cast', 'props', 'locations', 'wardrobe', 'sfx', 'vehicles'];
const CAL_KINDS = ['shoot_day', 'milestone', 'deliverable_due', 'meeting', 'review'];
const CAL_TONE: Record<string, TimelineEvent['tone']> = {
  shoot_day: 'info', milestone: 'good', deliverable_due: 'warn', meeting: 'default', review: 'bad',
};

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------
const PANEL = 'rounded-xl border border-zinc-800 bg-zinc-950/40 p-4';
const INPUT = 'w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors';
const BTN_PRIMARY = `${BTN} bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40`;
const BTN_SECONDARY = `${BTN} bg-zinc-800 hover:bg-zinc-700 text-zinc-200`;
const BTN_GHOST = 'p-1 rounded text-zinc-400 hover:text-zinc-200 transition-colors';

function fmtTime(sec: number | null): string {
  if (sec == null) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ProductionSuite() {
  const [tab, setTab] = useState<SuiteTab>('review');

  return (
    <div className="space-y-4" data-testid="creative-production-suite">
      <div className="flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-violet-400" />
        <h2 className="text-base font-semibold text-zinc-100">Production Suite</h2>
        <span className="text-xs text-zinc-400">StudioBinder + Frame.io parity</span>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
        {SUITE_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-violet-500/20 text-violet-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'review' && <ReviewTab />}
      {tab === 'callsheets' && <CallSheetTab />}
      {tab === 'breakdown' && <BreakdownTab />}
      {tab === 'deliverables' && <DeliverableTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'prooflinks' && <ProofLinkTab />}
    </div>
  );
}

// ===========================================================================
// Feature 1 — Frame-accurate review comments
// ===========================================================================
function ReviewTab() {
  const [assets, setAssets] = useState<ReviewAsset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'video' | 'image'>('video');
  const [src, setSrc] = useState('');
  const [duration, setDuration] = useState('');
  const [project, setProject] = useState('');
  // comment composer
  const [cBody, setCBody] = useState('');
  const [cAuthor, setCAuthor] = useState('');
  const [cTimestamp, setCTimestamp] = useState('');

  const loadAssets = useCallback(async () => {
    const r = await lensRun<{ assets: ReviewAsset[] }>('creative', 'review-asset-list', {});
    setAssets(r.data.result?.assets || []);
  }, []);

  const loadComments = useCallback(async (assetId: string) => {
    const r = await lensRun<{ comments: ReviewComment[] }>('creative', 'review-comment-list', { assetId });
    setComments(r.data.result?.comments || []);
  }, []);

  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => { if (selected) void loadComments(selected); }, [selected, loadComments]);

  const activeAsset = assets.find((a) => a.id === selected) || null;

  const createAsset = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun<{ asset: ReviewAsset }>('creative', 'review-asset-create', {
      name: name.trim(), kind, src: src.trim() || undefined,
      durationSec: kind === 'video' ? Number(duration) || 0 : 0,
      project: project.trim() || undefined,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setName(''); setSrc(''); setDuration(''); setProject(''); setShowNew(false);
      await loadAssets();
      setSelected(r.data.result.asset.id);
    }
  };

  const deleteAsset = async (id: string) => {
    await lensRun('creative', 'review-asset-delete', { id });
    if (selected === id) { setSelected(null); setComments([]); }
    await loadAssets();
  };

  const addComment = async () => {
    if (!selected || !cBody.trim()) return;
    setBusy(true);
    const ts = activeAsset?.kind === 'video' && cTimestamp ? Number(cTimestamp) : undefined;
    const r = await lensRun('creative', 'review-comment-add', {
      assetId: selected, body: cBody.trim(),
      author: cAuthor.trim() || undefined,
      timestampSec: ts,
    });
    setBusy(false);
    if (r.data.ok) {
      setCBody(''); setCTimestamp('');
      await loadComments(selected);
      await loadAssets();
    }
  };

  const toggleResolved = async (c: ReviewComment) => {
    await lensRun('creative', 'review-comment-resolve', { id: c.id, resolved: !c.resolved });
    if (selected) { await loadComments(selected); await loadAssets(); }
  };

  const deleteComment = async (id: string) => {
    await lensRun('creative', 'review-comment-delete', { id });
    if (selected) { await loadComments(selected); await loadAssets(); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Asset list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">Review Assets</h3>
          <button onClick={() => setShowNew((v) => !v)} className={BTN_SECONDARY}>
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
        {showNew && (
          <div className={`${PANEL} space-y-2`}>
            <input className={INPUT} placeholder="Asset name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-2">
              <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as 'video' | 'image')}>
                <option value="video">Video</option>
                <option value="image">Image</option>
              </select>
              {kind === 'video' && (
                <input className={INPUT} type="number" placeholder="Duration (sec)" value={duration} onChange={(e) => setDuration(e.target.value)} />
              )}
            </div>
            <input className={INPUT} placeholder="Source URL (optional)" value={src} onChange={(e) => setSrc(e.target.value)} />
            <input className={INPUT} placeholder="Project (optional)" value={project} onChange={(e) => setProject(e.target.value)} />
            <button onClick={createAsset} disabled={busy || !name.trim()} className={BTN_PRIMARY}>
              Create asset
            </button>
          </div>
        )}
        {assets.length === 0 && !showNew && (
          <p className="text-xs text-zinc-400">No review assets yet. Upload a video or image to start a review.</p>
        )}
        {assets.map((a) => (
          <div
            key={a.id}
            onClick={() => setSelected(a.id)}
            className={`${PANEL} cursor-pointer transition-colors ${selected === a.id ? 'border-violet-500/60' : 'hover:border-zinc-700'}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {a.kind === 'video' ? <Film className="w-4 h-4 text-violet-400 shrink-0" /> : <ImageIcon className="w-4 h-4 text-cyan-400 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{a.name}</p>
                  <p className="text-xs text-zinc-400">{a.project || 'No project'}{a.kind === 'video' ? ` · ${fmtTime(a.durationSec)}` : ''}</p>
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteAsset(a.id); }} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete asset">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
              <span><MessageSquare className="w-3 h-3 inline mr-1" />{a.commentCount} comment{a.commentCount !== 1 ? 's' : ''}</span>
              {a.openCount > 0 && <span className="text-amber-400">{a.openCount} open</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Comment thread */}
      <div className="lg:col-span-2 space-y-3">
        {!activeAsset ? (
          <div className={`${PANEL} text-center py-12`}>
            <Film className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">Select a review asset to see frame-accurate comments.</p>
          </div>
        ) : (
          <>
            <div className={PANEL}>
              <h3 className="text-sm font-semibold text-zinc-100 mb-1">{activeAsset.name}</h3>
              <p className="text-xs text-zinc-400 mb-3">
                {activeAsset.kind === 'video' ? `Video · ${fmtTime(activeAsset.durationSec)}` : 'Image'} · {comments.length} comment{comments.length !== 1 ? 's' : ''}
              </p>
              {activeAsset.src && (
                activeAsset.kind === 'video'
                  ? <video src={activeAsset.src} controls className="w-full rounded-lg max-h-64 bg-black" />
                  : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeAsset.src} alt={activeAsset.name} className="w-full rounded-lg max-h-64 object-contain bg-black" />
                  )
              )}
              {/* Comment composer */}
              <div className="mt-3 space-y-2">
                <textarea
                  className={INPUT} rows={2}
                  placeholder="Leave a comment at a precise frame..."
                  value={cBody} onChange={(e) => setCBody(e.target.value)}
                />
                <div className="flex gap-2">
                  <input className={INPUT} placeholder="Your name (optional)" value={cAuthor} onChange={(e) => setCAuthor(e.target.value)} />
                  {activeAsset.kind === 'video' && (
                    <input
                      className={INPUT} type="number" min={0} max={activeAsset.durationSec || undefined}
                      placeholder="Timestamp (sec)" value={cTimestamp} onChange={(e) => setCTimestamp(e.target.value)}
                    />
                  )}
                  <button onClick={addComment} disabled={busy || !cBody.trim()} className={BTN_PRIMARY}>
                    <Send className="w-3.5 h-3.5" /> Post
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {comments.length === 0 && <p className="text-xs text-zinc-400">No comments yet. Be the first to annotate this asset.</p>}
              {comments.map((c) => (
                <div key={c.id} className={`${PANEL} ${c.resolved ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {c.timestampSec != null && (
                        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-xs font-mono text-violet-300">{fmtTime(c.timestampSec)}</span>
                      )}
                      <span className="text-sm font-medium text-zinc-200">{c.author}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => toggleResolved(c)} className={`${BTN_GHOST} ${c.resolved ? 'text-emerald-400' : 'hover:text-emerald-400'}`} aria-label="Resolve">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteComment(c.id)} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete comment">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-300 mt-1">{c.body}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Feature 2 — Call sheet generator
// ===========================================================================
function CallSheetTab() {
  const [sheets, setSheets] = useState<CallSheet[]>([]);
  const [active, setActive] = useState<CallSheet | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [project, setProject] = useState('');
  const [shootDate, setShootDate] = useState('');
  const [dayNumber, setDayNumber] = useState('1');
  const [generalCall, setGeneralCall] = useState('08:00');
  // row composer
  const [section, setSection] = useState<'cast' | 'crew' | 'locations' | 'schedule'>('cast');
  const [rowFields, setRowFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadSheets = useCallback(async () => {
    const r = await lensRun<{ sheets: CallSheet[] }>('creative', 'callsheet-list', {});
    setSheets(r.data.result?.sheets || []);
  }, []);

  const loadSheet = useCallback(async (id: string) => {
    const r = await lensRun<{ sheet: CallSheet }>('creative', 'callsheet-get', { id });
    if (r.data.ok && r.data.result) setActive(r.data.result.sheet);
  }, []);

  useEffect(() => { void loadSheets(); }, [loadSheets]);

  const createSheet = async () => {
    if (!project.trim()) return;
    setBusy(true);
    const r = await lensRun<{ sheet: CallSheet }>('creative', 'callsheet-create', {
      project: project.trim(),
      shootDate: shootDate || undefined,
      dayNumber: Number(dayNumber) || 1,
      generalCall: generalCall || undefined,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setProject(''); setShootDate(''); setDayNumber('1'); setShowNew(false);
      await loadSheets();
      setActive(r.data.result.sheet);
    }
  };

  const deleteSheet = async (id: string) => {
    await lensRun('creative', 'callsheet-delete', { id });
    if (active?.id === id) setActive(null);
    await loadSheets();
  };

  const addRow = async () => {
    if (!active) return;
    setBusy(true);
    const r = await lensRun<{ sheet: CallSheet }>('creative', 'callsheet-add-row', {
      id: active.id, section, ...rowFields,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setRowFields({});
      setActive(r.data.result.sheet);
      await loadSheets();
    }
  };

  const removeRow = async (sec: string, rowId: string) => {
    if (!active) return;
    const r = await lensRun<{ sheet: CallSheet }>('creative', 'callsheet-remove-row', { id: active.id, section: sec, rowId });
    if (r.data.ok && r.data.result) { setActive(r.data.result.sheet); await loadSheets(); }
  };

  const rowSpec: Record<string, { key: string; label: string }[]> = {
    cast: [{ key: 'name', label: 'Cast name' }, { key: 'role', label: 'Role' }, { key: 'callTime', label: 'Call time (HH:MM)' }],
    crew: [{ key: 'name', label: 'Crew name' }, { key: 'department', label: 'Department' }, { key: 'callTime', label: 'Call time (HH:MM)' }],
    locations: [{ key: 'name', label: 'Location name' }, { key: 'address', label: 'Address' }],
    schedule: [{ key: 'time', label: 'Time' }, { key: 'scene', label: 'Scene / activity' }],
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">Call Sheets</h3>
          <button onClick={() => setShowNew((v) => !v)} className={BTN_SECONDARY}><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
        {showNew && (
          <div className={`${PANEL} space-y-2`}>
            <input className={INPUT} placeholder="Project" value={project} onChange={(e) => setProject(e.target.value)} />
            <input className={INPUT} type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} />
            <div className="flex gap-2">
              <input className={INPUT} type="number" min={1} placeholder="Day #" value={dayNumber} onChange={(e) => setDayNumber(e.target.value)} />
              <input className={INPUT} placeholder="General call" value={generalCall} onChange={(e) => setGeneralCall(e.target.value)} />
            </div>
            <button onClick={createSheet} disabled={busy || !project.trim()} className={BTN_PRIMARY}>Create call sheet</button>
          </div>
        )}
        {sheets.length === 0 && !showNew && <p className="text-xs text-zinc-400">No call sheets. Create one per shoot day.</p>}
        {sheets.map((cs) => (
          <div
            key={cs.id}
            onClick={() => loadSheet(cs.id)}
            className={`${PANEL} cursor-pointer transition-colors ${active?.id === cs.id ? 'border-violet-500/60' : 'hover:border-zinc-700'}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">{cs.project}</p>
                <p className="text-xs text-zinc-400">Day {cs.dayNumber} · {cs.shootDate} · call {cs.generalCall}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteSheet(cs.id); }} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-3 mt-2 text-xs text-zinc-400">
              <span>{cs.castCount ?? cs.cast?.length ?? 0} cast</span>
              <span>{cs.crewCount ?? cs.crew?.length ?? 0} crew</span>
              <span>{cs.locationCount ?? cs.locations?.length ?? 0} loc</span>
              <span>{cs.sceneCount ?? cs.schedule?.length ?? 0} scenes</span>
            </div>
          </div>
        ))}
      </div>

      <div className="lg:col-span-2 space-y-3">
        {!active ? (
          <div className={`${PANEL} text-center py-12`}>
            <ClipboardList className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">Select a call sheet to manage cast, crew, locations and schedule.</p>
          </div>
        ) : (
          <>
            <div className={PANEL}>
              <h3 className="text-sm font-semibold text-zinc-100">{active.project} — Day {active.dayNumber}</h3>
              <p className="text-xs text-zinc-400">Shoot date {active.shootDate} · General crew call {active.generalCall}</p>
            </div>

            {/* Row composer */}
            <div className={`${PANEL} space-y-2`}>
              <div className="flex gap-2">
                <select className={INPUT} value={section} onChange={(e) => { setSection(e.target.value as typeof section); setRowFields({}); }}>
                  <option value="cast">Cast</option>
                  <option value="crew">Crew</option>
                  <option value="locations">Locations</option>
                  <option value="schedule">Schedule</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {rowSpec[section].map((f) => (
                  <input
                    key={f.key} className={INPUT} placeholder={f.label}
                    value={rowFields[f.key] || ''}
                    onChange={(e) => setRowFields((r) => ({ ...r, [f.key]: e.target.value }))}
                  />
                ))}
              </div>
              <button onClick={addRow} disabled={busy} className={BTN_PRIMARY}><Plus className="w-3.5 h-3.5" /> Add {section} row</button>
            </div>

            {/* Sections */}
            {([
              { key: 'cast', label: 'Cast', icon: Users, cols: ['name', 'role', 'callTime'] },
              { key: 'crew', label: 'Crew', icon: Users, cols: ['name', 'department', 'callTime'] },
              { key: 'locations', label: 'Locations', icon: MapPin, cols: ['name', 'address'] },
              { key: 'schedule', label: 'Schedule', icon: Clock, cols: ['time', 'scene'] },
            ] as const).map((sec) => {
              const rows = (active[sec.key] as CallSheetRow[]) || [];
              const SecIcon = sec.icon;
              return (
                <div key={sec.key} className={PANEL}>
                  <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                    <SecIcon className="w-3.5 h-3.5 text-violet-400" /> {sec.label} ({rows.length})
                  </h4>
                  {rows.length === 0 ? (
                    <p className="text-xs text-zinc-400">No {sec.label.toLowerCase()} rows.</p>
                  ) : (
                    <div className="space-y-1">
                      {rows.map((row) => (
                        <div key={row.id} className="flex items-center gap-3 text-sm text-zinc-300 border-b border-zinc-800/60 last:border-0 py-1.5">
                          {sec.cols.map((col) => (
                            <span key={col} className="flex-1 truncate">{String(row[col] ?? '—')}</span>
                          ))}
                          <button onClick={() => removeRow(sec.key, row.id)} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Remove row">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Feature 3 — Script breakdown
// ===========================================================================
function BreakdownTab() {
  const [list, setList] = useState<Breakdown[]>([]);
  const [active, setActive] = useState<Breakdown | null>(null);
  const [suggestions, setSuggestions] = useState<BreakdownSuggestions>({ cast: [], locations: [] });
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [script, setScript] = useState('');
  const [tagCategory, setTagCategory] = useState('cast');
  const [tagValue, setTagValue] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const r = await lensRun<{ breakdowns: Breakdown[] }>('creative', 'breakdown-list', {});
    setList(r.data.result?.breakdowns || []);
  }, []);

  const loadOne = useCallback(async (id: string) => {
    const r = await lensRun<{ breakdown: Breakdown; suggestions: BreakdownSuggestions }>('creative', 'breakdown-get', { id });
    if (r.data.ok && r.data.result) {
      setActive(r.data.result.breakdown);
      setSuggestions(r.data.result.suggestions);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const createBreakdown = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const r = await lensRun<{ breakdown: Breakdown; suggestions: BreakdownSuggestions }>('creative', 'breakdown-create', {
      title: title.trim(), project: project.trim() || undefined, script,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setTitle(''); setProject(''); setScript(''); setShowNew(false);
      await loadList();
      setActive(r.data.result.breakdown);
      setSuggestions(r.data.result.suggestions);
    }
  };

  const deleteBreakdown = async (id: string) => {
    await lensRun('creative', 'breakdown-delete', { id });
    if (active?.id === id) setActive(null);
    await loadList();
  };

  const tag = async (category: string, value: string) => {
    if (!active || !value.trim()) return;
    const r = await lensRun<{ breakdown: Breakdown }>('creative', 'breakdown-tag', { id: active.id, category, value: value.trim() });
    if (r.data.ok && r.data.result) { setActive(r.data.result.breakdown); setTagValue(''); await loadList(); }
  };

  const untag = async (category: string, tagId: string) => {
    if (!active) return;
    const r = await lensRun<{ breakdown: Breakdown }>('creative', 'breakdown-untag', { id: active.id, category, tagId });
    if (r.data.ok && r.data.result) { setActive(r.data.result.breakdown); await loadList(); }
  };

  const rescan = async () => {
    if (!active) return;
    const r = await lensRun<{ breakdown: Breakdown; suggestions: BreakdownSuggestions }>('creative', 'breakdown-rescan', { id: active.id });
    if (r.data.ok && r.data.result) { setActive(r.data.result.breakdown); setSuggestions(r.data.result.suggestions); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">Breakdowns</h3>
          <button onClick={() => setShowNew((v) => !v)} className={BTN_SECONDARY}><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
        {showNew && (
          <div className={`${PANEL} space-y-2`}>
            <input className={INPUT} placeholder="Breakdown title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className={INPUT} placeholder="Project (optional)" value={project} onChange={(e) => setProject(e.target.value)} />
            <textarea className={INPUT} rows={6} placeholder="Paste script (INT./EXT. headings + ALL-CAPS character cues auto-detected)" value={script} onChange={(e) => setScript(e.target.value)} />
            <button onClick={createBreakdown} disabled={busy || !title.trim()} className={BTN_PRIMARY}>Create + auto-scan</button>
          </div>
        )}
        {list.length === 0 && !showNew && <p className="text-xs text-zinc-400">No breakdowns yet.</p>}
        {list.map((b) => (
          <div
            key={b.id}
            onClick={() => loadOne(b.id)}
            className={`${PANEL} cursor-pointer transition-colors ${active?.id === b.id ? 'border-violet-500/60' : 'hover:border-zinc-700'}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">{b.title}</p>
                <p className="text-xs text-zinc-400">{b.project || 'No project'} · {b.tagCount ?? 0} tags · {b.scriptLength ?? 0} chars</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteBreakdown(b.id); }} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="lg:col-span-2 space-y-3">
        {!active ? (
          <div className={`${PANEL} text-center py-12`}>
            <Tag className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">Select a breakdown to tag props, cast, locations and more.</p>
          </div>
        ) : (
          <>
            <div className={PANEL}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">{active.title}</h3>
                <button onClick={rescan} className={BTN_SECONDARY}><RotateCcw className="w-3.5 h-3.5" /> Re-scan</button>
              </div>
              {(suggestions.cast.length > 0 || suggestions.locations.length > 0) && (
                <div className="mt-3 space-y-2">
                  {suggestions.cast.length > 0 && (
                    <div>
                      <p className="text-xs text-zinc-400 mb-1">Detected cast — click to tag</p>
                      <div className="flex flex-wrap gap-1">
                        {suggestions.cast.map((s) => (
                          <button key={s} onClick={() => tag('cast', s)} className="rounded-full bg-zinc-800 hover:bg-violet-500/30 px-2 py-0.5 text-xs text-zinc-300">
                            <Plus className="w-2.5 h-2.5 inline mr-0.5" />{s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {suggestions.locations.length > 0 && (
                    <div>
                      <p className="text-xs text-zinc-400 mb-1">Detected locations — click to tag</p>
                      <div className="flex flex-wrap gap-1">
                        {suggestions.locations.map((s) => (
                          <button key={s} onClick={() => tag('locations', s)} className="rounded-full bg-zinc-800 hover:bg-violet-500/30 px-2 py-0.5 text-xs text-zinc-300">
                            <Plus className="w-2.5 h-2.5 inline mr-0.5" />{s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Manual tag composer */}
            <div className={`${PANEL} flex gap-2`}>
              <select className={INPUT} value={tagCategory} onChange={(e) => setTagCategory(e.target.value)}>
                {BD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className={INPUT} placeholder="Tag value" value={tagValue} onChange={(e) => setTagValue(e.target.value)} />
              <button onClick={() => tag(tagCategory, tagValue)} disabled={!tagValue.trim()} className={BTN_PRIMARY}>Tag</button>
            </div>

            {/* Tag categories */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BD_CATEGORIES.map((cat) => {
                const tags = active.tags[cat] || [];
                return (
                  <div key={cat} className={PANEL}>
                    <h4 className="text-xs font-semibold text-zinc-300 capitalize mb-2">{cat} ({tags.length})</h4>
                    {tags.length === 0 ? (
                      <p className="text-xs text-zinc-400">None tagged.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300">
                            {t.value}
                            <button onClick={() => untag(cat, t.id)} aria-label="Remove tag"><X className="w-2.5 h-2.5" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Features 4 + 5 — Version stacking + approval workflow
// ===========================================================================
const STATUS_TONE: Record<string, string> = {
  draft: 'bg-zinc-700 text-zinc-300',
  in_review: 'bg-amber-500/20 text-amber-300',
  approved: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-rose-500/20 text-rose-300',
  changes_requested: 'bg-orange-500/20 text-orange-300',
};

function DeliverableTab() {
  const [list, setList] = useState<Deliverable[]>([]);
  const [active, setActive] = useState<Deliverable | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [src, setSrc] = useState('');
  // version composer
  const [vNote, setVNote] = useState('');
  const [vSrc, setVSrc] = useState('');
  // workflow
  const [reviewer, setReviewer] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const r = await lensRun<{ deliverables: Deliverable[] }>('creative', 'deliverable-list', {});
    setList(r.data.result?.deliverables || []);
  }, []);

  const loadOne = useCallback(async (id: string) => {
    const r = await lensRun<{ deliverable: Deliverable }>('creative', 'deliverable-get', { id });
    if (r.data.ok && r.data.result) setActive(r.data.result.deliverable);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const refresh = async (id: string) => { await loadOne(id); await loadList(); };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun<{ deliverable: Deliverable }>('creative', 'deliverable-create', {
      name: name.trim(), project: project.trim() || undefined, src: src.trim() || undefined,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setName(''); setProject(''); setSrc(''); setShowNew(false);
      await loadList();
      setActive(r.data.result.deliverable);
    }
  };

  const del = async (id: string) => {
    await lensRun('creative', 'deliverable-delete', { id });
    if (active?.id === id) setActive(null);
    await loadList();
  };

  const addVersion = async () => {
    if (!active) return;
    setBusy(true);
    const r = await lensRun('creative', 'deliverable-add-version', { id: active.id, note: vNote.trim() || undefined, src: vSrc.trim() || undefined });
    setBusy(false);
    if (r.data.ok) { setVNote(''); setVSrc(''); await refresh(active.id); }
  };

  const setCurrent = async (version: number) => {
    if (!active) return;
    await lensRun('creative', 'deliverable-set-current', { id: active.id, version });
    await refresh(active.id);
  };

  const submit = async () => {
    if (!active) return;
    await lensRun('creative', 'deliverable-submit', { id: active.id, reviewer: reviewer.trim() || undefined });
    setReviewer('');
    await refresh(active.id);
  };

  const decide = async (decision: 'approved' | 'rejected' | 'changes_requested') => {
    if (!active) return;
    await lensRun('creative', 'deliverable-decide', { id: active.id, decision, note: decisionNote.trim() || undefined });
    setDecisionNote('');
    await refresh(active.id);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">Deliverables</h3>
          <button onClick={() => setShowNew((v) => !v)} className={BTN_SECONDARY}><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
        {showNew && (
          <div className={`${PANEL} space-y-2`}>
            <input className={INPUT} placeholder="Deliverable name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={INPUT} placeholder="Project (optional)" value={project} onChange={(e) => setProject(e.target.value)} />
            <input className={INPUT} placeholder="Initial file URL (optional)" value={src} onChange={(e) => setSrc(e.target.value)} />
            <button onClick={create} disabled={busy || !name.trim()} className={BTN_PRIMARY}>Create deliverable</button>
          </div>
        )}
        {list.length === 0 && !showNew && <p className="text-xs text-zinc-400">No deliverables yet.</p>}
        {list.map((d) => (
          <div
            key={d.id}
            onClick={() => loadOne(d.id)}
            className={`${PANEL} cursor-pointer transition-colors ${active?.id === d.id ? 'border-violet-500/60' : 'hover:border-zinc-700'}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">{d.name}</p>
                <p className="text-xs text-zinc-400">{d.project || 'No project'} · v{d.currentVersion} of {d.versionCount ?? d.versions?.length ?? 1}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); del(d.id); }} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[d.status] || STATUS_TONE.draft}`}>
              {d.status.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>

      <div className="lg:col-span-2 space-y-3">
        {!active ? (
          <div className={`${PANEL} text-center py-12`}>
            <Layers className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">Select a deliverable to stack versions and route approvals.</p>
          </div>
        ) : (
          <>
            <div className={PANEL}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">{active.name}</h3>
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[active.status] || STATUS_TONE.draft}`}>
                  {active.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Current v{active.currentVersion}{active.reviewer ? ` · reviewer ${active.reviewer}` : ''}
              </p>
              {active.decisionNote && (
                <p className="text-xs text-zinc-400 mt-1">Decision note: {active.decisionNote}</p>
              )}
            </div>

            {/* Approval workflow */}
            <div className={`${PANEL} space-y-2`}>
              <h4 className="text-xs font-semibold text-zinc-300">Approval Workflow</h4>
              {active.status !== 'in_review' ? (
                <div className="flex gap-2">
                  <input className={INPUT} placeholder="Reviewer name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
                  <button onClick={submit} disabled={active.status === 'approved'} className={BTN_PRIMARY}>
                    <Send className="w-3.5 h-3.5" /> Submit for review
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea className={INPUT} rows={2} placeholder="Decision note (optional)" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => decide('approved')} className={`${BTN} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button onClick={() => decide('changes_requested')} className={`${BTN} bg-orange-600 hover:bg-orange-500 text-white`}>
                      <RotateCcw className="w-3.5 h-3.5" /> Request changes
                    </button>
                    <button onClick={() => decide('rejected')} className={`${BTN} bg-rose-600 hover:bg-rose-500 text-white`}>
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Version stack */}
            <div className={`${PANEL} space-y-2`}>
              <h4 className="text-xs font-semibold text-zinc-300">New Version</h4>
              <div className="flex gap-2">
                <input className={INPUT} placeholder="Version note" value={vNote} onChange={(e) => setVNote(e.target.value)} />
                <input className={INPUT} placeholder="File URL (optional)" value={vSrc} onChange={(e) => setVSrc(e.target.value)} />
                <button onClick={addVersion} disabled={busy} className={BTN_PRIMARY}><Plus className="w-3.5 h-3.5" /> Add</button>
              </div>
            </div>

            <div className={PANEL}>
              <h4 className="text-xs font-semibold text-zinc-300 mb-2">Revision Chain ({active.versions.length})</h4>
              <div className="space-y-1.5">
                {[...active.versions].reverse().map((v) => (
                  <div
                    key={v.version}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                      v.version === active.currentVersion ? 'border-violet-500/60 bg-violet-500/5' : 'border-zinc-800'
                    }`}
                  >
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-300">v{v.version}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate">{v.note}</p>
                      <p className="text-xs text-zinc-400">{v.uploadedBy} · {new Date(v.uploadedAt).toLocaleString()}</p>
                    </div>
                    {v.version === active.currentVersion ? (
                      <span className="text-xs text-violet-300 flex items-center gap-1"><Check className="w-3 h-3" /> current</span>
                    ) : (
                      <button onClick={() => setCurrent(v.version)} className="text-xs text-zinc-400 hover:text-violet-300">Set current</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Feature 6 — Production calendar
// ===========================================================================
function CalendarTab() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [summary, setSummary] = useState({ upcoming: 0, overdue: 0 });
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState('shoot_day');
  const [project, setProject] = useState('');
  const [notes, setNotes] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const input = kindFilter !== 'all' ? { kind: kindFilter } : {};
    const r = await lensRun<{ events: CalendarEvent[]; upcoming: number; overdue: number }>('creative', 'calendar-list', input);
    setEvents(r.data.result?.events || []);
    setSummary({ upcoming: r.data.result?.upcoming || 0, overdue: r.data.result?.overdue || 0 });
  }, [kindFilter]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!title.trim() || !date) return;
    setBusy(true);
    const r = await lensRun('creative', 'calendar-add', {
      title: title.trim(), date, kind, project: project.trim() || undefined, notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (r.data.ok) { setTitle(''); setDate(''); setProject(''); setNotes(''); setShowNew(false); await load(); }
  };

  const toggleDone = async (ev: CalendarEvent) => {
    await lensRun('creative', 'calendar-update', { id: ev.id, done: !ev.done });
    await load();
  };

  const del = async (id: string) => {
    await lensRun('creative', 'calendar-delete', { id });
    await load();
  };

  const timelineEvents: TimelineEvent[] = useMemo(
    () => events.map((e) => ({
      id: e.id,
      label: e.title,
      time: e.date,
      tone: e.done ? 'good' : CAL_TONE[e.kind] || 'default',
      detail: `${e.kind.replace(/_/g, ' ')}${e.project ? ` · ${e.project}` : ''}`,
    })),
    [events],
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={PANEL}><p className="text-xs text-zinc-400">Total Events</p><p className="text-2xl font-bold text-zinc-100">{events.length}</p></div>
        <div className={PANEL}><p className="text-xs text-zinc-400">Upcoming</p><p className="text-2xl font-bold text-emerald-400">{summary.upcoming}</p></div>
        <div className={PANEL}><p className="text-xs text-zinc-400">Overdue</p><p className="text-2xl font-bold text-rose-400">{summary.overdue}</p></div>
        <div className={PANEL}>
          <p className="text-xs text-zinc-400 mb-1">Filter</p>
          <select className={INPUT} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">All kinds</option>
            {CAL_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Production Timeline</h3>
        <button onClick={() => setShowNew((v) => !v)} className={BTN_SECONDARY}><Plus className="w-3.5 h-3.5" /> Add event</button>
      </div>

      {showNew && (
        <div className={`${PANEL} grid grid-cols-1 sm:grid-cols-2 gap-2`}>
          <input className={INPUT} placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={INPUT} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value)}>
            {CAL_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <input className={INPUT} placeholder="Project (optional)" value={project} onChange={(e) => setProject(e.target.value)} />
          <input className={`${INPUT} sm:col-span-2`} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button onClick={create} disabled={busy || !title.trim() || !date} className={`${BTN_PRIMARY} sm:col-span-2`}>Add to calendar</button>
        </div>
      )}

      {events.length > 0 && (
        <div className={PANEL}>
          <TimelineView events={timelineEvents} />
        </div>
      )}

      <div className="space-y-2">
        {events.length === 0 && <p className="text-xs text-zinc-400">No production events. Add shoot days, milestones and due dates.</p>}
        {events.map((ev) => {
          const overdue = !ev.done && ev.date < today;
          return (
            <div key={ev.id} className={`${PANEL} flex items-center gap-3`}>
              <button
                onClick={() => toggleDone(ev)}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${ev.done ? 'border-emerald-400 bg-emerald-400/20' : 'border-zinc-600 hover:border-violet-400'}`}
                aria-label="Toggle done"
              >
                {ev.done && <Check className="w-3 h-3 text-emerald-400" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${ev.done ? 'text-zinc-400 line-through' : 'text-zinc-100'}`}>{ev.title}</p>
                <p className="text-xs text-zinc-400">
                  {ev.date} · {ev.kind.replace(/_/g, ' ')}{ev.project ? ` · ${ev.project}` : ''}
                  {overdue && <span className="text-rose-400 ml-1">overdue</span>}
                </p>
              </div>
              <button onClick={() => del(ev.id)} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete event">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// Feature 7 — Shareable client-proof links + external comments
// ===========================================================================
function ProofLinkTab() {
  const [assets, setAssets] = useState<ReviewAsset[]>([]);
  const [links, setLinks] = useState<ProofLink[]>([]);
  const [inbox, setInbox] = useState<ExtComment[]>([]);
  const [assetId, setAssetId] = useState('');
  const [label, setLabel] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAssets = useCallback(async () => {
    const r = await lensRun<{ assets: ReviewAsset[] }>('creative', 'review-asset-list', {});
    setAssets(r.data.result?.assets || []);
  }, []);

  const loadLinks = useCallback(async () => {
    const r = await lensRun<{ links: ProofLink[] }>('creative', 'prooflink-list', {});
    setLinks(r.data.result?.links || []);
  }, []);

  const loadInbox = useCallback(async () => {
    const r = await lensRun<{ comments: ExtComment[] }>('creative', 'prooflink-inbox', {});
    setInbox(r.data.result?.comments || []);
  }, []);

  useEffect(() => {
    void loadAssets(); void loadLinks(); void loadInbox();
  }, [loadAssets, loadLinks, loadInbox]);

  const createLink = async () => {
    if (!assetId) return;
    setBusy(true);
    const r = await lensRun('creative', 'prooflink-create', {
      assetId, label: label.trim() || undefined, allowComments,
    });
    setBusy(false);
    if (r.data.ok) { setLabel(''); setAssetId(''); await loadLinks(); }
  };

  const toggle = async (l: ProofLink) => {
    await lensRun('creative', 'prooflink-toggle', { id: l.id, active: !l.active });
    await loadLinks();
  };

  const del = async (id: string) => {
    await lensRun('creative', 'prooflink-delete', { id });
    await loadLinks();
  };

  const copyShare = async (l: ProofLink) => {
    const full = typeof window !== 'undefined' ? `${window.location.origin}${l.shareUrl}` : l.shareUrl;
    try {
      await navigator.clipboard.writeText(full);
      setCopiedToken(l.token);
      setTimeout(() => setCopiedToken(null), 1800);
    } catch {
      setCopiedToken(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className={`${PANEL} space-y-2`}>
          <h3 className="text-sm font-semibold text-zinc-300">New Shareable Proof Link</h3>
          {assets.length === 0 ? (
            <p className="text-xs text-zinc-400">Create a review asset first (Review tab) — proof links wrap a review asset.</p>
          ) : (
            <>
              <select className={INPUT} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">Select review asset...</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
              </select>
              <input className={INPUT} placeholder="Link label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />
                Allow external comments
              </label>
              <button onClick={createLink} disabled={busy || !assetId} className={BTN_PRIMARY}>
                <Link2 className="w-3.5 h-3.5" /> Generate proof link
              </button>
            </>
          )}
        </div>

        <div className="space-y-2">
          {links.length === 0 && <p className="text-xs text-zinc-400">No proof links yet.</p>}
          {links.map((l) => (
            <div key={l.id} className={PANEL}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{l.label}</p>
                  <p className="text-xs font-mono text-zinc-400 truncate">{l.shareUrl}</p>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${l.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-400'}`}>
                  {l.active ? 'active' : 'disabled'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => copyShare(l)} className={BTN_SECONDARY}>
                  {copiedToken === l.token ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
                </button>
                <button onClick={() => toggle(l)} className={BTN_SECONDARY}>
                  {l.active ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => del(l.id)} className={`${BTN_GHOST} hover:text-rose-400`} aria-label="Delete link">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <span className="ml-auto text-xs text-zinc-400">
                  <MessageSquare className="w-3 h-3 inline mr-1" />{l.externalCommentCount} external
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* External comment inbox */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-violet-400" /> External Inbox
        </h3>
        {inbox.length === 0 ? (
          <p className="text-xs text-zinc-400">No external comments captured yet. Share a proof link to collect client feedback.</p>
        ) : (
          inbox.map((c) => (
            <div key={c.id} className={PANEL}>
              <div className="flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-violet-400" />
                <span className="text-sm font-medium text-zinc-200">{c.authorName}</span>
                {c.timestampSec != null && (
                  <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-xs font-mono text-violet-300">{fmtTime(c.timestampSec)}</span>
                )}
              </div>
              <p className="text-sm text-zinc-300 mt-1">{c.body}</p>
              <p className="text-xs text-zinc-400 mt-1">{new Date(c.createdAt).toLocaleString()}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
