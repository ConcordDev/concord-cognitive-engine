'use client';

import { InferenceTranscriptViewer } from '@/components/debug/InferenceTranscriptViewer';
import { SLODashboard } from '@/components/debug/SLODashboard';
import { ProvenanceDashboard } from '@/components/debug/ProvenanceDashboard';

export function MonitoringPanel() {
  return (
    <div className="space-y-6">
      <div className="panel p-4">
        <InferenceTranscriptViewer />
      </div>
      <div className="panel p-4">
        <SLODashboard />
      </div>
      <div className="panel p-4">
        <ProvenanceDashboard />
      </div>
    </div>
  );
}
