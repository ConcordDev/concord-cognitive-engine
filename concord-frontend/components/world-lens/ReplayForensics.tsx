'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';

// ── Types ──────────────────────────────────────────────────────────────────────

type EventType =
  | 'building_placed'
  | 'building_modified'
  | 'validation_run'
  | 'citation'
  | 'player_join'
  | 'disaster'
  | 'weather_change';

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: EventType;
  description: string;
  actor: string;
}

interface Bookmark {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  description: string;
}

// ── Seed data ──────────────────────────────────────────────────────────────────

const EVENT_TYPE_META: Record<EventType, { label: string; icon: string; color: string }> = {
  building_placed: { label: 'Building Placed', icon: '🏗', color: 'text-emerald-400' },
  building_modified: { label: 'Building Modified', icon: '🔧', color: 'text-blue-400' },
  validation_run: { label: 'Validation Run', icon: '✓', color: 'text-cyan-400' },
  citation: { label: 'Citation', icon: '📋', color: 'text-yellow-400' },
  player_join: { label: 'Player Join', icon: '👤', color: 'text-purple-400' },
  disaster: { label: 'Disaster', icon: '⚠', color: 'text-red-400' },
  weather_change: { label: 'Weather Change', icon: '☁', color: 'text-sky-400' },
};

// Map a backend event_timeline channel onto one of the panel's event types so
// the timeline dots + filters stay meaningful. Unknown channels fall back to a
// neutral type — we never invent a category that wasn't in the data.
function channelToType(channel: string): EventType {
  const c = (channel || '').toLowerCase();
  if (c.includes('weather')) return 'weather_change';
  if (c.includes('join') || c.includes('presence') || c.includes('player')) return 'player_join';
  if (c.includes('citation') || c.includes('royalt')) return 'citation';
  if (c.includes('valid')) return 'validation_run';
  if (c.includes('disaster') || c.includes('crisis') || c.includes('hazard') || c.includes('war')) return 'disaster';
  if (c.includes('build') && (c.includes('place') || c.includes('spawn') || c.includes('claim'))) return 'building_placed';
  return 'building_modified';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function timeToPercent(iso: string, start: string, end: string): number {
  const t = new Date(iso).getTime();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100));
}

// ── Component ──────────────────────────────────────────────────────────────────

interface EventTimelineRow {
  id?: string | number;
  channel?: string;
  actor_id?: string;
  actor_kind?: string;
  created_at?: number;
  payload_json?: string;
}
interface EventTimelineRecentResult {
  rows?: EventTimelineRow[];
}

export default function ReplayForensics() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  // Bookmarks live only in this session — there is no bookmark persistence
  // macro. They start empty and the user can create their own.
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [playheadPercent, setPlayheadPercent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activeTab, setActiveTab] = useState<'events' | 'bookmarks' | 'forensics' | 'timelapse'>('events');
  const [filters, setFilters] = useState<Record<EventType, boolean>>({
    building_placed: true,
    building_modified: true,
    validation_run: true,
    citation: true,
    player_join: true,
    disaster: true,
    weather_change: true,
  });
  const [forensicDtuId, setForensicDtuId] = useState('');
  const [showForensicReport, setShowForensicReport] = useState(false);
  const [newBookmark, setNewBookmark] = useState({
    name: '',
    startTime: '06:00',
    endTime: '09:00',
    description: '',
  });
  const [timelapseSettings, setTimelapseSettings] = useState({
    startDate: '2026-04-04',
    endDate: '2026-04-05',
    duration: 30,
    resolution: '1080p',
  });

  // Fetch real events from the event_timeline substrate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<EventTimelineRecentResult>('event_timeline', 'recent', { limit: 200 });
        if (cancelled) return;
        const rows = r.data?.ok ? r.data.result?.rows : null;
        if (!Array.isArray(rows)) { setEvents([]); return; }
        const mapped: TimelineEvent[] = rows.map((row, i) => {
          let description = row.channel || 'event';
          const payload = (() => { try { return row.payload_json ? JSON.parse(row.payload_json) : null; } catch { return null; } })();
          if (payload && typeof payload === 'object') {
            const p = payload as Record<string, unknown>;
            const summary = p.message || p.description || p.summary || p.title;
            if (typeof summary === 'string' && summary) description = summary;
          }
          return {
            id: String(row.id ?? `evt-${i}`),
            // created_at is unix seconds in the substrate; normalise to ISO.
            timestamp: new Date((Number(row.created_at) || 0) * 1000).toISOString(),
            type: channelToType(row.channel || ''),
            description,
            actor: row.actor_id || row.actor_kind || 'system',
          };
        });
        setEvents(mapped);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredEvents = useMemo(
    () => events.filter((e) => filters[e.type]),
    [events, filters]
  );

  // Derive the scrubber window from the real event span (fall back to a 1-day
  // window when there are no events so the empty timeline still renders).
  const { timelineStart, timelineEnd } = useMemo(() => {
    if (events.length === 0) {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 3600 * 1000);
      return { timelineStart: start.toISOString(), timelineEnd: now.toISOString() };
    }
    const times = events.map((e) => new Date(e.timestamp).getTime()).filter((t) => Number.isFinite(t) && t > 0);
    const min = Math.min(...times);
    const max = Math.max(...times);
    return {
      timelineStart: new Date(min).toISOString(),
      timelineEnd: new Date(max === min ? max + 3600 * 1000 : max).toISOString(),
    };
  }, [events]);

  const speeds = [0.5, 1, 2, 5, 10];

  const toggleFilter = (type: EventType) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const stepForward = () => {
    setPlayheadPercent((p) => Math.min(100, p + 2));
  };

  const stepBackward = () => {
    setPlayheadPercent((p) => Math.max(0, p - 2));
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setPlayheadPercent(Math.max(0, Math.min(100, pct)));
  };

  return (
    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl text-white overflow-hidden flex flex-col h-[750px]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400 text-sm font-bold">
          RF
        </div>
        <div>
          <h2 className="text-sm font-semibold">Replay & Forensics</h2>
          <p className="text-[11px] text-white/40">Event replay, trace analysis & timelapse</p>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-white/30 font-mono">00:00</span>
          <span className="text-[10px] text-white/30 font-mono">
            Playhead: {Math.round(playheadPercent)}%
          </span>
          <span className="text-[10px] text-white/30 font-mono">23:59</span>
        </div>

        {/* Timeline bar */}
        <div
          className="relative h-8 bg-white/5 rounded-lg cursor-pointer group"
          onClick={handleTimelineClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          {/* Time markers */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <div
              key={pct}
              className="absolute top-0 bottom-0 w-px bg-white/5"
              style={{ left: `${pct}%` }}
            />
          ))}

          {/* Event dots */}
          {filteredEvents.map((ev) => {
            const pct = timeToPercent(ev.timestamp, timelineStart, timelineEnd);
            const meta = EVENT_TYPE_META[ev.type];
            return (
              <div
                key={ev.id}
                className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-black/50 ${meta.color.replace('text-', 'bg-')}`}
                style={{ left: `${pct}%`, transform: 'translate(-50%, -50%)' }}
                title={`${meta.label}: ${ev.description}`}
              />
            );
          })}

          {/* Bookmark ranges */}
          {bookmarks.map((bk) => {
            const startPct = timeToPercent(bk.startTime, timelineStart, timelineEnd);
            const endPct = timeToPercent(bk.endTime, timelineStart, timelineEnd);
            return (
              <div
                key={bk.id}
                className="absolute top-0 bottom-0 bg-amber-500/10 border-l border-r border-amber-500/30"
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                title={bk.name}
              />
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10"
            style={{ left: `${playheadPercent}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-amber-400 rounded-full border-2 border-black" />
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-3 mt-3">
          <button
            onClick={stepBackward}
            className="w-8 h-8 rounded-lg border border-white/10 hover:bg-white/5 flex items-center justify-center text-xs transition-colors"
          >
            &#9664;&#9664;
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm transition-colors ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'bg-white/10 hover:bg-white/15'
            }`}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button
            onClick={stepForward}
            className="w-8 h-8 rounded-lg border border-white/10 hover:bg-white/5 flex items-center justify-center text-xs transition-colors"
          >
            &#9654;&#9654;
          </button>

          <div className="w-px h-6 bg-white/10 mx-1" />

          {/* Speed selector */}
          <div className="flex items-center gap-1">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  playbackSpeed === s
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'text-white/30 hover:text-white/60'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(['events', 'bookmarks', 'forensics', 'timelapse'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-white/30 hover:text-white/60'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {/* Events tab */}
        {activeTab === 'events' && (
          <div className="p-4 space-y-3">
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EVENT_TYPE_META) as EventType[]).map((type) => {
                const meta = EVENT_TYPE_META[type];
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-lg border transition-colors ${
                      filters[type]
                        ? `border-white/10 bg-white/5 ${meta.color}`
                        : 'border-white/5 text-white/20 line-through'
                    }`}
                  >
                    <span>{meta.icon}</span>
                    {meta.label}
                  </button>
                );
              })}
            </div>

            {/* Event list */}
            {filteredEvents.length === 0 && (
              <div className="py-10 text-center text-xs text-white/40">No events yet.</div>
            )}
            <div className="space-y-1">
              {filteredEvents.map((ev) => {
                const meta = EVENT_TYPE_META[ev.type];
                return (
                  <div
                    key={ev.id}
                    className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="text-sm mt-0.5">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white/80">{ev.description}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/20 font-mono">
                          {formatShortTime(ev.timestamp)}
                        </span>
                        <span className={`text-[10px] ${meta.color}`}>{meta.label}</span>
                        <span className="text-[10px] text-white/20">by {ev.actor}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bookmarks tab */}
        {activeTab === 'bookmarks' && (
          <div className="p-4 space-y-4">
            {bookmarks.length === 0 && (
              <p className="text-xs text-white/40">No bookmarks yet.</p>
            )}
            <div className="space-y-2">
              {bookmarks.map((bk) => (
                <div
                  key={bk.id}
                  className="p-3 rounded-xl border border-white/10 bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-amber-400">{bk.name}</span>
                    <span className="text-[10px] text-white/20 font-mono">
                      {formatShortTime(bk.startTime)} - {formatShortTime(bk.endTime)}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40">{bk.description}</p>
                </div>
              ))}
            </div>

            {/* Create bookmark form */}
            <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
              <h4 className="text-xs font-semibold">Create Bookmark</h4>
              <input
                value={newBookmark.name}
                onChange={(e) => setNewBookmark({ ...newBookmark, name: e.target.value })}
                placeholder="Bookmark name"
                className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none focus:border-amber-500/50 placeholder-white/20"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-white/30 block mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newBookmark.startTime}
                    onChange={(e) => setNewBookmark({ ...newBookmark, startTime: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/30 block mb-1">End Time</label>
                  <input
                    type="time"
                    value={newBookmark.endTime}
                    onChange={(e) => setNewBookmark({ ...newBookmark, endTime: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none"
                  />
                </div>
              </div>
              <textarea
                value={newBookmark.description}
                onChange={(e) => setNewBookmark({ ...newBookmark, description: e.target.value })}
                placeholder="Description..."
                rows={2}
                className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none resize-none focus:border-amber-500/50 placeholder-white/20"
              />
              <button
                onClick={() => {
                  if (newBookmark.name) {
                    const today = new Date().toISOString().slice(0, 10);
                    setBookmarks((prev) => [
                      ...prev,
                      {
                        id: `bk-${Date.now()}`,
                        name: newBookmark.name,
                        startTime: `${today}T${newBookmark.startTime}:00Z`,
                        endTime: `${today}T${newBookmark.endTime}:00Z`,
                        description: newBookmark.description,
                      },
                    ]);
                    setNewBookmark({ name: '', startTime: '06:00', endTime: '09:00', description: '' });
                  }
                }}
                className="w-full py-2 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 transition-colors font-medium"
              >
                Save Bookmark
              </button>
            </div>
          </div>
        )}

        {/* Forensics tab */}
        {activeTab === 'forensics' && (
          <div className="p-4 space-y-4">
            {/* DTU trace input */}
            <div className="flex gap-2">
              <input
                value={forensicDtuId}
                onChange={(e) => setForensicDtuId(e.target.value)}
                placeholder="Enter DTU ID to trace..."
                className="flex-1 px-3 py-2 text-xs font-mono bg-white/5 border border-white/10 rounded-lg outline-none focus:border-amber-500/50 placeholder-white/20"
              />
              <button
                onClick={() => setShowForensicReport(true)}
                className="px-4 py-2 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 transition-colors"
              >
                Trace
              </button>
            </div>

            {/* Forensic report — no backend root-cause-trace macro exists yet,
                so a trace always reports "no data". TODO: wire to backend. */}
            {showForensicReport && forensicDtuId && (
              <div className="p-6 text-center text-white/20 text-xs">
                No forensic data found for DTU: {forensicDtuId}
              </div>
            )}
          </div>
        )}

        {/* Timelapse tab */}
        {activeTab === 'timelapse' && (
          <div className="p-4 space-y-4">
            <h4 className="text-xs font-semibold">Timelapse Generator</h4>

            <div className="max-w-md space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-white/30 block mb-1">Start Date</label>
                  <input
                    type="date"
                    value={timelapseSettings.startDate}
                    onChange={(e) =>
                      setTimelapseSettings({ ...timelapseSettings, startDate: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/30 block mb-1">End Date</label>
                  <input
                    type="date"
                    value={timelapseSettings.endDate}
                    onChange={(e) =>
                      setTimelapseSettings({ ...timelapseSettings, endDate: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-white/30 block mb-1">
                  Duration ({timelapseSettings.duration}s)
                </label>
                <input
                  type="range"
                  min={10}
                  max={120}
                  step={5}
                  value={timelapseSettings.duration}
                  onChange={(e) =>
                    setTimelapseSettings({
                      ...timelapseSettings,
                      duration: parseInt(e.target.value),
                    })
                  }
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-white/20">
                  <span>10s</span>
                  <span>120s</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-white/30 block mb-1">Resolution</label>
                <select
                  value={timelapseSettings.resolution}
                  onChange={(e) =>
                    setTimelapseSettings({ ...timelapseSettings, resolution: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="1440p">1440p</option>
                  <option value="4K">4K</option>
                </select>
              </div>

              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('replay:render-timelapse')); }}
                className="w-full py-2.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-500 transition-colors"
              >
                Render Timelapse
              </button>

              <div className="p-3 rounded-lg border border-white/5 bg-white/[0.02] text-[10px] text-white/30">
                <div className="flex justify-between mb-1">
                  <span>Estimated frames:</span>
                  <span className="text-white/50">{timelapseSettings.duration * 30}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span>Events in range:</span>
                  <span className="text-white/50">{events.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated file size:</span>
                  <span className="text-white/50">
                    ~{Math.round(timelapseSettings.duration * 2.5)} MB
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
