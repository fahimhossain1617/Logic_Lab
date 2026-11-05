import React from 'react';
import { motion } from 'motion/react';
import { ExplainLanguage, TraceStep } from '../../../shared/types';
import { ArrowDown, ArrowRight, AlertTriangle, CheckCircle2, Layers, GitCommit } from 'lucide-react';

interface RendererProps {
  step: TraceStep;
  explainLanguage: ExplainLanguage;
  hoveredVariable?: string | null;
  reduceMotion?: boolean;
}

function findPrimaryArray(vars: Record<string, any>, fallback: (number | string)[]): {
  name: string;
  values: (number | string)[];
} {
  for (const [k, v] of Object.entries(vars || {})) {
    if (Array.isArray(v)) {
      return {
        name: k,
        values: v.map((item) =>
          typeof item === 'number' || typeof item === 'string' ? item : JSON.stringify(item)
        ),
      };
    }
  }
  return { name: 'arr', values: fallback };
}

/**
 * 1. `pointer_arrows`: Array boxes with sliding pointer badges (`left`, `right`, `i`, `maxVal`)
 */
export const PointerArrowsRenderer: React.FC<RendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const { name: arrName, values: detectedArr } = findPrimaryArray(
    step.variables || {},
    [10, 20, 30, 40]
  );
  const arr: (number | string)[] = step.structure?.values || detectedArr;
  const pointers: Record<string, number> = step.structure?.pointers || {};
  const swapping = step.structure?.swapping;
  const highlight = step.structure?.highlight || [];
  const hasFault = Boolean(step.fault);

  const resolvedPointers: Record<string, number> = { ...pointers };
  for (const key of ['left', 'right', 'i', 'j', 'idx', 'minIdx', 'low', 'high', 'mid']) {
    if (typeof step.variables?.[key] === 'number' && !(key in resolvedPointers)) {
      resolvedPointers[key] = step.variables[key];
    }
  }

  return (
    <div className="w-full px-3 sm:px-5 py-4 flex flex-col items-center justify-between gap-4 overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-secondary)] pb-2.5 border-b border-[var(--border-subtle)]">
        <span lang={explainLanguage} className="font-medium">
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: অ্যারে বক্স ও চলমান পয়েন্টার (Array & Pointers)'
            : 'Real-World Analogy: Array Boxes & Sliding Pointers'}
        </span>
        <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-accent)] font-semibold uppercase">
          {step.action} · Ln {step.activeLine}
        </span>
      </div>

      {/* Array Cells + Pointer Badges */}
      <div className="flex flex-wrap items-end justify-center gap-3 sm:gap-4 py-4 w-full">
        {arr.map((val, idx) => {
          const activePtrNames = Object.entries(resolvedPointers)
            .filter(([, pIdx]) => pIdx === idx)
            .map(([name]) => name);
          const isSwapping = swapping && (swapping[0] === idx || swapping[1] === idx);
          const isHighlighted = highlight.includes(idx) || activePtrNames.length > 0;
          const valStr = String(val);

          return (
            <div key={idx} className="flex flex-col items-center gap-2">
              {/* Top Pointer Badges */}
              <div className="min-h-[28px] flex flex-wrap items-center justify-center gap-1.5 max-w-[120px]">
                {activePtrNames.map((name) => (
                  <motion.span
                    key={name}
                    layout={!reduceMotion}
                    className="px-2 py-0.5 rounded-md bg-[#A3C1FF] text-[#070A1A] font-mono text-[10px] font-bold inline-flex items-center gap-1 shadow-sm whitespace-nowrap"
                  >
                    <span>{name}</span>
                    <ArrowDown className="w-2.5 h-2.5 shrink-0" />
                  </motion.span>
                ))}
              </div>

              {/* Array Element Box (Flexible width so long values never overflow) */}
              <motion.div
                layout={!reduceMotion}
                animate={
                  isSwapping
                    ? { y: -6, scale: 1.04 }
                    : isHighlighted
                    ? { y: -3, scale: 1.02 }
                    : { y: 0, scale: 1 }
                }
                transition={{ duration: reduceMotion ? 0 : 0.25 }}
                className={`min-w-[4rem] min-h-[4rem] px-3 py-2.5 rounded-2xl border-2 flex flex-col items-center justify-center font-mono transition-colors overflow-hidden ${
                  hasFault && isHighlighted
                    ? 'border-[#FF6B7D] bg-[#FF6B7D]/20 text-[var(--text-primary)]'
                    : isSwapping
                    ? 'border-[#FFB26B] bg-[#FFB26B]/20 text-[var(--text-primary)]'
                    : isHighlighted
                    ? 'border-[#A3C1FF] bg-[#A3C1FF]/20 text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-gutter)]/75 text-[var(--text-secondary)]'
                }`}
              >
                <span
                  className={`${
                    valStr.length > 5 ? 'text-xs' : 'text-base sm:text-lg'
                  } font-bold break-all text-center`}
                >
                  {valStr}
                </span>
              </motion.div>

              {/* Index Label */}
              <span className="font-mono text-[11px] text-[var(--text-muted)] font-medium">[{idx}]</span>
            </div>
          );
        })}

        {/* Out-of-bounds crash zone if any pointer >= arr.length */}
        {Object.entries(resolvedPointers).some(([, pIdx]) => pIdx >= arr.length || pIdx < 0) && (
          <div className="flex flex-col items-center gap-2">
            <div className="min-h-[28px] flex items-center">
              <span className="px-2 py-0.5 rounded-md bg-[#FF6B7D] text-[#070A1A] font-mono text-[10px] font-bold whitespace-nowrap">
                OUT OF BOUNDS!
              </span>
            </div>
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-[#FF6B7D] bg-[#FF6B7D]/15 flex items-center justify-center text-[#FF6B7D]">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <span className="font-mono text-[11px] text-[#FF6B7D] font-bold">[{arr.length}]</span>
          </div>
        )}
      </div>

      {/* Extra Scalar Variables Bar */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 w-full pt-1">
        {Object.entries(step.variables || {})
          .filter(([k]) => k !== arrName && !Array.isArray(step.variables?.[k]))
          .map(([k, v]) => (
            <span
              key={k}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-gutter)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)] break-all"
            >
              <strong className="text-[var(--text-accent)] mr-1">{k}:</strong> {JSON.stringify(v)}
            </span>
          ))}
      </div>
    </div>
  );
};

/**
 * 2. `binary_search_cards`: Search Spotlight with dimmed eliminated range `[low..high]`
 */
export const BinarySearchCardsRenderer: React.FC<RendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const { values: detectedArr } = findPrimaryArray(
    step.variables || {},
    [2, 5, 8, 12, 16, 23, 38]
  );
  const arr: (number | string)[] = step.structure?.values || detectedArr;
  const low = typeof step.variables?.low === 'number' ? step.variables.low : 0;
  const high = typeof step.variables?.high === 'number' ? step.variables.high : arr.length - 1;
  const mid =
    typeof step.variables?.mid === 'number'
      ? step.variables.mid
      : typeof step.variables?.i === 'number'
      ? step.variables.i
      : Math.floor((low + high) / 2);
  const target = step.variables?.target ?? step.variables?.key ?? step.variables?.x ?? '—';
  const foundIdx = step.variables?.found ?? step.variables?.ans;

  return (
    <div className="w-full px-2 sm:px-4 py-3 flex flex-col items-center justify-between gap-4 overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] pb-2 border-b border-[var(--border-subtle)]">
        <span lang={explainLanguage} className="font-medium">
          {explainLanguage === 'bn'
            ? `বাস্তব উদাহরণ: সার্চ স্পটলাইট (Target = ${String(target)})`
            : `Real-World Analogy: Search Spotlight (Target = ${String(target)})`}
        </span>
        <span className="font-mono text-[var(--text-accent)]">
          low={low} · mid={mid} · high={high}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2.5 py-4 w-full">
        {arr.map((val, idx) => {
          const inActiveWindow = idx >= low && idx <= high;
          const isMid = idx === mid;
          const isMatch =
            (target !== '—' && Number(val) === Number(target) && isMid) || foundIdx === idx;
          const valStr = String(val);

          return (
            <motion.div
              key={idx}
              layout={!reduceMotion}
              animate={{
                opacity: inActiveWindow ? 1 : 0.35,
                scale: isMid ? 1.06 : 1,
                y: isMid ? -4 : 0,
              }}
              transition={{ duration: reduceMotion ? 0 : 0.25 }}
              className={`min-w-[3.6rem] min-h-[5rem] px-2.5 py-2 rounded-2xl border-2 flex flex-col items-center justify-between font-mono overflow-hidden ${
                isMatch
                  ? 'border-[#4ADE9B] bg-[#4ADE9B]/25 text-[var(--text-primary)] shadow-lg'
                  : isMid
                  ? 'border-[#FFC46B] bg-[#FFC46B]/20 text-[var(--text-primary)] shadow-md'
                  : inActiveWindow
                  ? 'border-[#A3C1FF]/60 bg-[var(--bg-gutter)] text-[var(--text-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-gutter)]/30 text-[var(--text-muted)] line-through'
              }`}
            >
              <span className="text-[10px] uppercase text-[var(--text-secondary)] whitespace-nowrap">
                {isMid ? 'MID' : idx === low ? 'LOW' : idx === high ? 'HIGH' : `[${idx}]`}
              </span>
              <span
                className={`${
                  valStr.length > 4 ? 'text-xs' : 'text-sm sm:text-base'
                } font-bold break-all text-center my-0.5`}
              >
                {valStr}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                idx {idx}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 3. `stack_plates`: Vertical LIFO Cylinder
 */
export const StackPlatesRenderer: React.FC<RendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const { values: detectedStack } = findPrimaryArray(step.variables || {}, ['(', '[']);
  const stackItems: (string | number)[] = step.structure?.values || detectedStack;
  const hasFault = Boolean(step.fault);

  return (
    <div className="w-full px-2 sm:px-4 py-3 flex flex-col items-center justify-between gap-4 overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] pb-2 border-b border-[var(--border-subtle)]">
        <span lang={explainLanguage} className="font-medium">
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: প্লেটের স্ট্যাক (LIFO — সবার উপরের প্লেট আগে ওঠে)'
            : 'Real-World Analogy: Stack of Plates (LIFO)'}
        </span>
        <span className="font-mono text-[var(--text-accent)] uppercase">
          {step.action} · Size: {stackItems.length}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 py-3 w-full">
        {/* Vertical Glass Cylinder */}
        <div
          className={`w-48 sm:w-56 min-h-[180px] rounded-b-3xl border-x-2 border-b-4 px-3 py-3 flex flex-col-reverse items-center justify-start gap-2 overflow-hidden ${
            hasFault
              ? 'border-[#FF6B7D] bg-[#FF6B7D]/10'
              : 'border-[#A3C1FF]/60 bg-[var(--bg-gutter)]/60'
          }`}
        >
          {stackItems.length === 0 ? (
            <div className="my-auto text-xs font-mono text-[var(--text-muted)] text-center">
              {explainLanguage === 'bn' ? 'স্ট্যাক খালি (Empty)' : 'Stack Empty'}
            </div>
          ) : (
            stackItems.map((item, idx) => {
              const isTop = idx === stackItems.length - 1;
              return (
                <motion.div
                  key={`${idx}-${String(item)}`}
                  initial={reduceMotion ? false : { y: -16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className={`w-full py-2 px-3 rounded-xl font-mono text-xs sm:text-sm font-bold flex items-center justify-between gap-2 border overflow-hidden ${
                    isTop
                      ? 'bg-[#A3C1FF] text-[#070A1A] border-[#C6D8FF] shadow-md'
                      : 'bg-[var(--bg-panel)] text-[var(--text-primary)] border-[var(--border-subtle)]'
                  }`}
                >
                  <span className="break-all truncate">{String(item)}</span>
                  {isTop && (
                    <span className="text-[10px] uppercase font-semibold shrink-0">TOP</span>
                  )}
                </motion.div>
              );
            })
          )}
        </div>

        {/* Status Card */}
        <div className="space-y-2 text-xs font-mono min-w-[140px] max-w-[220px]">
          <div className="p-3 rounded-xl bg-[var(--bg-gutter)] border border-[var(--border-subtle)] overflow-hidden">
            <div className="text-[var(--text-muted)] text-[10px]">TOP ELEMENT</div>
            <div className="text-sm sm:text-base font-bold text-[var(--text-primary)] break-all">
              {stackItems.length > 0 ? String(stackItems[stackItems.length - 1]) : '∅ (Empty)'}
            </div>
          </div>
          {step.variables?.valid !== undefined && (
            <div className="p-3 rounded-xl bg-[var(--bg-gutter)] border border-[var(--border-subtle)] flex items-center gap-2">
              {step.variables.valid ? (
                <CheckCircle2 className="w-4 h-4 text-[#4ADE9B] shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#FF6B7D] shrink-0" />
              )}
              <span className="break-all">valid: {String(step.variables.valid)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * 4. `queue_line`: FIFO Horizontal Ticket Line
 */
export const QueueLineRenderer: React.FC<RendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const { values: detectedQueue } = findPrimaryArray(step.variables || {}, [10, 20, 30]);
  const queueItems: (string | number)[] = step.structure?.values || detectedQueue;

  return (
    <div className="w-full px-2 sm:px-4 py-3 flex flex-col items-center justify-between gap-4 overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] pb-2 border-b border-[var(--border-subtle)]">
        <span lang={explainLanguage} className="font-medium">
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: টিকিট কাউন্টারের লাইন (FIFO Queue)'
            : 'Real-World Analogy: Ticket Counter Queue (FIFO)'}
        </span>
        <span className="font-mono text-[var(--text-accent)]">
          FRONT → REAR ({queueItems.length})
        </span>
      </div>

      <div className="w-full max-w-xl py-4 px-3 sm:px-4 rounded-2xl border-y-2 border-dashed border-[#A3C1FF]/50 bg-[var(--bg-gutter)]/40 flex flex-wrap items-center justify-between gap-3 overflow-hidden">
        <span className="text-[10px] font-mono uppercase text-[#4ADE9B] font-semibold shrink-0">
          ← FRONT
        </span>

        <div className="flex flex-wrap items-center justify-center gap-2 py-1 flex-1 min-w-0">
          {queueItems.length === 0 ? (
            <span className="text-xs font-mono text-[var(--text-muted)]">Queue Empty (∅)</span>
          ) : (
            queueItems.map((item, idx) => (
              <motion.div
                key={`${idx}-${String(item)}`}
                layout={!reduceMotion}
                className={`px-3 py-2 rounded-xl font-mono text-xs sm:text-sm font-bold border-2 flex flex-col items-center min-w-[3.25rem] max-w-[120px] overflow-hidden ${
                  idx === 0
                    ? 'border-[#4ADE9B] bg-[#4ADE9B]/20 text-[var(--text-primary)]'
                    : idx === queueItems.length - 1
                    ? 'border-[#A3C1FF] bg-[#A3C1FF]/20 text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)]'
                }`}
              >
                <span className="break-all text-center">{String(item)}</span>
                <span className="text-[9px] text-[var(--text-muted)]">
                  {idx === 0 ? 'FRONT' : idx === queueItems.length - 1 ? 'REAR' : `#${idx + 1}`}
                </span>
              </motion.div>
            ))
          )}
        </div>

        <span className="text-[10px] font-mono uppercase text-[#A3C1FF] font-semibold shrink-0">
          REAR ←
        </span>
      </div>

      {step.variables?.front !== undefined && (
        <div className="px-3.5 py-1.5 rounded-xl bg-[var(--bg-gutter)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)] break-all">
          Dequeued <strong className="text-[#4ADE9B]">front = {String(step.variables.front)}</strong>
        </div>
      )}
    </div>
  );
};

/**
 * 5. `linked_list_train`: Train Coaches connected by `next` pointer couplers.
 */
export const LinkedListTrainRenderer: React.FC<RendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const { values: detectedNodes } = findPrimaryArray(step.variables || {}, [10, 20, 30]);
  const nodes: (string | number)[] = step.structure?.values || detectedNodes;
  const hasFault = Boolean(step.fault);

  return (
    <div className="w-full px-2 sm:px-4 py-3 flex flex-col items-center justify-between gap-4 overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] pb-2 border-b border-[var(--border-subtle)]">
        <span lang={explainLanguage} className="font-medium">
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: ট্রেনের বগি ও কাপলার (Linked List)'
            : 'Real-World Analogy: Train Coaches & Next Couplers'}
        </span>
        <span className="font-mono text-[var(--text-accent)] uppercase">
          {step.action} · Ln {step.activeLine}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 py-4 w-full">
        {nodes.map((val, idx) => (
          <React.Fragment key={idx}>
            <motion.div
              layout={!reduceMotion}
              className={`rounded-2xl border-2 p-2.5 flex items-center gap-2 bg-[var(--bg-gutter)] overflow-hidden ${
                hasFault && idx === nodes.length - 1
                  ? 'border-[#FF6B7D] bg-[#FF6B7D]/15'
                  : 'border-[#A3C1FF]/70'
              }`}
            >
              <div className="px-2.5 py-1 rounded-lg bg-[var(--bg-panel)] font-mono text-sm sm:text-base font-bold text-[var(--text-primary)] break-all">
                {String(val)}
              </div>
              <div className="text-[10px] font-mono text-[var(--text-secondary)] border-l border-[var(--border-subtle)] pl-2">
                <div>next</div>
                <div className="text-[var(--text-accent)] font-semibold whitespace-nowrap">
                  {idx < nodes.length - 1 ? `→ [${nodes[idx + 1]}]` : 'NULL'}
                </div>
              </div>
            </motion.div>

            {idx < nodes.length - 1 && (
              <ArrowRight className="w-4 h-4 text-[#A3C1FF] shrink-0" />
            )}
          </React.Fragment>
        ))}

        <span className="px-2.5 py-1 rounded-lg bg-[var(--bg-gutter)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-muted)]">
          NULL
        </span>
      </div>

      {/* Pointer state */}
      <div className="flex flex-wrap items-center justify-center gap-2 w-full">
        {Object.entries(step.variables || {}).map(([k, v]) => (
          <span
            key={k}
            className="px-2.5 py-1 rounded-lg bg-[var(--bg-gutter)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)] break-all"
          >
            <strong className="text-[var(--text-accent)]">{k}:</strong> {JSON.stringify(v)}
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * 6. `recursion_tower` / `tree_nodes`: Live Call Stack frames
 */
export const RecursionTowerRenderer: React.FC<RendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const { values: detectedFrames } = findPrimaryArray(
    step.variables || {},
    Object.entries(step.variables || {}).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
  );
  const frames: (string | number)[] =
    step.structure?.values ||
    (detectedFrames.length > 0 ? detectedFrames : [`Line ${step.activeLine}`]);
  const hasFault = Boolean(step.fault);

  return (
    <div className="w-full px-2 sm:px-4 py-3 flex flex-col items-center justify-between gap-4 overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] pb-2 border-b border-[var(--border-subtle)]">
        <span lang={explainLanguage} className="font-medium inline-flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-[var(--text-accent)] shrink-0" />
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: রিকার্শন কল স্ট্যাক টাওয়ার (Call Stack Frames)'
            : 'Real-World Analogy: Recursion Call Stack Tower'}
        </span>
        <span className="font-mono text-[var(--text-accent)]">
          Depth: {frames.length}
        </span>
      </div>

      <div className="w-full max-w-md flex flex-col-reverse items-center gap-2 py-2">
        {frames.map((frame, idx) => {
          const isTopFrame = idx === frames.length - 1;
          return (
            <motion.div
              key={`${idx}-${String(frame)}`}
              layout={!reduceMotion}
              className={`w-full px-3.5 py-2.5 rounded-xl border font-mono text-xs sm:text-sm flex items-center justify-between gap-2 overflow-hidden ${
                hasFault && isTopFrame
                  ? 'border-[#FF6B7D] bg-[#FF6B7D]/20 text-[var(--text-primary)]'
                  : isTopFrame
                  ? 'border-[#A3C1FF] bg-[#A3C1FF]/20 text-[var(--text-primary)] font-bold'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-gutter)]/75 text-[var(--text-secondary)]'
              }`}
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <GitCommit className="w-3.5 h-3.5 text-[var(--text-accent)] shrink-0" />
                <span className="break-all">{String(frame)}</span>
              </span>
              <span className="text-[10px] uppercase text-[var(--text-muted)] shrink-0">
                Frame #{idx + 1}
              </span>
            </motion.div>
          );
        })}
      </div>

      {step.variables?.result !== undefined && (
        <div
          className={`px-4 py-1.5 rounded-xl border font-mono text-xs font-semibold break-all ${
            hasFault
              ? 'bg-[#FF6B7D]/15 border-[#FF6B7D]/45 text-[var(--text-danger)]'
              : 'bg-[#4ADE9B]/15 border-[#4ADE9B]/40 text-[var(--text-success)]'
          }`}
        >
          Return Value = {String(step.variables.result)}
        </div>
      )}
    </div>
  );
};
