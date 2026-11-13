import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { useLabStore } from '../../store/useLabStore';
import { SupportedLanguage, ExecutionDiagnostic } from '../../../shared/types';
import {
  Play,
  Plus,
  Minus,
  Trash2,
  FileCode,
  AlignLeft,
  Clock,
  Cpu,
  Keyboard,
  Sparkles,
} from 'lucide-react';
import { registerMonacoLanguageProviders } from './monacoProviders';
import { registerIntelliSense } from '../../lib/monaco/intellisense/registerIntelliSense';
import { DisposableHandle } from '../../lib/monaco/intellisense/types';
import { StageCanvas } from '../stage/StageCanvas';
import { OutputConsole } from './OutputConsole';
import { detectInputCalls } from '../../../shared/stdinHelper';

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
    isFastRunning,
    trace,
    apiError,
    diagnostics,
    executionStatus,
    activeBreakpoints,
    currentStepIndex,
    editorFontSize,
    setCode,
    setLanguage,
    setFileName,
    createNewUserFile,
    selectUserFile,
    deleteUserFile,
    setEditorFontSize,
    resetSnippetToNew,
    runFast,
    runVisualize,
    requestVisualize,
    stdinPromptOpen,
    stdinDraft,
    pendingVisualizeCode,
    setStdinDraft,
    confirmStdinPromptAndVisualize,
    autoFillSampleAndVisualize,
    cancelStdinPrompt,
    toggleBreakpoint,
    jumpToLine,
    setHoveredLine,
    setCursorPosition,
  } = useLabStore();

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);
  const intelliSenseDisposableRef = useRef<DisposableHandle | null>(null);
  const providersDisposableRef = useRef<DisposableHandle | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [contentLeft, setContentLeft] = useState(46);

  // Resizable panel state (vertical editor height & horizontal split width)
  const [editorHeight, setEditorHeight] = useState(360);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const startHeight = useRef(360);

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [leftPanePct, setLeftPanePct] = useState(50);
  const [isSplitDragging, setIsSplitDragging] = useState(false);

  // Live syntax/compiler diagnostics for Monaco + OutputConsole
  const [liveDiagnostics, setLiveDiagnostics] = useState<ExecutionDiagnostic[]>([]);

  const currentStep = trace.steps[currentStepIndex] || trace.steps[0];
  const activeLine = hasExecuted && currentStep ? currentStep.activeLine : 0;
  const hasFaultOnLine = Boolean(currentStep?.fault);
  const isCompileError =
    hasExecuted &&
    (trace.verdict.status === 'compile_error' ||
      ((executionStatus === 'error' || Boolean(apiError)) && trace.steps.length === 0));

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

    // Register hover documentation, document formatters, and enterprise IntelliSense idempotently
    providersDisposableRef.current?.dispose();
    providersDisposableRef.current = registerMonacoLanguageProviders(monaco);

    intelliSenseDisposableRef.current?.dispose();
    intelliSenseDisposableRef.current = registerIntelliSense(monaco);
  };

  const handleOnMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    (window as any).__monacoEditor = editor;
    (window as any).__monacoInstance = monaco;

    // Ensure providers are registered even if StrictMode skipped beforeMount on remount
    if (!providersDisposableRef.current) {
      providersDisposableRef.current = registerMonacoLanguageProviders(monaco);
    }
    if (!intelliSenseDisposableRef.current) {
      intelliSenseDisposableRef.current = registerIntelliSense(monaco);
    }

    editor.onDidDispose(() => {
      intelliSenseDisposableRef.current?.dispose();
      intelliSenseDisposableRef.current = null;
      providersDisposableRef.current?.dispose();
      providersDisposableRef.current = null;
    });

    setMonacoReady(true);
    const updatePlaceholderAnchor = () => {
      const layout = editor.getLayoutInfo();
      const visiblePos = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 1 });
      const contentStart = Math.max(layout.contentLeft, visiblePos?.left ?? layout.contentLeft);
      setContentLeft(contentStart + 6);
    };
    updatePlaceholderAnchor();

    editor.onDidLayoutChange(() => {
      updatePlaceholderAnchor();
    });

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

  // Cleanup IntelliSense & language providers on component unmount
  useEffect(() => {
    return () => {
      intelliSenseDisposableRef.current?.dispose();
      intelliSenseDisposableRef.current = null;
      providersDisposableRef.current?.dispose();
      providersDisposableRef.current = null;
    };
  }, []);

  // Real-time debounced compiler diagnostics (350ms) with cancellation & stale-response guard
  useEffect(() => {
    if (!code.trim() || !monacoReady || !monacoRef.current || !editorRef.current) {
      if (monacoRef.current && editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) monacoRef.current.editor.setModelMarkers(model, 'compiler', []);
      }
      setLiveDiagnostics([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const reqFileId = useLabStore.getState().activeFileId;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, language, fileName }),
        });
        const data = await res.json();
        const latest = useLabStore.getState();
        if (
          cancelled ||
          controller.signal.aborted ||
          latest.activeFileId !== reqFileId ||
          latest.code !== code ||
          latest.language !== language ||
          latest.fileName !== fileName
        ) {
          return;
        }
        const incomingDiags: ExecutionDiagnostic[] = Array.isArray(data.diagnostics)
          ? data.diagnostics
          : [];
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
        // Ignore aborted or background analysis failures
      }
    }, 350);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
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
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(targetLine);
      }
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

  // Horizontal Split-Pane Resizing (Mouse & Touch)
  const updateSplitFromClientX = useCallback((clientX: number) => {
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minPct = Math.max(25, (280 / rect.width) * 100);
    const maxPct = 100 - minPct;
    const rawPct = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(minPct, Math.min(maxPct, rawPct));
    setLeftPanePct(Number(clamped.toFixed(2)));
  }, []);

  const handleMouseDownSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsSplitDragging(true);
  };

  const handleTouchStartSplit = () => {
    setIsSplitDragging(true);
  };

  useEffect(() => {
    if (!isSplitDragging) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (e: MouseEvent) => updateSplitFromClientX(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) updateSplitFromClientX(e.touches[0].clientX);
    };
    const onStop = () => setIsSplitDragging(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onStop);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onStop);
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onStop);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onStop);
    };
  }, [isSplitDragging, updateSplitFromClientX]);

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

  // Keyboard shortcuts handled in App.tsx

  const codeLines = code.split('\n');

  return (
    <section
      className="ll-panel rounded-xl flex flex-col overflow-hidden"
      aria-label={explainLanguage === 'bn' ? 'কোড এডিটর, ভিজ্যুয়ালাইজার এবং আউটপুট' : 'Code Editor, Visualizer and Output'}
    >
      {/* 1. Unified Horizontal Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 sm:px-5 py-2.5 bg-[var(--bg-gutter)] border-b border-[var(--border-subtle)] gap-3">
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
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-colors border ${
                  isSelected
                    ? 'bg-[var(--bg-panel-raised)] border-[var(--border-active)]/70 text-[var(--text-primary)] font-semibold'
                    : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)]'
                }`}
              >
                <FileCode className={`w-3.5 h-3.5 ${isSelected ? 'text-[var(--text-accent)]' : 'text-[var(--text-muted)]'}`} />
                {isSelected ? (
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="main.js"
                    aria-label={explainLanguage === 'bn' ? 'ফাইলের নাম' : 'File name'}
                    data-testid="file-name-input"
                    className="w-24 sm:w-28 bg-transparent text-[var(--text-primary)] font-semibold focus:outline-none"
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
                    className="text-[var(--text-muted)] hover:text-[var(--text-danger)] cursor-pointer ml-0.5 p-0.5 rounded"
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
            className="px-2 py-1 rounded-lg text-xs font-medium text-[var(--text-accent)] hover:bg-[var(--code-pill-bg)] transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1"
            data-testid="new-user-file-btn"
            title={explainLanguage === 'bn' ? 'নতুন ফাইল তৈরি করুন' : 'Create new file'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{explainLanguage === 'bn' ? 'নতুন ফাইল' : 'New File'}</span>
          </button>
        </div>

        {/* Right: Complexity Pills, Playback Controls, Language Selector, Format, Zoom, Run, Clear */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
          {/* Time & Space Complexity Pills */}
          {hasExecuted && !isCompileError && trace.logicSummary?.complexity && (
            <div className="hidden xl:flex items-center gap-1.5 pr-2 border-r border-[var(--border-subtle)] text-[11px] font-mono">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-accent)]">
                <Clock className="w-3 h-3" />
                {trace.logicSummary.complexity.time}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-success)]">
                <Cpu className="w-3 h-3" />
                {trace.logicSummary.complexity.space}
              </span>
            </div>
          )}

          {/* Language Select */}
          <div className="relative">
            <label className="sr-only" htmlFor="editor-language-select">
              Programming Language
            </label>
            <select
              id="editor-language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-select)] border border-[var(--border-subtle)] text-xs font-mono font-medium text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--border-active)] transition-colors"
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
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-select)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            aria-label="Format Document (Shift+Alt+F)"
            title="Format Code (Shift+Alt+F)"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>

          {/* Zoom: Minus & Plus icons */}
          <div className="hidden sm:flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-select)] px-1 py-0.5">
            <button
              type="button"
              onClick={() => setEditorFontSize(-2, true)}
              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded transition-colors cursor-pointer"
              aria-label="Decrease font size (-)"
              title="Decrease font size (-)"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-[var(--text-secondary)] px-1 font-semibold select-none">
              {editorFontSize}
            </span>
            <button
              type="button"
              onClick={() => setEditorFontSize(2, true)}
              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded transition-colors cursor-pointer"
              aria-label="Increase font size (+)"
              title="Increase font size (+)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Dual Execution Modes: Run vs. Explain & Animate */}
          <button
            type="button"
            onClick={() => {
              const bufferCode = editorRef.current ? editorRef.current.getValue() : code;
              void runFast(bufferCode);
            }}
            disabled={isFastRunning}
            className="px-3.5 py-1.5 rounded-lg font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap border border-[#10B981]/35 bg-[#10B981]/12 text-[#34D399] hover:bg-[#10B981]/22 disabled:opacity-60 transition-colors"
            data-testid="fast-run-btn"
            title={
              explainLanguage === 'bn'
                ? 'কোড রান করুন'
                : 'Run code'
            }
          >
            <Play className={`w-3.5 h-3.5 ${isFastRunning ? 'animate-spin' : 'fill-current'}`} />
            <span lang={explainLanguage}>
              {isFastRunning
                ? explainLanguage === 'bn'
                  ? 'চলছে...'
                  : 'Running...'
                : explainLanguage === 'bn'
                ? 'রান'
                : 'Run'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              const bufferCode = editorRef.current ? editorRef.current.getValue() : code;
              void requestVisualize(bufferCode);
            }}
            className="px-3.5 sm:px-4 py-1.5 rounded-lg font-semibold text-xs inline-flex items-center justify-center cursor-pointer whitespace-nowrap border border-[#60A5FA]/35 bg-[#2563EB] hover:bg-[#3B82F6] text-white shadow-sm transition-colors"
            data-testid="visualize-primary-btn"
            title={
              explainLanguage === 'bn'
                ? 'সহজ বাংলা/ইংরেজি ব্যাখ্যা ও মেমোরি অ্যানিমেশন দেখুন'
                : 'Generate beginner-friendly explanation & memory animation'
            }
          >
            <span lang={explainLanguage}>
              {isTracing
                ? explainLanguage === 'bn'
                  ? 'বিশ্লেষণ চলছে...'
                  : 'Explaining...'
                : explainLanguage === 'bn'
                ? 'ব্যাখ্যা ও অ্যানিমেট'
                : 'Explain & Animate'}
            </span>
            {!isTracing && (
              <span className="sr-only">
                {explainLanguage === 'bn' ? ' রান' : ' Run'}
              </span>
            )}
          </button>

          {/* Delete / Clear Button */}
          <button
            type="button"
            onClick={resetSnippetToNew}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-select)] text-[var(--text-secondary)] hover:text-[var(--text-danger)] hover:border-[#EF4444]/40 transition-colors cursor-pointer"
            data-testid="clear-editor-btn"
            title={explainLanguage === 'bn' ? 'মুছে ফেলুন' : 'Clear code'}
            aria-label="Clear code"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Main Split View: Code Editor (Left) | Draggable Divider | Live Logic & Memory Visualizer (Right) */}
      <div
        ref={splitContainerRef}
        style={{ '--left-pane-w': `${leftPanePct}%` } as React.CSSProperties}
        className="flex flex-col lg:flex-row divide-y lg:divide-y-0"
      >
        {/* LEFT PANE: Monaco Code Editor + Resize Handle + Status Strip */}
        <div className="w-full lg:w-[var(--left-pane-w)] lg:shrink-0 lg:min-w-[280px] flex flex-col min-w-0">
          <div
            style={{ height: `${editorHeight}px` }}
            className="relative bg-[#0A1027] dark:bg-[#0A1027]"
          >
            {code.length === 0 && (
              <div
                style={{
                  top: 12,
                  left: `${contentLeft}px`,
                  fontSize: `${editorFontSize}px`,
                  lineHeight: `${Math.max(22, Math.round(editorFontSize * 1.55))}px`,
                }}
                className="pointer-events-none absolute z-10 font-mono italic text-slate-500/80 select-none whitespace-nowrap"
              >
                Start writing your code.
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
                glyphMargin: false,
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                lineDecorationsWidth: 12,
                lineHeight: Math.max(22, Math.round(editorFontSize * 1.55)),
                roundedSelection: true,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on',
                bracketPairColorization: { enabled: true },
                guides: { indentation: true, bracketPairs: true },
                padding: { top: 12, bottom: 16 },
                automaticLayout: true,
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                autoIndent: 'full',
                folding: false,
                multiCursorModifier: 'alt',
                tabSize: 4,
                insertSpaces: true,
                formatOnPaste: true,
                formatOnType: true,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'on',
                tabCompletion: 'on',
                wordBasedSuggestions: 'currentDocument',
                snippetSuggestions: 'top',
                quickSuggestions: { other: true, comments: false, strings: true },
                quickSuggestionsDelay: 0,
                suggest: {
                  showIcons: true,
                  showSnippets: true,
                  showKeywords: true,
                  showMethods: true,
                  showFunctions: true,
                  showClasses: true,
                  showVariables: true,
                  showConstants: true,
                  showStructs: true,
                  showModules: true,
                  showProperties: true,
                  showInlineDetails: true,
                  showStatusBar: true,
                  preview: true,
                  previewMode: 'subwordSmart',
                  localityBonus: true,
                  snippetsPreventQuickSuggestions: false,
                },
              }}
              loading={
                <div className="py-4 px-2 font-mono text-xs space-y-1.5 bg-[#0A1027] text-[#E4ECFF] h-full overflow-auto">
                  {codeLines.map((lineText, idx) => (
                    <div key={idx + 1} className="flex items-center gap-2.5 px-1 py-0.5">
                      <span className="w-6 text-right text-[#5B78B8] select-none font-semibold">{idx + 1}</span>
                      <span className="whitespace-pre">{lineText}</span>
                    </div>
                  ))}
                </div>
              }
            />
          </div>

          {/* Resizable Drag Handle */}
          <div
            onMouseDown={handleMouseDownDivider}
            onDoubleClick={() => setEditorHeight(360)}
            title={explainLanguage === 'bn' ? 'ড্র্যাগ করে এডিটরের আকার পরিবর্তন করুন (রিসেট করতে ডাবল ক্লিক)' : 'Drag to resize editor (double click to reset)'}
            className="h-2 bg-[var(--bg-gutter)] hover:bg-[var(--accent-primary)]/30 cursor-row-resize flex items-center justify-center transition-colors group select-none border-t border-b border-[var(--border-subtle)]"
          >
            <div className="w-10 h-1 bg-slate-600 group-hover:bg-[var(--text-accent)] rounded-full transition-colors" />
          </div>

          {/* Editor Status Bar (static bottom-right line count & language) */}
          <div
            className="h-8 shrink-0 flex items-center justify-end px-4 bg-[var(--bg-gutter)] border-t border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)] select-none tabular-nums whitespace-nowrap"
            data-testid="editor-status-bar"
          >
            <div className="flex items-center gap-4">
              <span>{code ? `${codeLines.length} lines` : '0 lines'}</span>
              <span className="uppercase text-[var(--text-accent)] font-semibold">{language}</span>
            </div>
          </div>
        </div>

        {/* DRAGGABLE VERTICAL SPLIT DIVIDER (Desktop) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={explainLanguage === 'bn' ? 'প্যানেল আকার পরিবর্তন করুন' : 'Resize split panes'}
          onMouseDown={handleMouseDownSplit}
          onTouchStart={handleTouchStartSplit}
          onDoubleClick={() => setLeftPanePct(50)}
          title={
            explainLanguage === 'bn'
              ? 'ড্র্যাগ করে এডিটর ও ভিজ্যুয়ালাইজার আকার পরিবর্তন করুন (রিসেট করতে ডাবল ক্লিক)'
              : 'Drag to resize editor and visualizer (double-click to reset)'
          }
          data-testid="split-pane-divider"
          className={`hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center relative group select-none transition-colors ${
            isSplitDragging
              ? 'bg-indigo-500/25'
              : 'bg-transparent hover:bg-indigo-500/15'
          }`}
        >
          <div
            className={`w-px h-full transition-colors ${
              isSplitDragging
                ? 'bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.6)]'
                : 'bg-[var(--border-subtle)] group-hover:bg-indigo-400/70'
            }`}
          />
          <div
            className={`absolute w-1 h-8 rounded-full transition-all ${
              isSplitDragging
                ? 'bg-indigo-400 scale-y-110'
                : 'bg-slate-600/70 group-hover:bg-indigo-400'
            }`}
          />
        </div>

        {/* RIGHT PANE: Live Logic & Memory Visualizer */}
        <div className="w-full lg:flex-1 lg:min-w-[280px] flex flex-col justify-start min-w-0 bg-[var(--bg-panel)]">
          <div className="flex-1 p-4 sm:p-5 flex flex-col justify-start min-h-[260px]">
            {hasExecuted || isTracing ? (
              <StageCanvas />
            ) : (
              <div className="my-auto flex flex-col items-center justify-center text-center py-10 px-4 space-y-1.5 select-none">
                <p className="text-sm font-semibold text-[var(--text-primary)] m-0" lang={explainLanguage}>
                  {explainLanguage === 'bn'
                    ? 'লাইভ লজিক ভিজ্যুয়ালাইজার'
                    : 'Live Logic Visualizer'}
                </p>
                <p className="text-xs text-[var(--text-secondary)] max-w-xs m-0 leading-relaxed" lang={explainLanguage}>
                  {explainLanguage === 'bn'
                    ? 'কোড রান করলে এখানে ধাপে ধাপে অ্যানিমেশন দেখাবে।'
                    : 'Run your code to see step-by-step animation here.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Unified Program Output, Problems & Input Console */}
      <OutputConsole
        getEditorCode={() => (editorRef.current ? editorRef.current.getValue() : code)}
        liveDiagnostics={liveDiagnostics}
        onJumpToDiagnostic={handleJumpToDiagnostic}
      />

      {/* 4. Interactive STDIN Prompt Modal when input statements exist & STDIN tab is empty */}
      {stdinPromptOpen && (() => {
        const detectedCalls = detectInputCalls(pendingVisualizeCode || code, language);
        return (
          <div
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            data-testid="stdin-prompt-modal"
          >
            <div className="ll-panel w-full max-w-lg rounded-2xl border border-[#60A5FA]/40 bg-[var(--bg-panel)] p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-[#2563EB]/20 border border-[#60A5FA]/40 flex items-center justify-center text-[#60A5FA]">
                    <Keyboard className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)] m-0" lang={explainLanguage}>
                      {explainLanguage === 'bn'
                        ? 'প্রোগ্রামের জন্য ইনপুট (STDIN) প্রয়োজন'
                        : 'Program Requires STDIN Input'}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5" lang={explainLanguage}>
                      {explainLanguage === 'bn'
                        ? 'আপনার কোডে ইউজার ইনপুট (`Scanner` / `input()` / `cin`) আছে। স্যাম্পল মান দিন অথবা অটো-স্যাম্পল দিয়ে অ্যানিমেট করুন।'
                        : 'Your code reads user input. Enter values line by line or use auto-generated sample values.'}
                    </p>
                  </div>
                </div>
              </div>

              {detectedCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                  {detectedCalls.map((c, idx) => (
                    <span
                      key={`${c.line}-${idx}`}
                      className="px-2 py-0.5 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-accent)]"
                    >
                      Ln {c.line}: {c.targetVar || `input #${idx + 1}`} ({c.hintType})
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="stdin-prompt-textarea"
                  className="block text-xs font-semibold text-[var(--text-secondary)]"
                >
                  {explainLanguage === 'bn'
                    ? 'ইনপুট (প্রতি লাইনে একটি মান লিখুন):'
                    : 'Input values (one per line):'}
                </label>
                <textarea
                  id="stdin-prompt-textarea"
                  rows={4}
                  value={stdinDraft}
                  onChange={(e) => setStdinDraft(e.target.value)}
                  data-testid="stdin-prompt-textarea"
                  className="w-full rounded-xl bg-[#070C1D] border border-slate-700 focus:border-[#60A5FA] focus:outline-none p-3 font-mono text-xs sm:text-sm text-slate-100"
                  placeholder={'25\n*\n5'}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelStdinPrompt}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  data-testid="stdin-prompt-cancel"
                >
                  {explainLanguage === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => void autoFillSampleAndVisualize()}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border border-[#10B981]/40 bg-[#10B981]/15 text-[#34D399] hover:bg-[#10B981]/25 cursor-pointer"
                  data-testid="stdin-prompt-auto-btn"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {explainLanguage === 'bn'
                      ? 'অটো স্যাম্পল দিয়ে অ্যানিমেট করুন'
                      : 'Auto-Sample & Animate'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void confirmStdinPromptAndVisualize()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#2563EB] hover:bg-[#3B82F6] text-white cursor-pointer"
                  data-testid="stdin-prompt-confirm-btn"
                >
                  {explainLanguage === 'bn'
                    ? 'এই ইনপুট দিয়ে অ্যানিমেট করুন'
                    : 'Run & Animate'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
};
