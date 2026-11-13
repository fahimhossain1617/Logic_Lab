import React from 'react';
import { useLabStore } from '../../store/useLabStore';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

export const LoginView: React.FC = () => {
  const {
    explainLanguage,
    isAuthLoading,
    authError,
    signInWithGoogle,
    continueAsGuest,
    clearAuthError,
  } = useLabStore();

  return (
    <div
      className="min-h-[calc(100vh-120px)] flex items-center justify-center px-4 py-10"
      data-testid="login-page"
    >
      <div className="w-full max-w-md ll-panel rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
        {/* Top Back to Workspace Link */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={continueAsGuest}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span lang={explainLanguage}>
              {explainLanguage === 'bn' ? 'ওয়ার্কস্পেসে ফিরুন' : 'Back to Workspace'}
            </span>
          </button>
        </div>

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <img
            src="/logo.jpg"
            alt="Logic Lab Logo"
            className="w-14 h-14 rounded-2xl object-cover border border-[var(--border-subtle)] shadow-sm"
          />
          <div className="space-y-1.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] m-0">
              Logic Lab
            </h1>
            <p
              lang={explainLanguage}
              className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed m-0 max-w-xs"
            >
              {explainLanguage === 'bn'
                ? 'আপনার কোড ও রান ইতিহাস সংরক্ষণ করতে গুগল দিয়ে লগইন করুন'
                : 'Sign in with Google to save your code runs and history'}
            </p>
          </div>
        </div>

        {/* Auth Error Notice */}
        {authError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 text-xs text-[#FCA5A5]"
            data-testid="login-error-banner"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F87171]" />
            <div className="flex-1 space-y-1">
              <p className="m-0 leading-relaxed" lang={explainLanguage}>
                {explainLanguage === 'bn' ? authError.message_bn : authError.message_en}
              </p>
            </div>
            <button
              type="button"
              onClick={clearAuthError}
              className="text-[11px] text-[#FCA5A5] hover:text-white cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* Continue with Google (Only Sign-In Provider) */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            disabled={isAuthLoading}
            data-testid="google-signin-btn"
            className="w-full h-11 px-4 rounded-xl bg-[#131B2E] hover:bg-[#1A2540] border border-[#2D3B5E] hover:border-[#3B82F6] text-sm font-semibold text-[#F1F5F9] inline-flex items-center justify-center gap-3 transition-colors cursor-pointer disabled:opacity-60"
          >
            {isAuthLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#60A5FA]" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
            )}
            <span lang={explainLanguage}>
              {isAuthLoading
                ? explainLanguage === 'bn'
                  ? 'লগইন হচ্ছে...'
                  : 'Signing in...'
                : explainLanguage === 'bn'
                ? 'Continue with Google'
                : 'Continue with Google'}
            </span>
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase">
              {explainLanguage === 'bn' ? 'অথবা' : 'or'}
            </span>
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
          </div>

          <button
            type="button"
            onClick={continueAsGuest}
            data-testid="continue-as-guest-btn"
            className="w-full h-10 px-4 rounded-xl bg-[var(--bg-gutter)] hover:bg-[var(--bg-panel-raised)] border border-[var(--border-subtle)] hover:border-[#3B82F6]/50 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <span lang={explainLanguage}>
              {explainLanguage === 'bn' ? 'গেস্ট মোডে চালিয়ে যান' : 'Continue as Guest'}
            </span>
          </button>
        </div>

        {/* Guest Mode Explanation */}
        <p
          lang={explainLanguage}
          className="text-[11px] text-center text-[var(--text-muted)] leading-relaxed m-0 pt-2 border-t border-[var(--border-subtle)]"
        >
          {explainLanguage === 'bn'
            ? 'গেস্ট মোডে কোড রান, ব্যাখ্যা ও অ্যানিমেশন সবই করা যাবে—শুধুমাত্র কোনো ইতিহাস সেভ হবে না।'
            : 'In Guest mode you can run, explain, and animate code freely—only your run history will not be saved.'}
        </p>
      </div>
    </div>
  );
};

