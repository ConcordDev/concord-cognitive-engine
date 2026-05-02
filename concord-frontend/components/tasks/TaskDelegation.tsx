'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  ListTodo, Send, Loader2, CheckCircle, XCircle, Clock, Play,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  pending: { icon: Clock, color: 'text-gray-400' },
  running: { icon: Loader2, color: 'text-neon-cyan' },
  completed: { icon: CheckCircle, color: 'text-green-400' },
  partial: { icon: XCircle, color: 'text-yellow-400' },
  failed: { icon: XCircle, color: 'text-red-400' },
};

interface DelegatedTask {
  id: string;
  description: string;
  domain: string;
  steps: {
    id: string;
    description: string;
    type: string;
    assignedBrain: string;
    assignedPersona: string;
    status: string;
    result: string | null;
  }[];
  status: string;
  createdAt: string;
  completedAt: string | null;
}

function TaskDelegation({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['delegated-tasks'],
    queryFn: () => api.get('/api/tasks?limit=10').then(r => r.data),
    refetchInterval: 10000,
  });

  const delegateMutation = useMutation({
    mutationFn: (description: string) =>
      api.post('/api/tasks/delegate', { description, autoExecute: true }),
    onSuccess: () => {
      setTaskInput('');
      queryClient.invalidateQueries({ queryKey: ['delegated-tasks'] });
    },
  });

  const executeMutation = useMutation({
    mutationFn: (taskId: string) => api.post(`/api/tasks/${taskId}/execute`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegated-tasks'] });
    },
  });

  const tasks: DelegatedTask[] = data?.tasks || [];

  if (isLoading) {
    return (
      <div className={cn('p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse', className)}>
        <div className="h-6 bg-lattice-deep rounded w-40" />
      </div>
    );
  }

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/20 rounded-lg">
            <ListTodo className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">Task Delegation</h3>
            <p className="text-xs text-gray-500">
              {tasks.length > 0 ? `${tasks.filter(t => t.status === 'completed').length}/${tasks.length} tasks done` : 'Delegate tasks to brains'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Task input */}
      <div className="p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && taskInput.trim() && !delegateMutation.isPending) {
                delegateMutation.mutate(taskInput.trim());
              }
            }}
            placeholder="Describe a task to delegate..."
            className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
            disabled={delegateMutation.isPending}
          />
          <button
            onClick={() => taskInput.trim() && delegateMutation.mutate(taskInput.trim())}
            disabled={!taskInput.trim() || delegateMutation.isPending}
            className="px-3 py-2 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors disabled:opacity-50"
          >
            {delegateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Recent tasks */}
      {tasks.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          {tasks.slice(0, expanded ? 10 : 3).map(task => {
            const statusConf = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const StatusIcon = statusConf.icon;

            return (
              <div key={task.id} className="p-3 bg-lattice-deep rounded-lg">
                <div className="flex items-center gap-2">
                  <StatusIcon className={cn('w-4 h-4', statusConf.color, task.status === 'running' && 'animate-spin')} />
                  <p className="text-sm text-white flex-1 truncate">{task.description}</p>
                  {task.status === 'pending' && (
                    <button
                      onClick={() => executeMutation.mutate(task.id)}
                      disabled={executeMutation.isPending}
                      className="p-1 text-neon-cyan hover:bg-neon-cyan/20 rounded transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Steps */}
                {task.steps.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {task.steps.map(step => {
                      const stepConf = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
                      const StepIcon = stepConf.icon;
                      return (
                        <div key={step.id} className="flex items-start gap-2 pl-6">
                          <StepIcon className={cn('w-3 h-3 mt-0.5', stepConf.color, step.status === 'running' && 'animate-spin')} />
                          <div className="min-w-0">
                            <p className="text-xs text-gray-400 truncate">{step.description}</p>
                            {step.result && (
                              <p className="text-[10px] text-gray-500 truncate mt-0.5">{step.result}</p>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-600 flex-shrink-0">{step.assignedBrain}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _TaskDelegation = withErrorBoundary(TaskDelegation);
export { _TaskDelegation as TaskDelegation };
