import React, { useEffect } from 'react';
import { useLabStore } from './store/useLabStore';
import { CodeEditorPanel } from './components/editor/CodeEditorPanel';
import { LineByLineWorkspace } from './components/workspace/LineByLineWorkspace';
import { SharedRunView } from './components/views/SecondaryViews';
import { Overlays } from './components/modals/Overlays';
import { Play, Sun, Moon } from 'lucide-react';

export default function App() {
  const {
    activeRoute,
    theme,
    explainLanguage,
    trace,
    isTracing,
    user,
    isCloudSyncing,
    initAuthAndCloudSync,
    setActiveRoute,
    runVisualize,
    togglePlay,
    nextStep,
    prevStep,
    resetPlayback,
    goToStep,
    toggleTheme,
    toggleExplainLanguage,
    signInWithGoogle,
    signOutUser,
    openShareViewById,
  } = useLabStore();

  // Initialize Firebase Auth & Background Cloud Sync
  useEffect(() => {
    const unsubscribe = initAuthAndCloudSync();
    return () => unsubscribe();
  }, [initAuthAndCloudSync]);

  // Detect /s/:shareId route on initial load
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/s/')) {
      const shareId = window.location.pathname.slice(3).trim();
      if (shareId) {
        void openShareViewById(shareId);
      }
    }
  }, [openShareViewById]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.closest('.monaco-editor'));

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void runVisualize();
        return;
      }

      if (isEditingText) return;

      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextStep();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevStep();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToStep(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToStep(trace.steps.length - 1);
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        resetPlayback();
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        toggleTheme();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleExplainLanguage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    runVisualize,
    togglePlay,
    nextStep,
    prevStep,
    goToStep,
    resetPlayback,
    toggleTheme,
    toggleExplainLanguage,
    trace.steps.length,
  ]);

  return (
    <div className="min-h-screen flex flex-col text-[var(--text-primary)] selection:bg-[#A3C1FF]/30">
      {/* Clean Single-Workspace Top Bar */}
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-gutter)]/80 backdrop-blur-md">
        <div className="flex items-baseline gap-3.5 min-w-0">
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveRoute('/');
            }}
            className="text-lg font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0"
          >
            Logic Lab
          </a>
          <span
            lang={explainLanguage}
            className="hidden md:inline text-xs text-[var(--text-secondary)] truncate"
          >
            {explainLanguage === 'bn'
              ? 'আপনার নিজের কোড লিখুন — লাইন বাই লাইন বাংলা ব্যাখ্যা ও ৩ডি অ্যানিমেশন দেখুন'
              : 'Write your own code — see line-by-line explanation & 3D animation'}
          </span>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Cloud Sync / Google Auth Button */}
          {user ? (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs">
              <span className="text-[var(--text-primary)] font-medium truncate max-w-[120px]">
                {user.displayName}
              </span>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <button
                type="button"
                onClick={() => void signOutUser()}
                className="text-[var(--text-secondary)] hover:text-[#FF6B7D] transition-colors cursor-pointer whitespace-nowrap"
                data-testid="header-signout-btn"
              >
                {explainLanguage === 'bn' ? 'লগআউট' : 'Sign Out'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={isCloudSyncing}
              className="hidden sm:inline-flex items-center px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#A3C1FF] transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
              data-testid="header-signin-btn"
            >
              {isCloudSyncing
                ? explainLanguage === 'bn'
                  ? 'সিঙ্ক হচ্ছে...'
                  : 'Syncing...'
                : explainLanguage === 'bn'
                ? 'ক্লাউড সিঙ্ক'
                : 'Cloud Sync'}
            </button>
          )}

          {/* Bilingual Toggle (বাংলা / EN) */}
          <button
            type="button"
            onClick={toggleExplainLanguage}
            className="px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-medium text-[var(--text-primary)] hover:border-[#A3C1FF] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            data-testid="header-lang-toggle"
          >
            {explainLanguage === 'bn' ? 'বাংলা · EN' : 'EN · বাংলা'}
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
            aria-label={
              theme === 'dark'
                ? 'Switch to Daybreak light theme (T)'
                : 'Switch to Midnight dark theme (T)'
            }
            title="Toggle Theme (T)"
            data-testid="header-theme-toggle"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Primary Run Action */}
          <button
            type="button"
            onClick={() => void runVisualize()}
            disabled={isTracing}
            className="ll-btn-primary px-4 sm:px-5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            data-testid="header-run-btn"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span lang={explainLanguage}>
              {explainLanguage === 'bn' ? 'রান করুন' : 'Run Code'}
            </span>
          </button>
        </div>
      </header>


      {/* Main Single Clean Workspace */}
      <main
        id="workspace"
        className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-x-hidden"
      >
        {activeRoute === '/share' ? (
          <SharedRunView />
        ) : (
          <div className="max-w-[1280px] mx-auto space-y-6 sm:space-y-8">
            {/* 1. User File / Folder Editor + Real Output Section */}
            <CodeEditorPanel />

            {/* 2. Line-by-Line Explanation & Scrollable 3D Animation Workspace (only shown after valid code execution) */}
            <LineByLineWorkspace />
          </div>
        )}
      </main>

      <Overlays />
    </div>
  );
}
