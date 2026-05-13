'use client';

import { useState, useEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target, Coffee, Play, Pause, RotateCcw } from 'lucide-react';
import { cn, getScrollPercentage } from '@/lib/utils';

interface FocusModeProps {
  children: ReactNode;
  isActive: boolean;
  onToggle: () => void;
  showTimer?: boolean;
  className?: string;
}

export function FocusMode({
  children,
  isActive,
  onToggle,
  showTimer = true,
  className
}: FocusModeProps) {
  return (
    <AnimatePresence>
      {isActive ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black"
        >
          {/* Exit button */}
          <button
            onClick={onToggle}
            className="fixed top-4 right-4 z-50 p-2 text-gray-500 hover:text-white transition-colors opacity-30 hover:opacity-100"
            title="Exit focus mode (Esc)"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Timer */}
          {showTimer && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 opacity-30 hover:opacity-100 transition-opacity">
              <PomodoroTimer />
            </div>
          )}

          {/* Content */}
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className={cn(
              'h-full flex items-center justify-center p-8',
              className
            )}
          >
            <div className="w-full max-w-4xl">
              {children}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// Pomodoro Timer Component
interface PomodoroTimerProps {
  workDuration?: number; // in minutes
  breakDuration?: number;
  onComplete?: () => void;
}

export function PomodoroTimer({
  workDuration = 25,
  breakDuration = 5,
  onComplete
}: PomodoroTimerProps) {
  const [mode, setMode] = useState<'work' | 'break'>('work');
  const [timeLeft, setTimeLeft] = useState(workDuration * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState(0);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Timer complete
          if (mode === 'work') {
            setSessions(s => s + 1);
            setMode('break');
            onComplete?.();
            return breakDuration * 60;
          } else {
            setMode('work');
            return workDuration * 60;
          }
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, mode, workDuration, breakDuration, onComplete]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const reset = () => {
    setIsRunning(false);
    setMode('work');
    setTimeLeft(workDuration * 60);
  };

  const progress = mode === 'work'
    ? ((workDuration * 60 - timeLeft) / (workDuration * 60)) * 100
    : ((breakDuration * 60 - timeLeft) / (breakDuration * 60)) * 100;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-lattice-surface/80 backdrop-blur border border-lattice-border rounded-full">
      {/* Mode indicator */}
      <div className="flex items-center gap-2">
        {mode === 'work' ? (
          <Target className="w-4 h-4 text-neon-cyan" />
        ) : (
          <Coffee className="w-4 h-4 text-green-400" />
        )}
        <span className={cn(
          'text-sm font-medium',
          mode === 'work' ? 'text-neon-cyan' : 'text-green-400'
        )}>
          {mode === 'work' ? 'Focus' : 'Break'}
        </span>
      </div>

      {/* Timer */}
      <div className="relative">
        <svg className="w-12 h-12 -rotate-90">
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="#374151"
            strokeWidth="3"
          />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke={mode === 'work' ? '#22d3ee' : '#10b981'}
            strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 20}`}
            strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress / 100)}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-mono text-white">{formatTime(timeLeft)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setIsRunning(!isRunning)}
          className="p-1.5 text-gray-400 hover:text-white transition-colors"
        >
          {isRunning ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={reset}
          className="p-1.5 text-gray-400 hover:text-white transition-colors"
        aria-label="Rotate ccw">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Sessions count */}
      <div className="text-xs text-gray-500">
        {sessions} sessions
      </div>
    </div>
  );
}

// Hook for focus mode
export function useFocusMode() {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle with Cmd+Shift+F or Escape to exit
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setIsActive(prev => !prev);
      } else if (e.key === 'Escape' && isActive) {
        setIsActive(false);
      }
    };

    const handleEvent = () => setIsActive(prev => !prev);
    document.addEventListener('toggle-focus-mode', handleEvent);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('toggle-focus-mode', handleEvent);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive]);

  return {
    isActive,
    toggle: () => setIsActive(prev => !prev),
    enable: () => setIsActive(true),
    disable: () => setIsActive(false)
  };
}

// Zen mode - even more minimal
interface ZenModeProps {
  children: ReactNode;
  isActive: boolean;
  onExit: () => void;
}

export function ZenMode({ children, isActive, onExit }: ZenModeProps) {
  useEffect(() => {
    if (!isActive) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };

    // Hide scrollbars
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isActive, onExit]);

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-[#0a0a0a] flex items-center justify-center"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-3xl p-8"
          >
            {children}
          </motion.div>

          {/* Subtle exit hint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 text-xs text-gray-700"
          >
            Press Esc to exit
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Typewriter focus component
interface TypewriterFocusProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  className?: string;
}

export function TypewriterFocus({
  content,
  onChange,
  placeholder = 'Start writing...',
  className
}: TypewriterFocusProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollProgress(getScrollPercentage());
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className={cn('relative', className)}>
      {/* Reading progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-gray-800">
        <div
          className="h-full bg-neon-cyan/60 transition-[width] duration-150"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className={cn(
          'w-full bg-transparent text-xl text-white leading-relaxed resize-none focus:outline-none',
          'placeholder-gray-700 transition-colors',
          isFocused && 'placeholder-gray-600'
        )}
        style={{
          minHeight: '60vh',
          caretColor: '#22d3ee'
        }}
      />

      {/* Word count and scroll progress */}
      <div className="fixed bottom-8 right-8 text-sm text-gray-700">
        {content.split(/\s+/).filter(Boolean).length} words
        {scrollProgress > 0 && <span className="ml-3">{Math.round(scrollProgress)}%</span>}
      </div>
    </div>
  );
}
