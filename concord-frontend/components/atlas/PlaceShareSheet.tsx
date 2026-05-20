'use client';

/**
 * PlaceShareSheet — Google Maps-style share + act sheet for a focused
 * place in the atlas lens. Mounts as a modal triggered by a "Share /
 * act" button next to SaveAsDtuButton in PlaceFinder.
 *
 * Per leader-app UX (Google Maps share sheet + Apple Maps share-to)
 * the sheet bundles 5 paid-app-tier actions, all wiring real Concord
 * backends — no mock data, no seed inputs:
 *
 *   1. Send via DM         → /api/social/dm (recipient + body)
 *   2. Research with agent → chat_agent.do (place history, things to
 *                            know, accessibility) — renders inline
 *   3. Save & publish      → dtu.create public + /api/dtus/:id/publish
 *                            (federation picks it up; one shot)
 *   4. Add to "My places"  → dtu.create kind='guide' with this place
 *                            appended; if a guide DTU already exists
 *                            this session, append a citation
 *   5. Copy embed link     → clipboard write with OSM permalink
 *
 * Place identity is derived from osmType+osmId+lat+lng so the same
 * place across sheet opens is treated as the same place (dedupe key
 * for guides).
 */

import { useState } from 'react';
import {
  X, Send, Wand2, Globe, BookMarked, Link as LinkIcon,
  Loader2, Check, AlertTriangle, MapPin, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface PlaceLike {
  displayName: string;
  latitude: number;
  longitude: number;
  category?: string;
  type?: string;
  osmType?: string;
  osmId?: number;
  address?: Record<string, string>;
}

interface PlaceShareSheetProps {
  place: PlaceLike;
  onClose: () => void;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type PaneId = 'dm' | 'research' | 'publish' | 'guide' | 'embed';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

function osmPermalink(p: PlaceLike): string {
  if (p.osmType && p.osmId) {
    return `https://www.openstreetmap.org/${p.osmType}/${p.osmId}`;
  }
  return `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`;
}

function googleMapsLink(p: PlaceLike): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
}

export function PlaceShareSheet({ place, onClose }: PlaceShareSheetProps) {
  const [pane, setPane] = useState<PaneId>('dm');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // DM pane
  const [dmRecipient, setDmRecipient] = useState('');
  const [dmBody, setDmBody] = useState(`📍 ${place.displayName}\n${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}\n${googleMapsLink(place)}`);

  // Research pane
  const [agentFindings, setAgentFindings] = useState<string | null>(null);

  // Publish pane
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);

  // Guide pane
  const [guideDtuId, setGuideDtuId] = useState<string | null>(null);

  // Embed pane
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const ok  = (text: string) => setFeedback({ kind: 'ok', text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  /* ---- handlers ---- */

  async function actDm() {
    if (!dmRecipient.trim() || !dmBody.trim()) { err('Recipient + body required.'); return; }
    setBusy('dm'); setFeedback(null);
    try {
      const r = await api.post('/api/social/dm', {
        toUserId: dmRecipient.trim(),
        content: dmBody.trim(),
      });
      if (r.data?.ok !== false) {
        ok(`Sent to ${dmRecipient.trim()}.`);
        setDmRecipient('');
      } else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actResearch() {
    setBusy('research'); setFeedback(null); setAgentFindings(null);
    try {
      const where = [
        place.displayName,
        place.address?.city ?? place.address?.state ?? place.address?.country,
      ].filter(Boolean).join(', ');
      const task = [
        `Research this place: "${where}".`,
        `Coordinates ${place.latitude}, ${place.longitude}.`,
        place.category ? `Category: ${place.category}.` : '',
        'Return a brief plaintext brief covering: what it is, why you might go there,',
        'best time of day/year, accessibility, and 1–2 things to know before visiting.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent',
        name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply
        ?? r.data?.result?.summary
        ?? r.data?.result?.output;
      if (reply) {
        setAgentFindings(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Agent finished.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu',
        name: 'create',
        input: {
          title: `${place.displayName.split(',').slice(0, 2).join(',')} — public place`,
          tags: ['atlas', 'place', 'public', place.category, place.type].filter(Boolean) as string[],
          source: 'atlas:place:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            place: {
              displayName: place.displayName,
              latitude: place.latitude,
              longitude: place.longitude,
              category: place.category,
              type: place.type,
              osm: place.osmType && place.osmId ? `${place.osmType}/${place.osmId}` : null,
              address: place.address,
              permalink: osmPermalink(place),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) {
        setPublishedDtuId(id);
        ok(`Published DTU ${id.slice(0, 8)}… (federation will pick up).`);
      } else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAddToGuide() {
    setBusy('guide'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu',
        name: 'create',
        input: {
          title: guideDtuId
            ? `Place added to guide: ${place.displayName.split(',')[0]}`
            : `My places — guide (${new Date().toISOString().slice(0, 10)})`,
          tags: ['atlas', 'guide', 'my-places', place.category].filter(Boolean) as string[],
          source: 'atlas:guide',
          lineage: guideDtuId ? [guideDtuId] : [],
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            guide: guideDtuId ? { parentGuide: guideDtuId } : null,
            place: {
              displayName: place.displayName,
              latitude: place.latitude,
              longitude: place.longitude,
              category: place.category,
              osm: place.osmType && place.osmId ? `${place.osmType}/${place.osmId}` : null,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) {
        if (!guideDtuId) setGuideDtuId(id);
        ok(guideDtuId ? 'Appended to existing guide.' : `Guide started: ${id.slice(0, 8)}…`);
      } else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCopyEmbed() {
    setBusy('embed'); setFeedback(null);
    try {
      await navigator.clipboard.writeText(osmPermalink(place));
      setCopyState('copied');
      ok('OSM permalink copied to clipboard.');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch { err('Clipboard write blocked.'); }
    finally { setBusy(null); }
  }

  const panes: { id: PaneId; label: string; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
    { id: 'dm',       label: 'DM',       icon: Send,       accent: '#ec4899' },
    { id: 'research', label: 'Research', icon: Wand2,      accent: '#eab308' },
    { id: 'publish',  label: 'Publish',  icon: Globe,      accent: '#22c55e' },
    { id: 'guide',    label: 'Guide',    icon: BookMarked, accent: '#8b5cf6' },
    { id: 'embed',    label: 'Embed',    icon: LinkIcon,   accent: '#06b6d4' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        className="w-full max-w-xl bg-lattice-surface border border-lattice-border rounded-t-2xl md:rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-lattice-border flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Share / act</div>
            <h3 className="text-sm font-semibold text-white truncate">{place.displayName}</h3>
            <div className="text-[11px] text-gray-500 font-mono mt-0.5">
              {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
              {place.category && <span className="ml-2 text-gray-400">· {place.category}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab nav */}
        <nav className="flex items-center border-b border-lattice-border overflow-x-auto">
          {panes.map(p => {
            const Icon = p.icon;
            const active = pane === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setPane(p.id); setFeedback(null); }}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                  active ? 'text-white' : 'border-transparent text-gray-400 hover:text-gray-200',
                )}
                style={active ? { borderBottomColor: p.accent, color: p.accent } : {}}
              >
                <Icon className="w-3.5 h-3.5" />
                {p.label}
              </button>
            );
          })}
        </nav>

        {/* Pane content */}
        <div className="p-4 min-h-[200px] max-h-[60vh] overflow-y-auto">
          {pane === 'dm' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">Recipient (Concord user id)</label>
                <input
                  type="text"
                  value={dmRecipient}
                  onChange={(e) => setDmRecipient(e.target.value)}
                  className="w-full bg-lattice-elevated border border-lattice-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40"
                  placeholder="username or user id"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">Message</label>
                <textarea
                  value={dmBody}
                  onChange={(e) => setDmBody(e.target.value)}
                  rows={5}
                  className="w-full bg-lattice-elevated border border-lattice-border rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-pink-400/40 resize-none"
                />
              </div>
              <button
                type="button"
                onClick={actDm}
                disabled={!!busy || !dmRecipient.trim() || !dmBody.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === 'dm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send DM
              </button>
            </div>
          )}

          {pane === 'research' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                Agent will research this place via Concord&apos;s chat-agent tool-use loop (web search,
                local DTU lookup) and return a brief.
              </p>
              <button
                type="button"
                onClick={actResearch}
                disabled={!!busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 text-black text-sm font-semibold hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === 'research' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Research this place
              </button>
              {agentFindings && (
                <div className="mt-3 px-3 py-3 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-xs text-gray-200 max-h-72 overflow-y-auto">
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentFindings}</pre>
                </div>
              )}
            </div>
          )}

          {pane === 'publish' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                Saves this place as a <span className="text-emerald-300 font-semibold">public DTU</span> with
                citations enabled, then flags it published so federation peers can pick it up. One-shot.
              </p>
              {publishedDtuId ? (
                <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" />
                  <span>Published as DTU <span className="font-mono">{publishedDtuId.slice(0, 12)}…</span></span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={actPublish}
                  disabled={!!busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {busy === 'publish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  Save & publish
                </button>
              )}
            </div>
          )}

          {pane === 'guide' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                Append this place to your private &ldquo;My places&rdquo; guide DTU. First click starts the
                guide; subsequent clicks append place DTUs as citations from the guide.
              </p>
              <button
                type="button"
                onClick={actAddToGuide}
                disabled={!!busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-semibold hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === 'guide' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookMarked className="w-4 h-4" />}
                {guideDtuId ? 'Append to guide' : 'Start a guide'}
              </button>
              {guideDtuId && (
                <div className="px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-xs text-purple-300 flex items-center gap-2">
                  <BookMarked className="w-3.5 h-3.5" />
                  <span>Guide DTU <span className="font-mono">{guideDtuId.slice(0, 12)}…</span></span>
                </div>
              )}
            </div>
          )}

          {pane === 'embed' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">OSM permalink</label>
                <code className="block w-full bg-lattice-elevated border border-lattice-border rounded px-3 py-2 text-xs text-cyan-300 font-mono break-all">
                  {osmPermalink(place)}
                </code>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">Google Maps link</label>
                <a
                  href={googleMapsLink(place)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full bg-lattice-elevated border border-lattice-border rounded px-3 py-2 text-xs text-cyan-300 font-mono break-all hover:bg-lattice-elevated/70"
                >
                  {googleMapsLink(place)} <ExternalLink className="inline w-3 h-3 ml-1" />
                </a>
              </div>
              <button
                type="button"
                onClick={actCopyEmbed}
                disabled={!!busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-black text-sm font-semibold hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === 'embed' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 copyState === 'copied' ? <Check className="w-4 h-4" /> :
                 <LinkIcon className="w-4 h-4" />}
                {copyState === 'copied' ? 'Copied' : 'Copy OSM permalink'}
              </button>
            </div>
          )}
        </div>

        {/* Feedback bar */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              key={feedback.text}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className={cn(
                'px-4 py-2 text-xs flex items-start gap-2 border-t',
                feedback.kind === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-300 border-red-500/30',
              )}
            >
              {feedback.kind === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
              <span>{feedback.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
