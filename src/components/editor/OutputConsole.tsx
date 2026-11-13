import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eraser } from 'lucide-react';
import { ExecutionDiagnostic } from '../../../shared/types';
import { useLabStore } from '../../store/useLabStore';

interface OutputConsoleProps {
  getEditorCode?: () => string;
  liveDiagnostics?: ExecutionDiagnostic[];
  onJumpToDiagnostic?: (diagnostic: ExecutionDiagnostic) => void;
}

export const OutputConsole: React.FC<OutputConsoleProps> = ({
  liveDiagnostics = [],
  onJumpToDiagnostic,
}) => {
  const {
    fileName,
    explainLanguage,
    consoleOpen,
    isFastRunning,
    isTracing,
    executionMode,
    hasExecuted,
    fastRunResult,
    terminalHistory,
    currentPrompt,
    currentInputValue,
    terminalExecState,
    activeSessionId,
    trace,
    apiError,
    diagnostics,
    executionStatus,
    setCurrentInputValue,
    submitTerminalInput,
    toggleConsoleOpen,
    clearConsoleOutput,
  } = useLabStore();

  const [activeTab, setActiveTab] = useState<'output' | 'problems'>('output');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy =
    isTracing ||
    isFastRunning ||
    terminalExecState === 'COMPILING' ||
    terminalExecState === 'RUNNING';
  const isWaitingInput = terminalExecState === 'WAITING_FOR_INPUT';

  const displayDiagnostics = diagnostics.length > 0 ? diagnostics : liveDiagnostics;
  const errorCount = displayDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = displayDiagnostics.filter((d) => d.severity === 'warning').length;

  const hasTerminalContent =
    terminalHistory.length > 0 ||
    currentPrompt.length > 0 ||
    terminalExecState !== 'IDLE' ||
    Boolean(fastRunResult);

  const hasAnyOutput =
    executionMode === 'explain' ? hasExecuted : hasTerminalContent;

  const isFastError =
    executionMode === 'fast' &&
    (terminalExecState === 'ERROR' || (fastRunResult !== null && !fastRunResult.success));

  const isCompileError =
    executionMode === 'fast'
      ? isFastError || executionStatus === 'error'
      : hasExecuted &&
        (executionStatus === 'error' ||
          Boolean(apiError) ||
          trace.verdict.status === 'compile_error');

  const hasWarnings =
    hasAnyOutput &&
    !isCompileError &&
    (executionStatus === 'warning' || diagnostics.some((d) => d.severity === 'warning'));

  const stdoutText = trace.finalOutput;
  const showTraceExplanation =
    executionMode === 'explain' && hasExecuted && Boolean(trace.outputExplanation);

  // Auto-focus inline input whenever waiting for user input
  useEffect(() => {
    if (consoleOpen && activeTab === 'output' && isWaitingInput) {
      requestAnimationFrame(() => {
        inlineInputRef.current?.focus();
      });
    }
  }, [consoleOpen, activeTab, isWaitingInput, currentPrompt]);

  // Auto-scroll terminal to bottom whenever new output or a prompt appears
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [terminalHistory.length, currentPrompt, terminalExecState, isBusy]);

  const handleTerminalAreaClick = () => {
    if (isWaitingInput && activeTab === 'output') {
      inlineInputRef.current?.focus();
    }
  };

  const canClear =
    hasTerminalContent || Boolean(activeSessionId) || Boolean(fastRunResult);

  return (
    <div
      className="border-t border-[var(--border-subtle)] bg-[#060916]/95 backdrop-blur-md text-slate-200 transition-all"
      data-testid="output-console-panel"
    >
      {/* Consolidated Output & Problems Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2 border-b border-[var(--border-subtle)] bg-[#090E21]/90">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('output');
              if (!consoleOpen) toggleConsoleOpen();
            }}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'output'
                ? 'bg-[var(--code-pill-bg)] text-[var(--text-accent)] border border-[var(--border-active)]/35'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            data-testid="tab-program-output"
          >
            {explainLanguage === 'bn' ? 'প্রোগ্রাম আউটপুট' : 'Program Output'}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('problems');
              if (!consoleOpen) toggleConsoleOpen();
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'problems'
                ? 'bg-[var(--code-pill-bg)] text-[var(--text-accent)] border border-[var(--border-active)]/35'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            data-testid="tab-problems"
          >
            <span>{explainLanguage === 'bn' ? 'সমস্যা ও সতর্কতা' : 'Problems'}</span>
            {(errorCount > 0 || warningCount > 0) && (
              <span
                className={`px-1.5 rounded-full text-[10px] font-mono font-bold ${
                  errorCount > 0
                    ? 'bg-[#EF4444]/20 text-[var(--text-danger)]'
                    : 'bg-[#F59E0B]/20 text-[var(--text-warning)]'
                }`}
              >
                {errorCount + warningCount}
              </span>
            )}
          </button>

          {isWaitingInput && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              {explainLanguage === 'bn' ? 'ইনপুট অপেক্ষমাণ' : 'Waiting for input'}
            </span>
          )}

          {hasAnyOutput && !isBusy && !isWaitingInput && (
            <span
              className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                isCompileError
                  ? 'bg-[#EF4444]/15 text-[var(--text-danger)]'
                  : hasWarnings
                  ? 'bg-[#F59E0B]/15 text-[var(--text-warning)]'
                  : 'bg-[#10B981]/15 text-[var(--text-success)]'
              }`}
              data-testid="console-status-badge"
            >
              {isCompileError
                ? explainLanguage === 'bn'
                  ? 'ত্রুটি'
                  : 'Error'
                : hasWarnings
                ? explainLanguage === 'bn'
                  ? 'সতর্কতা'
                  : 'Warning'
                : explainLanguage === 'bn'
                ? 'সফল'
                : 'Success'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {hasExecuted && !isCompileError && !isBusy && trace.steps.length > 0 && (
            <span
              className="text-xs font-mono text-[var(--text-secondary)]"
              data-testid="total-steps-badge"
            >
              {explainLanguage === 'bn'
                ? `মোট ধাপ: ${trace.steps.length}`
                : `Total steps: ${trace.steps.length}`}
            </span>
          )}

          {canClear && (
            <button
              type="button"
              onClick={clearConsoleOutput}
              data-testid="terminal-clear-btn"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
              title={explainLanguage === 'bn' ? 'মুছুন' : 'Clear'}
              aria-label={explainLanguage === 'bn' ? 'মুছুন' : 'Clear'}
            >
              <Eraser className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {explainLanguage === 'bn' ? 'মুছুন' : 'Clear'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleConsoleOpen}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
            data-testid="console-toggle-btn"
            aria-expanded={consoleOpen}
            aria-label={consoleOpen ? 'Collapse console' : 'Expand console'}
          >
            {consoleOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Unified Single-Box Terminal Body */}
      {consoleOpen && (
        <div className="divide-y divide-[var(--border-subtle)]" data-testid="real-output-section">
          <div
            ref={scrollContainerRef}
            onClick={handleTerminalAreaClick}
            className={`w-full bg-[#040711]/95 p-3 sm:p-4 font-mono text-xs sm:text-sm space-y-1 max-h-64 min-h-[150px] overflow-y-auto ${
              isWaitingInput ? 'cursor-text' : ''
            }`}
            data-testid="terminal-output-view"
          >
            {activeTab === 'problems' ? (
              displayDiagnostics.length === 0 ? (
                <div className="py-2 text-slate-500 select-none text-xs">
                  //{' '}
                  {explainLanguage === 'bn'
                    ? 'কোডে কোনো ত্রুটি বা সতর্কতা পাওয়া যায়নি।'
                    : 'No problems detected in the file.'}
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {displayDiagnostics.map((d, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onJumpToDiagnostic?.(d)}
                      className="w-full text-left py-2 px-1.5 hover:bg-slate-800/50 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span
                          className={`font-bold uppercase text-[10px] ${
                            d.severity === 'error'
                              ? 'text-[var(--text-danger)]'
                              : d.severity === 'warning'
                              ? 'text-[var(--text-warning)]'
                              : 'text-[var(--text-accent)]'
                          }`}
                        >
                          {d.severity}
                        </span>
                        <span className="text-[var(--text-muted)] group-hover:text-[var(--text-accent)]">
                          {fileName}:{d.line}
                          {d.column ? `:${d.column}` : ''}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-primary)] mt-0.5 font-mono whitespace-pre-wrap leading-relaxed m-0">
                        {d.message}
                      </p>
                    </button>
                  ))}
                </div>
              )
            ) : executionMode === 'explain' ? (
              isTracing ? (
                <div className="flex items-center gap-2 text-cyan-300 text-xs">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span>
                    {explainLanguage === 'bn'
                      ? 'অ্যানিমেশন ও ব্যাখ্যা লোড হচ্ছে...'
                      : 'Loading animation & explanation...'}
                  </span>
                </div>
              ) : !hasExecuted ? (
                <div className="text-slate-500 select-none text-xs" data-testid="output-zero-state">
                  //{' '}
                  {explainLanguage === 'bn'
                    ? 'কোড রান করলে আউটপুট এখানে দেখাবে'
                    : 'Program output will appear here'}
                </div>
              ) : isCompileError ? (
                <div className="space-y-2" role="alert" data-testid="output-error-state">
                  {trace.errorDetails && (
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="px-2 py-0.5 rounded bg-[#EF4444]/15 text-[var(--text-danger)] font-bold">
                        {trace.errorDetails.errorType || 'ERROR'}
                      </span>
                      <span className="text-[var(--text-secondary)] font-semibold">
                        {explainLanguage === 'bn'
                          ? `লাইন ${trace.errorDetails.lineNumber || trace.errorDetails.line || 1}`
                          : `Line ${trace.errorDetails.lineNumber || trace.errorDetails.line || 1}`}
                      </span>
                      {trace.errorDetails.lineCode && (
                        <code className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-warning)] break-all">
                          {trace.errorDetails.lineCode}
                        </code>
                      )}
                    </div>
                  )}
                  <p className="font-mono text-xs sm:text-sm text-[var(--text-danger)] font-medium whitespace-pre-wrap leading-relaxed m-0">
                    {apiError
                      ? explainLanguage === 'bn'
                        ? apiError.message_bn
                        : apiError.message_en
                      : trace.errorDetails?.messageBn ||
                        trace.errorDetails?.message ||
                        trace.verdict.message}
                  </p>
                  {trace.errorDetails?.solutionBn && (
                    <div
                      lang={explainLanguage}
                      className="pt-1.5 border-t border-[var(--border-subtle)] text-xs text-[var(--text-success)] font-medium leading-relaxed font-sans"
                    >
                      <strong className="mr-1.5">
                        {explainLanguage === 'bn' ? 'সমাধান:' : 'Solution:'}
                      </strong>
                      <span>{trace.errorDetails.solutionBn}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2" data-testid="output-success-state">
                  {stdoutText ? (
                    <pre className="m-0 whitespace-pre-wrap break-words text-xs sm:text-sm font-semibold text-emerald-300 leading-relaxed font-mono">
                      {stdoutText}
                    </pre>
                  ) : (
                    <div className="text-slate-500 italic text-xs">
                      {explainLanguage === 'bn'
                        ? '(প্রোগ্রামটি কোনো আউটপুট প্রিন্ট করেনি)'
                        : '(Program produced no stdout output)'}
                    </div>
                  )}
                  {showTraceExplanation && (
                    <p
                      lang={explainLanguage}
                      className="text-xs text-[var(--text-secondary)] leading-relaxed m-0 pt-2 border-t border-[var(--border-subtle)] font-sans"
                    >
                      {trace.outputExplanation}
                    </p>
                  )}
                </div>
              )
            ) : terminalExecState === 'IDLE' && terminalHistory.length === 0 ? (
              <div className="text-slate-500 select-none text-xs" data-testid="output-zero-state">
                //{' '}
                {explainLanguage === 'bn'
                  ? 'কোড রান করলে আউটপুট এখানে দেখাবে'
                  : 'Program output will appear here'}
              </div>
            ) : (
              <div
                className="space-y-0.5"
                data-testid={
                  terminalExecState === 'ERROR' ? 'output-error-state' : 'output-success-state'
                }
              >
                {hasWarnings && (
                  <div
                    className="pb-2 mb-2 border-b border-[var(--border-subtle)] space-y-1"
                    role="status"
                    data-testid="output-warning-state"
                  >
                    {diagnostics
                      .filter((d) => d.severity === 'warning')
                      .map((diag, i) => (
                        <div
                          key={i}
                          className="text-xs font-mono text-[var(--text-warning)]/90 flex items-start gap-2"
                        >
                          <span className="text-[var(--text-muted)] font-semibold shrink-0">
                            Ln {diag.line}:
                          </span>
                          <span>{diag.message}</span>
                        </div>
                      ))}
                  </div>
                )}

                {terminalHistory.map((line) => {
                  if (line.type === 'prompt-answered') {
                    return (
                      <div
                        key={line.id}
                        className="whitespace-pre-wrap break-words leading-relaxed"
                      >
                        {line.prompt && (
                          <span className="text-emerald-300 font-semibold">{line.prompt}</span>
                        )}
                        <span className="text-cyan-300 font-semibold">{line.answer}</span>
                      </div>
                    );
                  }
                  if (line.type === 'error') {
                    return (
                      <div
                        key={line.id}
                        className="whitespace-pre-wrap break-words text-rose-400 leading-relaxed"
                      >
                        {line.text || '\u00A0'}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={line.id}
                      className="whitespace-pre-wrap break-words text-emerald-300 font-semibold leading-relaxed"
                    >
                      {line.text || '\u00A0'}
                    </div>
                  );
                })}

                {isWaitingInput && (
                  <div className="flex items-center leading-relaxed">
                    {currentPrompt && (
                      <span className="whitespace-pre text-emerald-300 font-semibold shrink-0">
                        {currentPrompt}
                      </span>
                    )}
                    <input
                      ref={inlineInputRef}
                      type="text"
                      value={currentInputValue}
                      onChange={(e) => setCurrentInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void submitTerminalInput();
                        }
                      }}
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus
                      aria-label="Terminal input"
                      data-testid="terminal-inline-input"
                      className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-cyan-300 font-semibold font-mono p-0 m-0 caret-cyan-400"
                    />
                  </div>
                )}

                {!isWaitingInput && isBusy && (
                  <div className="flex items-center gap-2 text-cyan-300 text-xs pt-1">
                    {currentPrompt && (
                      <span className="whitespace-pre text-emerald-300 font-semibold">
                        {currentPrompt}
                      </span>
                    )}
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span>
                      {terminalExecState === 'COMPILING'
                        ? explainLanguage === 'bn'
                          ? 'কম্পাইল হচ্ছে...'
                          : 'Compiling...'
                        : explainLanguage === 'bn'
                        ? 'কোড রান হচ্ছে...'
                        : 'Running...'}
                    </span>
                  </div>
                )}

                {terminalExecState === 'COMPLETED' &&
                  terminalHistory.length === 0 &&
                  !currentPrompt && (
                    <div className="text-slate-500 italic text-xs">
                      {explainLanguage === 'bn'
                        ? '(প্রোগ্রামটি কোনো আউটপুট প্রিন্ট করেনি)'
                        : '(Program produced no stdout output)'}
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Minimal Hallmark Footer */}
          <div className="flex items-center justify-end px-3 sm:px-5 py-1.5 bg-[#050814] text-[11px] font-mono">
            <span className="text-slate-400/90 tracking-tight" data-testid="hallmark-badge">
              Powered by Focentia Runtime • Crafted by Md. Fahim Hossain
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
