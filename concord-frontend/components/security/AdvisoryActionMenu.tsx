'use client';

/**
 * AdvisoryActionMenu — Snyk / Datadog Security-shape action sheet for
 * a GitHub Security Advisory. Opens as a modal triggered by an
 * "Actions" button on each advisory row. Five real-backend actions:
 *
 *   1. Mint incident DTU   → dtu.create private incident record
 *                            (tags=[security,advisory,ghsa,severity])
 *   2. Escalate to lead    → /api/social/dm with summary + severity +
 *                            CVSS + advisory link to incident-lead id
 *   3. Mint patch plan     → dtu.create plan DTU citing the incident
 *                            (lineage carries the advisory ref)
 *   4. Publish post-mortem → dtu.create public + cite + flag published
 *                            (federation pickup; minimum after fixes)
 *   5. Exposure agent      → chat_agent.do "given advisory {ghsa},
 *                            do we use the affected package in our
 *                            stack: {stack-description}?"
 */

import { useState } from 'react';
import {
  X, ShieldAlert, Sparkles, Send, FileText, Globe, Wand2,
  Loader2, Check, AlertTriangle, AlertOctagon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface AdvisoryLike {
  ghsa_id: string;
  cve_id?: string;
  summary: string;
  severity: string;
  html_url: string;
  published_at: string;
  cvss?: { score?: number; vector_string?: string };
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type PaneId = 'incident' | 'escalate' | 'patch' | 'postmortem' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

const SEV_ACCENT: Record<string, { bg: string; text: string; tag: string }> = {
  critical: { bg: 'bg-rose-500/15',    text: 'text-rose-300',    tag: '#e11d48' },
  high:     { bg: 'bg-orange-500/15',  text: 'text-orange-300',  tag: '#f97316' },
  medium:   { bg: 'bg-amber-500/15',   text: 'text-amber-300',   tag: '#eab308' },
  low:      { bg: 'bg-zinc-700/30',    text: 'text-zinc-300',    tag: '#94a3b8' },
};

export function AdvisoryActionMenu({ advisory, onClose }: { advisory: AdvisoryLike; onClose: () => void }) {
  const [pane, setPane] = useState<PaneId>('incident');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [incidentDtuId, setIncidentDtuId] = useState<string | null>(null);
  const [patchDtuId, setPatchDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [escalateTo, setEscalateTo] = useState('');
  const [stackDescription, setStackDescription] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const accent = SEV_ACCENT[advisory.severity] ?? SEV_ACCENT.low;

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  function advisoryLines(): string[] {
    return [
      `${advisory.ghsa_id}${advisory.cve_id ? ` / ${advisory.cve_id}` : ''}`,
      `Severity: ${advisory.severity}${advisory.cvss?.score ? ` (CVSS ${advisory.cvss.score})` : ''}`,
      `Published: ${advisory.published_at?.slice(0, 10) ?? '—'}`,
      ``,
      advisory.summary,
      ``,
      advisory.html_url,
    ];
  }

  async function actIncident() {
    setBusy('incident'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Incident — ${advisory.ghsa_id}${advisory.cve_id ? ` (${advisory.cve_id})` : ''}`,
          tags: ['security', 'advisory', 'incident', advisory.severity, advisory.ghsa_id],
          source: 'security:incident',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            advisory: {
              ghsa_id: advisory.ghsa_id,
              cve_id: advisory.cve_id ?? null,
              severity: advisory.severity,
              cvss: advisory.cvss ?? null,
              html_url: advisory.html_url,
              published_at: advisory.published_at,
              summary: advisory.summary,
            },
            status: 'triaging',
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setIncidentDtuId(id); ok(`Incident DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actEscalate() {
    if (!escalateTo.trim()) { err('Enter a lead user id.'); return; }
    setBusy('escalate'); setFeedback(null);
    const body = [
      `🚨 Security advisory escalation`,
      ``,
      ...advisoryLines(),
      ``,
      incidentDtuId ? `[Incident DTU ${incidentDtuId}]` : '(no incident DTU yet)',
    ].join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: escalateTo.trim(), content: body });
      if (r.data?.ok !== false) ok(`Escalated to ${escalateTo.trim()}.`);
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPatch() {
    setBusy('patch'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Patch plan — ${advisory.ghsa_id}`,
          tags: ['security', 'patch-plan', advisory.severity, advisory.ghsa_id],
          source: 'security:patch-plan',
          lineage: incidentDtuId ? [incidentDtuId] : [],
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            patch: {
              advisoryRef: advisory.ghsa_id,
              status: 'planned',
              targetDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
              steps: [
                'Confirm exposure (search dependency graph for affected package)',
                'Plan rollout window (off-peak; staged by environment)',
                'Apply patch in staging; verify regression tests',
                'Promote to prod; smoke + canary verify',
                'Close incident DTU; post short post-mortem',
              ],
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setPatchDtuId(id); ok(`Patch plan DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPostmortem() {
    setBusy('postmortem'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Post-mortem — ${advisory.ghsa_id}${advisory.cve_id ? ` (${advisory.cve_id})` : ''}`,
          tags: ['security', 'post-mortem', 'public', advisory.severity, advisory.ghsa_id],
          source: 'security:postmortem:publish',
          lineage: [incidentDtuId, patchDtuId].filter(Boolean) as string[],
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            advisory: {
              ghsa_id: advisory.ghsa_id,
              cve_id: advisory.cve_id ?? null,
              severity: advisory.severity,
              html_url: advisory.html_url,
            },
            structure: ['summary', 'timeline', 'impact', 'remediation', 'lessons'],
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) {
        setPublishedDtuId(id);
        ok(`Post-mortem published ${id.slice(0, 8)}…`);
      } else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!stackDescription.trim()) { err('Describe your stack.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Given GitHub Security Advisory ${advisory.ghsa_id}${advisory.cve_id ? ` (${advisory.cve_id})` : ''}`,
        `with severity ${advisory.severity}${advisory.cvss?.score ? ` and CVSS ${advisory.cvss.score}` : ''}.`,
        `Summary: ${advisory.summary.slice(0, 400)}`,
        ``,
        `Our stack: ${stackDescription.trim()}.`,
        ``,
        'Are we exposed? Return: (1) likely affected packages or layers; (2) suggested checks',
        '(grep / dependency-tree commands); (3) priority (immediate / soon / monitor); (4) mitigations.',
      ].join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Exposure brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const panes: { id: PaneId; label: string; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
    { id: 'incident',   label: 'Incident',    icon: Sparkles,    accent: '#06b6d4' },
    { id: 'escalate',   label: 'Escalate',    icon: Send,        accent: '#ec4899' },
    { id: 'patch',      label: 'Patch plan',  icon: FileText,    accent: '#8b5cf6' },
    { id: 'postmortem', label: 'Post-mortem', icon: Globe,       accent: '#22c55e' },
    { id: 'agent',      label: 'Exposure',    icon: Wand2,       accent: '#eab308' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        className="w-full max-w-2xl bg-zinc-950 border border-rose-500/30 rounded-t-2xl md:rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-rose-500/20 flex items-start gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', accent.bg, accent.text)}>
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-2">
              Advisory actions
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: accent.tag + '30', color: accent.tag }}>
                {advisory.severity}
              </span>
              {advisory.cvss?.score && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono text-zinc-300">
                  CVSS {advisory.cvss.score}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-white font-mono">{advisory.ghsa_id}</h3>
            {advisory.cve_id && <div className="text-[11px] text-zinc-400 font-mono">{advisory.cve_id}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex items-center border-b border-zinc-800 overflow-x-auto">
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
                  active ? '' : 'border-transparent text-zinc-400 hover:text-zinc-200',
                )}
                style={active ? { borderBottomColor: p.accent, color: p.accent } : {}}
              >
                <Icon className="w-3.5 h-3.5" />
                {p.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 min-h-[200px] max-h-[60vh] overflow-y-auto">
          {pane === 'incident' && (
            <div className="space-y-3">
              <pre className="bg-zinc-900 border border-zinc-800 rounded p-3 text-[11px] text-zinc-200 font-mono leading-relaxed whitespace-pre-wrap">
                {advisoryLines().join('\n')}
              </pre>
              {incidentDtuId ? (
                <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" /> Incident DTU <span className="font-mono">{incidentDtuId.slice(0, 12)}…</span>
                </div>
              ) : (
                <button type="button" onClick={actIncident} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-black text-sm font-semibold hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'incident' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Open incident
                </button>
              )}
            </div>
          )}

          {pane === 'escalate' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Escalate to (user id)</label>
                <input type="text" value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="incident-lead username" autoFocus />
              </div>
              <button type="button" onClick={actEscalate} disabled={!!busy || !escalateTo.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy === 'escalate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Escalate
              </button>
            </div>
          )}

          {pane === 'patch' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Mints a patch-plan DTU lineaging from the incident (if open) with a 5-step plan and a 7-day target
                date. Edit the plan later via dtu.update once you know the affected packages and rollout window.
              </p>
              {patchDtuId ? (
                <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" /> Patch plan <span className="font-mono">{patchDtuId.slice(0, 12)}…</span>
                </div>
              ) : (
                <button type="button" onClick={actPatch} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-semibold hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'patch' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Open patch plan
                </button>
              )}
            </div>
          )}

          {pane === 'postmortem' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Publishes a public post-mortem DTU lineaging from the incident + patch plan. Structure: summary,
                timeline, impact, remediation, lessons. Federation peers pick this up so other ops teams can learn.
              </p>
              {publishedDtuId ? (
                <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" /> Post-mortem <span className="font-mono">{publishedDtuId.slice(0, 12)}…</span>
                </div>
              ) : (
                <button type="button" onClick={actPostmortem} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'postmortem' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  Publish post-mortem
                </button>
              )}
            </div>
          )}

          {pane === 'agent' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Your stack</label>
                <textarea value={stackDescription} onChange={(e) => setStackDescription(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40 resize-none" placeholder="e.g. node 20 + express + react 18, Postgres, deployed on Fly.io…" />
              </div>
              <button type="button" onClick={actAgent} disabled={!!busy || !stackDescription.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 text-black text-sm font-semibold hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy === 'agent' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Assess exposure
              </button>
              {agentReply && (
                <div className="mt-2 px-3 py-3 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-xs text-zinc-200 max-h-72 overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
                    <AlertOctagon className="w-3 h-3" />
                    Exposure brief
                  </div>
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentReply}</pre>
                </div>
              )}
            </div>
          )}
        </div>

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
