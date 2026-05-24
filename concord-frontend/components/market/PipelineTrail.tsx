'use client';

/**
 * PipelineTrail — Shows the cross-domain pipeline chain that produced an artifact.
 */

import React, { Fragment } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface PipelineStep {
  domain: string;
  action: string;
  artifactId?: string;
  timestamp?: string;
}

interface PipelineTrailProps {
  trail: PipelineStep[];
}

function PipelineTrailInner({ trail }: PipelineTrailProps) {
  if (!trail?.length) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Pipeline</h4>
      <div className="flex items-center gap-1 flex-wrap">
        {trail.map((step, i) => (
          <Fragment key={i}>
            {i > 0 && <ArrowRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />}
            <Link
              href={`/lenses/${step.domain}`}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs
                bg-zinc-800 border border-zinc-700 text-zinc-300
                hover:border-neon-cyan/30 transition-colors whitespace-nowrap"
            >
              {step.domain}
              {step.action && (
                <span className="text-zinc-400">{step.action.replace(/-/g, ' ')}</span>
              )}
            </Link>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export const PipelineTrail = React.memo(PipelineTrailInner);
export default PipelineTrail;
