import React, { useEffect } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { StageCanvas } from '../stage/StageCanvas';
import { FormattedText } from '../common/FormattedText';
import { getStepDurationMs } from '../../utils/playerLogic';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, BookOpen, Layers } from 'lucide-react';

export const LineByLineWorkspace: React.FC = () => {
  const {
    code,
    hasExecuted,
    apiError,
    trace,
    explainLanguage,
    activeResultTab,
    currentStepIndex,
    isPlaying,
    speed,
    setActiveResultTab,
    goToStep,
    togglePlay,
    nextStep,
    prevStep,
    resetPlayback,
    setSpeed,
    setHoveredVariable,
  } = useLabStore();

  // Playback timer when in animation mode
  useEffect(() => {
    if (!isPlaying || trace.steps.length === 0) return;
    const intervalMs = getStepDurationMs(speed);
    const timer = setInterval(() => {
      nextStep();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, speed, nextStep, trace.steps.length]);

  // Do not show explanation or animation if code has not been executed or if it has syntax/compile errors
  if (
    !hasExecuted ||
    Boolean(apiError) ||
    trace.verdict.status === 'compile_error' ||
    trace.steps.length === 0
  ) {
    return null;
  }

  const codeLines = code.split('\n');
  const activeStep = trace.steps[currentStepIndex] || trace.steps[0];
  const activeCodeLineText =
    activeStep && codeLines[activeStep.activeLine - 1]
      ? codeLines[activeStep.activeLine - 1].trim()
      : '';

  // Build complete line-by-line documentation entries for every non-empty line in the user's code
  const lineBreakdownItems = codeLines
    .map((rawLine, idx) => {
      const lineNumber = idx + 1;
      const trimmed = rawLine.trim();
      if (!trimmed) return null;

      const note = trace.lineNotes.find((n) => n.line === lineNumber);
      const matchingSteps = trace.steps.filter((s) => s.activeLine === lineNumber);
      const firstStep = matchingSteps[0];
      const firstStepIdx = firstStep
        ? trace.steps.findIndex((s) => s.stepIndex === firstStep.stepIndex)
        : -1;

      const changes = matchingSteps.flatMap((s) => s.changes || []);

      return {
        lineNumber,
        codeText: trimmed,
        role: note?.role || firstStep?.action || 'statement',
        whatText:
          note?.text ||
          firstStep?.explanation ||
          (explainLanguage === 'bn'
            ? `লাইন ${lineNumber} (\`${trimmed}\`) এক্সিকিউট হয়েছে।`
            : `Line ${lineNumber} (\`${trimmed}\`) executed.`),
        whyText:
          note?.why ||
          firstStep?.why ||
          (explainLanguage === 'bn'
            ? 'প্রোগ্রামের চূড়ান্ত ফলাফলে পৌঁছানোর জন্য এই লাইনটি মেমোরি বা নিয়ন্ত্রণ প্রবাহ এগিয়ে নেয়।'
            : 'Advances the program state toward the final output.'),
        changes,
        executionCount: matchingSteps.length,
        firstStepIdx,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const speeds = [0.5, 1, 1.5, 2];

  return (
    <section
      className="ll-panel rounded-2xl overflow-hidden"
      aria-label={
        explainLanguage === 'bn'
          ? 'লাইন বাই লাইন ব্যাখ্যা ও অ্যানিমেশন'
          : 'Line-by-Line Explanation and Animation'
      }
      data-testid="line-by-line-workspace"
    >
      {/* Top Mode Switcher Bar: Explanation vs Line-by-Line Animation */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 px-4 sm:px-7 py-3.5 bg-[var(--bg-gutter)] border-b border-[var(--border-subtle)]">
        <div
          className="flex items-center gap-2.5"
          role="tablist"
          aria-label={explainLanguage === 'bn' ? 'বিশ্লেষণ মোড' : 'Analysis Mode'}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeResultTab === 'explanation'}
            onClick={() => setActiveResultTab('explanation')}
            data-testid="tab-explanation-btn"
            className={`px-3.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
              activeResultTab === 'explanation'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span lang={explainLanguage}>
              {explainLanguage === 'bn' ? 'ব্যাখ্যা' : 'Explanation'}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeResultTab === 'animation'}
            onClick={() => setActiveResultTab('animation')}
            data-testid="tab-animation-btn"
            className={`px-3.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
              activeResultTab === 'animation'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span lang={explainLanguage}>
              {explainLanguage === 'bn' ? 'অ্যানিমেশন' : 'Animation'}
            </span>
          </button>
        </div>

        <div className="text-xs font-mono text-[var(--text-secondary)]">
          {explainLanguage === 'bn'
            ? `${lineBreakdownItems.length}টি কোড লাইন · ${trace.steps.length}টি এক্সিকিউশন ধাপ`
            : `${lineBreakdownItems.length} code lines · ${trace.steps.length} execution steps`}
        </div>
      </div>

      {/* TAB 1: UNIFIED SINGLE-CONTAINER EXPLANATION SEPARATED BY HORIZONTAL LINES */}
      {activeResultTab === 'explanation' && (
        <div
          className="divide-y divide-[var(--border-subtle)]"
          data-testid="explanation-view-content"
        >
          {/* Section 1: Core AI Logic Summary */}
          <div className="px-5 sm:px-8 py-6 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2
                lang={explainLanguage}
                className="text-base sm:text-lg font-bold text-[var(--text-primary)] m-0"
              >
                {trace.logicSummary.title ||
                  (explainLanguage === 'bn'
                    ? 'লজিক বিল্ডিং ও প্রোগ্রামের সারসংক্ষেপ'
                    : 'Logic Building & Program Summary')}
              </h2>
              <div className="flex items-center gap-3 text-xs font-mono text-[var(--text-secondary)]">
                <span>Time: {trace.logicSummary.complexity.time}</span>
                <span aria-hidden="true">·</span>
                <span>Space: {trace.logicSummary.complexity.space}</span>
              </div>
            </div>

            <div className="space-y-3 text-sm sm:text-base text-[var(--text-primary)] leading-relaxed">
              <p lang={explainLanguage} className="m-0">
                <strong className="text-[var(--text-accent)] mr-2">
                  {explainLanguage === 'bn' ? 'প্রোগ্রামের লক্ষ্য:' : 'Program Goal:'}
                </strong>
                <FormattedText text={trace.logicSummary.goal} lang={explainLanguage} />
              </p>

              <p lang={explainLanguage} className="m-0">
                <strong className="text-[var(--text-success)] mr-2">
                  {explainLanguage === 'bn'
                    ? 'কীভাবে লজিক কাজ করে:'
                    : 'How the Logic Works:'}
                </strong>
                <FormattedText text={trace.logicSummary.idea} lang={explainLanguage} />
              </p>

              {trace.logicSummary.analogyStory && (
                <p lang={explainLanguage} className="m-0 text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)] mr-2">
                    {explainLanguage === 'bn' ? 'বাস্তব উদাহরণ:' : 'Real-World Analogy:'}
                  </strong>
                  <FormattedText
                    text={trace.logicSummary.analogyStory}
                    lang={explainLanguage}
                  />
                </p>
              )}
            </div>
          </div>

          {/* Section 2: Step-by-Step Execution Flow Header */}
          <div className="px-5 sm:px-8 py-3.5 bg-[var(--bg-gutter)]/35 flex flex-wrap items-center justify-between gap-3">
            <h3
              lang={explainLanguage}
              className="text-xs sm:text-sm font-bold text-[var(--text-primary)] m-0"
            >
              {explainLanguage === 'bn'
                ? 'ধাপে ধাপে এক্সিকিউশন ও লাইন বাই লাইন ব্যাখ্যা'
                : 'Step-by-Step Execution & Line-by-Line Breakdown'}
            </h3>
            <button
              type="button"
              onClick={() => setActiveResultTab('animation')}
              className="text-xs font-semibold text-[var(--text-accent)] hover:underline cursor-pointer inline-flex items-center gap-1.5"
            >
              <span>{explainLanguage === 'bn' ? '৩ডি অ্যানিমেশন দেখুন' : 'Open 3D Animation'}</span>
              <span>→</span>
            </button>
          </div>

          {/* Section 3: Every Execution Step separated cleanly by a horizontal rule (No boxy cards) */}
          <div className="divide-y divide-[var(--border-subtle)]">
            {trace.steps.map((stepItem, idx) => {
              const stepLineCode =
                stepItem.codeSnippet ||
                codeLines[stepItem.activeLine - 1]?.trim() ||
                `Line ${stepItem.activeLine}`;
              const badgeAction = stepItem.actionType || stepItem.action.toUpperCase();
              return (
                <div
                  key={stepItem.stepIndex}
                  className="px-5 sm:px-8 py-5 space-y-3 transition-colors hover:bg-[var(--bg-gutter)]/20"
                  data-testid={`explanation-step-row-${idx + 1}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <span className="font-mono text-xs font-bold text-[var(--text-accent)] shrink-0">
                        {explainLanguage === 'bn'
                          ? `ধাপ ${idx + 1} · লাইন ${stepItem.activeLine}`
                          : `Step ${idx + 1} · Line ${stepItem.activeLine}`}
                      </span>
                      <span className="font-mono text-[11px] font-semibold uppercase px-2 py-0.5 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-muted)] shrink-0">
                        {badgeAction}
                      </span>
                      <span aria-hidden="true" className="text-[var(--text-muted)] select-none">
                        —
                      </span>
                      <code className="font-mono text-xs sm:text-sm font-semibold text-[var(--text-primary)] break-all px-2 py-0.5 rounded bg-[var(--bg-gutter)]/70">
                        {stepLineCode}
                      </code>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        goToStep(idx);
                        setActiveResultTab('animation');
                      }}
                      className="px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-gutter)] hover:border-[#A3C1FF] text-xs font-semibold text-[var(--text-accent)] hover:underline cursor-pointer inline-flex items-center gap-1.5 transition-colors shrink-0"
                    >
                      <span>
                        {explainLanguage === 'bn'
                          ? `ধাপ ${idx + 1} অ্যানিমেশন`
                          : `Animate Step ${idx + 1}`}
                      </span>
                      <span>→</span>
                    </button>
                  </div>

                  <p className="text-sm text-[var(--text-primary)] m-0 leading-relaxed" lang={explainLanguage}>
                    <strong className="text-[var(--text-secondary)] mr-2">
                      {explainLanguage === 'bn' ? 'কী ঘটল:' : 'What happened:'}
                    </strong>
                    <FormattedText
                      text={stepItem.explanation}
                      lang={explainLanguage}
                      onHoverToken={setHoveredVariable}
                    />
                  </p>

                  {stepItem.why && (
                    <p className="text-xs sm:text-sm text-[var(--text-secondary)] m-0 leading-relaxed" lang={explainLanguage}>
                      <strong className="text-[var(--text-success)] mr-2">
                        {explainLanguage === 'bn' ? 'কেন দরকার (লজিক):' : 'Why it matters:'}
                      </strong>
                      <FormattedText
                        text={stepItem.why}
                        lang={explainLanguage}
                        onHoverToken={setHoveredVariable}
                      />
                    </p>
                  )}

                  {((stepItem.changes && stepItem.changes.length > 0) ||
                    stepItem.consoleOutput) && (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 font-mono text-xs text-[var(--text-secondary)]">
                      {stepItem.changes && stepItem.changes.length > 0 && (
                        <>
                          <span className="text-[var(--text-muted)] font-semibold">
                            {explainLanguage === 'bn' ? 'মেমোরি ডেল্টা:' : 'Memory delta:'}
                          </span>
                          {stepItem.changes.map((chg, cIdx) => (
                            <span
                              key={`${chg.name}-${cIdx}`}
                              onMouseEnter={() => setHoveredVariable(chg.name)}
                              onMouseLeave={() => setHoveredVariable(null)}
                              className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-success)] font-semibold"
                            >
                              {chg.name}:{' '}
                              {chg.from === null || chg.from === undefined
                                ? 'null'
                                : String(chg.from)}{' '}
                              → {String(chg.to)}
                            </span>
                          ))}
                        </>
                      )}
                      {stepItem.consoleOutput && (
                        <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-accent)] font-semibold">
                          stdout: {JSON.stringify(stepItem.consoleOutput)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Section 4: Line-by-Line Reference (Line 1 to End) separated by horizontal lines */}
          <div className="px-5 sm:px-8 py-4 bg-[var(--bg-gutter)]/35">
            <h3
              lang={explainLanguage}
              className="text-xs sm:text-sm font-bold text-[var(--text-primary)] m-0"
            >
              {explainLanguage === 'bn'
                ? 'কোডের প্রতিটি লাইনের সারসংক্ষেপ (১ম লাইন থেকে শেষ লাইন)'
                : 'Line-by-Line Code Reference (Line 1 to End)'}
            </h3>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {lineBreakdownItems.map((item) => (
              <div
                key={item.lineNumber}
                className="px-5 sm:px-8 py-4 space-y-2 hover:bg-[var(--bg-gutter)]/20 transition-colors"
                data-testid={`explanation-line-row-${item.lineNumber}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-[var(--text-accent)] shrink-0">
                      {explainLanguage === 'bn'
                        ? `লাইন ${item.lineNumber}`
                        : `Line ${item.lineNumber}`}
                    </span>
                    <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                      {item.role}
                    </span>
                    <code className="font-mono text-xs sm:text-sm font-semibold text-[var(--text-primary)] break-all px-2 py-0.5 rounded bg-[var(--bg-gutter)]/70">
                      {item.codeText}
                    </code>
                  </div>

                  {item.firstStepIdx >= 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        goToStep(item.firstStepIdx);
                        setActiveResultTab('animation');
                      }}
                      className="px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-gutter)] hover:border-[#A3C1FF] text-xs font-semibold text-[var(--text-accent)] hover:underline cursor-pointer inline-flex items-center gap-1.5 transition-colors shrink-0"
                    >
                      <span>
                        {explainLanguage === 'bn'
                          ? `লাইন ${item.lineNumber} অ্যানিমেশন`
                          : `Animate Line ${item.lineNumber}`}
                      </span>
                      <span>→</span>
                    </button>
                  )}
                </div>

                <p className="text-sm text-[var(--text-primary)] m-0 leading-relaxed" lang={explainLanguage}>
                  <FormattedText text={item.whatText} lang={explainLanguage} />
                </p>

                <p className="text-xs sm:text-sm text-[var(--text-secondary)] m-0 leading-relaxed" lang={explainLanguage}>
                  <strong className="text-[var(--text-success)] mr-2">
                    {explainLanguage === 'bn' ? 'লজিক:' : 'Logic:'}
                  </strong>
                  <FormattedText text={item.whyText} lang={explainLanguage} />
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: SCROLLABLE LINE-BY-LINE 3D ANIMATION TIMELINE + STAGE */}
      {activeResultTab === 'animation' && (
        <div
          className="divide-y divide-[var(--border-subtle)]"
          data-testid="animation-view-content"
        >
          {/* Step Playback Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 px-4 sm:px-7 py-3.5 bg-[var(--bg-gutter)]/50">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prevStep}
                disabled={currentStepIndex <= 0}
                className="px-3 sm:px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-medium text-[var(--text-primary)] hover:border-[#A3C1FF] disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                aria-label="Previous step"
                data-testid="anim-prev-btn"
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {explainLanguage === 'bn' ? 'পূর্ববর্তী ধাপ' : 'Prev'}
                </span>
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="ll-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
                data-testid="anim-play-pause-btn"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>{explainLanguage === 'bn' ? 'বিরতি' : 'Pause'}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{explainLanguage === 'bn' ? 'অটো প্লে' : 'Auto Play'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={nextStep}
                disabled={currentStepIndex >= trace.steps.length - 1}
                className="px-3 sm:px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-medium text-[var(--text-primary)] hover:border-[#A3C1FF] disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                aria-label="Next step"
                data-testid="anim-next-btn"
              >
                <span className="hidden sm:inline">
                  {explainLanguage === 'bn' ? 'পরবর্তী ধাপ' : 'Next'}
                </span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={resetPlayback}
                className="px-3 sm:px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ml-1"
                aria-label="Reset to step 1"
                data-testid="anim-reset-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {explainLanguage === 'bn' ? 'প্রথম থেকে' : 'Reset'}
                </span>
              </button>
            </div>

            {/* Speed selector */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-xs font-mono">
                <span className="text-[var(--text-muted)] mr-1.5 font-medium">
                  {explainLanguage === 'bn' ? 'গতি:' : 'Speed:'}
                </span>
                {speeds.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={`px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                      speed === s
                        ? 'bg-blue-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Split Layout: Left Scrollable Step List | Right 3D Stage + Step Explanation */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-subtle)]">
            {/* Left Column: Unified Scrollable Execution Steps List separated by horizontal lines */}
            <div
              className="lg:col-span-5 max-h-[640px] overflow-y-auto divide-y divide-[var(--border-subtle)]"
              aria-label={
                explainLanguage === 'bn'
                  ? 'লাইন বাই লাইন অ্যানিমেশন টাইমলাইন'
                  : 'Line-by-Line Animation Timeline'
              }
              data-testid="line-by-line-timeline-list"
            >
              {trace.steps.map((stepItem, idx) => {
                const isSelected = idx === currentStepIndex;
                const lineCode =
                  codeLines[stepItem.activeLine - 1]?.trim() ||
                  `Line ${stepItem.activeLine}`;
                const isLastStep = idx === trace.steps.length - 1;

                return (
                  <button
                    key={stepItem.stepIndex}
                    type="button"
                    onClick={() => goToStep(idx)}
                    data-testid={`timeline-step-item-${idx}`}
                    className={`w-full text-left px-5 py-4 transition-colors cursor-pointer block ${
                      isSelected
                        ? 'bg-blue-600/15 border-l-4 border-l-blue-500'
                        : 'hover:bg-slate-800/40 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`font-mono text-xs font-bold ${
                          isSelected ? 'text-[var(--text-accent)]' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        {explainLanguage === 'bn'
                          ? `ধাপ ${idx + 1} · লাইন ${stepItem.activeLine}`
                          : `Step ${idx + 1} · Line ${stepItem.activeLine}`}
                      </span>
                      <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                        {isLastStep
                          ? explainLanguage === 'bn'
                            ? 'চূড়ান্ত ধাপ'
                            : 'FINAL STEP'
                          : stepItem.action}
                      </span>
                    </div>

                    <div className="font-mono text-xs font-semibold text-[var(--text-primary)] break-all mb-1.5 px-2 py-1 rounded bg-[var(--bg-gutter)]/60">
                      {lineCode}
                    </div>

                    <div
                      className="text-xs text-[var(--text-secondary)] leading-relaxed"
                      lang={explainLanguage}
                    >
                      <FormattedText text={stepItem.explanation} lang={explainLanguage} />
                    </div>

                    {stepItem.changes && stepItem.changes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 font-mono text-[11px] text-[var(--text-success)]">
                        {stepItem.changes.map((c, cIdx) => (
                          <span key={`${c.name}-${cIdx}`} className="px-1.5 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)]">
                            {c.name}:{' '}
                            {c.from === null || c.from === undefined
                              ? '∅'
                              : String(c.from)}{' '}
                            → {String(c.to)}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Right Column: Active Line Source Banner + 3D Stage Canvas + Synced Step Explanation */}
            <div className="lg:col-span-7 flex flex-col justify-between bg-[var(--bg-panel)] divide-y divide-[var(--border-subtle)] min-w-0">
              {/* Active Executed Code Line Header */}
              <div className="px-5 sm:px-7 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-gutter)]/30">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono text-xs font-bold text-[var(--text-accent)] shrink-0">
                    {explainLanguage === 'bn'
                      ? `সক্রিয় লাইন ${activeStep?.activeLine || 1}:`
                      : `Active Line ${activeStep?.activeLine || 1}:`}
                  </span>
                  <code className="font-mono text-xs sm:text-sm font-semibold text-[var(--text-primary)] break-all px-2 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)]">
                    {activeCodeLineText || '—'}
                  </code>
                </div>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-muted)] shrink-0">
                  {currentStepIndex + 1} / {trace.steps.length}
                </span>
              </div>

              {/* 3D Tactile Stage Canvas */}
              <div className="p-4 sm:p-7">
                <StageCanvas />
              </div>

              {/* Synced Step-by-Step Explanation Details (Separated by Horizontal Line, No Inner Boxes) */}
              {activeStep && (
                <div className="px-5 sm:px-7 py-4.5 space-y-2.5 text-xs sm:text-sm bg-[var(--bg-gutter)]/15">
                  <p className="m-0 text-[var(--text-primary)] leading-relaxed" lang={explainLanguage}>
                    <strong className="text-[var(--text-accent)] mr-2">
                      {explainLanguage === 'bn' ? 'কী ঘটল:' : 'What happened:'}
                    </strong>
                    <FormattedText
                      text={activeStep.explanation}
                      lang={explainLanguage}
                      onHoverToken={setHoveredVariable}
                    />
                  </p>
                  {activeStep.why && (
                    <p className="m-0 text-[var(--text-secondary)] leading-relaxed" lang={explainLanguage}>
                      <strong className="text-[var(--text-success)] mr-2">
                        {explainLanguage === 'bn' ? 'কেন দরকার:' : 'Why this matters:'}
                      </strong>
                      <FormattedText
                        text={activeStep.why}
                        lang={explainLanguage}
                        onHoverToken={setHoveredVariable}
                      />
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
