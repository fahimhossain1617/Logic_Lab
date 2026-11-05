import React, { useEffect, useRef, useState } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { useLabStore } from '../../store/useLabStore';
import { SupportedLanguage } from '../../../shared/types';
import { Play } from 'lucide-react';

export const CodeEditorPanel: React.FC = () => {
  const {
    code,
    language,
    theme,
    explainLanguage,
    userFiles,
    activeFileId,
    folderName,
    fileName,
    hasExecuted,
    isTracing,
    trace,
    apiError,
    currentStepIndex,
    editorFontSize,
    cursorPosition,
    setCode,
    setLanguage,
    setFolderName,
    setFileName,
    createNewUserFile,
    selectUserFile,
    deleteUserFile,
    setEditorFontSize,
    resetSnippetToNew,
    saveCurrentSnippet,
    createShareLink,
    runVisualize,
    jumpToLine,
    setHoveredLine,
    setCursorPosition,
  } = useLabStore();

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);
  const [monacoReady, setMonacoReady] = useState(false);

  const currentStep = trace.steps[currentStepIndex] || trace.steps[0];
  const activeLine = hasExecuted && currentStep ? currentStep.activeLine : 0;
  const hasFaultOnLine = Boolean(currentStep?.fault);
  const isCompileError =
    hasExecuted && (Boolean(apiError) || trace.verdict.status === 'compile_error');

  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme('LogicLab-Midnight', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'E4ECFF', background: '0A1027' },
        { token: 'keyword', foreground: 'C4A7FF' },
        { token: 'keyword.control', foreground: 'C4A7FF' },
        { token: 'storage', foreground: 'FF8FB1' },
        { token: 'type', foreground: '6FE3D6' },
        { token: 'entity.name.function', foreground: '7FD1FF' },
        { token: 'string', foreground: '8FF0B4' },
        { token: 'number', foreground: 'FFC46B' },
        { token: 'constant', foreground: 'FFA07A' },
        { token: 'variable.parameter', foreground: 'FFD9A0', fontStyle: 'italic' },
        { token: 'delimiter', foreground: '8FA6D9' },
        { token: 'comment', foreground: '5B78B8', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#0A1027',
        'editor.foreground': '#E4ECFF',
        'editor.selectionBackground': '#2A4378CC',
        'editor.lineHighlightBackground': '#121C42',
        'editorCursor.foreground': '#A3C1FF',
        'editorLineNumber.foreground': '#3F5A94',
        'editorLineNumber.activeForeground': '#A3C1FF',
        'editorIndentGuide.background1': '#A3C1FF1F',
        'editorGutter.background': '#070A1A',
      },
    });

    monaco.editor.defineTheme('LogicLab-Daybreak', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '0D1330', background: 'F3F7FF' },
        { token: 'keyword', foreground: '7B4FD6' },
        { token: 'storage', foreground: 'D2406F' },
        { token: 'entity.name.function', foreground: '1F78C8' },
        { token: 'string', foreground: '1E8A55' },
        { token: 'number', foreground: 'C27800' },
        { token: 'comment', foreground: '6B84B8', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#F3F7FF',
        'editor.foreground': '#0D1330',
        'editor.selectionBackground': '#C6D8FF',
        'editor.lineHighlightBackground': '#E4EEFF',
        'editorCursor.foreground': '#233B6E',
        'editorLineNumber.foreground': '#6B84B8',
        'editorLineNumber.activeForeground': '#0D1330',
        'editorGutter.background': '#E8F0FF',
      },
    });
  };

  const handleOnMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setMonacoReady(true);

    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      });
    });

    editor.onMouseDown((e) => {
      const line = e.target.position?.lineNumber;
      if (line && hasExecuted) {
        jumpToLine(line);
      }
    });

    editor.onMouseMove((e) => {
      const line = e.target.position?.lineNumber || null;
      setHoveredLine(line);
    });
  };

  // Highlight active execution line or compilation error line
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !monacoReady) return;

    const errLine = trace.errorDetails?.lineNumber || trace.errorDetails?.line || 0;
    const targetLine = isCompileError ? errLine : activeLine;

    if (!hasExecuted || targetLine <= 0) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      return;
    }

    const showFaultStyle = isCompileError || hasFaultOnLine;

    const newDecorations = [
      {
        range: new monaco.Range(targetLine, 1, targetLine, 1),
        options: {
          isWholeLine: true,
          className: showFaultStyle ? 'monaco-fault-line-bg' : 'monaco-active-line-bg',
          glyphMarginClassName: showFaultStyle ? 'monaco-fault-glyph' : 'monaco-active-glyph',
        },
      },
    ];

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [activeLine, hasFaultOnLine, hasExecuted, isCompileError, trace.errorDetails, monacoReady, code]);

  // Switch Monaco theme dynamically
  useEffect(() => {
    if (monacoRef.current && monacoReady) {
      monacoRef.current.editor.setTheme(
        theme === 'dark' ? 'LogicLab-Midnight' : 'LogicLab-Daybreak'
      );
    }
  }, [theme, monacoReady]);

  const codeLines = code.split('\n');

  return (
    <section
      className="ll-panel rounded-2xl flex flex-col overflow-hidden"
      aria-label={explainLanguage === 'bn' ? 'কোড এডিটর এবং আউটপুট' : 'Code Editor and Output'}
    >
      {/* 1. User File Tabs Row */}
      <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-2.5 bg-[var(--bg-gutter)] border-b border-[var(--border-subtle)] gap-2.5">
        <div
          className="flex items-center gap-2 overflow-x-auto max-w-full"
          role="tablist"
          aria-label={explainLanguage === 'bn' ? 'আপনার ফাইলসমূহ' : 'Your Files'}
        >
          {userFiles.map((f) => {
            const isSelected = f.id === activeFileId;
            return (
              <div
                key={f.id}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-mono transition-colors border ${
                  isSelected
                    ? 'bg-[var(--bg-panel)] border-[#A3C1FF] text-[var(--text-primary)] font-semibold'
                    : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => selectUserFile(f.id)}
                  className="cursor-pointer truncate max-w-[180px]"
                >
                  {f.folderName ? `${f.folderName}/` : ''}
                  {f.fileName}
                </button>
                {userFiles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteUserFile(f.id)}
                    className="text-[var(--text-muted)] hover:text-[#FF6B7D] cursor-pointer ml-1 px-1 rounded hover:bg-white/10"
                    aria-label={`Close ${f.fileName}`}
                    title="Close file"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={createNewUserFile}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#A3C1FF] hover:bg-[#A3C1FF]/15 transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5"
            data-testid="new-user-file-btn"
          >
            <span>+</span>
            <span>{explainLanguage === 'bn' ? 'নতুন ফাইল' : 'New File'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {code.trim() && (
            <button
              type="button"
              onClick={saveCurrentSnippet}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer whitespace-nowrap"
              data-testid="save-snippet-btn"
            >
              {explainLanguage === 'bn' ? 'সংরক্ষণ' : 'Save'}
            </button>
          )}
          {hasExecuted && !isCompileError && trace.steps.length > 0 && (
            <button
              type="button"
              onClick={() => void createShareLink()}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-accent)] hover:bg-[#A3C1FF]/15 transition-colors cursor-pointer whitespace-nowrap"
              data-testid="share-run-btn"
            >
              {explainLanguage === 'bn' ? 'শেয়ার লিংক' : 'Share'}
            </button>
          )}
          <button
            type="button"
            onClick={resetSnippetToNew}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer whitespace-nowrap"
            data-testid="clear-editor-btn"
          >
            {explainLanguage === 'bn' ? 'মুছে ফেলুন' : 'Clear'}
          </button>
        </div>
      </div>


      {/* 2. Inline Folder & File Name Header + Language & Run Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 px-4 sm:px-6 py-3 bg-[var(--bg-gutter)]/65 border-b border-[var(--border-subtle)]">
        {/* Inline Folder / File Inputs */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span
            lang={explainLanguage}
            className="text-xs font-medium text-[var(--text-secondary)] shrink-0"
          >
            {explainLanguage === 'bn' ? 'ফোল্ডার ও ফাইল:' : 'Folder & File:'}
          </span>

          <div className="inline-flex items-center rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] focus-within:border-[#A3C1FF] px-3 py-1.5 font-mono text-xs gap-1.5">
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="folder-name"
              aria-label={explainLanguage === 'bn' ? 'ফোল্ডারের নাম' : 'Folder name'}
              data-testid="folder-name-input"
              className="w-28 sm:w-36 bg-transparent text-[var(--text-secondary)] focus:text-[var(--text-primary)] focus:outline-none"
            />
            <span className="px-1 text-[var(--text-muted)] select-none">/</span>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="main.js"
              aria-label={explainLanguage === 'bn' ? 'ফাইলের নাম' : 'File name'}
              data-testid="file-name-input"
              className="w-32 sm:w-40 bg-transparent text-[var(--text-primary)] font-semibold focus:outline-none"
            />
          </div>
        </div>

        {/* Language Select, Font Size, and Run CTA */}
        <div className="flex items-center gap-2.5 shrink-0">
          <label className="sr-only" htmlFor="editor-language-select">
            Programming Language
          </label>
          <select
            id="editor-language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
            className="px-3.5 py-2 rounded-xl bg-[var(--bg-select)] border border-[var(--border-subtle)] text-xs font-mono font-semibold text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[#A3C1FF]"
          >
            <option value="javascript" className="bg-[var(--bg-select)] text-[var(--text-primary)]">
              JavaScript (.js)
            </option>
            <option value="python" className="bg-[var(--bg-select)] text-[var(--text-primary)]">
              Python (.py)
            </option>
            <option value="cpp" className="bg-[var(--bg-select)] text-[var(--text-primary)]">
              C++ (.cpp)
            </option>
            <option value="java" className="bg-[var(--bg-select)] text-[var(--text-primary)]">
              Java (.java)
            </option>
          </select>

          <div className="hidden sm:flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-1 py-0.5">
            <button
              type="button"
              onClick={() => setEditorFontSize(-1, true)}
              className="px-2 py-1 text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer rounded-lg hover:bg-[var(--border-subtle)]"
              aria-label="Decrease editor font size (A-)"
            >
              A-
            </button>
            <span className="text-[11px] font-mono text-[var(--text-muted)] px-1.5 font-semibold">
              {editorFontSize}
            </span>
            <button
              type="button"
              onClick={() => setEditorFontSize(1, true)}
              className="px-2 py-1 text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer rounded-lg hover:bg-[var(--border-subtle)]"
              aria-label="Increase editor font size (A+)"
            >
              A+
            </button>
          </div>

          <button
            type="button"
            onClick={() => void runVisualize()}
            disabled={isTracing}
            className="ll-btn-primary px-4 sm:px-5 py-2 rounded-xl font-semibold text-xs inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
            data-testid="visualize-primary-btn"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span lang={explainLanguage}>
              {isTracing
                ? explainLanguage === 'bn'
                  ? 'রান হচ্ছে...'
                  : 'Running...'
                : explainLanguage === 'bn'
                ? 'রান ও বিশ্লেষণ করুন'
                : 'Run & Analyze'}
            </span>
          </button>
        </div>
      </div>

      {/* 3. Monaco Code Editor Surface */}
      <div className="relative h-[320px] sm:h-[360px] bg-[#0A1027] dark:bg-[#0A1027]">
        {/* Zero-State subtle watermark placeholder when editor is completely empty */}
        {!code && (
          <div
            className="pointer-events-none absolute top-4 left-20 z-10 font-mono text-xs text-[#5B78B8] select-none"
            lang={explainLanguage}
          >
            {explainLanguage === 'bn'
              ? `// ${folderName}/${fileName} ফাইলে আপনার নিজের কোড লিখুন বা পেস্ট করুন...`
              : `// Write or paste your code in ${folderName}/${fileName}...`}
          </div>
        )}

        <Editor
          height="100%"
          language={language === 'cpp' ? 'cpp' : language}
          theme={theme === 'dark' ? 'LogicLab-Midnight' : 'LogicLab-Daybreak'}
          value={code}
          beforeMount={handleBeforeMount}
          onMount={handleOnMount}
          onChange={(val) => setCode(val ?? '')}
          options={{
            fontSize: editorFontSize,
            fontFamily: '"JetBrains Mono", monospace',
            fontLigatures: true,
            minimap: { enabled: false },
            glyphMargin: true,
            lineNumbers: 'on',
            lineNumbersMinChars: 4,
            lineDecorationsWidth: 16,
            lineHeight: Math.max(22, Math.round(editorFontSize * 1.55)),
            roundedSelection: true,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorSmoothCaretAnimation: 'on',
            bracketPairColorization: { enabled: true },
            guides: { indentation: true, bracketPairs: true },
            padding: { top: 16, bottom: 16 },
            automaticLayout: true,
          }}
          loading={
            <div className="p-4 sm:p-5 font-mono text-xs space-y-1.5 bg-[#0A1027] text-[#E4ECFF] h-full overflow-auto">
              {codeLines.map((lineText, idx) => (
                <div key={idx + 1} className="flex items-center gap-4 px-2 py-0.5">
                  <span className="w-8 text-right text-[#5B78B8] select-none font-semibold">{idx + 1}</span>
                  <span className="whitespace-pre pl-2">{lineText}</span>
                </div>
              ))}
            </div>
          }
        />
      </div>

      {/* 4. Editor Status Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2 bg-[var(--bg-gutter)] border-t border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
        <div className="flex items-center gap-4 sm:gap-6">
          <span className="font-semibold text-[var(--text-primary)]">
            {folderName}/{fileName}
          </span>
          <span>
            Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>{code ? `${codeLines.length} lines` : '0 lines'}</span>
          <span className="uppercase text-[#A3C1FF] font-semibold">{language}</span>
        </div>
      </div>

      {/* 5. Horizontal Rule + Real Output Section (Single Surface, No Double-Boxing) */}
      <hr className="border-[var(--border-subtle)] m-0" />

      <div
        className="px-4 sm:px-6 py-5 bg-[var(--bg-panel)] space-y-4"
        data-testid="real-output-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <h2
              lang={explainLanguage}
              className="text-sm font-bold tracking-tight text-[var(--text-primary)] m-0"
            >
              {explainLanguage === 'bn' ? 'প্রোগ্রাম আউটপুট (Output)' : 'Program Output'}
            </h2>
            {hasExecuted && (
              <span
                className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-md ${
                  isCompileError
                    ? 'bg-[#FF6B7D]/15 text-[#FF6B7D] border border-[#FF6B7D]/40'
                    : 'bg-[#4ADE9B]/15 text-[#4ADE9B] border border-[#4ADE9B]/40'
                }`}
              >
                {isCompileError
                  ? explainLanguage === 'bn'
                    ? 'ত্রুটি শনাক্ত হয়েছে (Error)'
                    : 'Error Detected'
                  : explainLanguage === 'bn'
                  ? 'সফলভাবে রান হয়েছে'
                  : 'Executed Successfully'}
              </span>
            )}
          </div>

          {hasExecuted && !isCompileError && (
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {explainLanguage === 'bn'
                ? `মোট এক্সিকিউশন ধাপ: ${trace.steps.length}`
                : `Total execution steps: ${trace.steps.length}`}
            </span>
          )}
        </div>

        {/* Output Content */}
        {!hasExecuted ? (
          <p
            lang={explainLanguage}
            className="pt-1 text-sm text-[var(--text-secondary)] leading-relaxed m-0"
            data-testid="output-zero-state"
          >
            {explainLanguage === 'bn'
              ? 'উপরে আপনার কোড লিখুন এবং "রান ও বিশ্লেষণ করুন" বাটনে ক্লিক করুন। সঠিক কোড রান করলে এখানে প্রোগ্রামের আসল আউটপুট এবং নিচে লাইন বাই লাইন ব্যাখ্যা ও ৩ডি অ্যানিমেশন দেখা যাবে।'
              : 'Write your code above and click "Run & Analyze". When valid code runs, its real output will appear here along with the line-by-line explanation and 3D animation below.'}
          </p>
        ) : isCompileError ? (
          <div className="p-4 sm:p-5 rounded-2xl bg-[#FF6B7D]/10 border border-[#FF6B7D]/35 space-y-3" role="alert" data-testid="output-error-state">
            {trace.errorDetails && (
              <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-[#FF6B7D]/20 border border-[#FF6B7D]/50 text-[#FF6B7D] font-bold">
                  {trace.errorDetails.errorType || 'COMPILATION_ERROR'}
                </span>
                <span className="text-[var(--text-secondary)] font-semibold">
                  {explainLanguage === 'bn'
                    ? `লাইন ${trace.errorDetails.lineNumber || trace.errorDetails.line || 1}`
                    : `Line ${trace.errorDetails.lineNumber || trace.errorDetails.line || 1}`}
                </span>
                {trace.errorDetails.lineCode && (
                  <code className="px-2.5 py-1 rounded-lg bg-[var(--bg-gutter)] text-[#FFC46B] break-all border border-[var(--border-subtle)]">
                    {trace.errorDetails.lineCode}
                  </code>
                )}
              </div>
            )}
            <p className="font-mono text-xs sm:text-sm text-[#FF6B7D] font-semibold whitespace-pre-wrap leading-relaxed m-0">
              {apiError
                ? explainLanguage === 'bn'
                  ? apiError.message_bn
                  : apiError.message_en
                : trace.errorDetails?.messageBn ||
                  trace.errorDetails?.message ||
                  trace.verdict.message}
            </p>
            {trace.errorDetails?.solutionBn && (
              <div lang={explainLanguage} className="p-3 rounded-xl bg-[#4ADE9B]/10 border border-[#4ADE9B]/30 text-xs sm:text-sm text-[#4ADE9B] font-medium leading-relaxed">
                <strong className="mr-2 text-[#4ADE9B]">
                  {explainLanguage === 'bn' ? '💡 সমাধান (Solution):' : '💡 Solution:'}
                </strong>
                <span>{trace.errorDetails.solutionBn}</span>
              </div>
            )}
            <p lang={explainLanguage} className="text-xs text-[var(--text-secondary)] leading-relaxed m-0">
              {explainLanguage === 'bn'
                ? 'কোডে সিনট্যাক্স বা কম্পাইল ত্রুটি থাকায় কোনো আউটপুট বা অ্যানিমেশন তৈরি করা হয়নি। অনুগ্রহ করে ত্রুটি সংশোধন করে আবার রান করুন।'
                : 'No output or animation was generated because the code contains a syntax or compile error. Please fix the code and run again.'}
            </p>
          </div>
        ) : (
          <div className="p-4 sm:p-5 rounded-2xl bg-[#070A1A] border border-[var(--border-subtle)] space-y-2.5" data-testid="output-success-state">
            <pre className="font-mono text-sm sm:text-base font-bold text-[#4ADE9B] whitespace-pre-wrap break-words m-0 leading-relaxed">
              {trace.finalOutput
                ? trace.finalOutput
                : explainLanguage === 'bn'
                ? '(প্রোগ্রামটি কোনো টেক্সট প্রিন্ট করেনি — মেমোরি পরিবর্তন নিচে দেখুন)'
                : '(Program printed no stdout text — inspect memory state changes below)'}
            </pre>
            {trace.outputExplanation && (
              <p lang={explainLanguage} className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed m-0 pt-1 border-t border-white/10">
                {trace.outputExplanation}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
