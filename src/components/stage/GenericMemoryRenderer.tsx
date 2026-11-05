import React from 'react';
import { motion } from 'motion/react';
import {
  ExecutionTrace,
  ExplainLanguage,
  TraceStep,
} from '../../../shared/types';

interface GenericMemoryRendererProps {
  trace: ExecutionTrace;
  step: TraceStep | undefined;
  explainLanguage: ExplainLanguage;
  hoveredVariable: string | null;
  reduceMotion: boolean;
}

export const GenericMemoryRenderer: React.FC<GenericMemoryRendererProps> = ({
  trace,
  step,
  explainLanguage,
  hoveredVariable,
  reduceMotion,
}) => {
  // Handle Compile / Syntax Error where steps === []
  if (trace.verdict.status === 'compile_error' || !step) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full min-h-[240px] p-4 sm:p-6 text-center select-none overflow-hidden"
        data-testid="renderer-compile-error"
      >
        <h3
          lang={explainLanguage}
          className="text-base font-bold text-[#FF6B7D] mb-1.5"
        >
          {explainLanguage === 'bn'
            ? 'কম্পাইল বা সিনট্যাক্স ত্রুটি — অ্যানিমেশন তৈরি করা হয়নি'
            : 'Compile / Syntax Error — No Animation Generated'}
        </h3>
        <p
          lang={explainLanguage}
          className="text-sm text-[var(--text-primary)] max-w-md mb-3 break-words"
        >
          {trace.errorDetails?.message || trace.verdict.message}
        </p>
        {trace.errorDetails?.line && (
          <span className="font-mono text-xs px-3 py-1 rounded-lg bg-[#FF6B7D]/20 border border-[#FF6B7D]/50 text-[#FF6B7D]">
            Line {trace.errorDetails.line}
          </span>
        )}
      </div>
    );
  }

  const variables = step.variables || {};
  const entries = Object.entries(variables);
  const changedMap = new Map(
    (step.changes || []).map((c) => [c.name, c])
  );

  return (
    <div
      className="relative flex flex-col items-center justify-between w-full h-full min-h-[260px] px-3 sm:px-5 py-3.5 select-none overflow-hidden ll-3d-stage-grid"
      data-testid="renderer-generic-memory"
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 w-full max-w-[620px] text-xs pb-2.5 border-b border-[var(--border-subtle)]">
        <span className="text-[var(--text-muted)] font-medium" lang={explainLanguage}>
          {explainLanguage === 'bn'
            ? '৩ডি মেমোরি কিউব ও ভ্যারিয়েবল স্টেট (3D Memory State)'
            : '3D Memory Cubes & Variable State'}
        </span>
        <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-semibold">
          {step.action.toUpperCase()} · Ln {step.activeLine}
        </span>
      </div>

      {/* 3D Variable Cubes Grid */}
      <div className="flex flex-wrap items-stretch justify-center gap-4 sm:gap-5 my-5 w-full max-w-[620px]">
        {entries.length === 0 ? (
          <div className="px-5 py-4 rounded-2xl bg-[var(--bg-gutter)]/70 border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] font-mono text-center">
            {explainLanguage === 'bn'
              ? 'এই লাইনে মেমোরিতে কোনো ভ্যারিয়েবল এখনো তৈরি হয়নি'
              : 'No variables allocated in memory at this line yet'}
          </div>
        ) : (
          entries.map(([name, val]) => {
            const change = changedMap.get(name);
            const isChanged = Boolean(change);
            const isHovered = hoveredVariable === name;
            const isArrayVal = Array.isArray(val);
            const formattedScalar =
              typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);

            return (
              <motion.div
                key={name}
                layout={!reduceMotion}
                initial={{ scale: 0.94, y: 8, opacity: 0 }}
                animate={{
                  scale: isChanged ? [1.04, 1] : 1,
                  y: isChanged ? [-4, 0] : 0,
                  opacity: 1,
                }}
                transition={
                  reduceMotion
                    ? { duration: 0.01 }
                    : { type: 'spring', stiffness: 260, damping: 22 }
                }
                className={`min-w-[140px] max-w-full sm:max-w-[260px] flex-1 p-4 rounded-2xl border flex flex-col items-center justify-between gap-3 overflow-hidden transition-colors ${
                  isChanged
                    ? 'll-3d-cube-changed bg-gradient-to-b from-[#4ADE9B]/22 to-[#0D2824] border-[#4ADE9B]'
                    : isHovered
                    ? 'll-3d-cube bg-gradient-to-b from-[#A3C1FF]/25 to-[#101C3D] border-[#A3C1FF]'
                    : 'll-3d-cube bg-gradient-to-b from-[#16234D] to-[#0B122B] border-[#334E88]'
                }`}
              >
                <div className="flex items-center justify-between gap-2.5 w-full text-xs font-mono border-b border-white/10 pb-2 min-w-0">
                  <span className="font-semibold text-[#A3C1FF] truncate" title={name}>
                    {name}
                  </span>
                  {isChanged ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#4ADE9B]/25 text-[#4ADE9B] font-bold shrink-0">
                      {explainLanguage === 'bn' ? 'পরিবর্তিত' : 'UPDATED'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#8FA6D9] shrink-0 font-medium">
                      {isArrayVal ? 'array' : typeof val}
                    </span>
                  )}
                </div>

                {isArrayVal ? (
                  <div className="flex flex-wrap items-center justify-center gap-2 py-1 w-full">
                    {(val as unknown[]).map((item, idx) => (
                      <div
                        key={idx}
                        className="px-2.5 py-1.5 rounded-xl bg-[#070A1A]/85 border border-[#A3C1FF]/40 font-mono text-xs font-bold text-[#EEF3FF] flex flex-col items-center min-w-[2.5rem]"
                      >
                        <span className="break-all text-center">{String(item)}</span>
                        <span className="text-[9px] text-[#8FA6D9] font-normal">[{idx}]</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className={`font-mono font-bold text-[#EEF3FF] py-1 break-words text-center w-full ${
                      formattedScalar.length > 14
                        ? 'text-xs sm:text-sm'
                        : formattedScalar.length > 8
                        ? 'text-base sm:text-lg'
                        : 'text-xl sm:text-2xl'
                    }`}
                  >
                    {formattedScalar}
                  </div>
                )}

                {change && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-mono text-[#C6D8FF] pt-2 border-t border-white/10 w-full break-all text-center">
                    <span className="opacity-75">
                      {change.from === null || change.from === undefined
                        ? '∅'
                        : typeof change.from === 'object'
                        ? JSON.stringify(change.from)
                        : String(change.from)}
                    </span>
                    <span className="text-[#A3C1FF] font-bold">→</span>
                    <span className="text-[#4ADE9B] font-bold">
                      {typeof change.to === 'object' ? JSON.stringify(change.to) : String(change.to)}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {/* Step Output Readout if stdout was produced by this line */}
      {step.stdout && (
        <div className="w-full max-w-[620px] mt-2 px-4 py-2.5 rounded-xl bg-[#4ADE9B]/12 border border-[#4ADE9B]/45 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <span className="text-[#4ADE9B] font-semibold shrink-0">
            {explainLanguage === 'bn' ? 'এই ধাপ পর্যন্ত আউটপুট (stdout):' : 'Output so far (stdout):'}
          </span>
          <span className="text-[var(--text-primary)] font-bold break-all">
            {step.stdout.replace(/\n/g, ' ↵ ')}
          </span>
        </div>
      )}
    </div>
  );
};
