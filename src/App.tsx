import React, { useEffect, useRef } from 'react';
import { useLabStore } from './store/useLabStore';
import { CodeEditorPanel } from './components/editor/CodeEditorPanel';
import { LineByLineWorkspace } from './components/workspace/LineByLineWorkspace';
import { SharedRunView } from './components/views/SecondaryViews';
import { Overlays } from './components/modals/Overlays';
import { LogIn, LogOut, History, Languages, Trash2, Calendar } from 'lucide-react';

export default function App() {
  const {
    activeRoute,
    explainLanguage,
    trace,
    user,
    historyItems,
    historyDropdownOpen,
    initAuthAndCloudSync,
    setActiveRoute,
    runVisualize,
    togglePlay,
    nextStep,
    prevStep,
    resetPlayback,
    goToStep,
    toggleExplainLanguage,
    signInWithGoogle,
    signOutUser,
    openShareViewById,
    toggleHistoryDropdown,
    setHistoryDropdownOpen,
    restoreHistoryItem,
    clearAllHistory,
    deleteHistoryItem,
  } = useLabStore();

  const historyRef = useRef<HTMLDivElement>(null);

  // Close history dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setHistoryDropdownOpen(false);
      }
    }
    if (historyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [historyDropdownOpen, setHistoryDropdownOpen]);

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
    toggleExplainLanguage,
    trace.steps.length,
  ]);

  return (
    <div className="min-h-screen flex flex-col text-[var(--text-primary)] selection:bg-[#A3C1FF]/30">
      {/* Clean Single-Workspace Top Bar */}
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 py-3 border-b border-[#1E293B] bg-[#0B0F19]">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveRoute('/');
            }}
            className="flex items-center gap-2.5 text-decoration-none group"
          >
            <img
              src="/logo.jpg"
              alt="Logic Lab Logo"
              className="w-8 h-8 rounded-lg object-cover border border-slate-700/60 shadow-sm shrink-0"
            />
            <span className="text-base sm:text-lg font-bold tracking-tight text-white group-hover:text-blue-400 transition-colors whitespace-nowrap">
              Logic Lab
            </span>
          </a>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* History Icon Button & Dropdown */}
          <div className="relative" ref={historyRef}>
            <button
              type="button"
              onClick={toggleHistoryDropdown}
              className={`relative p-2 rounded-xl border transition-colors cursor-pointer ${
                historyDropdownOpen
                  ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                  : 'border-[#1E293B] bg-[#111827] text-slate-300 hover:text-white hover:border-slate-600'
              }`}
              title={explainLanguage === 'bn' ? 'রান ইতিহাস' : 'Execution History'}
              aria-label="History"
              data-testid="header-history-btn"
            >
              <History className="w-4 h-4" />
              {historyItems.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-[#0B0F19]" />
              )}
            </button>

            {historyDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-slate-800 bg-[#0E1422] shadow-2xl p-3 z-50 divide-y divide-slate-800/80"
                data-testid="history-dropdown-panel"
              >
                <div className="flex items-center justify-between pb-2.5 px-1">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-slate-200">
                      {explainLanguage === 'bn' ? 'রান ইতিহাস' : 'Execution History'}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                      {historyItems.length}
                    </span>
                  </div>
                  {historyItems.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAllHistory}
                      className="text-[11px] text-slate-400 hover:text-red-400 cursor-pointer transition-colors"
                      data-testid="clear-history-btn"
                    >
                      {explainLanguage === 'bn' ? 'সব মুছুন' : 'Clear all'}
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto pt-2 space-y-1.5">
                  {historyItems.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500 font-mono">
                      {explainLanguage === 'bn' ? 'কোনো রান ইতিহাস নেই' : 'No execution history yet'}
                    </div>
                  ) : (
                    historyItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => restoreHistoryItem(item)}
                        className="group flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-slate-800/60 cursor-pointer border border-transparent hover:border-slate-700/60 transition-all text-left"
                        data-testid={`history-item-${item.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200 truncate">
                              {item.fileName || item.title_en}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-blue-400 font-mono uppercase">
                              {item.language}
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                                item.verdictStatus === 'compile_error'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              {item.verdictStatus === 'compile_error' ? 'Error' : 'Success'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                            <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>{item.timestamp}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHistoryItem(item.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1 rounded hover:bg-slate-700/50 transition-all shrink-0"
                          title="Remove from history"
                          aria-label="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bilingual Toggle (Icon Only) */}
          <button
            type="button"
            onClick={toggleExplainLanguage}
            className="p-2 rounded-xl border border-[#1E293B] bg-[#111827] text-slate-300 hover:text-white hover:border-slate-600 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1.5"
            title={explainLanguage === 'bn' ? 'Switch to English' : 'বাংলায় পরিবর্তন করুন'}
            aria-label="Toggle Language"
            data-testid="header-lang-toggle"
          >
            <Languages className="w-4 h-4 text-blue-400" />
            <span className="text-[11px] font-bold text-slate-300 uppercase">
              {explainLanguage === 'bn' ? 'BN' : 'EN'}
            </span>
          </button>

          {/* Login / Logout Button with Icon */}
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-xs text-slate-300 font-medium truncate max-w-[120px]">
                {user.displayName}
              </span>
              <button
                type="button"
                onClick={() => void signOutUser()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/80 bg-[#111827] text-xs font-medium text-slate-300 hover:text-red-400 hover:border-red-500/50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                data-testid="header-signout-btn"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{explainLanguage === 'bn' ? 'লগআউট' : 'Sign Out'}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-700/80 bg-[#111827] text-xs font-medium text-slate-200 hover:text-white hover:border-blue-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              data-testid="header-signin-btn"
            >
              <LogIn className="w-3.5 h-3.5 text-blue-400" />
              <span>{explainLanguage === 'bn' ? 'লগইন' : 'Login'}</span>
            </button>
          )}
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
