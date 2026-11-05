import { create } from 'zustand';
import {
  ExecutionTrace,
  ExplainLanguage,
  ExplanationDepth,
  SupportedLanguage,
} from '../../shared/types';
import { SAMPLE_PROGRAMS, resolveTraceForCode } from '../data/sampleTraces';
import { PROBLEM_LIBRARY } from '../data/problemLibrary';
import { clampStepIndex, findFirstStepForLine } from '../utils/playerLogic';
import {
  AppUserProfile,
  signInWithGooglePopup,
  signOutFirebase,
  subscribeToAuthChanges,
  syncUserProfileToFirestore,
  saveSnippetToFirestore,
  deleteSnippetFromFirestore,
  saveHistoryToFirestore,
  syncProgressToFirestore,
  createShareInFirestore,
  getShareFromFirestore,
  fetchUserCloudData,
} from '../lib/firebase';

export type AppRoute = '/' | '/library' | '/history' | '/progress' | '/settings' | '/share';
export type DeckTab = 'explain' | 'output' | 'summary';
export type MobileTab = 'code' | 'stage' | 'explain' | 'output';
export type WorkspaceResultTab = 'explanation' | 'animation';

export interface UserCodeFile {
  id: string;
  folderName: string;
  fileName: string;
  language: SupportedLanguage;
  code: string;
}

export interface SavedSnippetItem {
  id: string;
  title_bn: string;
  title_en: string;
  language: SupportedLanguage;
  code: string;
  stdin: string;
  analogyType: ExecutionTrace['analogyType'];
  isFavorite: boolean;
  problemId?: string;
  updatedAt: string;
}

export interface SavedHistoryItem {
  id: string;
  title_bn: string;
  title_en: string;
  language: SupportedLanguage;
  code: string;
  analogyType: ExecutionTrace['analogyType'];
  verdictStatus: ExecutionTrace['verdict']['status'];
  favorite: boolean;
  timestamp: string;
}

export interface UserProgressState {
  streak: number;
  lastActiveDate: string;
  completedProblemIds: string[];
  badges: string[];
  topicsCovered: string[];
}

export interface SharedVisualizationData {
  shareId: string;
  authorName: string;
  title_bn: string;
  title_en: string;
  language: SupportedLanguage;
  code: string;
  trace: ExecutionTrace;
  createdAt: string;
}

export interface ToastMessage {
  id: string;
  message_bn: string;
  message_en: string;
  onUndo?: () => void;
}

export interface BilingualMessage {
  code: string;
  message_bn: string;
  message_en: string;
}

const EMPTY_INITIAL_TRACE: ExecutionTrace = {
  isValidLogic: true,
  errorDetails: null,
  language: 'javascript',
  analogyType: 'generic_memory',
  traceSource: 'real_execution',
  logicSummary: {
    title: '',
    goal: '',
    idea: '',
    keyPoints: [],
    analogyStory: '',
    complexity: { time: '—', space: '—', note: '' },
    commonMistakes: [],
  },
  lineNotes: [],
  steps: [],
  finalOutput: '',
  outputExplanation: '',
  verdict: { status: 'ok', message: '' },
};

function inferLanguageFromFileName(
  fileName: string,
  fallback: SupportedLanguage
): SupportedLanguage {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (
    lower.endsWith('.cpp') ||
    lower.endsWith('.cc') ||
    lower.endsWith('.c') ||
    lower.endsWith('.h')
  ) {
    return 'cpp';
  }
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return 'javascript';
  return fallback;
}

function defaultExtensionForLanguage(lang: SupportedLanguage): string {
  switch (lang) {
    case 'python':
      return '.py';
    case 'cpp':
      return '.cpp';
    case 'java':
      return '.java';
    case 'javascript':
    default:
      return '.js';
  }
}

interface LabState {
  activeRoute: AppRoute;
  theme: 'dark' | 'light';
  explainLanguage: ExplainLanguage;
  depth: ExplanationDepth;
  language: SupportedLanguage;
  activeSampleId: string;

  // User-First Zero-State File System
  userFiles: UserCodeFile[];
  activeFileId: string;
  folderName: string;
  fileName: string;
  code: string;
  hasExecuted: boolean;
  activeResultTab: WorkspaceResultTab;

  isDirty: boolean;
  trace: ExecutionTrace;
  currentStepIndex: number;
  prevStepIndex: number;
  isPlaying: boolean;
  speed: number;
  reduceMotion: boolean;
  editorFontSize: number;
  activeDeckTab: DeckTab;
  mobileTab: MobileTab;
  isTracing: boolean;
  traceProgressStage: 0 | 1 | 2 | 3;
  apiError: BilingualMessage | null;
  apiNotice: BilingualMessage | null;
  hoveredVariable: string | null;
  hoveredLine: number | null;
  cursorPosition: { lineNumber: number; column: number };
  presentationMode: boolean;
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;
  tourStep: number | null;

  user: AppUserProfile | null;
  isAuthReady: boolean;
  isCloudSyncing: boolean;
  guestWorkMigrated: boolean;
  snippets: SavedSnippetItem[];
  historyItems: SavedHistoryItem[];
  progress: UserProgressState;
  sharedRun: SharedVisualizationData | null;
  shareModalOpen: boolean;
  lastCreatedShareUrl: string | null;
  lastCreatedShareId: string | null;
  toast: ToastMessage | null;

  // Actions
  initAuthAndCloudSync: () => () => void;
  setActiveRoute: (route: AppRoute) => void;
  setActiveResultTab: (tab: WorkspaceResultTab) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleExplainLanguage: () => void;
  setExplainLanguage: (lang: ExplainLanguage) => void;
  setDepth: (depth: ExplanationDepth) => void;
  setLanguage: (lang: SupportedLanguage) => void;

  // Folder & File Actions
  setFolderName: (folderName: string) => void;
  setFileName: (fileName: string) => void;
  createNewUserFile: () => void;
  selectUserFile: (fileId: string) => void;
  deleteUserFile: (fileId: string) => void;

  selectSample: (sampleId: string) => void;
  loadLibraryProblem: (problemId: string, useFaulty?: boolean) => Promise<void>;
  setCode: (code: string) => void;
  resetSnippetToNew: () => void;
  runVisualize: () => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  nextStep: () => void;
  prevStep: () => void;
  resetPlayback: () => void;
  goToStep: (idx: number) => void;
  jumpToLine: (line: number) => void;
  setSpeed: (speed: number) => void;
  setReduceMotion: (rm: boolean) => void;
  setEditorFontSize: (deltaOrValue: number, isDelta?: boolean) => void;
  setActiveDeckTab: (tab: DeckTab) => void;
  setMobileTab: (tab: MobileTab) => void;
  setHoveredVariable: (v: string | null) => void;
  setHoveredLine: (line: number | null) => void;
  setCursorPosition: (pos: { lineNumber: number; column: number }) => void;
  togglePresentationMode: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setTourStep: (step: number | null) => void;

  signInWithGoogle: () => Promise<void>;
  signInDemoStudent: () => void;
  signOutUser: () => Promise<void>;
  migrateGuestToAccount: () => void;
  saveCurrentSnippet: () => void;
  toggleFavoriteSnippet: (id: string) => void;
  deleteSnippet: (id: string) => void;
  toggleFavoriteHistory: (id: string) => void;
  deleteHistoryItem: (id: string) => void;
  createShareLink: () => Promise<string>;
  openShareViewById: (shareId: string) => Promise<void>;
  closeShareModal: () => void;
  forkSharedToPlayground: () => void;
  dismissToast: () => void;
  dismissApiNotice: () => void;
}

const INITIAL_USER_FILE: UserCodeFile = {
  id: 'file-1',
  folderName: 'my-project',
  fileName: 'main.js',
  language: 'javascript',
  code: '',
};

const INITIAL_PROGRESS: UserProgressState = {
  streak: 1,
  lastActiveDate: new Date().toISOString().slice(0, 10),
  completedProblemIds: [],
  badges: [],
  topicsCovered: [],
};

async function fetchTraceFromApi(
  params: {
    code: string;
    language: SupportedLanguage;
    explainLanguage: ExplainLanguage;
    depth: ExplanationDepth;
    fileName?: string;
  },
  uid?: string
): Promise<{
  trace?: ExecutionTrace;
  apiNotice?: BilingualMessage | null;
  error?: BilingualMessage;
}> {
  const res = await fetch('/api/trace', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-uid': uid || 'guest-local',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    return { error: data.error };
  }
  return {
    trace: data.trace,
    apiNotice: data.apiNotice || null,
  };
}

export const useLabStore = create<LabState>((set, get) => ({
  activeRoute: '/',
  theme: 'dark',
  explainLanguage: 'bn',
  depth: 'detailed',
  language: 'javascript',
  activeSampleId: '',

  userFiles: [INITIAL_USER_FILE],
  activeFileId: INITIAL_USER_FILE.id,
  folderName: INITIAL_USER_FILE.folderName,
  fileName: INITIAL_USER_FILE.fileName,
  code: '',
  hasExecuted: false,
  activeResultTab: 'explanation',

  isDirty: false,
  trace: EMPTY_INITIAL_TRACE,
  currentStepIndex: 0,
  prevStepIndex: 0,
  isPlaying: false,
  speed: 1,
  reduceMotion: false,
  editorFontSize: 14,
  activeDeckTab: 'explain',
  mobileTab: 'code',
  isTracing: false,
  traceProgressStage: 0,
  apiError: null,
  apiNotice: null,
  hoveredVariable: null,
  hoveredLine: null,
  cursorPosition: { lineNumber: 1, column: 1 },
  presentationMode: false,
  commandPaletteOpen: false,
  shortcutsOpen: false,
  tourStep: null,

  user: null,
  isAuthReady: false,
  isCloudSyncing: false,
  guestWorkMigrated: false,
  snippets: [],
  historyItems: [],
  progress: INITIAL_PROGRESS,
  sharedRun: null,
  shareModalOpen: false,
  lastCreatedShareUrl: null,
  lastCreatedShareId: null,
  toast: null,

  initAuthAndCloudSync: () => {
    const unsubscribe = subscribeToAuthChanges(async (fbUser) => {
      if (!fbUser) {
        set({ isAuthReady: true, isCloudSyncing: false });
        return;
      }

      const profile: AppUserProfile = {
        uid: fbUser.uid,
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Logic Lab User',
        email: fbUser.email || '',
        photoURL: fbUser.photoURL || '',
      };

      set({ user: profile, isAuthReady: true, isCloudSyncing: true });

      try {
        await syncUserProfileToFirestore(fbUser, {
          theme: get().theme,
          explainLanguage: get().explainLanguage,
          detailLevel: get().depth,
          defaultCodeLanguage: get().language,
          defaultSpeed: get().speed,
        });

        const cloudData = await fetchUserCloudData(fbUser.uid);
        if (cloudData) {
          const loadedSnippets: SavedSnippetItem[] = (cloudData.snippets || []).map((s: any) => ({
            id: String(s.id || `snip-${Date.now()}`),
            title_bn: String(s.title || 'main.js'),
            title_en: String(s.title || 'main.js'),
            language: (s.language as SupportedLanguage) || 'javascript',
            code: String(s.code || ''),
            stdin: '',
            analogyType: 'generic_memory',
            isFavorite: Boolean(s.favorite ?? true),
            problemId: s.problemId ? String(s.problemId) : undefined,
            updatedAt: 'Cloud Synced',
          }));

          const loadedHistory: SavedHistoryItem[] = (cloudData.history || []).map((h: any) => ({
            id: String(h.id || `run-${Date.now()}`),
            title_bn: String(h.title_bn || h.title_en || 'কোড রান'),
            title_en: String(h.title_en || h.title_bn || 'Code Run'),
            language: (h.language as SupportedLanguage) || 'javascript',
            code: String(h.code || ''),
            analogyType: (h.analogyType as ExecutionTrace['analogyType']) || 'generic_memory',
            verdictStatus:
              (h.verdictStatus as ExecutionTrace['verdict']['status']) || 'ok',
            favorite: Boolean(h.favorite),
            timestamp: 'Cloud Synced',
          }));

          set((state) => ({
            snippets: loadedSnippets.length > 0 ? loadedSnippets : state.snippets,
            historyItems: loadedHistory.length > 0 ? loadedHistory : state.historyItems,
            progress: cloudData.progress
              ? {
                  streak: Number(cloudData.progress.streak ?? state.progress.streak),
                  lastActiveDate: String(
                    cloudData.progress.lastActiveDate || state.progress.lastActiveDate
                  ),
                  completedProblemIds: Array.isArray(cloudData.progress.completedProblemIds)
                    ? cloudData.progress.completedProblemIds
                    : state.progress.completedProblemIds,
                  badges: Array.isArray(cloudData.progress.badges)
                    ? cloudData.progress.badges
                    : state.progress.badges,
                  topicsCovered: Array.isArray(cloudData.progress.topicsCovered)
                    ? cloudData.progress.topicsCovered
                    : state.progress.topicsCovered,
                }
              : state.progress,
            isCloudSyncing: false,
          }));
        } else {
          set({ isCloudSyncing: false });
        }
      } catch {
        set({ isCloudSyncing: false });
      }
    });

    return unsubscribe;
  },

  setActiveRoute: (route) => {
    if (
      typeof window !== 'undefined' &&
      route !== '/share' &&
      window.location.pathname.startsWith('/s/')
    ) {
      window.history.pushState({}, '', '/');
    }
    set({ activeRoute: route });
  },

  setActiveResultTab: (activeResultTab) => set({ activeResultTab }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
    set({ theme: next });
  },

  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    set({ theme });
  },

  toggleExplainLanguage: () => {
    const { explainLanguage } = get();
    const nextLang: ExplainLanguage = explainLanguage === 'bn' ? 'en' : 'bn';
    get().setExplainLanguage(nextLang);
  },

  setExplainLanguage: (nextLang) => {
    const { code, language, depth, hasExecuted, fileName, user } = get();
    set({ explainLanguage: nextLang });
    if (!hasExecuted || !code.trim()) return;
    fetchTraceFromApi(
      { code, language, explainLanguage: nextLang, depth, fileName },
      user?.uid
    )
      .then((res) => {
        if (res.trace) {
          set({ trace: res.trace, apiNotice: null });
        }
      })
      .catch(() => {});
  },

  setDepth: (depth) => {
    const { code, language, explainLanguage, hasExecuted, fileName, user } = get();
    set({ depth });
    if (!hasExecuted || !code.trim()) return;
    fetchTraceFromApi({ code, language, explainLanguage, depth, fileName }, user?.uid)
      .then((res) => {
        if (res.trace) {
          set({ trace: res.trace, apiNotice: null });
        }
      })
      .catch(() => {});
  },

  setLanguage: (language) => {
    const { fileName, activeFileId, userFiles } = get();
    const rawBase = fileName.replace(/\.(js|ts|py|cpp|cc|c|h|java)$/i, '') || 'main';
    const baseName =
      language === 'java' && rawBase.toLowerCase() === 'main'
        ? 'Main'
        : language !== 'java' && rawBase === 'Main'
        ? 'main'
        : rawBase;
    const nextFileName = `${baseName}${defaultExtensionForLanguage(language)}`;
    const updatedFiles = userFiles.map((f) =>
      f.id === activeFileId ? { ...f, language, fileName: nextFileName } : f
    );
    set({
      language,
      fileName: nextFileName,
      userFiles: updatedFiles,
      apiError: null,
    });
  },

  setFolderName: (folderName) => {
    const { activeFileId, userFiles } = get();
    const updated = userFiles.map((f) => (f.id === activeFileId ? { ...f, folderName } : f));
    set({ folderName, userFiles: updated });
  },

  setFileName: (fileName) => {
    const { activeFileId, userFiles, language } = get();
    const detectedLang = inferLanguageFromFileName(fileName, language);
    const updated = userFiles.map((f) =>
      f.id === activeFileId ? { ...f, fileName, language: detectedLang } : f
    );
    set({ fileName, language: detectedLang, userFiles: updated, apiError: null });
  },

  createNewUserFile: () => {
    const { userFiles, folderName, language } = get();
    const nextIndex = userFiles.length + 1;
    const ext = defaultExtensionForLanguage(language);
    const basePrefix = language === 'java' ? `Main${nextIndex}` : `script${nextIndex}`;
    const newFile: UserCodeFile = {
      id: `file-${Date.now()}`,
      folderName: folderName || 'my-project',
      fileName: `${basePrefix}${ext}`,
      language,
      code: '',
    };
    set({
      userFiles: [...userFiles, newFile],
      activeFileId: newFile.id,
      fileName: newFile.fileName,
      code: '',
      hasExecuted: false,
      trace: EMPTY_INITIAL_TRACE,
      currentStepIndex: 0,
      prevStepIndex: 0,
      isPlaying: false,
      apiError: null,
    });
  },

  selectUserFile: (fileId) => {
    const { userFiles } = get();
    const target = userFiles.find((f) => f.id === fileId);
    if (!target) return;
    set({
      activeFileId: target.id,
      folderName: target.folderName,
      fileName: target.fileName,
      language: target.language,
      code: target.code,
      hasExecuted: false,
      trace: EMPTY_INITIAL_TRACE,
      currentStepIndex: 0,
      prevStepIndex: 0,
      isPlaying: false,
      apiError: null,
    });
  },

  deleteUserFile: (fileId) => {
    const { userFiles, activeFileId, user } = get();
    if (user && !user.isDemo) {
      void deleteSnippetFromFirestore(user.uid, fileId).catch(() => {});
    }
    if (userFiles.length <= 1) {
      get().resetSnippetToNew();
      return;
    }
    const remaining = userFiles.filter((f) => f.id !== fileId);
    const nextActive =
      fileId === activeFileId
        ? remaining[remaining.length - 1]
        : userFiles.find((f) => f.id === activeFileId)!;
    set({
      userFiles: remaining,
      activeFileId: nextActive.id,
      folderName: nextActive.folderName,
      fileName: nextActive.fileName,
      language: nextActive.language,
      code: nextActive.code,
      hasExecuted: false,
      trace: EMPTY_INITIAL_TRACE,
    });
  },

  selectSample: (sampleId) => {
    const { language, explainLanguage, depth } = get();
    const sample = SAMPLE_PROGRAMS.find((s) => s.id === sampleId) || SAMPLE_PROGRAMS[0];
    const nextCode = sample.codes[language];
    const nextTrace = resolveTraceForCode(nextCode, language, explainLanguage, depth, sample.id);
    set({
      activeSampleId: sample.id,
      code: nextCode,
      hasExecuted: true,
      isDirty: false,
      trace: nextTrace,
      currentStepIndex: 0,
      prevStepIndex: 0,
      isPlaying: false,
      activeRoute: '/',
      apiError: null,
    });
  },

  loadLibraryProblem: async (problemId, useFaulty = false) => {
    const { language } = get();
    const prob = PROBLEM_LIBRARY.find((p) => p.id === problemId) || PROBLEM_LIBRARY[0];
    const targetCode = useFaulty ? prob.faultyCodes[language] : prob.codes[language];
    set({
      activeSampleId: prob.id,
      code: targetCode,
      isDirty: false,
      activeRoute: '/',
    });
    await get().runVisualize();
  },

  setCode: (code) => {
    const { activeFileId, userFiles } = get();
    const updated = userFiles.map((f) => (f.id === activeFileId ? { ...f, code } : f));
    set({ code, userFiles: updated, isDirty: true, apiError: null });
  },

  resetSnippetToNew: () => {
    const { activeFileId, userFiles } = get();
    const updated = userFiles.map((f) => (f.id === activeFileId ? { ...f, code: '' } : f));
    set({
      code: '',
      userFiles: updated,
      hasExecuted: false,
      trace: EMPTY_INITIAL_TRACE,
      isDirty: false,
      currentStepIndex: 0,
      prevStepIndex: 0,
      isPlaying: false,
      apiError: null,
    });
  },

  runVisualize: async () => {
    let {
      code,
      language,
      explainLanguage,
      depth,
      historyItems,
      user,
      fileName,
      folderName,
      activeFileId,
      userFiles,
    } = get();

    // If editor is blank, show a clear error and do not generate any animation
    if (!code.trim()) {
      set({
        hasExecuted: true,
        isPlaying: false,
        isTracing: false,
        traceProgressStage: 0,
        apiError: {
          code: 'EMPTY_CODE',
          message_bn: 'এডিটর খালি আছে। রান ও বিশ্লেষণ করার জন্য আগে আপনার কোড লিখুন।',
          message_en: 'Editor is empty. Please write or paste your code before running.',
        },
        trace: {
          ...EMPTY_INITIAL_TRACE,
          hasError: true,
          isValidLogic: false,
          verdict: {
            status: 'compile_error',
            message:
              explainLanguage === 'bn'
                ? 'এডিটরে কোনো কোড নেই।'
                : 'No code provided in editor.',
          },
        },
      });
      return;
    }

    // Auto-switch from untouched default main.js to Java if the user pasted a Java class
    if (
      language === 'javascript' &&
      fileName === 'main.js' &&
      (/\bpublic\s+class\s+[A-Za-z_$]/.test(code) || /\bSystem\.out\.print/.test(code))
    ) {
      language = 'java';
      fileName = 'Main.java';
      const updatedFiles = userFiles.map((f) =>
        f.id === activeFileId ? { ...f, language, fileName } : f
      );
      set({ language, fileName, userFiles: updatedFiles });
    }

    set({
      isPlaying: false,
      isTracing: true,
      traceProgressStage: 1,
      apiError: null,
    });

    const stage2Timer = setTimeout(() => {
      if (get().isTracing) set({ traceProgressStage: 2 });
    }, 60);

    const stage3Timer = setTimeout(() => {
      if (get().isTracing) set({ traceProgressStage: 3 });
    }, 120);

    try {
      const [apiRes] = await Promise.all([
        fetchTraceFromApi(
          { code, language, explainLanguage, depth, fileName },
          user?.uid
        ),
        new Promise((r) => setTimeout(r, 150)),
      ]);

      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);

      if (apiRes.error) {
        set({
          hasExecuted: true,
          isTracing: false,
          traceProgressStage: 0,
          apiError: apiRes.error,
          trace: {
            ...EMPTY_INITIAL_TRACE,
            hasError: true,
            isValidLogic: false,
            verdict: {
              status: 'compile_error',
              message:
                explainLanguage === 'bn' ? apiRes.error.message_bn : apiRes.error.message_en,
            },
          },
        });
        return;
      }

      if (apiRes.trace) {
        const nextTrace = apiRes.trace;
        const newEntry: SavedHistoryItem = {
          id: `run-${Date.now()}`,
          title_bn: `${folderName}/${fileName}`,
          title_en: `${folderName}/${fileName}`,
          language,
          code,
          analogyType: nextTrace.analogyType,
          verdictStatus: nextTrace.verdict.status,
          favorite: false,
          timestamp: 'Just now',
        };

        set({
          hasExecuted: true,
          trace: nextTrace,
          apiNotice: null,
          apiError: null,
          isTracing: false,
          traceProgressStage: 0,
          isDirty: false,
          currentStepIndex: 0,
          prevStepIndex: 0,
          isPlaying: false,
          historyItems: [newEntry, ...historyItems.slice(0, 29)],
        });

        // Persist run history to backend API in the background
        void fetch('/api/history', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uid': user?.uid || 'guest-local',
          },
          body: JSON.stringify(newEntry),
        }).catch(() => {});

        // Sync run history and active file to Cloud Firestore in the background if signed in
        if (user && !user.isDemo) {
          void saveHistoryToFirestore(user.uid, {
            id: newEntry.id,
            title: newEntry.title_en,
            title_bn: newEntry.title_bn,
            language: newEntry.language,
            code: newEntry.code,
            renderer: newEntry.analogyType,
            verdictStatus: newEntry.verdictStatus,
            hasFault: newEntry.verdictStatus !== 'ok',
            stepsCount: nextTrace.steps.length,
          }).catch(() => {});

          if (!nextTrace.hasError && nextTrace.verdict.status !== 'compile_error') {
            void saveSnippetToFirestore(user.uid, {
              id: activeFileId,
              title: `${folderName}/${fileName}`,
              language,
              code,
              isFavorite: true,
            }).catch(() => {});
          }
        }
        return;
      }
    } catch {
      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);
    }

    set({
      hasExecuted: true,
      isTracing: false,
      traceProgressStage: 0,
      isDirty: false,
      currentStepIndex: 0,
      prevStepIndex: 0,
      isPlaying: false,
    });
  },

  play: () => {
    const { currentStepIndex, trace } = get();
    if (trace.steps.length === 0) return;
    if (currentStepIndex >= trace.steps.length - 1) {
      set({ currentStepIndex: 0, prevStepIndex: 0, isPlaying: true });
    } else {
      set({ isPlaying: true });
    }
  },

  pause: () => set({ isPlaying: false }),

  togglePlay: () => {
    const { isPlaying } = get();
    if (isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  nextStep: () => {
    const { currentStepIndex, trace } = get();
    if (trace.steps.length === 0) return;
    const next = clampStepIndex(currentStepIndex + 1, trace.steps.length);
    const hasReachedEnd = next >= trace.steps.length - 1;
    set({
      prevStepIndex: currentStepIndex,
      currentStepIndex: next,
      isPlaying: hasReachedEnd ? false : get().isPlaying,
    });
  },

  prevStep: () => {
    const { currentStepIndex, trace } = get();
    if (trace.steps.length === 0) return;
    const prev = clampStepIndex(currentStepIndex - 1, trace.steps.length);
    set({
      prevStepIndex: currentStepIndex,
      currentStepIndex: prev,
      isPlaying: false,
    });
  },

  resetPlayback: () => {
    set({
      prevStepIndex: get().currentStepIndex,
      currentStepIndex: 0,
      isPlaying: false,
    });
  },

  goToStep: (idx) => {
    const { currentStepIndex, trace } = get();
    if (trace.steps.length === 0) return;
    const target = clampStepIndex(idx, trace.steps.length);
    set({
      prevStepIndex: currentStepIndex,
      currentStepIndex: target,
      isPlaying: false,
    });
  },

  jumpToLine: (line) => {
    const { trace, currentStepIndex } = get();
    const stepIdx = findFirstStepForLine(trace.steps, line);
    if (stepIdx !== null) {
      set({
        prevStepIndex: currentStepIndex,
        currentStepIndex: stepIdx,
        isPlaying: false,
      });
    }
  },

  setSpeed: (speed) => set({ speed }),

  setReduceMotion: (reduceMotion) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    }
    set({ reduceMotion });
  },

  setEditorFontSize: (val, isDelta = false) => {
    const current = get().editorFontSize;
    const next = isDelta ? Math.min(22, Math.max(12, current + val)) : val;
    set({ editorFontSize: next });
  },

  setActiveDeckTab: (activeDeckTab) => set({ activeDeckTab }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setHoveredVariable: (hoveredVariable) => set({ hoveredVariable }),
  setHoveredLine: (hoveredLine) => set({ hoveredLine }),
  setCursorPosition: (cursorPosition) => set({ cursorPosition }),
  togglePresentationMode: () => set((s) => ({ presentationMode: !s.presentationMode })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setTourStep: (tourStep) => set({ tourStep }),

  signInWithGoogle: async () => {
    try {
      set({ isCloudSyncing: true });
      const profile = await signInWithGooglePopup();
      set({
        user: profile,
        isCloudSyncing: false,
        toast: {
          id: `auth-${Date.now()}`,
          message_bn: `স্বাগতম, ${profile.displayName}! ক্লাউড সিঙ্ক সক্রিয় হয়েছে।`,
          message_en: `Welcome, ${profile.displayName}! Cloud sync is active.`,
        },
      });
      get().migrateGuestToAccount();
    } catch {
      set({ isCloudSyncing: false });
      get().signInDemoStudent();
    }
  },

  signInDemoStudent: () => {
    set({
      user: {
        uid: 'student-demo-bd',
        displayName: 'তানভীর আহমেদ (Tanvir Ahmed)',
        email: 'tanvir.student@logiclab.bd',
        photoURL: '',
        isDemo: true,
      },
    });
  },

  signOutUser: async () => {
    try {
      await signOutFirebase();
    } catch {
      // ignore
    }
    set({
      user: null,
      guestWorkMigrated: false,
      toast: {
        id: `signout-${Date.now()}`,
        message_bn: 'সাইন আউট সম্পন্ন হয়েছে।',
        message_en: 'Signed out successfully.',
      },
    });
  },

  migrateGuestToAccount: () => {
    const { user, snippets, userFiles, progress } = get();
    const activeUser =
      user || {
        uid: 'student-demo-bd',
        displayName: 'তানভীর আহমেদ (Tanvir Ahmed)',
        email: 'tanvir.student@logiclab.bd',
        photoURL: '',
        isDemo: true,
      };
    if (!activeUser.isDemo) {
      for (const snip of snippets) {
        void saveSnippetToFirestore(activeUser.uid, {
          id: snip.id,
          title: snip.title_en,
          language: snip.language,
          code: snip.code,
          stdin: snip.stdin,
          isFavorite: snip.isFavorite,
          problemId: snip.problemId,
        }).catch(() => {});
      }
      for (const f of userFiles) {
        if (f.code.trim()) {
          void saveSnippetToFirestore(activeUser.uid, {
            id: f.id,
            title: `${f.folderName}/${f.fileName}`,
            language: f.language,
            code: f.code,
            isFavorite: true,
          }).catch(() => {});
        }
      }
      void syncProgressToFirestore(activeUser.uid, progress).catch(() => {});
    }
    set({ user: activeUser, guestWorkMigrated: true });
  },

  saveCurrentSnippet: () => {
    const { code, language, trace, folderName, fileName, activeFileId, snippets, user } = get();
    if (!code.trim()) return;
    const newSnippet: SavedSnippetItem = {
      id: activeFileId || `snip-${Date.now()}`,
      title_bn: `${folderName}/${fileName}`,
      title_en: `${folderName}/${fileName}`,
      language,
      code,
      stdin: '',
      analogyType: trace.analogyType,
      isFavorite: true,
      updatedAt: 'Just now',
    };
    set({
      snippets: [newSnippet, ...snippets.filter((s) => s.id !== newSnippet.id)],
      isDirty: false,
      toast: {
        id: `save-${Date.now()}`,
        message_bn: `"${folderName}/${fileName}" সংরক্ষিত হয়েছে।`,
        message_en: `Saved "${folderName}/${fileName}".`,
      },
    });

    void fetch('/api/snippets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-uid': user?.uid || 'guest-local',
      },
      body: JSON.stringify(newSnippet),
    }).catch(() => {});

    if (user && !user.isDemo) {
      void saveSnippetToFirestore(user.uid, {
        id: newSnippet.id,
        title: newSnippet.title_en,
        language: newSnippet.language,
        code: newSnippet.code,
        stdin: '',
        isFavorite: true,
      }).catch(() => {});
    }
  },

  toggleFavoriteSnippet: (id) => {
    const { snippets } = get();
    set({
      snippets: snippets.map((s) => (s.id === id ? { ...s, isFavorite: !s.isFavorite } : s)),
    });
  },

  deleteSnippet: (id) => {
    const { snippets, user } = get();
    set({ snippets: snippets.filter((s) => s.id !== id) });
    void fetch(`/api/snippets/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-uid': user?.uid || 'guest-local' },
    }).catch(() => {});
    if (user && !user.isDemo) {
      void deleteSnippetFromFirestore(user.uid, id).catch(() => {});
    }
  },

  toggleFavoriteHistory: (id) =>
    set((s) => ({
      historyItems: s.historyItems.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item
      ),
    })),

  deleteHistoryItem: (id) => {
    const { historyItems, user } = get();
    set({ historyItems: historyItems.filter((item) => item.id !== id) });
    void fetch(`/api/history/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-uid': user?.uid || 'guest-local' },
    }).catch(() => {});
  },

  createShareLink: async () => {
    const { code, language, trace, user, folderName, fileName } = get();
    const shareId = `ll-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
    const payload = {
      shareId,
      authorName: user?.displayName || 'Logic Lab User',
      title_bn: `${folderName}/${fileName}`,
      title_en: `${folderName}/${fileName}`,
      language,
      code,
      stdin: '',
      trace,
    };

    try {
      await fetch('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-uid': user?.uid || 'guest-local',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // ignore
    }

    if (user && !user.isDemo) {
      void createShareInFirestore({
        shareId,
        title: `${folderName}/${fileName}`,
        title_bn: `${folderName}/${fileName}`,
        language,
        code,
        stdin: '',
      }).catch(() => {});
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const shareUrl = `${origin}/s/${shareId}`;
    set({
      sharedRun: {
        shareId,
        authorName: payload.authorName,
        title_bn: payload.title_bn,
        title_en: payload.title_en,
        language,
        code,
        trace,
        createdAt: new Date().toLocaleDateString(),
      },
      shareModalOpen: true,
      lastCreatedShareUrl: shareUrl,
      lastCreatedShareId: shareId,
    });
    return shareUrl;
  },

  openShareViewById: async (shareId) => {
    try {
      const res = await fetch(`/api/share/${shareId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.share) {
          set({
            sharedRun: {
              shareId: data.share.shareId,
              authorName: data.share.authorName,
              title_bn: data.share.title_bn,
              title_en: data.share.title_en,
              language: data.share.language,
              code: data.share.code,
              trace: data.share.trace,
              createdAt: new Date(data.share.createdAt).toLocaleDateString(),
            },
            trace: data.share.trace,
            code: data.share.code,
            language: data.share.language,
            hasExecuted: true,
            currentStepIndex: 0,
            prevStepIndex: 0,
            isPlaying: false,
            activeRoute: '/share',
            shareModalOpen: false,
          });
          return;
        }
      }
    } catch {
      // fallback to Firestore below
    }

    // Fallback: check Cloud Firestore `/shares/{shareId}` (persists across Vercel serverless cold starts)
    const cloudShare = await getShareFromFirestore(shareId);
    if (cloudShare && cloudShare.code) {
      const traceRes = await fetchTraceFromApi({
        code: cloudShare.code,
        language: cloudShare.language,
        explainLanguage: get().explainLanguage,
        depth: get().depth,
        fileName: cloudShare.title_en.split('/').pop(),
      });
      const resolvedTrace = traceRes.trace || EMPTY_INITIAL_TRACE;
      set({
        sharedRun: {
          shareId: cloudShare.shareId,
          authorName: 'Logic Lab User',
          title_bn: cloudShare.title_bn,
          title_en: cloudShare.title_en,
          language: cloudShare.language,
          code: cloudShare.code,
          trace: resolvedTrace,
          createdAt: new Date().toLocaleDateString(),
        },
        trace: resolvedTrace,
        code: cloudShare.code,
        language: cloudShare.language,
        hasExecuted: true,
        currentStepIndex: 0,
        prevStepIndex: 0,
        isPlaying: false,
        activeRoute: '/share',
        shareModalOpen: false,
      });
    }
  },

  closeShareModal: () => set({ shareModalOpen: false }),

  forkSharedToPlayground: () => {
    const { sharedRun } = get();
    if (sharedRun) {
      set({
        code: sharedRun.code,
        language: sharedRun.language,
        trace: sharedRun.trace,
        hasExecuted: true,
        currentStepIndex: 0,
        prevStepIndex: 0,
        activeRoute: '/',
      });
    } else {
      set({ activeRoute: '/' });
    }
  },

  dismissToast: () => set({ toast: null }),
  dismissApiNotice: () => set({ apiError: null, apiNotice: null }),
}));

if (typeof window !== 'undefined') {
  (window as any).__useLabStore = useLabStore;
}
