import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';
import { useLabStore } from '../../store/useLabStore';
import { getStepDurationMs } from '../../utils/playerLogic';
import { SwapBucketsRenderer } from './SwapBucketsRenderer';
import { SortBlocksRenderer } from './SortBlocksRenderer';
import { LoopGaugeRenderer } from './LoopGaugeRenderer';
import { GenericMemoryRenderer } from './GenericMemoryRenderer';
import {
  PointerArrowsRenderer,
  BinarySearchCardsRenderer,
  StackPlatesRenderer,
  QueueLineRenderer,
  LinkedListTrainRenderer,
  RecursionTowerRenderer,
} from './AdvancedAnalogyRenderers';
import { FormattedText } from '../common/FormattedText';

export const StageCanvas: React.FC = () => {
  const {
    trace,
    currentStepIndex,
    prevStepIndex,
    isPlaying,
    explainLanguage,
    hoveredVariable,
    reduceMotion,
    isTracing,
    traceProgressStage,
    togglePlay,
    nextStep,
    prevStep: goToPrevStep,
    resetPlayback,
  } = useLabStore();

  const step = trace.steps[currentStepIndex] || trace.steps[0];
  const prevStep = trace.steps[prevStepIndex] || null;
  const isZeroStepError = trace.verdict.status === 'compile_error' || trace.steps.length === 0;
  const isRuntimeOrInputErr =
    trace.verdict.status === 'runtime_error' ||
    trace.verdict.status === 'infinite_loop' ||
    trace.errorCategory === 'runtime_error' ||
    trace.errorCategory === 'input_error';

  const activeAnalogy = step?.analogyType || trace.analogyType;
  const hasArrayInStep =
    Boolean(step?.structure?.values && step.structure.values.length > 0) ||
    Object.values(step?.variables || {}).some((v) => Array.isArray(v));

  const [loadingProgress, setLoadingProgress] = useState(12);

  // Hardcoded 1x playback speed timer
  useEffect(() => {
    if (!isPlaying || isZeroStepError || trace.steps.length === 0) return;
    const intervalMs = getStepDurationMs(1);
    const timer = setInterval(() => {
      nextStep();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, isZeroStepError, trace.steps.length, nextStep]);

  useEffect(() => {
    if (!isTracing) {
      setLoadingProgress(12);
      return;
    }

    setLoadingProgress(14);
    const timer = setInterval(() => {
      setLoadingProgress((prev) => {
        const floor = traceProgressStage > 0 ? Math.min(88, traceProgressStage * 26) : 14;
        const base = Math.max(prev, floor);
        if (base >= 94) return 94;
        const step = Math.max(0.8, (95 - base) * 0.08);
        return Math.min(94, Number((base + step).toFixed(1)));
      });
    }, 150);

    return () => clearInterval(timer);
  }, [isTracing, traceProgressStage]);

  const activeLine = step?.activeLine || 1;
  const atStart = currentStepIndex <= 0;
  const atEnd = currentStepIndex >= trace.steps.length - 1;

  return (
    <section
      className="flex flex-col justify-between overflow-hidden relative min-h-[300px]"
      aria-label={explainLanguage === 'bn' ? 'অ্যানিমেশন স্টেজ' : 'Animation Stage'}
    >
      {/* Minimal Stage Header Row: ONLY active line number on left, playback controls on right */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center min-w-0">
          <span
            className="text-sm font-mono font-semibold text-[var(--text-accent)] shrink-0 tabular-nums"
            data-testid="stage-active-line"
          >
            {isTracing
              ? explainLanguage === 'bn'
                ? 'লোড হচ্ছে...'
                : 'Loading...'
              : isZeroStepError
              ? isRuntimeOrInputErr
                ? explainLanguage === 'bn'
                  ? 'রানটাইম / ইনপুট ত্রুটি'
                  : 'Runtime / Input Error'
                : explainLanguage === 'bn'
                ? 'কম্পাইল ত্রুটি'
                : 'Compile Error'
              : explainLanguage === 'bn'
              ? `লাইন ${activeLine}`
              : `Line ${activeLine}`}
          </span>
        </div>

        {!isZeroStepError && trace.steps.length > 0 && (
          <div
            className="flex items-center gap-1.5 shrink-0"
            data-testid="player-controls"
          >
            <button
              type="button"
              onClick={resetPlayback}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-select)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
              aria-label={explainLanguage === 'bn' ? 'প্রথম থেকে' : 'Reset'}
              title={explainLanguage === 'bn' ? 'প্রথম থেকে (R)' : 'Reset (R)'}
              data-testid="player-reset-btn"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={goToPrevStep}
              disabled={atStart}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-select)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              aria-label={explainLanguage === 'bn' ? 'পূর্ববর্তী ধাপ' : 'Previous step'}
              title={explainLanguage === 'bn' ? 'পূর্ববর্তী ধাপ (←)' : 'Previous (←)'}
              data-testid="player-prev-btn"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-active)]/45 bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold cursor-pointer transition-colors"
              aria-label={
                isPlaying
                  ? explainLanguage === 'bn'
                    ? 'থামান'
                    : 'Pause'
                  : explainLanguage === 'bn'
                  ? 'চালান'
                  : 'Play'
              }
              title={
                isPlaying
                  ? explainLanguage === 'bn'
                    ? 'থামান (Space)'
                    : 'Pause (Space)'
                  : explainLanguage === 'bn'
                  ? 'চালান (Space)'
                  : 'Play (Space)'
              }
              data-testid="player-play-btn"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
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
              disabled={atEnd}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-select)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              aria-label={explainLanguage === 'bn' ? 'পরবর্তী ধাপ' : 'Next step'}
              title={explainLanguage === 'bn' ? 'পরবর্তী ধাপ (→)' : 'Next (→)'}
              data-testid="player-next-btn"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Continuous AI / Trace Progress Overlay */}
      <AnimatePresence>
        {isTracing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-[var(--bg-gutter)]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
            data-testid="trace-progress-overlay"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8] animate-pulse" />
              <p
                lang={explainLanguage}
                className="text-base font-semibold text-[var(--text-primary)] m-0"
              >
                {explainLanguage === 'bn'
                  ? 'অ্যানিমেশন ও ব্যাখ্যা লোড হচ্ছে...'
                  : 'Loading animation & explanation...'}
              </p>
            </div>
            <div className="w-64 h-2 rounded-full bg-[#16224A] overflow-hidden border border-[var(--border-subtle)]">
              <motion.div
                className="h-full bg-gradient-to-r from-[#3B82F6] via-[#38BDF8] to-[#34D399]"
                initial={{ width: '12%' }}
                animate={{ width: `${loadingProgress}%` }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active 3D / Memory & Reference Analogy Renderer */}
      <div className="flex-1 flex items-center justify-center py-3 overflow-hidden">
        {isZeroStepError ? (
          <GenericMemoryRenderer
            trace={trace}
            step={undefined}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'swap_buckets' ? (
          <SwapBucketsRenderer
            step={step}
            prevStep={prevStep}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'sort_blocks' && hasArrayInStep ? (
          <SortBlocksRenderer
            step={step}
            prevStep={prevStep}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'loop_gauge' ? (
          <LoopGaugeRenderer
            step={step}
            explainLanguage={explainLanguage}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'pointer_arrows' && hasArrayInStep ? (
          <PointerArrowsRenderer
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'binary_search_cards' && hasArrayInStep ? (
          <BinarySearchCardsRenderer
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'stack_plates' && hasArrayInStep ? (
          <StackPlatesRenderer
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'queue_line' && hasArrayInStep ? (
          <QueueLineRenderer
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : activeAnalogy === 'linked_list_train' && hasArrayInStep ? (
          <LinkedListTrainRenderer
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : (activeAnalogy === 'recursion_tower' ||
            activeAnalogy === 'tree_nodes' ||
            activeAnalogy === 'graph_nodes') ? (
          <RecursionTowerRenderer
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        ) : (
          <GenericMemoryRenderer
            trace={trace}
            step={step}
            explainLanguage={explainLanguage}
            hoveredVariable={hoveredVariable}
            reduceMotion={reduceMotion}
          />
        )}
      </div>

      {/* Stacked Step Explanation Cards: ONLY "কী ঘটলো" & "লজিক ও কারণ" */}
      {!isZeroStepError && step && (
        <div
          className="pt-3 mt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2.5 text-xs leading-relaxed"
          data-testid="stage-step-explanations"
        >
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-select)]/65 px-3.5 py-2.5 space-y-1"
            lang={explainLanguage}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-accent)]">
              {explainLanguage === 'bn' ? 'কী ঘটলো' : 'What happened'}
            </div>
            <p className="m-0 text-[var(--text-primary)] leading-relaxed">
              <FormattedText
                text={
                  explainLanguage === 'bn'
                    ? step.banglaExplanation || step.whatHappenedBn || step.whatHappened || step.explanation
                    : step.whatHappened || step.explanation
                }
                lang={explainLanguage}
              />
            </p>
          </div>
          {(step.whyAndLogic || step.why) && (
            <div
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-select)]/65 px-3.5 py-2.5 space-y-1"
              lang={explainLanguage}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-success)]">
                {explainLanguage === 'bn' ? 'লজিক ও কারণ' : 'Logic & Reason'}
              </div>
              <p className="m-0 text-[var(--text-secondary)] leading-relaxed">
                <FormattedText text={step.whyAndLogic || step.why} lang={explainLanguage} />
              </p>
            </div>
          )}
        </div>
      )}

      {/* Fault Alert Banner & Fix Hint when current step has a fault */}
      <AnimatePresence>
        {step?.fault && (
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="mt-3 pt-4 border-t border-[#FF6B7D]/60 text-xs flex flex-col gap-2 break-words"
            role="alert"
            data-testid="stage-fault-banner"
          >
            <div className="text-[#FF6B7D] font-bold leading-relaxed">
              <FormattedText text={step.fault.message} lang={explainLanguage} />
            </div>
            <div className="text-[var(--text-primary)] leading-relaxed">
              <span className="font-bold text-[#FFC46B] mr-2">
                {explainLanguage === 'bn' ? '💡 সমাধান:' : '💡 Fix:'}
              </span>
              <FormattedText text={step.fault.fixHint} lang={explainLanguage} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
