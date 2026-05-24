'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  X,
  Sparkles,
  Tag,
  Hash,
  ArrowRight,
  Zap,
  Brain,
  Lightbulb,
  FileText,
  MessageSquare,
  Bookmark
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHelpers } from '@/lib/api/client';

interface QuickCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture?: (dtu: unknown) => void;
}

type CaptureType = 'thought' | 'note' | 'idea' | 'question' | 'bookmark';

const captureTypes: { type: CaptureType; icon: React.ComponentType<{ className?: string; size?: number | string }>; label: string; color: string }[] = [
  { type: 'thought', icon: Brain, label: 'Thought', color: 'text-neon-cyan' },
  { type: 'idea', icon: Lightbulb, label: 'Idea', color: 'text-neon-yellow' },
  { type: 'note', icon: FileText, label: 'Note', color: 'text-neon-purple' },
  { type: 'question', icon: MessageSquare, label: 'Question', color: 'text-neon-pink' },
  { type: 'bookmark', icon: Bookmark, label: 'Bookmark', color: 'text-neon-green' },
];

export function QuickCapture({ isOpen, onClose, onCapture }: QuickCaptureProps) {
  const [content, setContent] = useState('');
  const [captureType, setCaptureType] = useState<CaptureType>('thought');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Escape to close
  useHotkeys('escape', () => {
    if (isOpen) onClose();
  }, { enabled: isOpen });

  // Submit with Cmd+Enter
  useHotkeys('mod+enter', () => {
    if (isOpen && content.trim()) handleSubmit();
  }, { enabled: isOpen, enableOnFormTags: ['TEXTAREA'] });

  // Get AI suggestions when content changes
  useEffect(() => {
    if (content.length > 20) {
      const timer = setTimeout(async () => {
        try {
          // Simulated AI suggestions - would call API in real implementation
          const words = content.toLowerCase().split(/\s+/);
          const suggestions = words
            .filter(w => w.length > 4)
            .slice(0, 3)
            .map(w => `#${w}`);
          setAiSuggestions(suggestions);
        } catch {
          // Ignore errors
        }
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setAiSuggestions([]);
    }
  }, [content]);

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Auto-domain detection: call lens/run classify to determine best domain
      let detectedDomain: string | undefined;
      try {
        const classifyRes = await apiHelpers.lens.runDomain('meta', 'classify', { text: content.trim() });
        detectedDomain = classifyRes.data?.domain || classifyRes.data?.lens;
      } catch {
        // Classification failed — proceed without domain, forge will auto-assign
      }

      const forgePayload: { content: string; tags: string[]; source: string; domain?: string } = {
        content: content.trim(),
        tags: [...tags, captureType],
        source: 'quick-capture',
      };
      if (detectedDomain) forgePayload.domain = detectedDomain;

      const response = await apiHelpers.forge.manual(forgePayload);
      const dtu = response.data;

      onCapture?.(dtu);
      setContent('');
      setTags([]);
      setCaptureType('thought');
      onClose();
    } catch (error) {
      console.error('Failed to capture:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTag = (tag: string) => {
    const normalized = tag.toLowerCase().replace(/^#/, '').trim();
    if (normalized && !tags.includes(normalized)) {
      setTags([...tags, normalized]);
    }
    setTagInput('');
    setShowTagInput(false);
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      handleAddTag(tagInput);
    } else if (e.key === 'Escape') {
      setShowTagInput(false);
      setTagInput('');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-2xl z-50"
          >
            <div className="bg-lattice-bg border border-lattice-border rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-neon-cyan" />
                  <span className="text-sm font-medium text-white">Quick Capture</span>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded hover:bg-lattice-surface text-gray-400 hover:text-white transition-colors"
                aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Type Selector */}
              <div className="flex items-center gap-1 px-4 py-2 border-b border-lattice-border/50">
                {captureTypes.map(({ type, icon: Icon, label, color }) => (
                  <button
                    key={type}
                    onClick={() => setCaptureType(type)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                      captureType === type
                        ? 'bg-lattice-surface border border-lattice-border'
                        : 'hover:bg-lattice-surface/50'
                    )}
                  >
                    <Icon className={cn('w-4 h-4', captureType === type ? color : 'text-gray-400')} />
                    <span className={captureType === type ? 'text-white' : 'text-gray-400'}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="p-4">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Capture your thought..."
                  className="w-full h-32 bg-transparent text-white placeholder-gray-500 resize-none focus:outline-none text-lg"
                />

                {/* Tags */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {tags.map((tag) => (
                    <motion.span
                      key={tag}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="flex items-center gap-1 px-2 py-1 bg-neon-purple/20 text-neon-purple border border-neon-purple/30 rounded-full text-sm"
                    >
                      <Hash className="w-3 h-3" />
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-1 hover:text-white"
                      aria-label="Close">
                        <X className="w-3 h-3" />
                      </button>
                    </motion.span>
                  ))}

                  {showTagInput ? (
                    <input
                      ref={tagInputRef}
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      onBlur={() => {
                        if (tagInput.trim()) handleAddTag(tagInput);
                        else setShowTagInput(false);
                      }}
                      placeholder="Add tag..."
                      className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan w-24"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setShowTagInput(true)}
                      className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:text-white hover:bg-lattice-surface rounded transition-colors text-sm"
                    >
                      <Tag className="w-3 h-3" />
                      Add tag
                    </button>
                  )}
                </div>

                {/* AI Suggestions */}
                {aiSuggestions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-neon-cyan" />
                    <span className="text-xs text-gray-400">Suggested:</span>
                    {aiSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => handleAddTag(suggestion)}
                        className="px-2 py-0.5 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 rounded text-xs hover:bg-neon-cyan/20 transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-lattice-border bg-lattice-surface/30">
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">⌘</kbd>
                    <span>+</span>
                    <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">↵</kbd>
                    <span className="ml-1">to save</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">Esc</kbd>
                    <span className="ml-1">to close</span>
                  </span>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={!content.trim() || isSubmitting}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                    content.trim()
                      ? 'bg-neon-cyan text-black hover:bg-neon-cyan/90'
                      : 'bg-lattice-surface text-gray-400 cursor-not-allowed'
                  )}
                >
                  {isSubmitting ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full"
                    />
                  ) : (
                    <>
                      Capture
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Hook to manage quick capture state
export function useQuickCapture() {
  const [isOpen, setIsOpen] = useState(false);

  useHotkeys('mod+shift+n', (e) => {
    e.preventDefault();
    setIsOpen(true);
  }, { enableOnFormTags: ['INPUT', 'TEXTAREA'] });

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(!isOpen)
  };
}
