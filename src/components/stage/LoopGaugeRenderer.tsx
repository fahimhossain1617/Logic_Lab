import React from 'react';
import { motion } from 'motion/react';
import { ExplainLanguage, TraceStep } from '../../../shared/types';
import { OctagonAlert } from 'lucide-react';

interface LoopGaugeRendererProps {
  step: TraceStep;
  explainLanguage: ExplainLanguage;
  reduceMotion: boolean;
}

export const LoopGaugeRenderer: React.FC<LoopGaugeRendererProps> = ({
  step,
  explainLanguage,
  reduceMotion,
}) => {
  const vars = step.variables || {};
  const inferredLap =
    step.structure?.lap ??
    (typeof vars.i === 'number'
      ? Math.max(1, Math.abs(vars.i))
      : typeof vars.count === 'number'
      ? Math.max(1, Math.abs(vars.count))
      : step.stepIndex);
  const maxLaps = step.structure?.maxLaps ?? Math.max(inferredLap, 5);
  const unchangedVar = step.structure?.unchangedVar || step.fault?.target || 'i';
  const isInfiniteFault = step.fault?.type === 'infinite_loop' || step.action === 'halt';

  return (
    <div
      className="relative flex flex-col items-center justify-between w-full h-full min-h-[260px] px-3 sm:px-5 py-3.5 select-none overflow-hidden"
      data-testid="renderer-loop-gauge"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 w-full max-w-[600px] text-xs pb-2.5 border-b border-[var(--border-subtle)]">
        <span className="text-[var(--text-muted)] font-medium">
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: লুপ ল্যাপ কাউন্টার (Loop Lap Gauge)'
            : 'Real-World Analogy: Loop Lap Gauge'}
        </span>
        <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-semibold">
          Step {step.stepIndex} · Ln {step.activeLine}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-8 my-5 w-full max-w-[600px]">
        {/* Spinning Ring */}
        <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 140 140" className="w-full h-full">
            <circle
              cx="70"
              cy="70"
              r="54"
              fill="none"
              stroke="rgba(163, 193, 255, 0.14)"
              strokeWidth="10"
            />
            <motion.circle
              cx="70"
              cy="70"
              r="54"
              fill="none"
              stroke={isInfiniteFault ? '#FF6B7D' : '#A3C1FF'}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray="110 230"
              animate={{
                rotate: reduceMotion ? 0 : inferredLap * 360,
              }}
              transition={{ duration: 0.65, ease: 'easeInOut' }}
              style={{ transformOrigin: '70px 70px' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3 overflow-hidden">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {explainLanguage === 'bn' ? 'ল্যাপ' : 'LAP'}
            </span>
            <span
              className={`text-2xl sm:text-3xl font-mono font-bold leading-tight ${
                isInfiniteFault ? 'text-[#FF6B7D]' : 'text-[var(--text-primary)]'
              }`}
            >
              {inferredLap}
            </span>
            {step.structure?.conditionText && (
              <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate max-w-[92px]">
                {step.structure.conditionText}
              </span>
            )}
          </div>
        </div>

        {/* Variable Watch & STOP Banner */}
        <div className="flex flex-col gap-3 flex-1 min-w-0 w-full">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {Object.entries(vars).map(([k, v]) => {
              const isStuck = isInfiniteFault && k === unchangedVar;
              const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return (
                <div
                  key={k}
                  className={`px-3.5 py-2.5 rounded-xl border font-mono text-xs flex flex-col overflow-hidden gap-1 ${
                    isStuck
                      ? 'bg-[#FF6B7D]/15 border-[#FF6B7D] text-[#FF6B7D]'
                      : 'bg-[var(--bg-gutter)]/80 border-[var(--border-subtle)] text-[var(--text-primary)]'
                  }`}
                >
                  <span className="opacity-75 truncate text-[11px]" title={k}>
                    {k}
                  </span>
                  <span className="text-sm sm:text-base font-bold break-all">
                    {valStr}
                  </span>
                </div>
              );
            })}
          </div>

          {isInfiniteFault && (
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#FF6B7D]/20 border border-[#FF6B7D] text-[#FF6B7D] text-xs font-semibold break-words"
              data-testid="fault-infinite-loop-stop"
            >
              <OctagonAlert className="w-4 h-4 shrink-0" />
              <span>
                {explainLanguage === 'bn'
                  ? `STOP: ভ্যারিয়েবল "${unchangedVar}" কখনোই বদলায়নি!`
                  : `STOP: Variable "${unchangedVar}" never changed!`}
              </span>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
