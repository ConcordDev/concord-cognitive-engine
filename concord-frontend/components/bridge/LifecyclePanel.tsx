'use client';

import { Baby, CheckCircle2, XCircle } from 'lucide-react';
import type { BirthCert } from './types';
import { EmptyCard } from './bridge-helpers';

export function LifecyclePanel({ births }: { births: BirthCert[] }) {
  if (births.length === 0) return <EmptyCard icon={<Baby />} message="No organism lifecycle events" hint="When a DTU swarm crosses the awakening threshold, a birth ceremony convenes all nine emergent agents." />;

  return (
    <div className="space-y-3">
      {births.slice().reverse().map(cert => (
        <div key={cert.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            {cert.approved ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
            <h3 className="font-semibold text-sm">{cert.swarmName}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${cert.approved ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {cert.approved ? 'Approved' : 'Denied'} — {cert.approvalRatio}
            </span>
            <span className="text-xs text-zinc-400 ml-auto">{new Date(cert.at).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {cert.governanceReviews.map((review, i) => (
              <div key={i} className="p-2 bg-zinc-800 rounded text-xs">
                <div className="flex items-center gap-1">
                  {review.approve ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="font-medium capitalize">{review.role}</span>
                </div>
                <div className="text-zinc-400 mt-1 line-clamp-2">{review.note}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
