import React, { useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { PROBLEM_LIBRARY } from '../../data/problemLibrary';
import { StageCanvas } from '../stage/StageCanvas';
import { PlayerBar } from '../player/PlayerBar';
import { ExplainerDeck } from '../explainer/ExplainerDeck';
import { FormattedText } from '../common/FormattedText';
import {
  Search,
  Play,
  Star,
  Trash2,
  Flame,
  Award,
  CheckCircle2,
  Sliders,
  AlertTriangle,
  Share2,
  CloudUpload,
  LogIn,
  LogOut,
  UserCheck,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Bug,
} from 'lucide-react';

export const LibraryView: React.FC = () => {
  const { explainLanguage, language, progress, loadLibraryProblem } = useLabStore();
  const [query, setQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');

  const topics = [
    'all',
    'Variables & Memory',
    'Arrays & Two Pointers',
    'Sorting',
    'Searching',
    'Stack & Queue',
    'Linked List & Recursion',
    'Loops & Control Flow',
  ];

  const filtered = PROBLEM_LIBRARY.filter((item) => {
    const matchesTopic = topicFilter === 'all' || item.topic === topicFilter;
    const matchesDiff = difficultyFilter === 'all' || item.difficulty === difficultyFilter;
    const q = query.toLowerCase();
    const matchesQuery =
      !q ||
      item.title_bn.toLowerCase().includes(q) ||
      item.title_en.toLowerCase().includes(q) ||
      item.topic.toLowerCase().includes(q) ||
      item.concept_bn.toLowerCase().includes(q) ||
      item.concept_en.toLowerCase().includes(q);
    return matchesTopic && matchesDiff && matchesQuery;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--text-accent)] mb-1">
            <Layers className="w-3.5 h-3.5" />
            <span>{PROBLEM_LIBRARY.length} Curated DSA Problems · Correct & Faulty Pairs</span>
          </div>
          <h1 lang={explainLanguage} className="text-2xl font-bold text-[var(--text-primary)]">
            {explainLanguage === 'bn' ? 'প্রবলেম লাইব্রেরি (Problem Library)' : 'DSA Problem Library'}
          </h1>
          <p lang={explainLanguage} className="text-sm text-[var(--text-secondary)]">
            {explainLanguage === 'bn'
              ? 'প্রতিটি প্রবলেমের সঠিক কোড এবং সাধারণ ভুল (Faulty Bug) দুটোই চালিয়ে অ্যানিমেশনে পার্থক্য দেখুন।'
              : 'Launch any problem in either its correct form or its faulty bug version to see how the animation reacts.'}
          </p>
        </div>

        {/* Search Input + Difficulty Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={explainLanguage === 'bn' ? 'প্রবলেম খুঁজুন...' : 'Search 13 problems...'}
              aria-label="Search problems"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#A3C1FF] transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-gutter)]/60 border border-[var(--border-subtle)]">
            {(['all', 'easy', 'medium', 'hard'] as const).map((diff) => (
              <button
                key={diff}
                type="button"
                onClick={() => setDifficultyFilter(diff)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono capitalize cursor-pointer transition-colors ${
                  difficultyFilter === diff
                    ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                }`}
              >
                {diff}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Topic Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-[var(--bg-gutter)]/60 border border-[var(--border-subtle)]">
        {topics.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTopicFilter(t)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              topicFilter === t
                ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
            }`}
          >
            {t === 'all' ? (explainLanguage === 'bn' ? 'সবগুলো টপিক (১৩)' : 'All Topics (13)') : t}
          </button>
        ))}
      </div>

      {/* Problem Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="library-grid">
        {filtered.map((item) => {
          const isCompleted = progress.completedProblemIds.includes(item.id);
          return (
            <div
              key={item.id}
              data-testid={`problem-card-${item.id}`}
              className="ll-panel rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-5 hover:border-[#A3C1FF]/60 transition-colors"
            >
              <div className="space-y-3.5">
                <div className="flex items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-1 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] font-mono text-[var(--text-secondary)]">
                      {item.topic}
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-md font-mono uppercase text-[10px] font-semibold ${
                        item.difficulty === 'easy'
                          ? 'bg-[#4ADE9B]/15 text-[var(--text-success)]'
                          : item.difficulty === 'medium'
                          ? 'bg-[#FFC46B]/15 text-[var(--text-warning)]'
                          : 'bg-[#FF6B7D]/15 text-[var(--text-danger)]'
                      }`}
                    >
                      {item.difficulty}
                    </span>
                  </div>

                  {isCompleted && (
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-success)] font-medium text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span lang={explainLanguage}>
                        {explainLanguage === 'bn' ? 'সম্পন্ন' : 'Completed'}
                      </span>
                    </span>
                  )}
                </div>

                <div>
                  <h2 lang={explainLanguage} className="text-lg font-bold text-[var(--text-primary)] m-0">
                    {explainLanguage === 'bn' ? item.title_bn : item.title_en}
                  </h2>
                  <p lang={explainLanguage} className="text-xs text-[var(--text-secondary)] mt-1 mb-0 leading-relaxed">
                    {explainLanguage === 'bn' ? item.concept_bn : item.concept_en}
                  </p>
                </div>

                {/* Concept & Faulty Bug Preview */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[var(--bg-gutter)]/65 border border-[var(--border-subtle)] space-y-1">
                    <div className="font-semibold text-[var(--text-accent)]">
                      {explainLanguage === 'bn' ? 'মূল ধারণা (Concept)' : 'Core Concept'}
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] m-0 leading-relaxed">
                      <FormattedText
                        text={explainLanguage === 'bn' ? item.concept_bn : item.concept_en}
                        lang={explainLanguage}
                      />
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FF6B7D]/8 border border-[#FF6B7D]/25 space-y-1">
                    <div className="font-semibold text-[var(--text-danger)] flex items-center gap-1.5">
                      <Bug className="w-3.5 h-3.5" />
                      <span>{explainLanguage === 'bn' ? 'ভুল কোডের বাগ' : 'Faulty Bug Demo'}</span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] m-0 leading-relaxed">
                      <FormattedText
                        text={explainLanguage === 'bn' ? item.bugHint_bn : item.bugHint_en}
                        lang={explainLanguage}
                      />
                    </p>
                  </div>
                </div>

                <pre className="p-3.5 rounded-xl bg-[#070A1A] border border-[var(--border-subtle)] text-xs font-mono text-[#C6D8FF] overflow-x-auto max-h-32 m-0 leading-relaxed">
                  {item.codes[language]}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => void loadLibraryProblem(item.id, true)}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-[#FF6B7D]/45 bg-[#FF6B7D]/12 text-[var(--text-danger)] hover:bg-[#FF6B7D]/20 inline-flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span lang={explainLanguage}>
                    {explainLanguage === 'bn' ? 'ভুল কোড পরীক্ষা করুন' : 'Run Faulty Version'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void loadLibraryProblem(item.id, false)}
                  className="ll-btn-primary px-4 sm:px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span lang={explainLanguage}>
                    {explainLanguage === 'bn' ? 'সঠিক কোড চালান' : 'Run Correct Code'}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const HistoryView: React.FC = () => {
  const {
    user,
    guestWorkMigrated,
    snippets,
    historyItems,
    explainLanguage,
    toggleFavoriteSnippet,
    deleteSnippet,
    toggleFavoriteHistory,
    deleteHistoryItem,
    migrateGuestToAccount,
    setCode,
    setLanguage,
    setActiveRoute,
    runVisualize,
    createShareLink,
  } = useLabStore();

  const [tab, setTab] = useState<'snippets' | 'runs'>('snippets');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 lang={explainLanguage} className="text-2xl font-bold text-[var(--text-primary)]">
            {explainLanguage === 'bn'
              ? 'সংরক্ষিত স্নিপেট ও ইতিহাস (Snippets & History)'
              : 'Saved Snippets & Run History'}
          </h1>
          <p lang={explainLanguage} className="text-sm text-[var(--text-secondary)]">
            {explainLanguage === 'bn'
              ? 'আপনার সংরক্ষিত কোড এবং সাম্প্রতিক ভিজ্যুয়ালাইজেশন। মুছে ফেললে এক ক্লিকে Undo করতে পারবেন।'
              : 'Your saved code snippets and recent runs. Delete any entry with one-click Undo.'}
          </p>
        </div>

        {/* Segmented Switcher: Snippets vs Recent Runs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-gutter)]/70 border border-[var(--border-subtle)] self-start">
          <button
            type="button"
            onClick={() => setTab('snippets')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'snippets'
                ? 'bg-[#A3C1FF] text-[#070A1A]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {explainLanguage === 'bn'
              ? `সংরক্ষিত কোড (${snippets.length})`
              : `Saved Snippets (${snippets.length})`}
          </button>
          <button
            type="button"
            onClick={() => setTab('runs')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'runs'
                ? 'bg-[#A3C1FF] text-[#070A1A]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {explainLanguage === 'bn'
              ? `সাম্প্রতিক রান (${historyItems.length})`
              : `Recent Runs (${historyItems.length})`}
          </button>
        </div>
      </div>

      {/* One-Tap Guest-to-Account Migration Banner */}
      {!guestWorkMigrated && (
        <div className="ll-panel rounded-2xl p-4 border border-[#A3C1FF]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CloudUpload className="w-5 h-5 text-[var(--text-accent)] shrink-0 mt-0.5" />
            <div>
              <h2 lang={explainLanguage} className="text-sm font-semibold text-[var(--text-primary)]">
                {explainLanguage === 'bn'
                  ? 'গেস্ট মোডের কাজ আপনার অ্যাকাউন্টে স্থানান্তর করুন'
                  : 'Move your guest work to your account'}
              </h2>
              <p lang={explainLanguage} className="text-xs text-[var(--text-secondary)]">
                {explainLanguage === 'bn'
                  ? `আপনার লোকাল ব্রাউজারে ${snippets.length}টি স্নিপেট এবং ${historyItems.length}টি রান জমা আছে। এক ক্লিকে ক্লাউড অ্যাকাউন্টে সিঙ্ক করুন।`
                  : `You have ${snippets.length} saved snippets and ${historyItems.length} runs in guest storage. Sync them to your account in one tap.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={migrateGuestToAccount}
            data-testid="migrate-guest-btn"
            className="ll-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            <span lang={explainLanguage}>
              {explainLanguage === 'bn'
                ? 'অ্যাকাউন্টে স্থানান্তর করুন'
                : 'Move my work to my account'}
            </span>
          </button>
        </div>
      )}

      {user && guestWorkMigrated && (
        <div className="px-4 py-2.5 rounded-xl bg-[#4ADE9B]/12 border border-[#4ADE9B]/35 text-xs text-[var(--text-success)] flex items-center gap-2">
          <UserCheck className="w-4 h-4 shrink-0" />
          <span lang={explainLanguage}>
            {explainLanguage === 'bn'
              ? `${user.displayName}-এর অ্যাকাউন্টের সাথে সব স্নিপেট ও ইতিহাস সিঙ্ক করা হয়েছে।`
              : `All snippets and run history are synced with ${user.displayName}.`}
          </span>
        </div>
      )}

      {/* Snippets List */}
      {tab === 'snippets' && (
        <div className="space-y-3">
          {snippets.map((item) => (
            <div
              key={item.id}
              className="ll-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-mono uppercase">{item.language}</span>
                  <span>·</span>
                  <span>{item.analogyType}</span>
                  <span>·</span>
                  <span>{item.updatedAt}</span>
                </div>
                <h3
                  lang={explainLanguage}
                  className="text-base font-semibold text-[var(--text-primary)] truncate"
                >
                  {explainLanguage === 'bn' ? item.title_bn : item.title_en}
                </h3>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleFavoriteSnippet(item.id)}
                  aria-label={`Favorite ${item.title_en}`}
                  className={`w-10 h-10 rounded-xl border border-[var(--border-subtle)] flex items-center justify-center cursor-pointer transition-colors ${
                    item.isFavorite
                      ? 'text-[#FFC46B] bg-[#FFC46B]/15 border-[#FFC46B]/40'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                  }`}
                >
                  <Star className="w-4 h-4 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLanguage(item.language);
                    setCode(item.code);
                    void createShareLink();
                  }}
                  aria-label={`Share ${item.title_en}`}
                  className="w-10 h-10 rounded-xl border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[#A3C1FF] hover:bg-[var(--border-subtle)] cursor-pointer transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => deleteSnippet(item.id)}
                  aria-label={`Delete ${item.title_en}`}
                  className="w-10 h-10 rounded-xl border border-[var(--border-subtle)] flex items-center justify-center text-[#FF6B7D] hover:bg-[#FF6B7D]/15 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLanguage(item.language);
                    setCode(item.code);
                    setActiveRoute('/');
                    void runVisualize();
                  }}
                  className="ll-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {explainLanguage === 'bn' ? 'খুলুন ও চালান' : 'Open & Run'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Runs List */}
      {tab === 'runs' && (
        <div className="space-y-3.5">
          {historyItems.map((item) => (
            <div
              key={item.id}
              className="ll-panel rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-mono uppercase font-semibold">{item.language}</span>
                  <span>·</span>
                  <span>{item.analogyType}</span>
                  <span>·</span>
                  <span>{item.timestamp}</span>
                </div>
                <h3
                  lang={explainLanguage}
                  className="text-base font-semibold text-[var(--text-primary)] truncate m-0"
                >
                  {explainLanguage === 'bn' ? item.title_bn : item.title_en}
                </h3>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleFavoriteHistory(item.id)}
                  aria-label={`Favorite ${item.title_en}`}
                  className={`w-10 h-10 rounded-xl border border-[var(--border-subtle)] flex items-center justify-center cursor-pointer transition-colors ${
                    item.favorite
                      ? 'text-[#FFC46B] bg-[#FFC46B]/15 border-[#FFC46B]/40'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                  }`}
                >
                  <Star className="w-4 h-4 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={() => deleteHistoryItem(item.id)}
                  aria-label={`Delete ${item.title_en}`}
                  className="w-10 h-10 rounded-xl border border-[var(--border-subtle)] flex items-center justify-center text-[#FF6B7D] hover:bg-[#FF6B7D]/15 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLanguage(item.language);
                    setCode(item.code);
                    setActiveRoute('/');
                    void runVisualize();
                  }}
                  className="ll-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {explainLanguage === 'bn' ? 'আবার চালান' : 'Load & Run'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ALL_BADGES = [
  {
    id: 'first_visualize',
    title_bn: 'প্রথম ভিজ্যুয়ালাইজেশন (First Spark)',
    title_en: 'First Visualization',
    desc_bn: 'প্রথমবার কোড অ্যানিমেশন চালিয়েছেন',
    desc_en: 'Ran your first step-by-step code animation',
  },
  {
    id: 'swap_master',
    title_bn: 'সোয়াপ মাস্টার (Swap Master)',
    title_en: 'Swap Master',
    desc_bn: '`temp` ব্যবহার করে সঠিক ভ্যারিয়েবল অদলবদল শিখেছেন',
    desc_en: 'Mastered variable swapping with a temporary cup',
  },
  {
    id: 'bug_hunter',
    title_bn: 'বাগ হান্টার (Bug Hunter)',
    title_en: 'Bug Hunter',
    desc_bn: 'অসীম লুপ ও হারানো মানের লজিক ত্রুটি শনাক্ত করেছেন',
    desc_en: 'Inspected an honest failure animation and fix hint',
  },
  {
    id: 'bug_detective',
    title_bn: 'ফল্ট ডিটেক্টিভ (Fault Detective)',
    title_en: 'Fault Detective',
    desc_bn: 'লাইব্রেরি থেকে ভুল কোড চালিয়ে বাগ পরীক্ষা করেছেন',
    desc_en: 'Tested a faulty bug version from the Problem Library',
  },
  {
    id: 'dsa_explorer',
    title_bn: 'ডিএসএ এক্সপ্লোরার (DSA Explorer)',
    title_en: 'DSA Explorer',
    desc_bn: '৬টির বেশি ডিএসএ প্রবলেম সম্পন্ন করেছেন',
    desc_en: 'Completed 6 or more curated DSA problems',
  },
  {
    id: 'cloud_synced',
    title_bn: 'ক্লাউড সিঙ্কড (Cloud Synced)',
    title_en: 'Cloud Synced',
    desc_bn: 'গেস্ট মোডের কাজ অ্যাকাউন্টে সংরক্ষণ করেছেন',
    desc_en: 'Migrated guest work to your cloud account',
  },
];

export const ProgressView: React.FC = () => {
  const { explainLanguage, progress } = useLabStore();
  const totalProblems = PROBLEM_LIBRARY.length;
  const completedCount = progress.completedProblemIds.length;
  const pct = Math.min(100, Math.round((completedCount / totalProblems) * 100));

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 lang={explainLanguage} className="text-2xl font-bold text-[var(--text-primary)]">
          {explainLanguage === 'bn' ? 'শেখার অগ্রগতি (Learning Progress)' : 'Learning Progress & Badges'}
        </h1>
        <p lang={explainLanguage} className="text-sm text-[var(--text-secondary)]">
          {explainLanguage === 'bn'
            ? 'আপনার প্রতিদিনের ধারাবাহিকতা, সম্পন্ন করা ডিএসএ প্রবলেম এবং অর্জিত ব্যাজ।'
            : 'Track your daily visualization streak, completed DSA problems, and unlocked badges.'}
        </p>
      </div>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="ll-panel rounded-2xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-[var(--text-warning)] text-sm font-semibold">
            <Flame className="w-5 h-5" />
            <span>{explainLanguage === 'bn' ? 'দিনের স্ট্রিক' : 'Active Streak'}</span>
          </div>
          <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">
            {progress.streak} {explainLanguage === 'bn' ? 'দিন' : 'Days'}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {explainLanguage === 'bn' ? 'সর্বশেষ সক্রিয়: আজ' : `Last active: ${progress.lastActiveDate}`}
          </div>
        </div>

        <div className="ll-panel rounded-2xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-[var(--text-success)] text-sm font-semibold">
            <CheckCircle2 className="w-5 h-5" />
            <span>{explainLanguage === 'bn' ? 'সম্পন্ন প্রবলেম' : 'Problems Completed'}</span>
          </div>
          <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">
            {completedCount} / {totalProblems}
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--bg-gutter)] overflow-hidden">
            <div
              className="h-full bg-[#4ADE9B] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="ll-panel rounded-2xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-[var(--text-accent)] text-sm font-semibold">
            <Award className="w-5 h-5" />
            <span>{explainLanguage === 'bn' ? 'অর্জিত ব্যাজ' : 'Badges Unlocked'}</span>
          </div>
          <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">
            {progress.badges.length} / {ALL_BADGES.length}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {progress.topicsCovered.length} DSA topics explored
          </div>
        </div>
      </div>

      {/* Badges Grid */}
      <div className="ll-panel rounded-2xl p-6 space-y-4">
        <h2 lang={explainLanguage} className="text-base font-semibold text-[var(--text-primary)]">
          {explainLanguage === 'bn' ? 'ব্যাজ ও মাইলফলক (Milestones)' : 'Badges & Milestones'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {ALL_BADGES.map((badge) => {
            const unlocked = progress.badges.includes(badge.id);
            return (
              <div
                key={badge.id}
                className={`p-4 rounded-xl border transition-all ${
                  unlocked
                    ? 'bg-[#A3C1FF]/12 border-[#A3C1FF]/45'
                    : 'bg-[var(--bg-gutter)]/40 border-[var(--border-subtle)] opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Sparkles
                    className={`w-4 h-4 ${
                      unlocked ? 'text-[var(--text-accent)]' : 'text-[var(--text-muted)]'
                    }`}
                  />
                  <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)]">
                    {unlocked ? 'Unlocked' : 'Locked'}
                  </span>
                </div>
                <div lang={explainLanguage} className="text-sm font-semibold text-[var(--text-primary)]">
                  {explainLanguage === 'bn' ? badge.title_bn : badge.title_en}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  <FormattedText
                    text={explainLanguage === 'bn' ? badge.desc_bn : badge.desc_en}
                    lang={explainLanguage}
                  />
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const SettingsView: React.FC = () => {
  const {
    user,
    guestWorkMigrated,
    theme,
    explainLanguage,
    depth,
    speed,
    reduceMotion,
    editorFontSize,
    setTheme,
    setExplainLanguage,
    setDepth,
    setSpeed,
    setReduceMotion,
    setEditorFontSize,
    signInWithGoogle,
    signInDemoStudent,
    signOutUser,
    migrateGuestToAccount,
  } = useLabStore();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2.5">
        <Sliders className="w-6 h-6 text-[var(--text-accent)]" />
        <h1 lang={explainLanguage} className="text-2xl font-bold text-[var(--text-primary)]">
          {explainLanguage === 'bn' ? 'অ্যাকাউন্ট ও সেটিংস (Settings)' : 'Account & Preferences'}
        </h1>
      </div>

      {/* Account & Cloud Sync Panel */}
      <div className="ll-panel rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 lang={explainLanguage} className="text-base font-semibold text-[var(--text-primary)]">
              {explainLanguage === 'bn'
                ? 'অ্যাকাউন্ট ও ক্লাউড সিঙ্ক (Firebase Auth & Firestore)'
                : 'Account & Cloud Persistence'}
            </h2>
            <p lang={explainLanguage} className="text-xs text-[var(--text-secondary)]">
              {user
                ? explainLanguage === 'bn'
                  ? `সাইন ইন করা আছে: ${user.displayName} (${user.email})`
                  : `Signed in as ${user.displayName} (${user.email})`
                : explainLanguage === 'bn'
                ? 'সাইন ইন ছাড়াই সব ফিচার ব্যবহার করা যায়। সাইন ইন করলে আপনার স্নিপেট ও অগ্রগতি ক্লাউডে সংরক্ষিত থাকবে।'
                : 'Everything works without an account. Sign in to sync snippets, history, and streaks across devices.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!user ? (
              <>
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  className="ll-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span lang={explainLanguage}>
                    {explainLanguage === 'bn' ? 'Google দিয়ে সাইন ইন' : 'Sign in with Google'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={signInDemoStudent}
                  data-testid="demo-signin-btn"
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[#A3C1FF] cursor-pointer"
                >
                  {explainLanguage === 'bn' ? 'ডেমো স্টুডেন্ট সাইন ইন' : 'Instant Demo Account'}
                </button>
              </>
            ) : (
              <>
                {!guestWorkMigrated && (
                  <button
                    type="button"
                    onClick={migrateGuestToAccount}
                    className="ll-btn-primary px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>
                      {explainLanguage === 'bn'
                        ? 'গেস্ট ডেটা স্থানান্তর করুন'
                        : 'Move my work to my account'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#FF6B7D]/45 text-[var(--text-danger)] hover:bg-[#FF6B7D]/15 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{explainLanguage === 'bn' ? 'সাইন আউট' : 'Sign Out'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="ll-panel rounded-2xl p-6 space-y-5">
        {/* Theme */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-sm text-[var(--text-primary)]">
              {explainLanguage === 'bn' ? 'থিম (Theme)' : 'Color Theme'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              LogicLab Midnight (Dark) / LogicLab Daybreak (Light)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                theme === 'dark'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
              }`}
            >
              Midnight Dark
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                theme === 'light'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
              }`}
            >
              Daybreak Light
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="flex items-center justify-between gap-4 pt-4 border-t border-[var(--border-subtle)]">
          <div>
            <div className="font-semibold text-sm text-[var(--text-primary)]">
              {explainLanguage === 'bn' ? 'ব্যাখ্যার ভাষা (Explanation Language)' : 'Explanation Language'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Default Bengali (বাংলা) or English
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExplainLanguage('bn')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                explainLanguage === 'bn'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
              }`}
            >
              বাংলা (Bengali)
            </button>
            <button
              type="button"
              onClick={() => setExplainLanguage('en')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                explainLanguage === 'en'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
              }`}
            >
              English
            </button>
          </div>
        </div>

        {/* Depth */}
        <div className="flex items-center justify-between gap-4 pt-4 border-t border-[var(--border-subtle)]">
          <div>
            <div className="font-semibold text-sm text-[var(--text-primary)]">
              {explainLanguage === 'bn' ? 'ব্যাখ্যার গভীরতা (Explanation Depth)' : 'Explanation Depth'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Simple (1 sentence) or Detailed (includes memory trace)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDepth('simple')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                depth === 'simple'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setDepth('detailed')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                depth === 'detailed'
                  ? 'bg-[#A3C1FF] text-[#070A1A] font-semibold'
                  : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
              }`}
            >
              Detailed
            </button>
          </div>
        </div>

        {/* Reduce Motion */}
        <div className="flex items-center justify-between gap-4 pt-4 border-t border-[var(--border-subtle)]">
          <div>
            <div className="font-semibold text-sm text-[var(--text-primary)]">
              {explainLanguage === 'bn' ? 'অ্যানিমেশন কমান (Reduce Motion)' : 'Reduce Motion'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Instant state transitions for motion-sensitive learners
            </div>
          </div>
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
            aria-label="Reduce motion"
            className="w-5 h-5 accent-[#A3C1FF] cursor-pointer"
          />
        </div>

        {/* Font Size & Speed */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[var(--border-subtle)]">
          <div>
            <div className="font-semibold text-sm text-[var(--text-primary)]">
              {explainLanguage === 'bn' ? 'এডিটর ফন্ট সাইজ' : 'Editor Font Size'}: {editorFontSize}px · Speed: {speed}x
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[12, 14, 16, 18].map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setEditorFontSize(sz, false)}
                className={`px-2.5 py-1 rounded-lg font-mono text-xs cursor-pointer ${
                  editorFontSize === sz
                    ? 'bg-[#A3C1FF] text-[#070A1A] font-bold'
                    : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
                }`}
              >
                {sz}px
              </button>
            ))}
            {[0.5, 1, 2].map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSpeed(sp)}
                className={`px-2.5 py-1 rounded-lg font-mono text-xs cursor-pointer ${
                  speed === sp
                    ? 'bg-[#4ADE9B] text-[#070A1A] font-bold'
                    : 'bg-[var(--bg-gutter)] text-[var(--text-secondary)]'
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SharedRunView: React.FC = () => {
  const { sharedRun, explainLanguage, code, language, forkSharedToPlayground } = useLabStore();
  const [copied, setCopied] = useState(false);

  const shareId = sharedRun?.shareId || 'demo-swap';
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/s/${shareId}` : `/s/${shareId}`;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4" data-testid="shared-run-view">
      {/* Read-Only Shared Visualization Banner */}
      <div className="ll-panel rounded-2xl p-4 sm:p-5 border border-[#A3C1FF]/45 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-[var(--text-accent)]">
            <Share2 className="w-3.5 h-3.5" />
            <span>READ-ONLY SHARED VISUALIZATION · /s/{shareId}</span>
          </div>
          <h1 lang={explainLanguage} className="text-xl font-bold text-[var(--text-primary)]">
            {sharedRun
              ? explainLanguage === 'bn'
                ? sharedRun.title_bn
                : sharedRun.title_en
              : explainLanguage === 'bn'
              ? 'শেয়ার করা কোড ভিজ্যুয়ালাইজেশন'
              : 'Shared Code Visualization'}
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">
            {explainLanguage === 'bn'
              ? `শেয়ার করেছেন: ${sharedRun?.authorName || 'Logic Lab Student'} · ভাষা: ${language.toUpperCase()}`
              : `Shared by ${sharedRun?.authorName || 'Logic Lab Student'} · Language: ${language.toUpperCase()}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="px-3.5 py-2 rounded-xl text-xs font-mono bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#4ADE9B]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : `/s/${shareId}`}</span>
          </button>

          <button
            type="button"
            onClick={forkSharedToPlayground}
            className="ll-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span lang={explainLanguage}>
              {explainLanguage === 'bn' ? 'প্লেগ্রাউন্ডে এডিট করুন' : 'Open in Playground'}
            </span>
          </button>
        </div>
      </div>

      {/* Read-only Code + Live Stage + Player + Explainer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-5 ll-panel rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-[var(--text-muted)]">
            <span>Read-Only Source ({language})</span>
            <span>{code.split('\n').length} lines</span>
          </div>
          <pre className="p-3.5 rounded-xl bg-[#070A1A] border border-[var(--border-subtle)] text-xs font-mono text-[#E4ECFF] overflow-x-auto leading-relaxed">
            {code}
          </pre>
        </div>

        <div className="lg:col-span-7 space-y-3">
          <StageCanvas />
          <PlayerBar />
          <ExplainerDeck />
        </div>
      </div>
    </div>
  );
};
