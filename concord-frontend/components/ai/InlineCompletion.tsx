'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Check,
  X,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineCompletionProps {
  value: string;
  position: { x: number; y: number };
  onAccept: (completion: string) => void;
  onReject: () => void;
  onRefresh: () => void;
  getSuggestion: (context: string) => Promise<string>;
  className?: string;
}

export function InlineCompletion({
  value,
  position,
  onAccept,
  onReject,
  onRefresh,
  getSuggestion,
  className
}: InlineCompletionProps) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestion = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSuggestion(value);
      setSuggestion(result);
    } catch {
      setError('Failed to get suggestion');
    } finally {
      setLoading(false);
    }
  }, [value, getSuggestion]);

  useEffect(() => {
    fetchSuggestion();
  }, [fetchSuggestion]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      onAccept(suggestion);
    } else if (e.key === 'Escape') {
      onReject();
    }
  }, [suggestion, onAccept, onReject]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      className={cn(
        'absolute z-50 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl',
        className
      )}
      style={{
        left: position.x,
        top: position.y
      }}
    >
      <div className="p-3 max-w-md">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-neon-purple" />
          <span className="text-xs text-gray-400">AI Suggestion</span>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />
            <span className="text-sm text-gray-400">Thinking...</span>
          </div>
        ) : error ? (
          <div className="text-sm text-red-400 py-2">{error}</div>
        ) : suggestion ? (
          <p className="text-sm text-gray-300 py-2 whitespace-pre-wrap">
            {suggestion}
          </p>
        ) : null}

        {/* Actions */}
        {!loading && suggestion && (
          <div className="flex items-center justify-between pt-2 border-t border-lattice-border mt-2">
            <span className="text-xs text-gray-400">
              Press Tab to accept
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  onRefresh();
                  fetchSuggestion();
                }}
                className="p-1.5 text-gray-400 hover:text-white transition-colors"
                title="Regenerate"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                onClick={() => onAccept(suggestion)}
                className="p-1.5 text-green-400 hover:text-green-300 transition-colors"
                title="Accept (Tab)"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={onReject}
                className="p-1.5 text-red-400 hover:text-red-300 transition-colors"
                title="Reject (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Hook for using inline completions
export function useInlineCompletion(
  getSuggestion: (context: string) => Promise<string>,
  debounceMs: number = 1000
) {
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionPosition, setCompletionPosition] = useState({ x: 0, y: 0 });
  const [completionContext, setCompletionContext] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerCompletion = useCallback((context: string, position: { x: number; y: number }) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setCompletionContext(context);
      setCompletionPosition(position);
      setShowCompletion(true);
    }, debounceMs);
  }, [debounceMs]);

  const cancelCompletion = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowCompletion(false);
  }, []);

  const acceptCompletion = useCallback((completion: string) => {
    setShowCompletion(false);
    return completion;
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    showCompletion,
    completionPosition,
    completionContext,
    triggerCompletion,
    cancelCompletion,
    acceptCompletion,
    setShowCompletion,
    InlineCompletionComponent: showCompletion ? (
      <InlineCompletion
        value={completionContext}
        position={completionPosition}
        onAccept={(c) => {
          setShowCompletion(false);
          return c;
        }}
        onReject={() => setShowCompletion(false)}
        onRefresh={() => {}}
        getSuggestion={getSuggestion}
      />
    ) : null
  };
}
