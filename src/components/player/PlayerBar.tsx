import React, { useEffect } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { getStepDotCategory, getStepDurationMs } from '../../utils/playerLogic';
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';

export const PlayerBar: React.FC = () => {
  const {
    trace,
    currentStepIndex,
    isPlaying,
    speed,
    explainLanguage,
    togglePlay,
    nextStep,
    prevStep,
    resetPlayback,
    goToStep,
  } = useLabStore();

  useEffect(() => {
    if (!isPlaying) return;
    const duration = getStepDurationMs(speed);
    const timer = setInterval(() => {
      nextStep();
    }, duration);
    return () => clearInterval(timer);
  }, [isPlaying, speed, nextStep]);

  return (
    <div
      className="ll-panel rounded-2xl px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 sm:gap-4"
      role="region"
      aria-label={explainLanguage === 'bn' ? 'প্লেব্যাক কন্ট্রোল' : 'Playback Controls'}
    >
      {/* Transport Controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={resetPlayback}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          aria-label="Reset playback (R)"
          title="Reset (R)"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={prevStep}
          disabled={currentStepIndex <= 0}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] disabled:opacity-35 transition-colors cursor-pointer"
          aria-label="Previous step (Left Arrow)"
          title="Previous Step (←)"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={togglePlay}
          className="ll-btn-primary h-10 px-4 sm:px-5 rounded-xl flex items-center gap-2 font-semibold text-xs cursor-pointer"
          aria-label={isPlaying ? 'Pause animation (Space)' : 'Play animation (Space)'}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
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
          disabled={currentStepIndex >= trace.steps.length - 1}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] disabled:opacity-35 transition-colors cursor-pointer"
          aria-label="Next step (Right Arrow)"
          title="Next Step (→)"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Scrubber with Color-Coded Step Dots */}
      <div
        className="flex-1 flex items-center justify-center gap-2.5 min-w-[140px] px-3"
        role="group"
        aria-label="Step scrubber"
      >
        {trace.steps.map((step, idx) => {
          const cat = getStepDotCategory(step);
          const isCurrent = idx === currentStepIndex;
          const dotColor =
            cat === 'fault'
              ? 'bg-[#FF6B7D] border-[#FF6B7D]'
              : cat === 'swap'
              ? 'bg-[#FFB26B] border-[#FFB26B]'
              : cat === 'compare'
              ? 'bg-[#A3C1FF] border-[#A3C1FF]'
              : 'bg-[#5B78B8] border-[#5B78B8]';

          return (
            <button
              key={step.stepIndex}
              type="button"
              onClick={() => goToStep(idx)}
              aria-label={`Jump to step ${idx + 1} (Line ${step.activeLine})`}
              title={`Step ${idx + 1}: Line ${step.activeLine} (${step.action})`}
              className={`rounded-full border transition-all cursor-pointer ${dotColor} ${
                isCurrent
                  ? 'w-6 h-3.5 ring-2 ring-[#A3C1FF]/60 scale-110'
                  : 'w-3 h-3 opacity-65 hover:opacity-100'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
};
