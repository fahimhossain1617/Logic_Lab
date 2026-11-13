import React from 'react';
import { useLabStore } from '../../store/useLabStore';
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';

interface PlayerBarProps {
  compact?: boolean;
  manageTimer?: boolean;
}

/**
 * Minimal playback transport controls (hardcoded 1x speed, no progress bar/dots or speed selectors).
 */
export const PlayerBar: React.FC<PlayerBarProps> = ({ compact = false }) => {
  const {
    trace,
    currentStepIndex,
    isPlaying,
    explainLanguage,
    togglePlay,
    nextStep,
    prevStep,
    resetPlayback,
  } = useLabStore();

  const totalSteps = trace.steps.length;
  if (totalSteps === 0) return null;

  return (
    <div
      className={
        compact
          ? 'pt-3 mt-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-1.5'
          : 'll-panel rounded-2xl px-4 sm:px-6 py-3 flex items-center justify-end gap-1.5'
      }
      role="region"
      aria-label={explainLanguage === 'bn' ? 'প্লেব্যাক কন্ট্রোল' : 'Playback Controls'}
    >
      <button
        type="button"
        onClick={resetPlayback}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
        aria-label={explainLanguage === 'bn' ? 'প্রথম থেকে' : 'Reset'}
      >
        <RotateCcw className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={prevStep}
        disabled={currentStepIndex <= 0}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] disabled:opacity-40 cursor-pointer"
        aria-label={explainLanguage === 'bn' ? 'পূর্ববর্তী ধাপ' : 'Previous'}
      >
        <SkipBack className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={togglePlay}
        className="px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        <span>
          {isPlaying
            ? explainLanguage === 'bn'
              ? 'থামান'
              : 'Pause'
            : explainLanguage === 'bn'
            ? 'চালান'
            : 'Play'}
        </span>
      </button>
      <button
        type="button"
        onClick={nextStep}
        disabled={currentStepIndex >= totalSteps - 1}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] disabled:opacity-40 cursor-pointer"
        aria-label={explainLanguage === 'bn' ? 'পরবর্তী ধাপ' : 'Next'}
      >
        <SkipForward className="w-4 h-4" />
      </button>
    </div>
  );
};
