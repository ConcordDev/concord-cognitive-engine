'use client';

/**
 * EventActionRail — Cron-style right-rail action stack for a selected
 * calendar event. Layers 7 paid-app-tier actions on top of the existing
 * event modal, each wiring a real Concord backend:
 *
 *   1. Save to substrate   → dtu.create (private + tagged)
 *   2. Publish publicly    → POST /api/dtus/:id/publish (federation picks up)
 *   3. Send invites        → /api/social/dm per collaborator
 *   4. Schedule reminder   → calendar.remind via useRunArtifact
 *   5. Prep with agent     → chat_agent.do (LLM tool-use loop)
 *   6. Check conflicts     → calendar.resolve_conflicts
 *   7. Download .ics       → calendar.ical-export
 *
 * Inviting (3) attaches the minted DTU id so the recipient has a citable
 * handle. Publishing (2) requires minting (1) first — the rail enforces
 * the dependency in its disabled state.
 */

import { useState, useMemo } from 'react';
import {
  Globe, Send, Sparkles, Bell, CalendarCheck, FileDown,
  Loader2, Check, X, Link as LinkIcon, Wand2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, lensRun } from '@/lib/api/client';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';

interface EventLite {
  id: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  eventType: string;
  location?: string;
  collaborators?: string[];
  url?: string;
}

interface DtuRef { id: string; published: boolean; }
type InviteState = 'pending' | 'sent' | 'failed';
type Feedback = { kind: 'ok' | 'err'; text: string } | null;

const ACCENT = {
  mint:     '#06b6d4',
  publish:  '#22c55e',
  invite:   '#ec4899',
  remind:   '#f97316',
  agent:    '#eab308',
  conflict: '#ef4444',
  ical:     '#3b82f6',
} as const;

export function EventActionRail({ event }: { event: EventLite }) {
  const [dtuRef, setDtuRef] = useState<DtuRef | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [inviteStatus, setInviteStatus] = useState<Record<string, InviteState>>({});
  const [agentFindings, setAgentFindings] = useState<string | null>(null);
  const runAction = useRunArtifact('calendar');

  const collabCount = event.collaborators?.length ?? 0;

  function ok(text: string) { setFeedback({ kind: 'ok', text }); }
  function err(text: string) { setFeedback({ kind: 'err', text }); }
  function pickMessage(e: unknown): string {
    const ax = e as { response?: { data?: { error?: string } }; message?: string };
    return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
  }

  async function mintToSubstrate() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu',
        name: 'create',
        input: {
          title: `[Calendar] ${event.title}`,
          tags: ['calendar', event.eventType, 'event'],
          source: 'calendar:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            event: {
              start: event.startDate.toISOString(),
              end: event.endDate.toISOString(),
              location: event.location,
              description: event.description,
              collaborators: event.collaborators,
              calendarArtifactId: event.id,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) {
        setDtuRef({ id, published: false });
        ok(`Saved as DTU ${id.slice(0, 8)}…`);
      } else {
        err('No DTU id returned.');
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function togglePublish() {
    if (!dtuRef) { err('Save to substrate first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const path = `/api/dtus/${encodeURIComponent(dtuRef.id)}/publish`;
      const r = dtuRef.published ? await api.delete(path) : await api.post(path);
      if (r.data?.ok !== false) {
        setDtuRef({ ...dtuRef, published: !dtuRef.published });
        ok(dtuRef.published ? 'Unpublished.' : 'Public — federation peers will pick it up.');
      } else {
        err(r.data?.error ?? 'publish failed');
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function sendInvites() {
    if (collabCount === 0) { err('No collaborators on this event.'); return; }
    setBusy('invite'); setFeedback(null);
    const initial: Record<string, InviteState> = {};
    for (const c of event.collaborators!) initial[c] = 'pending';
    setInviteStatus(initial);

    const dtuLine = dtuRef ? `\n\n[DTU ${dtuRef.id}]` : '';
    const dateStr = new Date(event.startDate).toLocaleString();
    const body = [
      `📅 ${event.title}`,
      '',
      dateStr,
      event.location ? `📍 ${event.location}` : null,
      event.url ? `🔗 ${event.url}` : null,
      event.description ? `\n${event.description}` : null,
      dtuLine,
    ].filter(Boolean).join('\n');

    let sentCount = 0;
    for (const recipient of event.collaborators!) {
      try {
        const r = await api.post('/api/social/dm', {
          toUserId: recipient,
          content: body,
        });
        const sentOk = r.data?.ok !== false;
        setInviteStatus(prev => ({ ...prev, [recipient]: sentOk ? 'sent' : 'failed' }));
        if (sentOk) sentCount++;
      } catch {
        setInviteStatus(prev => ({ ...prev, [recipient]: 'failed' }));
      }
    }
    setBusy(null);
    ok(`Sent ${sentCount} of ${collabCount} invite${collabCount === 1 ? '' : 's'}.`);
  }

  async function scheduleReminder() {
    setBusy('remind'); setFeedback(null);
    try {
      const minutesBefore = 60;
      const reminderAt = new Date(event.startDate.getTime() - minutesBefore * 60 * 1000).toISOString();
      const r = await runAction.mutateAsync({
        id: event.id,
        action: 'remind',
        params: {
          at: reminderAt,
          message: `Reminder: ${event.title} in ${minutesBefore} minutes`,
        },
      });
      if (r?.ok !== false) {
        ok(`Reminder set for ${minutesBefore}m before.`);
      } else {
        err('Reminder failed.');
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function prepWithAgent() {
    setBusy('agent'); setFeedback(null); setAgentFindings(null);
    try {
      const task = [
        `Surface DTUs and prior context relevant to my upcoming event "${event.title}"`,
        `on ${new Date(event.startDate).toLocaleString()}.`,
        event.description ? `Topic: ${event.description}` : '',
        event.collaborators?.length ? `Collaborators: ${event.collaborators.join(', ')}.` : '',
        'Return a brief prep summary in plaintext.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent',
        name: 'do',
        input: { task, maxTurns: 6 },
      });
      const reply = r.data?.result?.reply
        ?? r.data?.result?.summary
        ?? r.data?.result?.output;
      if (reply) {
        setAgentFindings(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Agent finished prep.');
      } else {
        err('Agent returned empty.');
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function resolveConflicts() {
    setBusy('conflict'); setFeedback(null);
    try {
      const r = await runAction.mutateAsync({
        id: event.id,
        action: 'resolve_conflicts',
        params: {},
      });
      // calendar.resolve_conflicts (server.js inline) returns { ok, conflicts, count }
      // at the TOP LEVEL — it does NOT wrap in a `result` envelope.
      const rr = r as { conflicts?: unknown[] } | undefined;
      const conflicts = rr?.conflicts ?? [];
      if (Array.isArray(conflicts) && conflicts.length === 0) {
        ok('No conflicts detected.');
      } else {
        ok(`${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} flagged.`);
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function exportIcal() {
    setBusy('ical'); setFeedback(null);
    try {
      const r = await runAction.mutateAsync({
        id: event.id,
        action: 'ical-export',
        params: {},
      });
      const result = r?.result as { ics?: string; data?: string } | undefined;
      const ics = result?.ics ?? result?.data;
      if (ics && typeof ics === 'string') {
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${event.title.replace(/[^a-z0-9]/gi, '_')}.ics`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        ok('Downloaded .ics.');
      } else {
        err('No iCal payload returned.');
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions = useMemo(() => [
    { id: 'mint',     label: 'Save to substrate', desc: 'Mint a private DTU you can cite from elsewhere', icon: Sparkles, accent: ACCENT.mint, handler: mintToSubstrate, disabled: !!dtuRef, doneLabel: dtuRef ? 'Saved' : null },
    { id: 'publish',  label: dtuRef?.published ? 'Unpublish' : 'Publish publicly', desc: dtuRef?.published ? 'Federation peers will stop syncing this' : 'Make the DTU visible to federation peers', icon: Globe, accent: dtuRef?.published ? '#15803d' : ACCENT.publish, handler: togglePublish, disabled: !dtuRef, doneLabel: null },
    { id: 'invite',   label: 'Send invites',     desc: collabCount === 0 ? 'Add collaborators first' : `Direct-message ${collabCount} collaborator${collabCount === 1 ? '' : 's'}`, icon: Send, accent: ACCENT.invite, handler: sendInvites, disabled: collabCount === 0, doneLabel: null },
    { id: 'remind',   label: 'Schedule reminder', desc: '1 hour before, on the heartbeat tick', icon: Bell, accent: ACCENT.remind, handler: scheduleReminder, disabled: false, doneLabel: null },
    { id: 'agent',    label: 'Prep with agent',  desc: 'Agent surfaces relevant DTUs and prior context', icon: Wand2, accent: ACCENT.agent, handler: prepWithAgent, disabled: false, doneLabel: null },
    { id: 'conflict', label: 'Check conflicts',  desc: 'Cross-check overlapping events on your calendar', icon: CalendarCheck, accent: ACCENT.conflict, handler: resolveConflicts, disabled: false, doneLabel: null },
    { id: 'ical',     label: 'Download .ics',    desc: 'Export to Apple Calendar / Google / Fantastical', icon: FileDown, accent: ACCENT.ical, handler: exportIcal, disabled: false, doneLabel: null },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [dtuRef, collabCount, busy]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Actions</h3>
        {dtuRef && (
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <LinkIcon className="w-3 h-3" />
            <span className="font-mono">{dtuRef.id.slice(0, 8)}</span>
            {dtuRef.published && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold tracking-wide">
                PUBLIC
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {actions.map(a => {
          const isBusy = busy === a.id;
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all border',
                'bg-lattice-elevated/40 border-lattice-border/40',
                'hover:bg-lattice-elevated hover:border-lattice-border',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/40 disabled:hover:border-lattice-border/40',
                'focus:outline-none focus:ring-2 focus:ring-neon-cyan/40',
              )}
            >
              <div
                className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: a.accent + '20', color: a.accent }}
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-100 flex items-center gap-2">
                  {a.label}
                  {a.doneLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold">
                      {a.doneLabel}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 line-clamp-2">{a.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn(
              'mt-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok'
              ? <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {Object.keys(inviteStatus).length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 px-1">
            Invite status
          </div>
          {Object.entries(inviteStatus).map(([recipient, status]) => (
            <div
              key={recipient}
              className="flex items-center justify-between px-2.5 py-1.5 rounded bg-lattice-elevated/30 text-xs"
            >
              <span className="text-gray-300 truncate flex-1 font-mono">{recipient}</span>
              {status === 'sent'    && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
              {status === 'failed'  && <X     className="w-3.5 h-3.5 text-red-400     flex-shrink-0" />}
              {status === 'pending' && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}

      {agentFindings && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-xs text-gray-300 max-h-56 overflow-y-auto">
          <div className="text-yellow-400 font-semibold mb-1.5 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" />
            Agent prep
          </div>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed text-gray-200">
            {agentFindings}
          </pre>
        </div>
      )}
    </div>
  );
}
