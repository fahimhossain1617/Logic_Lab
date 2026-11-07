import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { useLabStore } from '../../store/useLabStore';
import { SupportedLanguage, ExecutionDiagnostic } from '../../../shared/types';
import {
  Play,
  Plus,
  Minus,
  Trash2,
  Terminal,
  FileCode,
  AlignLeft,
  AlertCircle,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { registerMonacoLanguageProviders } from './monacoProviders';

export const CodeEditorPanel: React.FC = () => {
  const {
    code,
    language,
    theme,
    explainLanguage,
    userFiles,
    activeFileId,
    fileName,
    hasExecuted,
    isTracing,
    trace,
    apiError,
    diagnostics,
    executionStatus,
    activeBreakpoints,
    currentStepIndex,
    editorFontSize,
    cursorPosition,
    setCode,
    setLanguage,
    setFileName,
    createNewUserFile,
    selectUserFile,
    deleteUserFile,
    setEditorFontSize,
    resetSnippetToNew,
    runVisualize,
    toggleBreakpoint,
    jumpToLine,
    setHoveredLine,
    setCursorPosition,
  } = useLabStore();

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);
  const [monacoReady, setMonacoReady] = useState(false);

  // Resizable panel state
  const [editorHeight, setEditorHeight] = useState(360);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const startHeight = useRef(360);

  // Output vs Problems console tab
  const [activeConsoleTab, setActiveConsoleTab] = useState<'output' | 'problems'>('output');
  const [liveDiagnostics, setLiveDiagnostics] = useState<ExecutionDiagnostic[]>([]);

  const currentStep = trace.steps[currentStepIndex] || trace.steps[0];
  const activeLine = hasExecuted && currentStep ? currentStep.activeLine : 0;
  const hasFaultOnLine = Boolean(currentStep?.fault);
  const isCompileError =
    hasExecuted &&
    (executionStatus === 'error' ||
      Boolean(apiError) ||
      trace.verdict.status === 'compile_error');
  const hasWarnings =
    hasExecuted &&
    !isCompileError &&
    (executionStatus === 'warning' || diagnostics.some((d) => d.severity === 'warning'));

  // Effective diagnostics to show (compiler truth from execution or live diagnostics)
  const displayDiagnostics = diagnostics.length > 0 ? diagnostics : liveDiagnostics;
  const errorCount = displayDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = displayDiagnostics.filter((d) => d.severity === 'warning').length;

  const handleBeforeMount: BeforeMount = (monaco) => {
    // Register custom dark & light themes
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

    // Register professional autocompletion, hover documentation, and document formatters
    registerMonacoLanguageProviders(monaco);
  };

  const handleOnMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    (window as any).__monacoEditor = editor;
    (window as any).__monacoInstance = monaco;
    setMonacoReady(true);

    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      });
    });

    editor.onMouseDown((e) => {
      // Toggle purely cosmetic breakpoint if clicked on gutter glyph margin
      if (
        e.target?.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target?.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        const line = e.target.position?.lineNumber;
        if (line) {
          toggleBreakpoint(line);
          return;
        }
      }

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

  // Real-time debounced compiler diagnostics (350ms)
  useEffect(() => {
    if (!code.trim() || !monacoReady || !monacoRef.current || !editorRef.current) {
      if (monacoRef.current && editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) monacoRef.current.editor.setModelMarkers(model, 'compiler', []);
      }
      setLiveDiagnostics([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, language, fileName }),
        });
        const data = await res.json();
        const incomingDiags: ExecutionDiagnostic[] = data.diagnostics || [];
        setLiveDiagnostics(incomingDiags);

        if (monacoRef.current && editorRef.current) {
          const monaco = monacoRef.current;
          const model = editorRef.current.getModel();
          if (model) {
            const markers = incomingDiags.map((d) => ({
              startLineNumber: d.line,
              startColumn: d.column || 1,
              endLineNumber: d.endLine || d.line,
              endColumn: d.endColumn || (d.column ? d.column + 6 : 100),
              message: d.message,
              severity:
                d.severity === 'error'
                  ? monaco.MarkerSeverity.Error
                  : d.severity === 'warning'
                  ? monaco.MarkerSeverity.Warning
                  : monaco.MarkerSeverity.Info,
            }));
            monaco.editor.setModelMarkers(model, 'compiler', markers);
          }
        }
      } catch {
        // Ignore background analysis failures
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [code, language, fileName, monacoReady]);

  // Highlight active execution line, compilation error line, warnings, and cosmetic breakpoints
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !monacoReady) return;

    const newDecorations: any[] = [];

    // 1. Cosmetic UI breakpoint markers (never injected into code AST)
    for (const bpLine of activeBreakpoints) {
      newDecorations.push({
        range: new monaco.Range(bpLine, 1, bpLine, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: 'monaco-breakpoint-glyph',
          glyphMarginHoverMessage: { value: `Breakpoint on line ${bpLine}` },
        },
      });
    }

    // 2. Active execution line or compilation error line
    const errLine = trace.errorDetails?.lineNumber || trace.errorDetails?.line || 0;
    const targetLine = isCompileError ? errLine : activeLine;

    if (hasExecuted && targetLine > 0) {
      const showFaultStyle = isCompileError || hasFaultOnLine;
      newDecorations.push({
        range: new monaco.Range(targetLine, 1, targetLine, 1),
        options: {
          isWholeLine: true,
          className: showFaultStyle ? 'monaco-fault-line-bg' : 'monaco-active-line-bg',
          glyphMarginClassName: showFaultStyle ? 'monaco-fault-glyph' : 'monaco-active-glyph',
        },
      });
    }

    // 3. Minor warning line highlights
    if (hasExecuted && !isCompileError) {
      for (const diag of diagnostics) {
        if (diag.severity === 'warning' && diag.line && diag.line !== targetLine) {
          newDecorations.push({
            range: new monaco.Range(diag.line, 1, diag.line, 1),
            options: {
              isWholeLine: true,
              className: 'monaco-warning-line-bg',
              glyphMarginClassName: 'monaco-warning-glyph',
              glyphMarginHoverMessage: { value: diag.message },
            },
          });
        }
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [
    activeLine,
    hasFaultOnLine,
    hasExecuted,
    isCompileError,
    trace.errorDetails,
    monacoReady,
    code,
    activeBreakpoints,
    diagnostics,
  ]);

  // Switch Monaco theme dynamically
  useEffect(() => {
    if (monacoRef.current && monacoReady) {
      monacoRef.current.editor.setTheme(
        theme === 'dark' ? 'LogicLab-Midnight' : 'LogicLab-Daybreak'
      );
    }
  }, [theme, monacoReady]);

  // Panel Resizing Drag Handling
  const handleMouseDownDivider = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    startHeight.current = editorHeight;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - dragStartY.current;
      const nextH = Math.max(200, Math.min(800, startHeight.current + delta));
      setEditorHeight(nextH);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Format Code Helper
  const handleFormatCode = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  }, []);

  // Jump to Diagnostic Line & Column
  const handleJumpToDiagnostic = (d: ExecutionDiagnostic) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(d.line);
      editorRef.current.setPosition({ lineNumber: d.line, column: d.column || 1 });
      editorRef.current.focus();
    }
  };

  const codeLines = code.split('\n');

  return (
    <section
      className="ll-panel rounded-2xl flex flex-col overflow-hidden"
      aria-label={explainLanguage === 'bn' ? 'কোড এডিটর এবং আউটপুট' : 'Code Editor and Output'}
    >
      {/* 1. Header Toolbar Row */}
      <div className="flex flex-wrap items-center justify-between px-3 sm:px-5 py-2.5 bg-[#080C14] border-b border-[#1E293B] gap-3">
        {/* Left: Active File Inline Rename, Other File Tabs, and + New File */}
        <div
          className="flex items-center gap-2 overflow-x-auto max-w-full"
          role="tablist"
          aria-label={explainLanguage === 'bn' ? 'ফাইল তালিকা' : 'File list'}
        >
          {userFiles.map((f) => {
            const isSelected = f.id === activeFileId;
            return (
              <div
                key={f.id}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
                  isSelected
                    ? 'bg-[#111827] border-blue-500/80 text-white font-semibold'
                    : 'bg-transparent border-transparent text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <FileCode className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-400' : 'text-slate-500'}`} />
                {isSelected ? (
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="main.js"
                    aria-label={explainLanguage === 'bn' ? 'ফাইলের নাম' : 'File name'}
                    data-testid="file-name-input"
                    className="w-24 sm:w-32 bg-transparent text-white font-semibold focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={false}
                    onClick={() => selectUserFile(f.id)}
                    className="cursor-pointer truncate max-w-[140px]"
                  >
                    {f.fileName}
                  </button>
                )}
                {userFiles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteUserFile(f.id)}
                    className="text-slate-500 hover:text-red-400 cursor-pointer ml-0.5 p-0.5 rounded hover:bg-slate-800"
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
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-400 hover:bg-blue-500/10 border border-transparent hover:border-blue-500/30 transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1"
            data-testid="new-user-file-btn"
            title={explainLanguage === 'bn' ? 'নতুন ফাইল তৈরি করুন' : 'Create new file'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{explainLanguage === 'bn' ? 'নতুন ফাইল' : 'New File'}</span>
          </button>
        </div>

        {/* Right: Language Selector, Format, Zoom (+ / -), Run Button, and Clear */}
        <div className="flex items-center gap-2.5 shrink-0 ml-auto">
          {/* Language Select */}
          <div className="relative">
            <label className="sr-only" htmlFor="editor-language-select">
              Programming Language
            </label>
            <select
              id="editor-language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
              className="px-2.5 py-1.5 rounded-lg bg-[#111827] border border-[#1E293B] text-xs font-mono font-medium text-slate-200 cursor-pointer focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="javascript">JavaScript (.js)</option>
              <option value="python">Python (.py)</option>
              <option value="cpp">C++ (.cpp)</option>
              <option value="java">Java (.java)</option>
            </select>
          </div>

          {/* Format Document Button */}
          <button
            type="button"
            onClick={handleFormatCode}
            className="p-1.5 rounded-lg border border-[#1E293B] bg-[#111827] text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Format Document (Shift+Alt+F)"
            title="Format Code (Shift+Alt+F)"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>

          {/* Zoom: Minus & Plus icons */}
          <div className="flex items-center rounded-lg border border-[#1E293B] bg-[#111827] px-1 py-0.5">
            <button
              type="button"
              onClick={() => setEditorFontSize(-2, true)}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
              aria-label="Decrease font size (-)"
              title="Decrease font size (-)"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-slate-400 px-1 font-semibold select-none">
              {editorFontSize}
            </span>
            <button
              type="button"
              onClick={() => setEditorFontSize(2, true)}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
              aria-label="Increase font size (+)"
              title="Increase font size (+)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Run Button */}
          <button
            type="button"
            onClick={() => {
              const bufferCode = editorRef.current ? editorRef.current.getValue() : code;
              void runVisualize(bufferCode);
            }}
            className="px-3 sm:px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors shadow-sm"
            data-testid="visualize-primary-btn"
          >
            <Play className={`w-3.5 h-3.5 ${isTracing ? 'animate-spin' : 'fill-current'}`} />
            <span lang={explainLanguage}>
              {isTracing
                ? explainLanguage === 'bn'
                  ? 'পুনরায় রান...'
                  : 'Running...'
                : explainLanguage === 'bn'
                ? 'রান'
                : 'Run'}
            </span>
          </button>

          {/* Delete / Clear Button */}
          <button
            type="button"
            onClick={resetSnippetToNew}
            className="p-1.5 rounded-lg border border-[#1E293B] bg-[#111827] text-slate-400 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors cursor-pointer"
            data-testid="clear-editor-btn"
            title={explainLanguage === 'bn' ? 'মুছে ফেলুন' : 'Clear code'}
            aria-label="Clear code"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Monaco Code Editor Surface */}
      <div
        style={{ height: `${editorHeight}px` }}
        className="relative bg-[#0A1027] dark:bg-[#0A1027]"
      >
        {!code.trim() && (
          <div className="pointer-events-none absolute top-4 left-16 z-10 font-mono text-xs text-slate-500 select-none">
            // Start writing here...
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
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            autoIndent: 'full',
            folding: true,
            showFoldingControls: 'always',
            multiCursorModifier: 'alt',
            tabSize: 4,
            insertSpaces: true,
            formatOnPaste: true,
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            quickSuggestions: { other: true, comments: false, strings: true },
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

      {/* 3. Resizable Drag Handle */}
      <div
        onMouseDown={handleMouseDownDivider}
        onDoubleClick={() => setEditorHeight(360)}
        title={explainLanguage === 'bn' ? 'ড্র্যাগ করে এডিটরের আকার পরিবর্তন করুন (রিসেট করতে ডাবল ক্লিক)' : 'Drag to resize editor (double click to reset)'}
        className="h-2 bg-[#080C14] hover:bg-blue-600/40 cursor-row-resize flex items-center justify-center transition-colors group select-none border-t border-b border-[#1E293B]"
      >
        <div className="w-10 h-1 bg-slate-600 group-hover:bg-blue-400 rounded-full transition-colors" />
      </div>

      {/* 4. Editor Status Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-1.5 bg-[#080C14] border-b border-[#1E293B] text-xs font-mono text-slate-400 select-none">
        <div className="flex items-center gap-4 sm:gap-6">
          <span className="font-semibold text-slate-200">
            {fileName}
          </span>
          <span>
            Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>{code ? `${codeLines.length} lines` : '0 lines'}</span>
          <span className="uppercase text-blue-400 font-semibold">{language}</span>
        </div>
      </div>

      {/* 5. Console Section: Program Output & Problems Tabs */}
      <div
        className="px-4 sm:px-6 py-4 bg-[#0E1422] space-y-3"
        data-testid="real-output-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-[#1E293B]">
          <div className="flex items-center gap-3">
            {/* Tab: Output */}
            <button
              type="button"
              onClick={() => setActiveConsoleTab('output')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeConsoleTab === 'output'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{explainLanguage === 'bn' ? 'প্রোগ্রাম আউটপুট' : 'Program Output'}</span>
            </button>

            {/* Tab: Problems / Diagnostics */}
            <button
              type="button"
              onClick={() => setActiveConsoleTab('problems')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeConsoleTab === 'problems'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {errorCount > 0 ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              ) : warningCount > 0 ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Info className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{explainLanguage === 'bn' ? 'সমস্যা ও সতর্কতা' : 'Problems'}</span>
              {(errorCount > 0 || warningCount > 0) && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    errorCount > 0
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {errorCount + warningCount}
                </span>
              )}
            </button>

            {/* Execution Verdict Badge */}
            {hasExecuted && activeConsoleTab === 'output' && (
              <span
                className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                  isCompileError
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                    : hasWarnings
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {isCompileError
                  ? explainLanguage === 'bn'
                    ? 'ত্রুটি (Error)'
                    : 'Error'
                  : hasWarnings
                  ? explainLanguage === 'bn'
                    ? 'সতর্কতা (Warning)'
                    : 'Warning'
                  : explainLanguage === 'bn'
                  ? 'সফল'
                  : 'Success'}
              </span>
            )}
          </div>

          {hasExecuted && !isCompileError && (
            <span className="text-xs font-mono text-slate-400">
              {explainLanguage === 'bn'
                ? `মোট ধাপ: ${trace.steps.length}`
                : `Total steps: ${trace.steps.length}`}
            </span>
          )}
        </div>

        {/* Tab 1: Problems / Diagnostics Panel */}
        {activeConsoleTab === 'problems' ? (
          <div className="space-y-2">
            {displayDiagnostics.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-[#080C14] border border-[#1E293B] font-mono text-xs text-slate-500 select-none">
                // {explainLanguage === 'bn' ? 'কোডে কোনো ত্রুটি বা সতর্কতা পাওয়া যায়নি।' : 'No problems detected in the file.'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {displayDiagnostics.map((d, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleJumpToDiagnostic(d)}
                    className="w-full text-left p-2.5 rounded-lg bg-[#080C14] border border-[#1E293B] hover:border-blue-500/40 hover:bg-slate-800/40 flex items-start gap-2.5 transition-colors cursor-pointer group"
                  >
                    {d.severity === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    ) : d.severity === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span
                          className={`font-bold uppercase text-[10px] px-1.5 py-0.5 rounded ${
                            d.severity === 'error'
                              ? 'bg-red-500/20 text-red-400'
                              : d.severity === 'warning'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {d.severity}
                        </span>
                        <span className="text-slate-400 group-hover:text-blue-400">
                          {fileName}:{d.line}{d.column ? `:${d.column}` : ''}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200 mt-1 font-mono whitespace-pre-wrap leading-relaxed m-0">
                        {d.message}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Tab 2: Program Output Panel */
          <div>
            {!hasExecuted ? (
              <div
                className="p-3.5 rounded-xl bg-[#080C14] border border-[#1E293B] font-mono text-xs text-slate-500 select-none"
                data-testid="output-zero-state"
              >
                // {explainLanguage === 'bn' ? 'কোড রান করলে আউটপুট এখানে দেখাবে' : 'Program output will appear here'}
              </div>
            ) : isCompileError ? (
              <div
                className="p-4 rounded-xl bg-red-950/20 border border-red-900/40 space-y-2.5"
                role="alert"
                data-testid="output-error-state"
              >
                {trace.errorDetails && (
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-400 font-bold">
                      {trace.errorDetails.errorType || 'ERROR'}
                    </span>
                    <span className="text-slate-300 font-semibold">
                      {explainLanguage === 'bn'
                        ? `লাইন ${trace.errorDetails.lineNumber || trace.errorDetails.line || 1}`
                        : `Line ${trace.errorDetails.lineNumber || trace.errorDetails.line || 1}`}
                    </span>
                    {trace.errorDetails.lineCode && (
                      <code className="px-2 py-0.5 rounded bg-[#080C14] text-amber-300 break-all border border-[#1E293B]">
                        {trace.errorDetails.lineCode}
                      </code>
                    )}
                  </div>
                )}
                <p className="font-mono text-xs sm:text-sm text-red-400 font-medium whitespace-pre-wrap leading-relaxed m-0">
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
                    className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-900/50 text-xs text-emerald-400 font-medium leading-relaxed"
                  >
                    <strong className="mr-1.5 text-emerald-300">
                      {explainLanguage === 'bn' ? '💡 সমাধান:' : '💡 Solution:'}
                    </strong>
                    <span>{trace.errorDetails.solutionBn}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {hasWarnings && (
                  <div
                    className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40 space-y-2"
                    role="status"
                    data-testid="output-warning-state"
                  >
                    <div className="flex items-center gap-2 font-mono text-xs text-amber-400 font-bold">
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40">
                        WARNING
                      </span>
                      <span>
                        {explainLanguage === 'bn'
                          ? `${diagnostics.filter((d) => d.severity === 'warning').length}টি সতর্কতা (কোড কার্যকরভাবে চলছে)`
                          : `${diagnostics.filter((d) => d.severity === 'warning').length} warning(s) found (code execution proceeded)`}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {diagnostics
                        .filter((d) => d.severity === 'warning')
                        .map((diag, i) => (
                          <div key={i} className="text-xs font-mono text-amber-300/90 flex items-start gap-2">
                            <span className="text-slate-400 font-semibold shrink-0">Ln {diag.line}:</span>
                            <span>{diag.message}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                <div
                  className="p-3.5 sm:p-4 rounded-xl bg-[#080C14] border border-[#1E293B] space-y-2"
                  data-testid="output-success-state"
                >
                  <pre className="font-mono text-xs sm:text-sm font-semibold text-emerald-400 whitespace-pre-wrap break-words m-0 leading-relaxed">
                    {trace.finalOutput
                      ? trace.finalOutput
                      : explainLanguage === 'bn'
                      ? '(প্রোগ্রামটি কোনো টেক্সট প্রিন্ট করেনি — মেমোরি পরিবর্তন নিচে দেখুন)'
                      : '(Program printed no stdout text — inspect memory state changes below)'}
                  </pre>
                  {trace.outputExplanation && (
                    <p
                      lang={explainLanguage}
                      className="text-xs text-slate-400 leading-relaxed m-0 pt-1.5 border-t border-slate-800"
                    >
                      {trace.outputExplanation}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
