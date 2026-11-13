import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ExecutionTrace,
  ExplainLanguage,
  TraceStep,
  VariableSnapshot,
} from '../../../shared/types';
import {
  extractDeclaredVariableTypes,
  resolveAccurateVariableType,
} from '../../../shared/declaredTypeHelper';
import { GitCompare, ArrowRight, Keyboard, GitBranch, Repeat, Terminal, Layers, ArrowLeftRight } from 'lucide-react';

interface GenericMemoryRendererProps {
  trace: ExecutionTrace;
  step: TraceStep | undefined;
  explainLanguage: ExplainLanguage;
  hoveredVariable: string | null;
  reduceMotion: boolean;
}

/**
 * Strips raw memory addresses, pool tags, and object hashes from display strings
 * so beginners only see clean, readable values.
 */
export function sanitizeDisplayText(raw: string): string {
  let cleaned = raw.trim();
  // Unwrap @StringPool[val] or @IntegerCache[val]
  const poolMatch = cleaned.match(/^@(?:StringPool|IntegerCache|Pool|Heap)\[([\s\S]*)\]$/i);
  if (poolMatch) {
    cleaned = poolMatch[1].trim();
  }
  // Remove @0x100, @0x4a2f, @4f2a1c etc.
  cleaned = cleaned.replace(/@0x[0-9a-fA-F]+/gi, '').replace(/@[0-9a-fA-F]{3,}\b/g, '');
  // Replace inline pool references inside longer labels (e.g. "a (@IntegerCache[127])")
  cleaned = cleaned.replace(/@(?:StringPool|IntegerCache|Pool|Heap)\[([^\]]*)\]/gi, '$1');
  return cleaned.trim();
}

function formatVariableValue(rawValue: unknown, type: string): string {
  if (rawValue === null || rawValue === undefined) {
    return 'null';
  }
  if (typeof rawValue === 'object') {
    return sanitizeDisplayText(JSON.stringify(rawValue));
  }
  const str = sanitizeDisplayText(String(rawValue));
  if (!str) {
    return type && type !== 'unknown' ? type : 'Object';
  }
  const normalizedType = (type || '').toLowerCase();
  const isStringType =
    normalizedType === 'string' ||
    normalizedType === 'str' ||
    normalizedType === 'char*' ||
    normalizedType === 'std::string';

  if (
    isStringType &&
    typeof rawValue === 'string' &&
    str.length > 0 &&
    !(str.startsWith('"') && str.endsWith('"')) &&
    !(str.startsWith("'") && str.endsWith("'"))
  ) {
    return `"${str}"`;
  }
  return str;
}

function detectInputTargetVar(step: TraceStep): string | null {
  if (step.stdinConsumed?.targetVar) {
    return step.stdinConsumed.targetVar;
  }
  const code = step.codeSnippet || '';
  // e.g. "String name = scanner.nextLine();" or "name = input(...)" or "int age = sc.nextInt();"
  const assignMatch = code.match(
    /(?:(?:String|int|double|float|long|boolean|char|var|let|const|auto|std::string)\s+)?([A-Za-z_]\w*)\s*=\s*.*?(?:nextLine|nextInt|nextDouble|nextFloat|nextLong|nextBoolean|next|input|readline|prompt|scanf)\s*\(/i
  );
  if (assignMatch?.[1]) {
    return assignMatch[1];
  }
  // e.g. "cin >> age;"
  const cinMatch = code.match(/\bcin\s*>>\s*([A-Za-z_]\w*)/);
  if (cinMatch?.[1]) {
    return cinMatch[1];
  }
  if (step.changes && step.changes.length === 1) {
    return step.changes[0].name;
  }
  return null;
}

export const GenericMemoryRenderer: React.FC<GenericMemoryRendererProps> = ({
  trace,
  step,
  explainLanguage,
  hoveredVariable,
  reduceMotion,
}) => {
  const isZeroStepError = trace.verdict.status === 'compile_error' || !step;
  const isRuntimeOrInputErr =
    trace.verdict.status === 'runtime_error' ||
    trace.verdict.status === 'infinite_loop' ||
    trace.errorCategory === 'runtime_error' ||
    trace.errorCategory === 'input_error';

  if (isZeroStepError) {
    const errTitleBn = isRuntimeOrInputErr
      ? trace.errorCategory === 'input_error'
        ? 'ইনপুট (STDIN) ত্রুটি — পর্যাপ্ত ইনপুট না থাকায় প্রোগ্রাম থেমে গেছে'
        : 'রানটাইম ত্রুটি — এক্সিকিউশন ব্যর্থ হয়েছে'
      : 'কম্পাইল বা সিনট্যাক্স ত্রুটি — অ্যানিমেশন তৈরি করা হয়নি';
    const errTitleEn = isRuntimeOrInputErr
      ? trace.errorCategory === 'input_error'
        ? 'Input Error — Execution Halted'
        : 'Runtime Error — Execution Failed'
      : 'Compile / Syntax Error — No Animation Generated';
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full min-h-[220px] p-4 sm:p-6 text-center select-none overflow-hidden"
        data-testid={isRuntimeOrInputErr ? 'renderer-runtime-error' : 'renderer-compile-error'}
      >
        <h3
          lang={explainLanguage}
          className="text-base font-bold text-[var(--text-danger)] mb-1.5"
        >
          {explainLanguage === 'bn' ? errTitleBn : errTitleEn}
        </h3>
        <p
          lang={explainLanguage}
          className="text-sm text-[var(--text-primary)] max-w-md mb-3 break-words"
        >
          {trace.errorDetails?.messageBn && explainLanguage === 'bn'
            ? trace.errorDetails.messageBn
            : trace.errorDetails?.message || trace.verdict.message}
        </p>
        {trace.errorDetails?.line && (
          <span className="font-mono text-xs px-3 py-1 rounded-md bg-[#EF4444]/15 border border-[#EF4444]/40 text-[var(--text-danger)]">
            Line {trace.errorDetails.line}
          </span>
        )}
      </div>
    );
  }

  const changedMap = new Map((step.changes || []).map((c) => [c.name, c]));
  const declaredTypesMap = extractDeclaredVariableTypes(
    (trace.steps || []).map((s) => s.codeSnippet || '').join('\n'),
    trace.language
  );

  // Build clean variable snapshots (no memory addresses or reference IDs)
  const snapshots: VariableSnapshot[] =
    step.variableSnapshots && step.variableSnapshots.length > 0
      ? step.variableSnapshots.map((snap) => ({
          ...snap,
          type: resolveAccurateVariableType(
            snap.type,
            snap.value,
            trace.language,
            snap.name,
            declaredTypesMap
          ),
        }))
      : Object.entries(step.variables || {}).map(([name, val]) => ({
          name,
          type: resolveAccurateVariableType(
            undefined,
            val,
            trace.language,
            name,
            declaredTypesMap
          ),
          value: val,
          memoryAddress: null,
          referenceId: null,
          pointsTo: null,
          changed: changedMap.has(name),
        }));

  const comparison = step.visualCue?.comparison || null;
  const compareSet = new Set<string>([
    ...(step.visualCue?.compareVars || []),
    ...(comparison?.leftVar ? [comparison.leftVar] : []),
    ...(comparison?.rightVar ? [comparison.rightVar] : []),
  ]);
  const highlightSet = new Set<string>(step.visualCue?.highlightVars || []);
  const pointersMap = step.structure?.pointers || {};

  // Input reading state detection for beginner-friendly input animation
  const hasInputCallInLine =
    /\b(?:nextLine|nextInt|nextDouble|nextFloat|nextLong|nextBoolean|next|input|readline|prompt|scanf)\s*\(/i.test(
      step.codeSnippet || ''
    ) || /\bcin\s*>>/.test(step.codeSnippet || '');
  const isInputStep = Boolean(step.stdinConsumed) || hasInputCallInLine;
  const inputTargetVar = isInputStep ? detectInputTargetVar(step) : null;
  const targetSnap = inputTargetVar
    ? snapshots.find((s) => s.name === inputTargetVar)
    : undefined;
  const rawInputToken =
    step.stdinConsumed?.token !== undefined && step.stdinConsumed?.token !== ''
      ? step.stdinConsumed.token
      : targetSnap
      ? formatVariableValue(targetSnap.value, targetSnap.type)
      : '';

  return (
    <div
      className="relative flex flex-col justify-between w-full min-h-[210px] select-none overflow-hidden"
      data-testid="renderer-generic-memory"
    >
      {/* Optional Loop Counter Badge when inside a loop */}
      {step.loopInfo && (
        <div className="flex items-center justify-end pb-2">
          <span
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#8B5CF6]/15 border border-[#8B5CF6]/40 text-[#C4B5FD] font-mono text-[11px] font-semibold"
            data-testid="loop-iteration-badge"
          >
            <Repeat className="w-3 h-3" />
            {explainLanguage === 'bn'
              ? `লুপ ধাপ #${step.loopInfo.iteration}`
              : `Loop #${step.loopInfo.iteration}`}
          </span>
        </div>
      )}

      {/* Stack Frame / Resource Cleanup Indicator */}
      <AnimatePresence mode="wait">
        {(step.actionType === 'METHOD_ENTRY' ||
          step.actionType === 'CALL' ||
          step.actionType === 'RETURN' ||
          step.actionType === 'SCOPE_END' ||
          step.actionType === 'BLOCK_END' ||
          step.animationAction === 'close_resource' ||
          /\.close\s*\(\s*\)/.test(step.codeSnippet || '')) && (
          <motion.div
            key={`scope-${step.stepIndex}-${step.actionType}`}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
            className="mb-2.5 px-3 py-1.5 rounded-lg bg-[var(--bg-gutter)] border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs font-mono"
            data-testid="scope-frame-visual"
          >
            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Layers className="w-3.5 h-3.5 text-[var(--text-accent)] shrink-0" />
              <span>
                {step.animationAction === 'close_resource' || /\.close\s*\(\s*\)/.test(step.codeSnippet || '')
                  ? explainLanguage === 'bn'
                    ? 'ইনপুট স্ট্রিম রিসোর্স বন্ধ (Stream Closed)'
                    : 'Input Stream Closed'
                  : step.actionType === 'RETURN' || step.actionType === 'BLOCK_END' || step.actionType === 'SCOPE_END'
                  ? explainLanguage === 'bn'
                    ? 'স্কোপ / ব্লক সমাপ্তি (Scope Exit)'
                    : 'Scope Exit'
                  : explainLanguage === 'bn'
                  ? 'স্ট্যাক ফ্রেম / মেথড প্রবেশ (Stack Frame)'
                  : 'Call Stack Frame'}
              </span>
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--code-pill-bg)] text-[var(--code-pill-text)] truncate max-w-[200px]">
              {step.codeSnippet || `Line ${step.activeLine}`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Directional Value Transfer / Swap Banner */}
      <AnimatePresence mode="wait">
        {(step.action === 'transfer' || step.action === 'swap') &&
          step.from &&
          step.to &&
          step.from !== step.to && (
            <motion.div
              key={`transfer-${step.stepIndex}-${step.from}-${step.to}`}
              initial={reduceMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.25 }}
              className="mb-2.5 px-3.5 py-2 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/40 flex items-center justify-center gap-2.5 text-xs font-mono font-semibold"
              data-testid="value-transfer-visual"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-[#C4B5FD] shrink-0" />
              <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[#93C5FD]">
                {sanitizeDisplayText(step.from)}
              </span>
              <motion.span
                animate={reduceMotion ? undefined : { x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
                className="inline-flex items-center text-[#C4B5FD]"
              >
                <ArrowRight className="w-4 h-4" />
              </motion.span>
              <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[#34D399]">
                {sanitizeDisplayText(step.to)}
              </span>
            </motion.div>
          )}
      </AnimatePresence>

      {/* Console Output Stream Transition Indicator */}
      <AnimatePresence mode="wait">
        {(step.actionType === 'OUTPUT' || step.animationAction === 'print_output') &&
          step.consoleOutput !== null &&
          step.consoleOutput !== undefined && (
            <motion.div
              key={`stdout-${step.stepIndex}`}
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.22 }}
              className="mb-3 px-3.5 py-2 rounded-xl bg-[#10B981]/10 border border-[#10B981]/40 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
              data-testid="output-stream-visual"
            >
              <span className="inline-flex items-center gap-1.5 text-[var(--text-success)] font-semibold">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>stdout</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
              </span>
              <span className="px-2.5 py-0.5 rounded bg-[#0B122B]/80 border border-[#10B981]/30 text-[#6EE7B7] break-all">
                {JSON.stringify(step.consoleOutput)}
              </span>
            </motion.div>
          )}
      </AnimatePresence>

      {/* Animated User Input Reading Indicator (for Scanner / input() / cin >> lines) */}
      <AnimatePresence mode="wait">
        {isInputStep && (
          <motion.div
            key={`input-anim-${step.stepIndex}-${inputTargetVar || 'stdin'}`}
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.25 }}
            className="mb-3 px-3.5 py-2.5 rounded-xl bg-[#3B82F6]/10 border border-[#60A5FA]/45 flex flex-wrap items-center justify-between gap-2.5 text-xs"
            data-testid="input-reading-visual"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {!reduceMotion && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                )}
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400" />
              </span>
              <Keyboard className="w-3.5 h-3.5 text-[#93C5FD] shrink-0" />
              <span className="font-medium text-[var(--text-primary)]" lang={explainLanguage}>
                {explainLanguage === 'bn'
                  ? inputTargetVar
                    ? `এখন "${inputTargetVar}" এর জন্য ইনপুট নেওয়া হচ্ছে`
                    : 'এখন ব্যবহারকারীর ইনপুট নেওয়া হচ্ছে'
                  : inputTargetVar
                  ? `Receiving input for "${inputTargetVar}"`
                  : 'Waiting / receiving user input'}
              </span>
            </div>

            {rawInputToken && (
              <motion.div
                initial={reduceMotion ? false : { scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.25, delay: 0.08 }}
                className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#0B122B]/80 border border-cyan-400/40 text-cyan-300"
              >
                <span>{sanitizeDisplayText(String(rawInputToken))}</span>
                {inputTargetVar && (
                  <>
                    <ArrowRight className="w-3 h-3 text-[var(--text-accent)]" />
                    <span className="text-[var(--text-success)]">{inputTargetVar}</span>
                  </>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Control Flow / Condition Evaluation Pill */}
      <AnimatePresence mode="wait">
        {step.conditionEval && (
          <motion.div
            key={`cond-${step.stepIndex}-${step.conditionEval.expression}`}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mb-3 px-3 py-2 rounded-xl bg-[var(--bg-gutter)] border border-[#60A5FA]/35 flex flex-col gap-1.5 text-xs"
            data-testid="condition-eval-visual"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-[var(--text-primary)]">
                <GitBranch className="w-3.5 h-3.5 text-[var(--text-accent)] shrink-0" />
                <span>{sanitizeDisplayText(step.conditionEval.expression)}</span>
              </span>
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span
                  className={`px-2 py-0.5 rounded font-bold ${
                    step.conditionEval.result === false || step.conditionEval.result === 'false'
                      ? 'bg-[#EF4444]/15 text-[#F87171]'
                      : 'bg-[#10B981]/15 text-[#34D399]'
                  }`}
                >
                  {String(step.conditionEval.result).toUpperCase()}
                </span>
                {step.conditionEval.branchTaken && (
                  <span className="px-2 py-0.5 rounded bg-[#3B82F6]/15 text-[#93C5FD] font-semibold">
                    ➔ {step.conditionEval.branchTaken}
                  </span>
                )}
              </div>
            </div>
            {step.conditionEval.casesChecked && step.conditionEval.casesChecked.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                {step.conditionEval.casesChecked.map((c, idx) => (
                  <span
                    key={`${idx}-${c.label}`}
                    className={`px-2 py-0.5 rounded border ${
                      c.matched
                        ? 'bg-[#10B981]/15 border-[#10B981]/50 text-[#34D399] font-bold'
                        : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    {c.label} {c.matched ? '✓' : '✗'}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Comparison Pill */}
      <AnimatePresence mode="wait">
        {comparison && (
          <motion.div
            key={`cmp-${step.stepIndex}-${comparison.leftLabel}-${comparison.rightLabel}`}
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
            className={`mb-3 px-3.5 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 text-xs ${
              comparison.result
                ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[var(--text-success)]'
                : 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[var(--text-danger)]'
            }`}
            data-testid="active-comparison-pill"
          >
            <div className="flex flex-wrap items-center gap-2 font-mono font-semibold">
              <GitCompare className="w-3.5 h-3.5 shrink-0" />
              <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-primary)]">
                {sanitizeDisplayText(comparison.leftLabel)}
              </span>
              <span className="text-[var(--text-accent)] font-bold">{comparison.operator}</span>
              <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-primary)]">
                {sanitizeDisplayText(comparison.rightLabel)}
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  comparison.result
                    ? 'bg-[#10B981]/20 text-[#34D399]'
                    : 'bg-[#EF4444]/20 text-[#F87171]'
                }`}
              >
                {comparison.result ? 'TRUE' : 'FALSE'}
              </span>
            </div>
            {comparison.reason && (
              <span
                lang={explainLanguage}
                className="text-[11px] text-[var(--text-secondary)] font-normal"
              >
                {comparison.reason}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clean Beginner-Friendly Variable Cards */}
      <div className="flex flex-wrap items-stretch justify-center gap-3.5 sm:gap-4 my-3 w-full">
        {snapshots.length === 0 ? (
          <div className="px-4 py-4 rounded-xl bg-[var(--bg-gutter)]/60 border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] text-center w-full">
            {explainLanguage === 'bn'
              ? 'এই ধাপে এখনো কোনো ভেরিয়েবল তৈরি হয়নি'
              : 'No variables created at this step yet'}
          </div>
        ) : (
          snapshots.map((snap) => {
            const change = changedMap.get(snap.name);
            const isChanged = Boolean(change || snap.changed);
            const isReceivingInput = isInputStep && inputTargetVar === snap.name;
            const isCompared = compareSet.has(snap.name);
            const isHighlighted = highlightSet.has(snap.name);
            const isHovered = hoveredVariable === snap.name;
            const isArrayVal = Array.isArray(snap.value);
            const formattedScalar = formatVariableValue(snap.value, snap.type);

            return (
              <motion.div
                key={snap.name}
                layout={!reduceMotion}
                layoutId={reduceMotion ? undefined : `mem-var-${snap.name}`}
                initial={reduceMotion ? false : { scale: 0.94, y: 6, opacity: 0 }}
                animate={{
                  scale: isReceivingInput || isCompared ? 1.03 : isChanged ? [1.03, 1] : 1,
                  y: isReceivingInput || isCompared ? -3 : 0,
                  opacity: 1,
                }}
                transition={
                  reduceMotion
                    ? { duration: 0.01 }
                    : { type: 'spring', stiffness: 280, damping: 24 }
                }
                className={`relative min-w-[148px] max-w-full sm:max-w-[260px] flex-1 p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 overflow-hidden transition-colors bg-[var(--bg-panel-raised)] ${
                  isReceivingInput
                    ? 'border-cyan-400 ring-2 ring-cyan-400/35 shadow-[0_0_16px_rgba(34,211,238,0.18)]'
                    : isCompared
                    ? comparison?.result === false
                      ? 'border-[#EF4444] ring-1 ring-[#EF4444]/40'
                      : 'border-[#34D399] ring-1 ring-[#34D399]/40'
                    : isChanged
                    ? 'border-[#10B981]'
                    : isHighlighted || isHovered
                    ? 'border-[var(--border-active)]'
                    : 'border-[var(--border-subtle)]'
                }`}
                data-testid={`memory-var-${snap.name}`}
              >
                {/* Header: ONLY Variable Name + Clean Data Type Badge */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 min-w-0">
                  <span
                    className="font-mono text-xs font-bold text-[var(--text-primary)] truncate"
                    title={snap.name}
                  >
                    {snap.name}
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--code-pill-bg)] text-[var(--code-pill-text)] font-semibold shrink-0">
                    {snap.type}
                  </span>
                </div>

                {/* Receiving Input Animation Banner inside the Target Card */}
                {isReceivingInput && (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] font-medium text-cyan-300 text-center bg-cyan-500/10 rounded-md py-0.5 px-2"
                  >
                    {explainLanguage === 'bn' ? 'ইনপুট গ্রহণ হচ্ছে...' : 'Receiving input...'}
                  </motion.div>
                )}

                {/* Actual Value inside box */}
                {isArrayVal ? (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 py-1 w-full">
                    {(snap.value as unknown[]).map((item, idx) => {
                      const activePtrs = Object.entries(pointersMap)
                        .filter(([, pIdx]) => pIdx === idx)
                        .map(([pName]) => pName);
                      return (
                        <motion.div
                          key={`${snap.name}-cell-${idx}`}
                          layout={!reduceMotion}
                          initial={reduceMotion ? false : { scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className={`px-2 py-1 rounded-lg bg-[var(--bg-gutter)] border font-mono text-xs font-bold text-[var(--text-primary)] flex flex-col items-center min-w-[2.2rem] ${
                            activePtrs.length > 0
                              ? 'border-[var(--border-active)]'
                              : 'border-[var(--border-subtle)]'
                          }`}
                        >
                          <span className="break-all text-center">
                            {sanitizeDisplayText(String(item))}
                          </span>
                          <span className="text-[9px] text-[var(--text-muted)] font-normal">
                            [{idx}]
                            {activePtrs.length > 0 ? ` · ${activePtrs.join(',')}` : ''}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : snap.value === null || snap.value === undefined ? (
                  <div className="flex items-center justify-center py-1.5 w-full">
                    <span className="px-2.5 py-1 rounded-md bg-[var(--bg-gutter)] border border-dashed border-[var(--border-subtle)] font-mono text-xs text-[var(--text-muted)]">
                      uninitialized / null
                    </span>
                  </div>
                ) : typeof snap.value === 'string' &&
                  /^(?:Scanner|Random|File|ArrayList|HashMap)\(/.test(snap.value) ? (
                  <div className="flex flex-col items-center gap-1 py-1 w-full">
                    <span
                      className={`px-2.5 py-1 rounded-lg border font-mono text-xs font-semibold ${
                        snap.value.includes('closed')
                          ? 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#F87171]'
                          : 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#93C5FD]'
                      }`}
                    >
                      {snap.value}
                    </span>
                  </div>
                ) : (
                  <div
                    className={`font-mono font-bold py-1 break-words text-center w-full ${
                      isReceivingInput ? 'text-cyan-200' : 'text-[var(--text-primary)]'
                    } ${
                      formattedScalar.length > 16
                        ? 'text-xs'
                        : formattedScalar.length > 9
                        ? 'text-base'
                        : 'text-xl'
                    }`}
                  >
                    {formattedScalar}
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};
