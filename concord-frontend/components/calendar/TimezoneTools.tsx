'use client';

/**
 * TimezoneTools — bespoke iCal export/parse + IANA timezone conversion
 * for the calendar lens. Backed by:
 *   calendar.timezone-convert — IANA → IANA conversion via Intl.DateTimeFormat
 *   calendar.ical-export      — events → RFC 5545 .ics blob
 *   calendar.ical-parse       — .ics → event list
 *
 * Per category-leader research (Google Calendar, Apple Calendar,
 * Fantastical, Notion Calendar, Outlook, Cal.com): persistent TZ rail
 * with "travel to TZ" Cmd-K-style picker, ScopedActionModal for import
 * with dry-run preview.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, Globe2, Upload, Download, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('calendar', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const COMMON_TZ = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Athens',
  'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

export function TimezoneTools() {
  const [tab, setTab] = useState<'tz' | 'import' | 'export'>('tz');
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Calendar Tools</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            iana tz · rfc 5545
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['tz', 'import', 'export'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                tab === t ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {t === 'tz' ? 'TZ Convert' : t === 'import' ? 'Import iCal' : 'Export iCal'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'tz' && <TzConverter />}
      {tab === 'import' && <IcalImport />}
      {tab === 'export' && <IcalExport />}
    </div>
  );
}

function TzConverter() {
  const [iso, setIso] = useState(() => new Date().toISOString().slice(0, 16));
  const [fromTz, setFromTz] = useState('UTC');
  const [toTz, setToTz] = useState('America/Los_Angeles');
  const [result, setResult] = useState<{ inFromTz: string; inToTz: string; epochMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const conv = useMutation({
    mutationFn: async () => callMacro<{ inFromTz: string; inToTz: string; epochMs: number }>('timezone-convert', { isoString: iso, fromTz, toTz }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setResult(env.result); setError(null); }
      else { setResult(null); setError(env.error || 'failed'); }
    },
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400">Time (local-ish)</label>
          <input type="datetime-local" value={iso} onChange={(e) => setIso(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400">From TZ</label>
          <select value={fromTz} onChange={(e) => setFromTz(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {COMMON_TZ.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400">To TZ</label>
          <select value={toTz} onChange={(e) => setToTz(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {COMMON_TZ.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
      </div>
      <button type="button" onClick={() => conv.mutate()} disabled={conv.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
        {conv.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe2 className="h-3.5 w-3.5" />}
        Convert
      </button>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300">{error}</div>}
      {result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 font-mono text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{fromTz}</div>
                <div className="text-cyan-300">{result.inFromTz}</div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{toTz}</div>
                <div className="text-emerald-300">{result.inToTz}</div>
              </div>
            </div>
            <SaveAsDtuButton
              compact
              apiSource="iana-tz"
              title={`TZ convert ${fromTz} → ${toTz}`}
              content={`Input: ${iso}\nFrom (${fromTz}): ${result.inFromTz}\nTo (${toTz}): ${result.inToTz}\nEpoch: ${result.epochMs}`}
              extraTags={['calendar', 'timezone', fromTz.toLowerCase(), toTz.toLowerCase()]}
              rawData={result}
            />
          </div>
        </motion.div>
      )}
    </div>
  );
}

function IcalImport() {
  const [icsText, setIcsText] = useState('');
  const [events, setEvents] = useState<Array<{ uid: string; summary: string; start: string; end?: string; location?: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const parse = useMutation({
    mutationFn: async () => callMacro<{ events: Array<{ uid: string; summary: string; start: string; end?: string; location?: string }> }>('ical-parse', { ics: icsText }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setEvents(env.result.events); setError(null); }
      else { setEvents([]); setError(env.error || 'parse failed'); }
    },
  });

  return (
    <div className="space-y-3">
      <textarea
        value={icsText}
        onChange={(e) => setIcsText(e.target.value)}
        rows={8}
        placeholder="Paste raw .ics content (BEGIN:VCALENDAR\\nVERSION:2.0\\n...)"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
      />
      <button type="button" onClick={() => parse.mutate()} disabled={!icsText.trim() || parse.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
        {parse.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        Parse (dry-run)
      </button>
      {error && <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300"><AlertTriangle className="h-3 w-3" /> {error}</div>}
      {events.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Parsed {events.length} events</div>
          {events.slice(0, 30).map((ev) => (
            <div key={ev.uid} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
              <div className="font-medium text-white">{ev.summary}</div>
              <div className="font-mono text-[10px] text-zinc-400">{ev.start}{ev.end ? ` → ${ev.end}` : ''}{ev.location ? ` · ${ev.location}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IcalExport() {
  const [title, setTitle] = useState('My Concord export');
  const [eventsJson, setEventsJson] = useState('[{"summary":"Demo event","start":"2026-06-01T15:00:00Z","end":"2026-06-01T16:00:00Z"}]');
  const [ics, setIcs] = useState<string | null>(null);

  const exp = useMutation({
    mutationFn: async () => {
      let events: unknown;
      try { events = JSON.parse(eventsJson); } catch { return { ok: false as const, error: 'invalid JSON' }; }
      return callMacro<{ ics: string }>('ical-export', { calendarName: title, events });
    },
    onSuccess: (env) => { if (env.ok && env.result) setIcs(env.result.ics); else setIcs(null); },
  });

  const download = () => {
    if (!ics) return;
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title.replace(/[^a-z0-9]+/gi, '-')}.ics`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Calendar name" className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
      <textarea value={eventsJson} onChange={(e) => setEventsJson(e.target.value)} rows={6} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-white" />
      <button type="button" onClick={() => exp.mutate()} disabled={exp.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
        {exp.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Generate .ics
      </button>
      {ics && (
        <div className="space-y-2">
          <pre className="max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-emerald-300">{ics}</pre>
          <div className="flex items-center gap-2">
            <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20"><Download className="h-3.5 w-3.5" /> Download .ics</button>
            <SaveAsDtuButton
              compact
              apiSource="rfc-5545"
              title={`iCal export — ${title}`}
              content={ics}
              extraTags={['calendar', 'ical', 'export']}
              rawData={{ title, ics }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
