import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLabStore } from '../../store/useLabStore';
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
    explainLanguage,
    hoveredVariable,
    reduceMotion,
    isTracing,
    traceProgressStage,
  } = useLabStore();

  const step = trace.steps[currentStepIndex] || trace.steps[0];
  const prevStep = trace.steps[prevStepIndex] || null;
  const isCompileError = trace.verdict.status === 'compile_error' || trace.steps.length === 0;
  const isFinalStep =
    !isCompileError &&
    trace.steps.length > 0 &&
    currentStepIndex === trace.steps.length - 1;

  const activeAnalogy = step?.analogyType || trace.analogyType;
  const hasArrayInStep =
    Boolean(step?.structure?.values && step.structure.values.length > 0) ||
    Object.values(step?.variables || {}).some((v) => Array.isArray(v));

  const progressLabelsBn = [
    '',
    '১/৩ আপনার কোড বিশ্লেষণ করা হচ্ছে...',
    '২/৩ লাইন বাই লাইন ৩ডি অ্যানিমেশন ধাপ তৈরি হচ্ছে...',
    '৩/৩ এআই ব্যাখ্যা তৈরি হচ্ছে...',
  ];
  const progressLabelsEn = [
    '',
    '1/3 Analyzing your code...',
    '2/3 Building line-by-line 3D animation steps...',
    '3/3 Generating AI line-by-line explanation...',
  ];

  return (
    <section
      className="flex flex-col justify-between overflow-hidden relative min-h-[300px]"
      aria-label={explainLanguage === 'bn' ? 'অ্যানিমেশন স্টেজ' : 'Animation Stage'}
    >
      {/* Stage Header Row separated by horizontal rule */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            lang={explainLanguage}
            className="text-sm font-semibold text-[var(--text-primary)] truncate"
          >
            {trace.logicSummary.title ||
              (explainLanguage === 'bn' ? 'কোড অ্যানিমেশন স্টেজ' : 'Code Animation Stage')}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)] select-none">
            ·
          </span>
          <span className="text-xs font-mono text-[var(--text-accent)] shrink-0 font-medium">
            {isCompileError
              ? explainLanguage === 'bn'
                ? '০ ধাপ (ত্রুটি)'
                : '0 steps (Error)'
              : explainLanguage === 'bn'
              ? `ধাপ ${currentStepIndex + 1} / ${trace.steps.length} (লাইন ${step?.activeLine || 1})`
              : `Step ${currentStepIndex + 1} / ${trace.steps.length} (Line ${step?.activeLine || 1})`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-[#4ADE9B]/15 border border-[#4ADE9B]/35 text-[var(--text-success)]"
            data-testid="stage-trace-source-badge"
          >
            {trace.traceSource === 'ai_predicted'
              ? explainLanguage === 'bn'
                ? 'AI বিশ্লেষিত'
                : 'AI Verified'
              : explainLanguage === 'bn'
              ? 'সরাসরি এক্সিকিউশন'
              : 'Real Execution'}
          </span>
        </div>
      </div>

      {/* Three-step AI / Trace Progress Overlay */}
      <AnimatePresence>
        {isTracing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-[var(--bg-gutter)]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
            data-testid="trace-progress-overlay"
          >
            <p
              lang={explainLanguage}
              className="text-base font-semibold text-[var(--text-primary)] mb-3"
            >
              {explainLanguage === 'bn'
                ? progressLabelsBn[traceProgressStage]
                : progressLabelsEn[traceProgressStage]}
            </p>
            <div className="w-56 h-2 rounded-full bg-[#16224A] overflow-hidden border border-[var(--border-subtle)]">
              <motion.div
                className="h-full bg-gradient-to-r from-[#A3C1FF] to-[#4ADE9B]"
                initial={{ width: '15%' }}
                animate={{ width: `${traceProgressStage * 33}%` }}
                transition={{ duration: 0.16 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active 3D Analogy Renderer */}
      <div className="flex-1 flex items-center justify-center py-2 overflow-hidden">
        {isCompileError ? (
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

      {/* Final Step 3D Output Showcase Banner */}
      {isFinalStep && (
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="mt-3 pt-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 overflow-hidden"
          data-testid="stage-final-output-banner"
        >
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-bold text-[#4ADE9B]" lang={explainLanguage}>
              {explainLanguage === 'bn'
                ? 'চূড়ান্ত ধাপ সম্পন্ন — প্রোগ্রামের ফাইনাল আউটপুট:'
                : 'Final Step Reached — Program Final Output:'}
            </div>
            <div className="text-xs text-[var(--text-secondary)] break-words leading-relaxed" lang={explainLanguage}>
              <FormattedText text={trace.outputExplanation} lang={explainLanguage} />
            </div>
          </div>
          <div className="px-4 py-2.5 rounded-xl ll-3d-cube-changed bg-[#070A1A] border border-[#4ADE9B] font-mono text-sm font-bold text-[#4ADE9B] break-all max-w-full sm:max-w-[280px] shrink-0 text-center">
            {trace.finalOutput
              ? trace.finalOutput
              : explainLanguage === 'bn'
              ? '(কোনো কনসোল আউটপুট নেই)'
              : '(No stdout output)'}
          </div>
        </motion.div>
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
