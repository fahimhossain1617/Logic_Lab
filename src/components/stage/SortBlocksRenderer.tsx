import React from 'react';
import { motion } from 'motion/react';
import { ExplainLanguage, TraceStep } from '../../../shared/types';

interface SortBlocksRendererProps {
  step: TraceStep;
  prevStep: TraceStep | null;
  explainLanguage: ExplainLanguage;
  hoveredVariable: string | null;
  reduceMotion: boolean;
}

export const SortBlocksRenderer: React.FC<SortBlocksRendererProps> = ({
  step,
  explainLanguage,
  hoveredVariable,
  reduceMotion,
}) => {
  const structure = step.structure;
  const anyArrayInVars = Object.values(step.variables || {}).find((v) => Array.isArray(v)) as
    | (number | string)[]
    | undefined;

  const rawValues: (number | string)[] =
    (structure?.values as (number | string)[]) ||
    anyArrayInVars ||
    [5, 2, 8, 1, 4];

  const highlight = structure?.highlight || [];
  const swapping = structure?.swapping || null;
  const sortedFrom = structure?.sortedFrom ?? rawValues.length;
  const pointers: Record<string, number> = { ...(structure?.pointers || {}) };

  // Also infer pointers from scalar integer variables in step.variables
  for (const key of ['i', 'j', 'k', 'minIdx', 'left', 'right']) {
    if (typeof step.variables?.[key] === 'number' && !(key in pointers)) {
      pointers[key] = step.variables[key];
    }
  }

  const numericVals = rawValues.map((v) => (typeof v === 'number' ? v : Number(v) || 1));
  const minVal = Math.min(...numericVals, 0);
  const maxVal = Math.max(...numericVals, 1);
  const span = Math.max(maxVal - minVal, 1);

  return (
    <div
      className="relative flex flex-col items-center justify-between w-full h-full min-h-[270px] px-3 sm:px-5 py-3.5 select-none overflow-hidden ll-3d-stage-grid"
      data-testid="renderer-sort-blocks"
    >
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 w-full max-w-[620px] text-xs pb-2.5 border-b border-[var(--border-subtle)]">
        <span className="text-[var(--text-muted)] font-medium">
          {explainLanguage === 'bn'
            ? '৩ডি স্লাইডিং ব্লক (3D Sorting Blocks)'
            : '3D Sliding Height Blocks'}
        </span>
        <div className="flex items-center gap-3 font-mono text-[11px] font-semibold">
          <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-warning)] border border-[var(--border-subtle)]">Compare</span>
          <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-accent)] border border-[var(--border-subtle)]">Swap</span>
          <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-success)] border border-[var(--border-subtle)]">Sorted</span>
        </div>
      </div>

      {/* 3D Blocks Stage */}
      <div className="relative flex flex-wrap items-end justify-center gap-3.5 sm:gap-5 w-full max-w-[620px] min-h-[210px] pt-9 pb-5 px-3 mt-1">
        {swapping && (
          <svg
            viewBox="0 0 400 90"
            className="absolute top-1 left-1/2 -translate-x-1/2 w-[260px] sm:w-[320px] h-[54px] pointer-events-none overflow-visible"
          >
            <motion.path
              d="M 120 45 Q 200 -8 280 45"
              fill="none"
              stroke="#FFB26B"
              strokeWidth="2.5"
              strokeDasharray="5 4"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.45 }}
            />
            <motion.path
              d="M 280 55 Q 200 96 120 55"
              fill="none"
              stroke="#A3C1FF"
              strokeWidth="2.5"
              strokeDasharray="5 4"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.45 }}
            />
          </svg>
        )}

        {rawValues.map((val, idx) => {
          const isCompared = highlight.includes(idx);
          const isSwapping = swapping ? swapping.includes(idx) : false;
          const isSorted = idx >= sortedFrom;
          const isLeftSwap = swapping && swapping[0] === idx;
          const numVal = typeof val === 'number' ? val : Number(val) || 1;
          const ratio = Math.max(0, Math.min(1, (numVal - minVal) / span));
          // Minimum height 64px ensures value + [idx] never overflow out of the block
          const heightPx = Math.round(64 + ratio * 84);

          const isPointerJ = pointers.j === idx;
          const isPointerJPlus1 = pointers.j !== undefined && pointers.j + 1 === idx;
          const valStr = String(val);

          return (
            <motion.div
              key={`block-val-${idx}-${valStr}`}
              layout={!reduceMotion}
              initial={false}
              animate={{
                y: isSwapping
                  ? isLeftSwap
                    ? [-14, 0]
                    : [10, 0]
                  : isCompared
                  ? -6
                  : 0,
              }}
              transition={
                reduceMotion
                  ? { duration: 0.01 }
                  : {
                      layout: { type: 'spring', stiffness: 260, damping: 24 },
                      duration: 0.45,
                    }
              }
              className="relative flex flex-col items-center"
            >
              {isSorted && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mb-1.5 px-2 py-0.5 rounded-md bg-[#4ADE9B]/20 text-[10px] font-mono font-bold text-[#4ADE9B] border border-[#4ADE9B]/60"
                >
                  OK
                </motion.div>
              )}

              {/* 3D Value Block with auto width & overflow protection */}
              <div
                style={{ height: `${heightPx}px` }}
                className={`ll-3d-block min-w-[3.4rem] sm:min-w-[3.75rem] px-2.5 py-2 rounded-xl flex flex-col items-center justify-between font-mono font-bold transition-colors border overflow-hidden ${
                  isSorted
                    ? 'bg-gradient-to-b from-[#4ADE9B]/30 to-[#0E3127] border-[#4ADE9B] text-[#4ADE9B]'
                    : isSwapping
                    ? 'bg-gradient-to-b from-[#FFB26B]/38 to-[#3B2110] border-[#FFB26B] text-[var(--text-primary)]'
                    : isCompared
                    ? 'bg-gradient-to-b from-[#FFC46B]/32 to-[#382711] border-[#FFC46B] text-[var(--text-primary)]'
                    : hoveredVariable === 'arr'
                    ? 'bg-gradient-to-b from-[#A3C1FF]/30 to-[#14234E] border-[#A3C1FF] text-[var(--text-primary)]'
                    : 'bg-gradient-to-b from-[#1E2E63] to-[#0E1738] border-[#3E5EA6] text-[#EEF3FF]'
                }`}
              >
                <span
                  className={`${
                    valStr.length > 4 ? 'text-xs' : 'text-sm sm:text-base'
                  } leading-tight break-all text-center`}
                >
                  {valStr}
                </span>
                <span className="text-[10px] opacity-75 font-normal leading-none">
                  [{idx}]
                </span>
              </div>

              {/* Gliding Pointer Labels (j, j+1) */}
              <div className="h-6 mt-2 flex items-center justify-center">
                {isPointerJ && (
                  <motion.span
                    layoutId="pointer-j"
                    className="text-[11px] font-mono font-bold text-[#A3C1FF] whitespace-nowrap px-1.5 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)]"
                  >
                    ↑ j
                  </motion.span>
                )}
                {!isPointerJ && isPointerJPlus1 && (
                  <motion.span
                    layoutId="pointer-j1"
                    className="text-[11px] font-mono font-bold text-[#FFB26B] whitespace-nowrap px-1.5 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)]"
                  >
                    ↑ j+1
                  </motion.span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
