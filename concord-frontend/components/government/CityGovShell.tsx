'use client';

/**
 * CityGovShell — SeeClickFix + Accela-shape silhouette.
 *
 * Top metric strip (Open SRs / Closed 30d / Avg resolution / Permits),
 * three-column main: 311 service-request map placeholder + recent
 * requests left, permits-in-progress middle, infrastructure asset
 * health right.
 *
 * Per "everything must be real": all props come from real macros
 * (dashboard-summary + service-requests-list + permits-list + assets-list).
 */

import React from 'react';
import {
  Megaphone, FileText, Wrench, MapPin, Clock, Building2,
  CheckCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GovServiceRequest {
  id: string;
  referenceNumber: string;
  category: string;
  description: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedDepartmentName?: string | null;
  createdAt: string;
  lat?: number;
  lng?: number;
}

export interface GovPermit {
  id: string;
  recordNumber: string;
  kind: string;
  applicantName: string;
  status: string;
  feeUsd: number;
}

export interface GovAsset {
  id: string;
  kind: string;
  label: string;
  condition: 'good' | 'fair' | 'poor' | 'broken';
}

export interface CityGovShellProps {
  totalServiceRequests: number;
  openRequests: number;
  closed30d: number;
  avgResolutionDays: number;
  permitCount: number;
  scheduledInspections: number;
  departmentCount: number;
  assetCount: number;
  brokenAssets: number;
  requests: GovServiceRequest[];
  permits: GovPermit[];
  assets: GovAsset[];
  className?: string;
}

const PRIORITY_COLOUR: Record<GovServiceRequest['priority'], string> = {
  urgent: 'bg-rose-500 text-white',
  high: 'bg-amber-500 text-black',
  medium: 'bg-cyan-500 text-black',
  low: 'bg-gray-500 text-gray-100',
};

const CONDITION_COLOUR: Record<GovAsset['condition'], string> = {
  good: 'bg-emerald-500/15 text-emerald-300',
  fair: 'bg-cyan-500/15 text-cyan-300',
  poor: 'bg-amber-500/15 text-amber-300',
  broken: 'bg-rose-500/15 text-rose-300',
};

export function CityGovShell({
  totalServiceRequests, openRequests, closed30d, avgResolutionDays,
  permitCount, scheduledInspections, assetCount, brokenAssets,
  requests, permits, assets, className,
}: CityGovShellProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d1117] text-gray-100', className)}>
      {/* Metric strip */}
      <div className="grid grid-cols-5 gap-2">
        <Metric icon={Megaphone} label="Open 311 SRs" value={String(openRequests)} caption={`of ${totalServiceRequests} total`} tone="amber" />
        <Metric icon={CheckCircle} label="Closed 30d" value={String(closed30d)} caption="resolved" tone="emerald" />
        <Metric icon={Clock} label="Avg resolution" value={`${avgResolutionDays}d`} caption="across all SRs" tone="cyan" />
        <Metric icon={FileText} label="Permits" value={String(permitCount)} caption={`${scheduledInspections} insps`} tone="violet" />
        <Metric icon={Wrench} label="Assets" value={String(assetCount)} caption={`${brokenAssets} broken/poor`} tone="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 311 service requests */}
        <section className="rounded-lg border border-amber-500/20 overflow-hidden">
          <header className="px-3 py-2 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2">
            <Megaphone className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">311 requests</span>
            <span className="ml-auto text-[10px] text-gray-500">{requests.length}</span>
          </header>
          {requests.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No requests yet — citizens file them from the workbench below.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {requests.slice(0, 8).map(r => (
                <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3 text-amber-300" />
                    <span className="text-[10px] font-mono text-cyan-300">{r.referenceNumber}</span>
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', PRIORITY_COLOUR[r.priority])}>{r.priority}</span>
                    <span className="ml-auto text-[9px] uppercase text-gray-500">{r.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-xs text-white truncate mt-0.5">{r.category.replace(/_/g, ' ')} · {r.description.slice(0, 60)}</div>
                  {r.assignedDepartmentName && <div className="text-[10px] text-gray-500">Assigned to {r.assignedDepartmentName}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Permits */}
        <section className="rounded-lg border border-violet-500/20 overflow-hidden">
          <header className="px-3 py-2 bg-violet-500/5 border-b border-violet-500/20 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Permits in progress</span>
            <span className="ml-auto text-[10px] text-gray-500">{permits.length}</span>
          </header>
          {permits.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No permits yet — applicants apply from the workbench below.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {permits.slice(0, 8).map(p => (
                <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                  <Building2 className="w-3.5 h-3.5 text-violet-300" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono text-violet-300">{p.recordNumber}</div>
                    <div className="text-xs text-white truncate">{p.kind} · {p.applicantName}</div>
                  </div>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{p.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Asset health */}
        <section className="rounded-lg border border-cyan-500/20 overflow-hidden">
          <header className="px-3 py-2 bg-cyan-500/5 border-b border-cyan-500/20 flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Asset health</span>
            <span className="ml-auto text-[10px] text-gray-500">{assets.length}</span>
          </header>
          {assets.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No assets yet — add streetlights, hydrants, signs from the workbench below.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {assets.slice(0, 8).map(a => (
                <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                  {(a.condition === 'broken' || a.condition === 'poor')
                    ? <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                    : <CheckCircle className="w-3.5 h-3.5 text-emerald-300" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{a.label || a.kind}</div>
                    <div className="text-[10px] text-gray-500">{a.kind.replace(/_/g, ' ')}</div>
                  </div>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', CONDITION_COLOUR[a.condition])}>{a.condition}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  amber: 'border-amber-500/20 text-amber-300',
  emerald: 'border-emerald-500/20 text-emerald-300',
  cyan: 'border-cyan-500/20 text-cyan-300',
  violet: 'border-violet-500/20 text-violet-300',
  rose: 'border-rose-500/20 text-rose-300',
};

function Metric({ icon: Icon, label, value, caption, tone }: { icon: typeof Megaphone; label: string; value: string; caption: string; tone: string }) {
  return (
    <div className={cn('rounded-lg border bg-white/[0.02] p-2.5', TILE_TONE[tone])}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-lg font-mono font-bold tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-gray-500">{caption}</div>
    </div>
  );
}

export default CityGovShell;
