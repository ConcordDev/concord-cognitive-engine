'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Palette,
  Wrench,
  Shield,
  Compass,
  BookOpen,
  Send,
  Loader2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AVATAR_ICONS: Record<string, React.ElementType> = {
  chart: BarChart3,
  palette: Palette,
  wrench: Wrench,
  shield: Shield,
  compass: Compass,
  book: BookOpen,
};

const AVATAR_COLORS: Record<string, string> = {
  chart: 'text-blue-400 bg-blue-500/20',
  palette: 'text-pink-400 bg-pink-500/20',
  wrench: 'text-green-400 bg-green-500/20',
  shield: 'text-red-400 bg-red-500/20',
  compass: 'text-yellow-400 bg-yellow-500/20',
  book: 'text-purple-400 bg-purple-500/20',
};

interface Persona {
  id: string;
  name: string;
  brain: string;
  style: string;
  domains: string[];
  avatar: string;
  active: boolean;
  stats: { queries: number; lastActive: string | null };
}

function AgentPersonas({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [lastResponse, setLastResponse] = useState<{ persona: string; response: string } | null>(
    null
  );
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get('/api/personas').then((r) => r.data),
  });

  const createAgentMutation = useMutation({
    mutationFn: () => api.post('/api/agent/create').then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  const configureAgentMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      api.put('/api/agent/config', config).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  const askMutation = useMutation({
    mutationFn: ({ personaId, q }: { personaId: string; q: string }) =>
      api.post(`/api/personas/${personaId}/ask`, { question: q }),
    onSuccess: (result, variables) => {
      const persona = personas.find((p) => p.id === variables.personaId);
      setLastResponse({
        persona: persona?.name || 'Agent',
        response: result.data?.response || 'No response',
      });
      setQuestion('');
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  const personas: Persona[] = data?.personas || [];

  if (isLoading) {
    return (
      <div
        className={cn(
          'p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse',
          className
        )}
      >
        <div className="h-6 bg-lattice-deep rounded w-40" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-neon-cyan/20 rounded-lg">
            <MessageSquare className="w-5 h-5 text-neon-cyan" />
          </div>
          <div>
            <h3 className="font-medium text-white">Agent Personas</h3>
            <p className="text-xs text-gray-500">
              {personas.filter((p) => p.active).length} experts available
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => createAgentMutation.mutate()}
            disabled={createAgentMutation.isPending}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-neon-cyan transition-colors disabled:opacity-50"
            title="Create new agent"
          >
            {createAgentMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <PlusCircle className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
            aria-label={expanded ? 'Collapse agent personas' : 'Expand agent personas'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Persona grid */}
      <div className="p-4 grid grid-cols-3 gap-2">
        {personas
          .filter((p) => p.active)
          .map((persona) => {
            const Icon = AVATAR_ICONS[persona.avatar] || BookOpen;
            const colors = AVATAR_COLORS[persona.avatar] || 'text-gray-400 bg-gray-500/20';
            const isSelected = selectedPersona === persona.id;

            return (
              <button
                key={persona.id}
                onClick={() => setSelectedPersona(isSelected ? null : persona.id)}
                className={cn(
                  'p-3 rounded-lg border text-center transition-all',
                  isSelected
                    ? 'border-neon-cyan/50 bg-neon-cyan/5'
                    : 'border-lattice-border hover:border-lattice-border/80 hover:bg-lattice-deep'
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 mx-auto rounded-lg flex items-center justify-center',
                    colors
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-xs font-medium text-white mt-1 truncate">{persona.name}</p>
                <p className="text-[10px] text-gray-500">{persona.stats.queries} queries</p>
              </button>
            );
          })}
      </div>

      {/* Ask selected persona */}
      {selectedPersona && (
        <div className="px-4 pb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && question.trim() && !askMutation.isPending) {
                  askMutation.mutate({ personaId: selectedPersona, q: question.trim() });
                }
              }}
              placeholder={`Ask ${personas.find((p) => p.id === selectedPersona)?.name}...`}
              className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neon-cyan"
              disabled={askMutation.isPending}
            />
            <button
              onClick={() =>
                question.trim() &&
                askMutation.mutate({ personaId: selectedPersona, q: question.trim() })
              }
              disabled={!question.trim() || askMutation.isPending}
              className="px-3 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 transition-colors disabled:opacity-50"
            >
              {askMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Last response */}
      {lastResponse && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-lattice-deep rounded-lg">
            <p className="text-xs text-neon-cyan font-medium mb-1">{lastResponse.persona}</p>
            <p className="text-sm text-gray-300">{lastResponse.response}</p>
          </div>
        </div>
      )}

      {/* Expanded: persona details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-lattice-border space-y-2">
              {personas.map((persona) => (
                <div
                  key={persona.id}
                  className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    {(() => {
                      const Icon = AVATAR_ICONS[persona.avatar] || BookOpen;
                      return (
                        <Icon
                          className={cn(
                            'w-4 h-4',
                            (AVATAR_COLORS[persona.avatar] || '').split(' ')[0]
                          )}
                        />
                      );
                    })()}
                    <div>
                      <p className="text-sm text-white">{persona.name}</p>
                      <p className="text-[10px] text-gray-500">{persona.style}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">{persona.domains.join(', ')}</p>
                      <p className="text-[10px] text-gray-500">{persona.brain} brain</p>
                    </div>
                    <button
                      onClick={() =>
                        configureAgentMutation.mutate({
                          personaId: persona.id,
                          active: !persona.active,
                        })
                      }
                      disabled={configureAgentMutation.isPending}
                      className="p-1 rounded hover:bg-lattice-surface text-gray-500 hover:text-neon-cyan transition-colors disabled:opacity-50"
                      title={`Configure ${persona.name}`}
                    >
                      {configureAgentMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Settings className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedAgentPersonas = withErrorBoundary(AgentPersonas);
export { _WrappedAgentPersonas as AgentPersonas };
