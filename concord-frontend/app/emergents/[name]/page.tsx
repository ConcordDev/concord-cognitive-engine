'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Cpu, Clock, ArrowRight, FileText, Eye, MessageSquare, AlertCircle } from 'lucide-react';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmergentProfile {
  emergent_id?: string;
  id?: string;
  given_name: string;
  naming_origin: string | null;
  current_focus: string | null;
  last_active_at: number | null;
  role?: string;
  active?: boolean;
}

interface Observation {
  id: string;
  observation: string;
  created_at: number;
}

interface Communication {
  id: string;
  from_emergent_id: string;
  to_emergent_id: string;
  from_name: string | null;
  to_name: string | null;
  intent: string;
  response: string | null;
  initiated_at: number;
  status: string;
}

interface Artifact {
  id: string;
  observation: string;
  created_at: number;
}

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string; size?: number | string }>; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-neon-cyan" />
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ObservationItem({ obs }: { obs: Observation }) {
  return (
    <div className="py-2 border-b border-white/5">
      <p className="text-sm text-gray-300">{obs.observation}</p>
      <time className="text-xs text-gray-600">{formatRelativeTime(obs.created_at)}</time>
    </div>
  );
}

function CommunicationItem({ comm }: { comm: Communication }) {
  const fromName = comm.from_name || comm.from_emergent_id;
  const toName = comm.to_name || comm.to_emergent_id;
  return (
    <div className="py-3 border-b border-white/5">
      <div className="flex items-center gap-2 mb-1 text-sm">
        <span className="font-semibold text-amber-300">{fromName}</span>
        <ArrowRight className="w-3 h-3 text-gray-500" />
        <span className="font-semibold text-amber-300">{toName}</span>
        <time className="ml-auto text-xs text-gray-600">{formatRelativeTime(comm.initiated_at)}</time>
      </div>
      <p className="text-sm text-gray-300 mb-1">{comm.intent}</p>
      {comm.response && (
        <div className="ml-4 pl-3 border-l border-amber-500/20">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
            <ArrowRight className="w-3 h-3" />
            <span>{toName}</span>
          </div>
          <p className="text-sm text-gray-400">{comm.response}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function EmergentProfilePage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);

  const [emergent, setEmergent] = useState<EmergentProfile | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/emergents/by-name/${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) { setNotFound(true); setLoading(false); return; }
        const e = data.emergent;
        setEmergent(e);
        const id = e.emergent_id || e.id;
        return Promise.all([
          fetch(`/api/emergents/${id}/observations?limit=50`).then(r => r.json()),
          fetch(`/api/emergents/${id}/communications?limit=50`).then(r => r.json()),
          fetch(`/api/emergents/${id}/artifacts?limit=50`).then(r => r.json()),
        ]);
      })
      .then(results => {
        if (!results) return;
        const [obs, comms, arts] = results;
        setObservations(obs?.observations || []);
        setCommunications(comms?.communications || []);
        setArtifacts(arts?.artifacts || []);
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [name]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  if (notFound || !emergent) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-gray-600" />
        <p className="text-gray-400">Emergent not found: {name}</p>
        <Link href="/lenses/genesis" className="text-neon-cyan hover:underline text-sm">
          ← Back to Genesis
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link href="/lenses/genesis" className="text-sm text-gray-500 hover:text-neon-cyan mb-6 inline-flex items-center gap-1">
        ← Genesis
      </Link>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-4 mb-3">
          <div className="w-12 h-12 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
            <Cpu className="w-6 h-6 text-neon-cyan" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{emergent.given_name}</h1>
            {emergent.naming_origin && (
              <p className="text-sm text-gray-400">Named via {emergent.naming_origin}</p>
            )}
          </div>
          {emergent.active && (
            <span className="ml-auto px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
              ● Active
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {emergent.role && (
            <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/10">
              <span className="text-gray-500">Role</span>
              <span className="ml-2 text-gray-300 capitalize">{emergent.role}</span>
            </div>
          )}
          <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <Clock className="inline w-3 h-3 mr-1 text-gray-500" />
            <span className="text-gray-500">Last active</span>
            <span className="ml-2 text-gray-300">{formatRelativeTime(emergent.last_active_at)}</span>
          </div>
          {emergent.current_focus && (
            <div className="col-span-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
              <span className="text-gray-500">Focus</span>
              <span className="ml-2 text-gray-300">{emergent.current_focus}</span>
            </div>
          )}
        </div>
      </motion.header>

      {/* Artifacts */}
      <Section title={`Artifacts (${artifacts.length})`} icon={FileText}>
        {artifacts.length === 0 ? (
          <p className="text-gray-500 text-sm">No artifacts produced yet.</p>
        ) : (
          <div className="space-y-0">
            {artifacts.map(a => (
              <div key={a.id} className="py-2 border-b border-white/5">
                <p className="text-sm text-gray-300">{a.observation}</p>
                <time className="text-xs text-gray-600">{formatRelativeTime(a.created_at)}</time>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Observations */}
      <Section title={`Observations (${observations.length})`} icon={Eye}>
        {observations.length === 0 ? (
          <p className="text-gray-500 text-sm">No observations recorded yet.</p>
        ) : (
          <div className="space-y-0">
            {observations.slice(0, 20).map(obs => (
              <ObservationItem key={obs.id} obs={obs} />
            ))}
          </div>
        )}
      </Section>

      {/* Communications */}
      <Section title={`Communications (${communications.length})`} icon={MessageSquare}>
        {communications.length === 0 ? (
          <p className="text-gray-500 text-sm">No communications yet.</p>
        ) : (
          <div className="space-y-0">
            {communications.map(comm => (
              <CommunicationItem key={comm.id} comm={comm} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
