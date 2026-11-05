import React, { useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { SAMPLE_PROGRAMS } from '../../data/sampleTraces';
import { StageCanvas } from '../stage/StageCanvas';
import { PlayerBar } from '../player/PlayerBar';
import { FormattedText } from '../common/FormattedText';
import { X, Command, Keyboard, Sparkles, Minimize2, RotateCcw, Share2, ExternalLink } from 'lucide-react';

export const Overlays: React.FC = () => {
  const {
    explainLanguage,
    commandPaletteOpen,
    shortcutsOpen,
    tourStep,
    presentationMode,
    shareModalOpen,
    lastCreatedShareUrl,
    lastCreatedShareId,
    toast,
    trace,
    currentStepIndex,
    setCommandPaletteOpen,
    setShortcutsOpen,
    setTourStep,
    togglePresentationMode,
    closeShareModal,
    openShareViewById,
    selectSample,
    toggleTheme,
    toggleExplainLanguage,
    runVisualize,
    dismissToast,
  } = useLabStore();

  const [cmdQuery, setCmdQuery] = useState('');

  const commands = [
    {
      id: 'visualize',
      label_bn: 'কোড ভিজ্যুয়ালাইজ করুন (Visualize)',
      label_en: 'Visualize Current Code',
      shortcut: 'Ctrl+Enter',
      action: () => runVisualize(),
    },
    {
      id: 'sample-swap',
      label_bn: 'উদাহরণ: দুটি ভ্যারিয়েবল অদলবদল (Swap with temp)',
      label_en: 'Load Example: Swap Two Variables',
      shortcut: '1',
      action: () => selectSample('swap_correct'),
    },
    {
      id: 'sample-faulty',
      label_bn: 'উদাহরণ: ভুল সোয়াপ (Lost Value Fault)',
      label_en: 'Load Example: Faulty Swap (No Temp)',
      shortcut: '2',
      action: () => selectSample('swap_faulty'),
    },
    {
      id: 'sample-bubble',
      label_bn: 'উদাহরণ: বাবল সর্ট (Bubble Sort)',
      label_en: 'Load Example: Bubble Sort',
      shortcut: '3',
      action: () => selectSample('bubble_sort'),
    },
    {
      id: 'sample-loop',
      label_bn: 'উদাহরণ: অসীম লুপ (Infinite Loop Fault)',
      label_en: 'Load Example: Missing-Increment Loop',
      shortcut: '4',
      action: () => selectSample('infinite_loop'),
    },
    {
      id: 'toggle-theme',
      label_bn: 'থিম বদলান (Midnight / Daybreak)',
      label_en: 'Toggle Dark / Light Theme',
      shortcut: 'T',
      action: () => toggleTheme(),
    },
    {
      id: 'toggle-lang',
      label_bn: 'ভাষা বদলান (বাংলা / English)',
      label_en: 'Switch Explanation Language (BN / EN)',
      shortcut: 'L',
      action: () => toggleExplainLanguage(),
    },
    {
      id: 'present',
      label_bn: 'প্রেজেন্টেশন মোড (Fullscreen Stage)',
      label_en: 'Toggle Presentation Mode',
      shortcut: 'F',
      action: () => togglePresentationMode(),
    },
  ];

  const filteredCommands = commands.filter((c) => {
    const q = cmdQuery.toLowerCase();
    return (
      !q ||
      c.label_bn.toLowerCase().includes(q) ||
      c.label_en.toLowerCase().includes(q)
    );
  });

  const tourSlides = [
    {
      title_bn: '১/৪ কোড এডিটর (VS Code স্টাইল)',
      title_en: '1/4 Write or Pick Code',
      body_bn: 'এখানে C++, JavaScript, Java বা Python কোড লিখুন অথবা প্রস্তুত উদাহরণ বেছে নিন।',
      body_en: 'Write code in C++, JS, Java, or Python, or pick any built-in sample card.',
    },
    {
      title_bn: '২/৪ ভিজ্যুয়ালাইজ বাটন',
      title_en: '2/4 Press Visualize',
      body_bn: 'এক ক্লিকে (অথবা Ctrl+Enter চেপে) কোডটিকে জীবন্ত অ্যানিমেশনে রূপান্তর করুন।',
      body_en: 'Click Visualize (or press Ctrl+Enter) to generate the step-by-step animation.',
    },
    {
      title_bn: '৩/৪ প্লেয়ার ও স্ক্রাবার',
      title_en: '3/4 Step Player & Colored Scrubber',
      body_bn: 'Play, Pause বা যেকোনো রঙিন ডটে ক্লিক করে সামনে-পেছনে গিয়ে লজিক পরীক্ষা করুন।',
      body_en: 'Step forward, back, or click any colored dot on the scrubber to inspect state.',
    },
    {
      title_bn: '৪/৪ লাইন-বাই-লাইন বাংলা ব্যাখ্যা',
      title_en: '4/4 Bengali Line Notes & Fault Hints',
      body_bn: 'প্রতিটি লাইনের সহজ বাংলা নোট এবং ভুল লজিক হলে ঠিক করার উপায় সাথে সাথে দেখুন!',
      body_en: 'Read natural Bengali explanations for every line plus instant fix hints on faults.',
    },
  ];

  const step = trace.steps[currentStepIndex] || trace.steps[0];

  return (
    <>
      {/* 1. Command Palette Modal (Ctrl/Cmd + K) */}
      {commandPaletteOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
        >
          <div className="ll-panel rounded-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 sm:px-6 py-3.5 border-b border-[var(--border-subtle)]">
              <Command className="w-4 h-4 text-[#A3C1FF] shrink-0" />
              <input
                type="text"
                autoFocus
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
                placeholder={
                  explainLanguage === 'bn'
                    ? 'কমান্ড বা উদাহরণ খুঁজুন...'
                    : 'Type a command or example...'
                }
                className="flex-1 bg-transparent text-sm py-1 text-[var(--text-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                aria-label="Close Command Palette"
                className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2.5 sm:p-3 max-h-72 overflow-y-auto space-y-1.5">
              {filteredCommands.map((cmd) => (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={() => {
                    cmd.action();
                    setCommandPaletteOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left text-xs sm:text-sm text-[var(--text-primary)] hover:bg-[#A3C1FF]/15 transition-colors cursor-pointer gap-3"
                >
                  <span lang={explainLanguage} className="truncate">
                    {explainLanguage === 'bn' ? cmd.label_bn : cmd.label_en}
                  </span>
                  <kbd className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-secondary)] shrink-0">
                    {cmd.shortcut}
                  </kbd>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. Keyboard Shortcuts Modal (?) */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard Shortcuts"
        >
          <div className="ll-panel rounded-2xl w-full max-w-md p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 font-semibold text-base text-[var(--text-primary)]">
                <Keyboard className="w-5 h-5 text-[#A3C1FF]" />
                <span>
                  {explainLanguage === 'bn' ? 'কিবোর্ড শর্টকাট' : 'Keyboard Shortcuts'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close Keyboard Shortcuts"
                className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 text-xs">
              {[
                ['Visualize Code', 'Ctrl / Cmd + Enter'],
                ['Play / Pause', 'Space'],
                ['Previous / Next Step', '← / →'],
                ['First / Last Step', 'Home / End'],
                ['Reset Playback', 'R'],
                ['Toggle Theme (Midnight / Daybreak)', 'T'],
                ['Toggle Language (বাংলা / EN)', 'L'],
                ['Presentation Mode', 'F'],
                ['Command Palette', 'Ctrl / Cmd + K'],
                ['Shortcuts Sheet', '?'],
              ].map(([label, key]) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] gap-3"
                >
                  <span className="text-[var(--text-secondary)]">{label}</span>
                  <kbd className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-primary)] shrink-0">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. Guided 4-Step Tour Modal */}
      {tourStep !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Guided Tour"
        >
          <div className="ll-panel rounded-2xl w-full max-w-md p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#A3C1FF]">
                <Sparkles className="w-4 h-4" />
                {explainLanguage === 'bn' ? 'লজিক ল্যাব গাইড' : 'Quick Tour'}
              </span>
              <button
                type="button"
                onClick={() => setTourStep(null)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer p-1"
              >
                {explainLanguage === 'bn' ? 'বাদ দিন (Skip)' : 'Skip'}
              </button>
            </div>

            <h3 lang={explainLanguage} className="text-lg font-bold text-[var(--text-primary)] m-0 leading-snug">
              {explainLanguage === 'bn'
                ? tourSlides[tourStep].title_bn
                : tourSlides[tourStep].title_en}
            </h3>
            <p lang={explainLanguage} className="text-sm text-[var(--text-secondary)] m-0 leading-relaxed">
              {explainLanguage === 'bn'
                ? tourSlides[tourStep].body_bn
                : tourSlides[tourStep].body_en}
            </p>

            <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
              <div className="flex gap-2">
                {tourSlides.map((_, i) => (
                  <span
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${
                      i === tourStep ? 'bg-[#A3C1FF]' : 'bg-[var(--border-subtle)]'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2.5">
                {tourStep > 0 && (
                  <button
                    type="button"
                    onClick={() => setTourStep(tourStep - 1)}
                    className="px-3.5 py-2 rounded-xl text-xs font-medium bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    {explainLanguage === 'bn' ? 'পেছনে' : 'Back'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    tourStep < tourSlides.length - 1 ? setTourStep(tourStep + 1) : setTourStep(null)
                  }
                  className="ll-btn-primary px-4 sm:px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {tourStep < tourSlides.length - 1
                    ? explainLanguage === 'bn'
                      ? 'পরবর্তী'
                      : 'Next'
                    : explainLanguage === 'bn'
                    ? 'শুরু করুন'
                    : 'Done'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Fullscreen Presentation Mode (F) for Teachers */}
      {presentationMode && (
        <div
          className="fixed inset-0 z-50 bg-[var(--bg-app)] flex flex-col justify-between p-6 sm:p-8 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Presentation Mode"
        >
          <div className="flex items-center justify-between max-w-6xl w-full mx-auto pb-4 border-b border-[var(--border-subtle)]">
            <div className="space-y-1">
              <h2 lang={explainLanguage} className="text-2xl font-bold text-[var(--text-primary)] m-0">
                {trace.logicSummary.title}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] font-mono m-0">
                Line {step.activeLine} · Step {currentStepIndex + 1} of {trace.steps.length}
              </p>
            </div>
            <button
              type="button"
              onClick={togglePresentationMode}
              className="px-4 py-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-sm font-medium text-[var(--text-primary)] inline-flex items-center gap-2 cursor-pointer hover:border-[#A3C1FF] transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
              <span>{explainLanguage === 'bn' ? 'সাধারণ ভিউ (Esc/F)' : 'Exit Presentation (F)'}</span>
            </button>
          </div>

          <div className="max-w-5xl w-full mx-auto my-6 flex-1 flex flex-col justify-center gap-5">
            <StageCanvas />
            <div className="ll-panel rounded-2xl p-6 text-center space-y-2">
              <div className="text-lg sm:text-xl font-semibold text-[var(--text-primary)] leading-relaxed">
                <FormattedText text={step.explanation} lang={explainLanguage} />
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                <FormattedText text={step.why} lang={explainLanguage} />
              </div>
            </div>
            <PlayerBar />
          </div>
        </div>
      )}

      {/* 5. Share Visualization Link Modal (/s/:shareId) */}
      {shareModalOpen && lastCreatedShareUrl && lastCreatedShareId && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Share Visualization Link"
          data-testid="share-modal"
        >
          <div className="ll-panel rounded-2xl w-full max-w-md p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 font-semibold text-base text-[var(--text-primary)]">
                <Share2 className="w-5 h-5 text-[var(--text-accent)]" />
                <span lang={explainLanguage}>
                  {explainLanguage === 'bn'
                    ? 'ভিজ্যুয়ালাইজেশন শেয়ার লিংক'
                    : 'Share Visualization Link'}
                </span>
              </div>
              <button
                type="button"
                onClick={closeShareModal}
                aria-label="Close Share Modal"
                className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p lang={explainLanguage} className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed m-0">
              {explainLanguage === 'bn'
                ? 'এই রিড-অনলি লিংকটি যেকোনো শিক্ষার্থী বা শিক্ষকের সাথে শেয়ার করুন। সাইন ইন ছাড়াই তারা অ্যানিমেশন ও বাংলা ব্যাখ্যা দেখতে পারবেন।'
                : 'Share this read-only link with anyone. They can step through the animation and line-by-line notes without signing in.'}
            </p>

            <div className="p-3.5 sm:p-4 rounded-xl bg-[var(--bg-gutter)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)] break-all select-all">
              {lastCreatedShareUrl}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={closeShareModal}
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {explainLanguage === 'bn' ? 'বন্ধ করুন' : 'Close'}
              </button>
              <button
                type="button"
                onClick={() => void openShareViewById(lastCreatedShareId)}
                data-testid="open-shared-view-btn"
                className="ll-btn-primary px-4 sm:px-5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span lang={explainLanguage}>
                  {explainLanguage === 'bn'
                    ? `শেয়ার পেজ দেখুন`
                    : `Open /s/${lastCreatedShareId}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Undo Toast */}
      {toast && (
        <div
          className="fixed bottom-16 md:bottom-6 right-6 z-50 ll-panel rounded-2xl px-5 py-3.5 flex items-center gap-4 text-xs sm:text-sm shadow-2xl border border-[var(--border-subtle)]"
          role="status"
        >
          <span lang={explainLanguage} className="text-[var(--text-primary)] font-medium">
            {explainLanguage === 'bn' ? toast.message_bn : toast.message_en}
          </span>
          {toast.onUndo && (
            <button
              type="button"
              onClick={toast.onUndo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#A3C1FF] text-[#070A1A] font-bold cursor-pointer transition-transform hover:scale-105"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
          )}
          <button
            type="button"
            onClick={dismissToast}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] cursor-pointer transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
