'use client';

/**
 * PipelineProgress — Real-time pipeline execution progress in chat rail.
 * Shows each step as it runs, with links to completed artifacts.
 */

import { useState, useEffect } from 'react';
import { Layers, Loader, CheckCircle, XCircle, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PipelineStep {
  lens: string;
  action: string;
  order: number;
}

type StepStatus = 'pending' | 'running' | { status: 'completed' | 'failed'; dtuId?: string };

interface PipelineProgressProps {
  pipelineId: string;
  executionId: string;
  description: string;
  steps: PipelineStep[];
  onComplete?: (data: { status: string; dtuIds: string[] }) => void;
  socket?: {
    on: (event: string, handler: (data: unknown) => void) => void;
    off: (event: string, handler: (data: unknown) => void) => void;
  };
}

export function PipelineProgress({
  pipelineId,
  executionId,
  description,
  steps,
  onComplete,
  socket,
}: PipelineProgressProps) {
  const [stepStatuses, setStepStatuses] = useState<Map<number, StepStatus>>(new Map());

  useEffect(() => {
    if (!socket) return;

    const handleStepStarted = (data: unknown) => {
      const d = data as { executionId: string; step: number };
      if (d.executionId !== executionId) return;
      setStepStatuses(prev => new Map(prev).set(d.step, 'running'));
    };

    const handleStepCompleted = (data: unknown) => {
      const d = data as { executionId: string; step: number; status: string; dtuId?: string };
      if (d.executionId !== executionId) return;
      setStepStatuses(prev => new Map(prev).set(d.step, {
        status: d.status as 'completed' | 'failed',
        dtuId: d.dtuId,
      }));
    };

    const handleCompleted = (data: unknown) => {
      const d = data as { executionId: string; status: string; dtuIds: string[] };
      if (d.executionId !== executionId) return;
      onComplete?.(d);
    };

    socket.on('pipeline:step_started', handleStepStarted);
    socket.on('pipeline:step_completed', handleStepCompleted);
    socket.on('pipeline:completed', handleCompleted);

    return () => {
      socket.off('pipeline:step_started', handleStepStarted);
      socket.off('pipeline:step_completed', handleStepCompleted);
      socket.off('pipeline:completed', handleCompleted);
    };
  }, [socket, executionId, onComplete]);

  return (
    <div className="mx-4 my-3 p-4 rounded-lg border border-blue-500/30 bg-blue-900/10">
      <h3 className="text-sm font-medium text-blue-300 mb-1 flex items-center gap-2">
        <Layers className="w-4 h-4" />
        {description}
      </h3>
      <p className="text-xs text-zinc-500 mb-3">Pipeline: {pipelineId}</p>
      <div className="space-y-2">
        {steps.map((step) => {
          const status = stepStatuses.get(step.order);
          const isRunning = status === 'running';
          const isCompleted = typeof status === 'object' && status?.status === 'completed';
          const isFailed = typeof status === 'object' && status?.status === 'failed';

          return (
            <div key={step.order} className="flex items-center gap-3">
              {isRunning ? (
                <Loader className="w-4 h-4 text-blue-400 animate-spin" />
              ) : isCompleted ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : isFailed ? (
                <XCircle className="w-4 h-4 text-red-400" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-600" />
              )}
              <span className={cn(
                'text-sm',
                isRunning ? 'text-blue-300' :
                isCompleted ? 'text-zinc-200' :
                'text-zinc-500',
              )}>
                {step.lens}: {step.action.replace(/-/g, ' ')}
              </span>
              {typeof status === 'object' && status?.dtuId && (
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('pipeline:view-dtu', { detail: { dtuId: status.dtuId } })); }}
                  className="text-xs text-cyan-400 underline ml-auto"
                >
                  View
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
