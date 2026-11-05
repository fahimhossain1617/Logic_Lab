import React from 'react';
import { useLabStore, DeckTab } from '../../store/useLabStore';
import { FormattedText } from '../common/FormattedText';
import {
  BookOpen,
  Terminal,
  Lightbulb,
  CheckCircle2,
  AlertOctagon,
  ArrowRight,
  Clock,
  Cpu,
} from 'lucide-react';

export const ExplainerDeck: React.FC = () => {
  const {
    trace,
    currentStepIndex,
    explainLanguage,
    depth,
    activeDeckTab,
    setActiveDeckTab,
    toggleExplainLanguage,
    setDepth,
    setHoveredVariable,
    jumpToLine,
  } = useLabStore();

  const step = trace.steps[currentStepIndex] || trace.steps[0];
  const activeLineNote =
    trace.lineNotes.find((n) => n.line === step?.activeLine) || trace.lineNotes[0];

  const tabs: { id: DeckTab; label_bn: string; label_en: string; icon: React.ReactNode }[] = [
    {
      id: 'explain',
      label_bn: 'ধাপ ও লাইন ব্যাখ্যা',
      label_en: 'Line & Step Explainer',
      icon: <BookOpen className="w-4 h-4" />,
    },
    {
      id: 'output',
      label_bn: 'আউটপুট টার্মিনাল',
      label_en: 'Output & Verdict',
      icon: <Terminal className="w-4 h-4" />,
    },
    {
      id: 'summary',
      label_bn: 'লজিক সারসংক্ষেপ',
      label_en: 'Logic Summary',
      icon: <Lightbulb className="w-4 h-4" />,
    },
  ];

  return (
    <section
      className="ll-panel rounded-2xl flex flex-col overflow-hidden"
      aria-label={explainLanguage === 'bn' ? 'ব্যাখ্যা এবং আউটপুট ডেক' : 'Explanation and Output Deck'}
    >
      {/* Deck Header with Tabs + Language & Depth Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-gutter)]/40">
        <div className="flex items-center gap-1" role="tablist">
          {tabs.map((t) => {
            const isActive = activeDeckTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveDeckTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-[#A3C1FF]/20 text-[var(--text-primary)] border border-[#A3C1FF]/50'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.icon}
                <span lang={explainLanguage}>
                  {explainLanguage === 'bn' ? t.label_bn : t.label_en}
                </span>
              </button>
            );
          })}
        </div>

        {/* Depth Toggle (Simple / Detailed) & Language Toggle (বাংলা / EN) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center p-0.5 rounded-lg bg-[var(--bg-gutter)]/80 border border-[var(--border-subtle)] text-xs">
            <button
              type="button"
              onClick={() => setDepth('simple')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                depth === 'simple'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {explainLanguage === 'bn' ? 'সহজ' : 'Simple'}
            </button>
            <button
              type="button"
              onClick={() => setDepth('detailed')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                depth === 'detailed'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {explainLanguage === 'bn' ? 'বিস্তারিত' : 'Detailed'}
            </button>
          </div>

          <button
            type="button"
            onClick={toggleExplainLanguage}
            className="px-2.5 py-1 rounded-lg bg-[var(--bg-gutter)]/80 border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:border-[#A3C1FF] transition-colors cursor-pointer whitespace-nowrap"
            aria-label="Toggle explanation language (L)"
            title="Switch Language (L)"
          >
            {explainLanguage === 'bn' ? 'বাংলা · EN' : 'EN · বাংলা'}
          </button>
        </div>
      </div>

      {/* Unified Tab Content Area with Horizontal Line Separators (No nested boxy cards) */}
      <div className="text-sm max-h-[380px] overflow-y-auto" aria-live="polite">
        {activeDeckTab === 'explain' && (
          <div className="divide-y divide-[var(--border-subtle)]">
            {activeLineNote && (
              <div className="px-4 sm:px-5 py-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono font-semibold text-[var(--text-accent)]">
                    {explainLanguage === 'bn'
                      ? `সক্রিয় লাইন ${activeLineNote.line} (${activeLineNote.role})`
                      : `Active Line ${activeLineNote.line} (${activeLineNote.role})`}
                  </span>
                  <span className="font-mono">
                    {trace.steps.length === 0
                      ? explainLanguage === 'bn'
                        ? 'কম্পাইল ত্রুটি'
                        : 'Compile Error'
                      : explainLanguage === 'bn'
                      ? `ধাপ ${currentStepIndex + 1}/${trace.steps.length}`
                      : `Step ${currentStepIndex + 1}/${trace.steps.length}`}
                  </span>
                </div>
                <p className="text-[var(--text-primary)] font-medium m-0">
                  <FormattedText
                    text={activeLineNote.text}
                    lang={explainLanguage}
                    onHoverToken={setHoveredVariable}
                  />
                </p>
              </div>
            )}

            {step ? (
              <>
                <div className="px-4 sm:px-5 py-3.5 space-y-1">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] block">
                    {explainLanguage === 'bn' ? 'কী ঘটল (What Happened)' : 'What Happened'}
                  </span>
                  <p className="text-[var(--text-primary)] m-0">
                    <FormattedText
                      text={step.explanation}
                      lang={explainLanguage}
                      onHoverToken={setHoveredVariable}
                    />
                  </p>
                </div>

                <div className="px-4 sm:px-5 py-3.5 space-y-1">
                  <span className="text-xs font-semibold text-[var(--text-success)] block">
                    {explainLanguage === 'bn' ? 'কেন দরকার (Why This Matters)' : 'Why Logic Needs It'}
                  </span>
                  <p className="text-[var(--text-primary)] m-0">
                    <FormattedText
                      text={step.why}
                      lang={explainLanguage}
                      onHoverToken={setHoveredVariable}
                    />
                  </p>
                </div>

                <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-[var(--text-muted)]">
                      {explainLanguage === 'bn' ? 'পরিবর্তন (Changes):' : 'Changes:'}
                    </span>
                    {step.changes.length === 0 ? (
                      <span className="font-mono text-[var(--text-muted)]">
                        {explainLanguage === 'bn' ? 'কোনো মান বদলায়নি' : 'No state mutation'}
                      </span>
                    ) : (
                      step.changes.map((c, idx) => (
                        <span
                          key={idx}
                          onMouseEnter={() => setHoveredVariable(c.name)}
                          onMouseLeave={() => setHoveredVariable(null)}
                          className="inline-flex items-center gap-1 font-mono text-[var(--text-primary)] cursor-pointer"
                        >
                          <strong>{c.name}:</strong>
                          <span className="opacity-70">
                            {c.from === null ? '∅' : String(c.from)}
                          </span>
                          <ArrowRight className="w-3 h-3 text-[var(--text-accent)]" />
                          <span className="text-[var(--text-success)] font-bold">
                            {String(c.to)}
                          </span>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--text-muted)]">
                      {explainLanguage === 'bn' ? 'লাইনে যান:' : 'Jump to line:'}
                    </span>
                    {trace.lineNotes.map((ln) => (
                      <button
                        key={ln.line}
                        type="button"
                        onClick={() => jumpToLine(ln.line)}
                        className={`w-6 h-6 rounded-md font-mono text-xs transition-colors cursor-pointer ${
                          step.activeLine === ln.line
                            ? 'bg-[#A3C1FF] text-[#070A1A] font-bold'
                            : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                        title={ln.text}
                      >
                        {ln.line}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="px-4 sm:px-5 py-3.5 text-xs text-[#FF6B7D]">
                <FormattedText
                  text={trace.errorDetails?.message || trace.verdict.message}
                  lang={explainLanguage}
                />
              </div>
            )}
          </div>
        )}

        {activeDeckTab === 'output' && (
          <div className="divide-y divide-[var(--border-subtle)]" data-testid="output-terminal-panel">
            <div className="px-4 sm:px-5 py-3 flex items-center justify-between">
              <div
                className={`flex items-center gap-2 font-medium text-xs sm:text-sm ${
                  trace.isValidLogic ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]'
                }`}
              >
                {trace.isValidLogic ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                )}
                <span lang={explainLanguage}>{trace.verdict.message}</span>
              </div>
              <span className="font-mono text-xs uppercase text-[var(--text-muted)]">
                {trace.verdict.status}
              </span>
            </div>

            <div className="px-4 sm:px-5 py-3.5 bg-[#070A1A] font-mono text-sm text-[#EEF3FF]">
              <div className="text-[11px] text-[#5B78B8] mb-1">stdout &gt;</div>
              <pre
                className={`m-0 whitespace-pre-wrap break-words font-semibold ${
                  trace.isValidLogic ? 'text-[#4ADE9B]' : 'text-[#FF6B7D]'
                }`}
              >
                {trace.finalOutput}
              </pre>
            </div>

            <div className="px-4 sm:px-5 py-3.5 space-y-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                {explainLanguage === 'bn'
                  ? 'কেন এই আউটপুট এলো (Output Explanation)'
                  : 'Why This Output Was Produced'}
              </div>
              <p className="text-[var(--text-primary)] m-0">
                <FormattedText
                  text={trace.outputExplanation}
                  lang={explainLanguage}
                  onHoverToken={setHoveredVariable}
                />
              </p>
            </div>
          </div>
        )}

        {activeDeckTab === 'summary' && (
          <div className="divide-y divide-[var(--border-subtle)]" data-testid="logic-summary-panel">
            <div className="px-4 sm:px-5 py-3.5 space-y-2">
              <div className="text-xs font-semibold text-[var(--text-accent)]">
                {explainLanguage === 'bn' ? 'মূল লক্ষ্য (Goal)' : 'Goal'}
              </div>
              <p className="text-[var(--text-primary)] font-medium m-0">
                <FormattedText text={trace.logicSummary.goal} lang={explainLanguage} />
              </p>
              <div className="text-xs font-semibold text-[var(--text-accent)] pt-1">
                {explainLanguage === 'bn' ? 'মূল ধারণা ও বাস্তব গল্প' : 'Core Idea & Real-World Story'}
              </div>
              <p className="text-[var(--text-primary)] m-0">
                <FormattedText text={trace.logicSummary.idea} lang={explainLanguage} />
              </p>
            </div>

            <div className="px-4 sm:px-5 py-3.5 space-y-2">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                {explainLanguage === 'bn' ? 'মূল ধাপসমূহ (Key Points)' : 'Key Points'}
              </div>
              <ul className="space-y-1.5 list-disc list-inside text-xs sm:text-sm text-[var(--text-primary)] m-0">
                {trace.logicSummary.keyPoints.map((pt, i) => (
                  <li key={i}>
                    <FormattedText text={pt} lang={explainLanguage} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-4 sm:px-5 py-3.5 space-y-2">
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="inline-flex items-center gap-1 text-[var(--text-success)]">
                  <Clock className="w-3.5 h-3.5" />
                  Time: {trace.logicSummary.complexity.time}
                </span>
                <span className="inline-flex items-center gap-1 text-[var(--text-accent)]">
                  <Cpu className="w-3.5 h-3.5" />
                  Space: {trace.logicSummary.complexity.space}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] m-0">
                <FormattedText text={trace.logicSummary.complexity.note} lang={explainLanguage} />
              </p>
              {trace.logicSummary.commonMistakes[0] && (
                <div className="pt-1">
                  <span className="text-xs font-semibold text-[var(--text-danger)]">
                    {explainLanguage === 'bn' ? 'সাধারণ ভুল (Common Mistake): ' : 'Common Mistake: '}
                  </span>
                  <span className="text-xs text-[var(--text-primary)]">
                    <FormattedText
                      text={trace.logicSummary.commonMistakes[0]}
                      lang={explainLanguage}
                    />
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
