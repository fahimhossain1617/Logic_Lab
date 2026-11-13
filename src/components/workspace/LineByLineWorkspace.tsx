import React, { useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { FormattedText } from '../common/FormattedText';
import {
  BookOpen,
  ListOrdered,
  Lightbulb,
  ArrowRight,
} from 'lucide-react';

function getActionBadgeClasses(tag: string): string {
  const t = tag.toUpperCase();
  if (t === 'OUTPUT') return 'bg-[#10B981]/15 text-[var(--text-success)]';
  if (t === 'COMPARISON' || t === 'CONDITION' || t === 'CONDITION_CHECK') {
    return 'bg-[#F59E0B]/15 text-[var(--text-warning)]';
  }
  if (t === 'LOOP' || t === 'LOOP_CHECK') return 'bg-[#8B5CF6]/15 text-[#A78BFA]';
  if (t === 'ALLOCATION' || t === 'DECLARATION' || t === 'DECLARE') {
    return 'bg-[#3B82F6]/15 text-[var(--text-accent)]';
  }
  if (t === 'RETURN' || t === 'SCOPE_END' || t === 'BLOCK_END') {
    return 'bg-[var(--bg-gutter)] text-[var(--text-muted)]';
  }
  return 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]';
}

export const LineByLineWorkspace: React.FC = () => {
  const {
    code,
    hasExecuted,
    apiError,
    trace,
    explainLanguage,
    currentStepIndex,
    goToStep,
    setHoveredVariable,
  } = useLabStore();

  const [breakdownTab, setBreakdownTab] = useState<'steps' | 'lines' | 'summary'>('steps');

  // Do not render breakdown when not yet executed or on compile/syntax error
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

  // Build line-by-line reference entries for every non-empty line in the user's code
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

      return {
        lineNumber,
        codeText: trimmed,
        role: (note?.role || firstStep?.actionType || firstStep?.action || 'statement').toUpperCase(),
        whatText:
          note?.text ||
          firstStep?.whatHappened ||
          firstStep?.explanation ||
          (explainLanguage === 'bn'
            ? `লাইন ${lineNumber} (\`${trimmed}\`) এক্সিকিউট হয়েছে।`
            : `Line ${lineNumber} (\`${trimmed}\`) executed.`),
        whyText:
          note?.why ||
          firstStep?.whyAndLogic ||
          firstStep?.why ||
          (explainLanguage === 'bn'
            ? 'প্রোগ্রামের চূড়ান্ত ফলাফলে পৌঁছানোর জন্য এই লাইনটি স্টেট এগিয়ে নেয়।'
            : 'Advances program state toward the final output.'),
        executionCount: matchingSteps.length,
        firstStepIdx,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <section
      className="pt-6 border-t border-[var(--border-subtle)] space-y-4"
      aria-label={
        explainLanguage === 'bn'
          ? 'স্টেপ-বাই-স্টেপ টাইমলাইন ও লাইন-বাই-লাইন লজিক ব্যাখ্যা'
          : 'Step-by-Step Timeline & Line-by-Line Logic Breakdown'
      }
      data-testid="line-by-line-workspace"
    >
      {/* Breakdown Section Header Tabs (Clean horizontal hairline tabs) */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label={explainLanguage === 'bn' ? 'বিশ্লেষণ ট্যাব' : 'Breakdown Tabs'}
          >
            <button
              type="button"
              role="tab"
              aria-selected={breakdownTab === 'steps'}
              onClick={() => setBreakdownTab('steps')}
              data-testid="tab-explanation-btn"
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                breakdownTab === 'steps'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ListOrdered className="w-4 h-4" />
              <span lang={explainLanguage}>
                {explainLanguage === 'bn' ? 'ধাপে ধাপে এক্সিকিউশন' : 'Step-by-Step Execution'}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={breakdownTab === 'lines'}
              onClick={() => setBreakdownTab('lines')}
              data-testid="tab-animation-btn"
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                breakdownTab === 'lines'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span lang={explainLanguage}>
                {explainLanguage === 'bn' ? 'লাইন বাই লাইন রেফারেন্স' : 'Line-by-Line Reference'}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={breakdownTab === 'summary'}
              onClick={() => setBreakdownTab('summary')}
              data-testid="tab-summary-btn"
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                breakdownTab === 'summary'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Lightbulb className="w-4 h-4" />
              <span lang={explainLanguage}>
                {explainLanguage === 'bn' ? 'লজিক সারসংক্ষেপ' : 'Logic Summary'}
              </span>
            </button>
          </div>

          <div className="text-xs font-mono text-[var(--text-muted)]">
            {explainLanguage === 'bn'
              ? `${lineBreakdownItems.length}টি লাইন · ${trace.steps.length}টি ধাপ`
              : `${lineBreakdownItems.length} lines · ${trace.steps.length} steps`}
          </div>
        </div>

        {/* TAB A: Step-by-Step Execution Horizontal Rows (Borderless, thin 1px dividers) */}
        {breakdownTab === 'steps' && (
          <div className="divide-y divide-[var(--border-subtle)]" data-testid="explanation-view-content">
            {trace.steps.map((stepItem, idx) => {
              const isSelected = idx === currentStepIndex;
              const stepLineCode =
                stepItem.codeSnippet ||
                codeLines[stepItem.activeLine - 1]?.trim() ||
                `Line ${stepItem.activeLine}`;
              const badgeAction = (stepItem.actionType || stepItem.action).toUpperCase();

              return (
                <div
                  key={stepItem.stepIndex}
                  onClick={() => goToStep(idx)}
                  className={`py-4 px-2 sm:px-3 transition-colors cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-[var(--code-pill-bg)]/50 border-l-2 border-l-[var(--accent-primary)]'
                      : 'hover:bg-[var(--bg-panel)]/70 border-l-2 border-l-transparent'
                  }`}
                  data-testid={`explanation-step-row-${idx + 1}`}
                >
                  {/* Top Horizontal Row: Step # + Line # + AST Tag + Code + Sync Button */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs font-bold text-[var(--text-accent)] shrink-0">
                        {explainLanguage === 'bn'
                          ? `ধাপ ${idx + 1} · লাইন ${stepItem.activeLine}`
                          : `Step ${idx + 1} · Line ${stepItem.activeLine}`}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-semibold uppercase px-2 py-0.5 rounded shrink-0 ${getActionBadgeClasses(
                          badgeAction
                        )}`}
                      >
                        {badgeAction}
                      </span>
                      <code className="font-mono text-xs sm:text-sm font-semibold text-[var(--text-primary)] break-all">
                        {stepLineCode}
                      </code>
                    </div>

                    <span className="text-xs font-mono text-[var(--text-accent)] inline-flex items-center gap-1 shrink-0">
                      <span>{isSelected ? (explainLanguage === 'bn' ? 'সক্রিয়' : 'Active') : (explainLanguage === 'bn' ? 'দেখুন' : 'Inspect')}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>

                  {/* What Happened & Deep Why/Logic */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm leading-relaxed">
                    <p className="text-[var(--text-primary)] m-0" lang={explainLanguage}>
                      <strong className="text-[var(--text-secondary)] mr-1.5">
                        {explainLanguage === 'bn' ? 'কী ঘটল:' : 'What happened:'}
                      </strong>
                      <FormattedText
                        text={stepItem.whatHappened || stepItem.explanation}
                        lang={explainLanguage}
                        onHoverToken={setHoveredVariable}
                      />
                    </p>

                    {(stepItem.whyAndLogic || stepItem.why) && (
                      <p className="text-[var(--text-secondary)] m-0" lang={explainLanguage}>
                        <strong className="text-[var(--text-success)] mr-1.5">
                          {explainLanguage === 'bn' ? 'লজিক ও কারণ:' : 'Why & Logic:'}
                        </strong>
                        <FormattedText
                          text={stepItem.whyAndLogic || stepItem.why}
                          lang={explainLanguage}
                          onHoverToken={setHoveredVariable}
                        />
                      </p>
                    )}
                  </div>

                  {/* Inline Memory Snapshot / Delta & Stdout */}
                  {((stepItem.changes && stepItem.changes.length > 0) ||
                    (stepItem.variableSnapshots && stepItem.variableSnapshots.length > 0) ||
                    stepItem.consoleOutput) && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 font-mono text-xs text-[var(--text-secondary)]">
                      {stepItem.changes && stepItem.changes.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[var(--text-muted)]">
                            {explainLanguage === 'bn' ? 'পরিবর্তন:' : 'Delta:'}
                          </span>
                          {stepItem.changes.map((chg, cIdx) => (
                            <span
                              key={`${chg.name}-${cIdx}`}
                              onMouseEnter={() => setHoveredVariable(chg.name)}
                              onMouseLeave={() => setHoveredVariable(null)}
                              className="text-[var(--text-success)] font-semibold"
                            >
                              {chg.name}:{' '}
                              {chg.from === null || chg.from === undefined ? '∅' : String(chg.from)} →{' '}
                              {String(chg.to)}
                            </span>
                          ))}
                        </div>
                      )}

                      {stepItem.variableSnapshots && stepItem.variableSnapshots.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[var(--text-muted)]">
                            {explainLanguage === 'bn' ? 'মেমোরি:' : 'Memory:'}
                          </span>
                          {stepItem.variableSnapshots.map((vs) => (
                            <span
                              key={vs.name}
                              onMouseEnter={() => setHoveredVariable(vs.name)}
                              onMouseLeave={() => setHoveredVariable(null)}
                              className="px-1.5 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-primary)]"
                            >
                              {vs.name}
                              <span className="text-[var(--text-muted)]">:{vs.type}</span>=
                              {typeof vs.value === 'object' ? JSON.stringify(vs.value) : String(vs.value)}
                              {vs.referenceId ? (
                                <span className="text-[var(--text-accent)] ml-1">{vs.referenceId}</span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}

                      {stepItem.consoleOutput && (
                        <span className="text-[var(--text-accent)] font-semibold">
                          stdout: {JSON.stringify(stepItem.consoleOutput)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TAB B: Line-by-Line Reference (Line 1 to End, Unboxed horizontal rows) */}
        {breakdownTab === 'lines' && (
          <div className="divide-y divide-[var(--border-subtle)]">
            {lineBreakdownItems.map((item) => (
              <div
                key={item.lineNumber}
                onClick={() => {
                  if (item.firstStepIdx >= 0) goToStep(item.firstStepIdx);
                }}
                className={`py-3.5 px-2 sm:px-3 space-y-1.5 transition-colors hover:bg-[var(--bg-panel)]/70 ${
                  item.firstStepIdx >= 0 ? 'cursor-pointer' : ''
                }`}
                data-testid={`explanation-line-row-${item.lineNumber}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                    <span className="font-mono text-xs font-bold text-[var(--text-accent)] shrink-0">
                      {explainLanguage === 'bn'
                        ? `লাইন ${item.lineNumber}`
                        : `Line ${item.lineNumber}`}
                    </span>
                    <span
                      className={`text-[11px] font-mono uppercase px-2 py-0.5 rounded font-semibold ${getActionBadgeClasses(
                        item.role
                      )}`}
                    >
                      {item.role}
                    </span>
                    <code className="font-mono text-xs sm:text-sm font-semibold text-[var(--text-primary)] break-all">
                      {item.codeText}
                    </code>
                  </div>

                  {item.firstStepIdx >= 0 && (
                    <span className="text-xs font-mono text-[var(--text-accent)] inline-flex items-center gap-1 shrink-0">
                      <span>
                        {explainLanguage === 'bn'
                          ? `ধাপ ${item.firstStepIdx + 1}-এ যান`
                          : `Jump to Step ${item.firstStepIdx + 1}`}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm leading-relaxed">
                  <p className="text-[var(--text-primary)] m-0" lang={explainLanguage}>
                    <FormattedText text={item.whatText} lang={explainLanguage} />
                  </p>
                  <p className="text-[var(--text-secondary)] m-0" lang={explainLanguage}>
                    <strong className="text-[var(--text-success)] mr-1.5">
                      {explainLanguage === 'bn' ? 'লজিক:' : 'Logic:'}
                    </strong>
                    <FormattedText text={item.whyText} lang={explainLanguage} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB C: Core AI Logic Summary (Unboxed hairline sections) */}
        {breakdownTab === 'summary' && (
          <div className="divide-y divide-[var(--border-subtle)] py-2">
            <div className="py-4 space-y-2.5">
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
                  <span>·</span>
                  <span>Space: {trace.logicSummary.complexity.space}</span>
                </div>
              </div>

              <p lang={explainLanguage} className="text-sm text-[var(--text-primary)] m-0 leading-relaxed">
                <strong className="text-[var(--text-accent)] mr-2">
                  {explainLanguage === 'bn' ? 'প্রোগ্রামের লক্ষ্য:' : 'Program Goal:'}
                </strong>
                <FormattedText text={trace.logicSummary.goal} lang={explainLanguage} />
              </p>

              <p lang={explainLanguage} className="text-sm text-[var(--text-primary)] m-0 leading-relaxed">
                <strong className="text-[var(--text-success)] mr-2">
                  {explainLanguage === 'bn' ? 'কীভাবে লজিক কাজ করে:' : 'How the Logic Works:'}
                </strong>
                <FormattedText text={trace.logicSummary.idea} lang={explainLanguage} />
              </p>

              {trace.logicSummary.analogyStory && (
                <p lang={explainLanguage} className="text-sm text-[var(--text-secondary)] m-0 leading-relaxed">
                  <strong className="text-[var(--text-primary)] mr-2">
                    {explainLanguage === 'bn' ? 'বাস্তব উদাহরণ:' : 'Real-World Analogy:'}
                  </strong>
                  <FormattedText text={trace.logicSummary.analogyStory} lang={explainLanguage} />
                </p>
              )}
            </div>

            {trace.logicSummary.keyPoints && trace.logicSummary.keyPoints.length > 0 && (
              <div className="py-4 space-y-1.5">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] m-0" lang={explainLanguage}>
                  {explainLanguage === 'bn' ? 'মূল পয়েন্টসমূহ' : 'Key Takeaways'}
                </h3>
                <ul className="m-0 pl-5 space-y-1 text-xs sm:text-sm text-[var(--text-primary)]">
                  {trace.logicSummary.keyPoints.map((kp, i) => (
                    <li key={i} lang={explainLanguage}>
                      <FormattedText text={kp} lang={explainLanguage} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {trace.logicSummary.commonMistakes && trace.logicSummary.commonMistakes.length > 0 && (
              <div className="py-4 space-y-1.5">
                <h3 className="text-xs font-semibold text-[var(--text-warning)] m-0" lang={explainLanguage}>
                  {explainLanguage === 'bn' ? 'সাধারণ ভুলগুলো এড়িয়ে চলুন' : 'Common Pitfalls to Avoid'}
                </h3>
                <ul className="m-0 pl-5 space-y-1 text-xs sm:text-sm text-[var(--text-secondary)]">
                  {trace.logicSummary.commonMistakes.map((cm, i) => (
                    <li key={i} lang={explainLanguage}>
                      <FormattedText text={cm} lang={explainLanguage} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
