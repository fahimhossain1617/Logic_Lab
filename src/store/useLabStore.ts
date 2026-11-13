import { create } from 'zustand';
import {
  CodeExecutionRecord,
  ExecutionDiagnostic,
  ExecutionMode,
  ExecutionResultPayload,
  ExecutionStatus,
  ExecutionTrace,
  ExplainLanguage,
  ExplanationDepth,
  FastExecutionResult,
  SupportedLanguage,
} from '../../shared/types';
import { SAMPLE_PROGRAMS, resolveTraceForCode } from '../data/sampleTraces';
import { PROBLEM_LIBRARY } from '../data/problemLibrary';
import { clampStepIndex, findFirstStepForLine } from '../utils/playerLogic';
import {
  AppUserProfile,
  signInWithGooglePopup,
  completeGoogleRedirectSignIn,
  signOutFirebase,
  subscribeToAuthChanges,
  getFirebaseIdToken,
  syncUserProfileToFirestore,
  saveSnippetToFirestore,
  deleteSnippetFromFirestore,
  saveHistoryToFirestore,
  deleteHistoryFromFirestore,
  clearHistoryFromFirestore,
  syncProgressToFirestore,
  createShareInFirestore,
  getShareFromFirestore,
  fetchUserCloudData,
  saveCodeExecutionToFirestore,
  fetchCodeExecutionsFromFirestore,
  clearCodeExecutionsFromFirestore,
} from '../lib/firebase';

export type AppRoute = '/' | '/login' | '/library' | '/history' | '/progress' | '/settings' | '/share';
export type DeckTab = 'explain' | 'output' | 'summary';
export type MobileTab = 'code' | 'stage' | 'explain' | 'output';
export type WorkspaceResultTab = 'explanation' | 'animation';

export interface TerminalLine {
  id: string;
  type: 'output' | 'prompt-answered' | 'error';
  text: string;
  prompt?: string;
  answer?: string;
}

export type TerminalExecState =
  | 'IDLE'
  | 'COMPILING'
  | 'RUNNING'
  | 'WAITING_FOR_INPUT'
  | 'COMPLETED'
  | 'ERROR';

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
  fileName?: string;
  folderName?: string;
  title_bn: string;
  title_en: string;
  language: SupportedLanguage;
  code: string;
  analogyType: ExecutionTrace['analogyType'];
  verdictStatus: ExecutionTrace['verdict']['status'];
  favorite: boolean;
  timestamp: string;
  trace?: ExecutionTrace;
  createdAt?: number;
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
  stdin: string;
  consoleOpen: boolean;
  isFastRunning: boolean;
  executionMode: ExecutionMode | null;
  fastRunResult: FastExecutionResult | null;
  terminalHistory: TerminalLine[];
  currentPrompt: string;
  currentInputValue: string;
  terminalExecState: TerminalExecState;
  activeSessionId: string | null;
  recentExecutions: CodeExecutionRecord[];
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
  diagnostics: ExecutionDiagnostic[];
  executionStatus: ExecutionStatus | 'idle';
  canRun: boolean;
  activeBreakpoints: number[];
  hoveredVariable: string | null;
  hoveredLine: number | null;
  cursorPosition: { lineNumber: number; column: number };
  presentationMode: boolean;
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;
  tourStep: number | null;

  user: AppUserProfile | null;
  isAuthReady: boolean;
  isAuthLoading: boolean;
  isCloudSyncing: boolean;
  authError: BilingualMessage | null;
  guestWorkMigrated: boolean;
  snippets: SavedSnippetItem[];
  historyItems: SavedHistoryItem[];
  progress: UserProgressState;
  sharedRun: SharedVisualizationData | null;
  shareModalOpen: boolean;
  lastCreatedShareUrl: string | null;
  lastCreatedShareId: string | null;
  toast: ToastMessage | null;
  historyDropdownOpen: boolean;

  // Actions
  initAuthAndCloudSync: () => () => void;
  openLoginPage: () => void;
  continueAsGuest: () => void;
  clearAuthError: () => void;
  setHistoryDropdownOpen: (open: boolean) => void;
  toggleHistoryDropdown: () => void;
  restoreHistoryItem: (item: SavedHistoryItem) => void;
  clearAllHistory: () => void;
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
  setStdin: (stdin: string) => void;
  setCurrentInputValue: (val: string) => void;
  submitTerminalInput: () => Promise<void>;
  stopTerminalSession: () => void;
  setConsoleOpen: (open: boolean) => void;
  toggleConsoleOpen: () => void;
  clearConsoleOutput: () => void;
  resetSnippetToNew: () => void;
  runFast: (overrideCode?: string, overrideStdin?: string) => Promise<void>;
  appendTerminalStdinAndRun: (inputLine: string, overrideCode?: string) => Promise<void>;
  restoreExecutionRecord: (record: CodeExecutionRecord) => void;
  clearRecentExecutions: () => void;
  runVisualize: (overrideCode?: string) => Promise<void>;
  toggleBreakpoint: (line: number) => void;
  clearBreakpoints: () => void;
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

function clearLegacyLocalHistoryStorage() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('logic_lab_history_v2');
    localStorage.removeItem('logic_lab_code_executions_v1');
  } catch {}
}

function formatCloudTimestamp(createdMs?: number): string {
  if (!createdMs) return 'Cloud Synced';
  const d = new Date(createdMs);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

let activeAbortController: AbortController | null = null;
let fastAbortController: AbortController | null = null;
let activeEventSource: EventSource | null = null;

function closeActiveEventSource() {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
}

function makeTerminalLineId(): string {
  return `tline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function fetchTraceFromApi(
  params: {
    code: string;
    language: SupportedLanguage;
    explainLanguage: ExplainLanguage;
    depth: ExplanationDepth;
    fileName?: string;
    stdin?: string;
    bypassCache?: boolean;
  },
  uid?: string,
  signal?: AbortSignal
): Promise<{
  trace?: ExecutionTrace;
  apiNotice?: BilingualMessage | null;
  error?: BilingualMessage;
  status?: ExecutionStatus;
  canRun?: boolean;
  output?: string;
  diagnostics?: ExecutionDiagnostic[];
  visualizerData?: ExecutionTrace | null;
}> {
  const res = await fetch('/api/trace', {
    method: 'POST',
    signal,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-user-uid': uid || 'guest-local',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    return {
      error: data.error,
      status: data.status || 'error',
      canRun: data.canRun ?? false,
      output: data.output || (data.error?.message_en ?? 'Execution error'),
      diagnostics: data.diagnostics || [],
    };
  }
  return {
    trace: data.trace || data.visualizerData,
    apiNotice: data.apiNotice || null,
    status: data.status,
    canRun: data.canRun,
    output: data.output,
    diagnostics: data.diagnostics || [],
    visualizerData: data.visualizerData,
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
  code: INITIAL_USER_FILE.code,
  stdin: '',
  consoleOpen: true,
  isFastRunning: false,
  executionMode: null,
  fastRunResult: null,
  terminalHistory: [],
  currentPrompt: '',
  currentInputValue: '',
  terminalExecState: 'IDLE',
  activeSessionId: null,
  recentExecutions: [],
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
  diagnostics: [],
  executionStatus: 'idle',
  canRun: true,
  activeBreakpoints: [],
  toggleBreakpoint: (line: number) => {
    const { activeBreakpoints } = get();
    const exists = activeBreakpoints.includes(line);
    set({
      activeBreakpoints: exists
        ? activeBreakpoints.filter((l) => l !== line)
        : [...activeBreakpoints, line].sort((a, b) => a - b),
    });
  },
  clearBreakpoints: () => set({ activeBreakpoints: [] }),
  hoveredVariable: null,
  hoveredLine: null,
  cursorPosition: { lineNumber: 1, column: 1 },
  presentationMode: false,
  commandPaletteOpen: false,
  shortcutsOpen: false,
  tourStep: null,
  historyDropdownOpen: false,

  user: null,
  isAuthReady: false,
  isAuthLoading: false,
  isCloudSyncing: false,
  authError: null,
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
    clearLegacyLocalHistoryStorage();
    void completeGoogleRedirectSignIn().catch(() => {});

    const unsubscribe = subscribeToAuthChanges(async (fbUser) => {
      if (!fbUser) {
        clearLegacyLocalHistoryStorage();
        set({
          user: null,
          isAuthReady: true,
          isAuthLoading: false,
          isCloudSyncing: false,
          historyItems: [],
          recentExecutions: [],
          snippets: [],
          guestWorkMigrated: false,
        });
        return;
      }

      const profile: AppUserProfile = {
        uid: fbUser.uid,
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Logic Lab User',
        email: fbUser.email || '',
        photoURL: fbUser.photoURL || '',
      };

      set({
        user: profile,
        isAuthReady: true,
        isAuthLoading: false,
        isCloudSyncing: true,
        authError: null,
      });

      if (get().activeRoute === '/login') {
        get().setActiveRoute('/');
      }

      try {
        const idToken = await getFirebaseIdToken();
        const backendSessionPromise = fetch('/api/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uid': fbUser.uid,
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            email: profile.email,
            displayName: profile.displayName,
            photoURL: profile.photoURL,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

        await syncUserProfileToFirestore(fbUser, {
          theme: get().theme,
          explainLanguage: get().explainLanguage,
          detailLevel: get().depth,
          defaultCodeLanguage: get().language,
          defaultSpeed: 1,
        }).catch(() => {});

        const [cloudData, backendSession] = await Promise.all([
          fetchUserCloudData(fbUser.uid),
          backendSessionPromise,
        ]);

        const cloudSnippets: SavedSnippetItem[] = (cloudData?.snippets || []).map((s: any) => ({
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

        const cloudHistory: SavedHistoryItem[] = (cloudData?.history || []).map((h: any) => ({
          id: String(h.id || `run-${Date.now()}`),
          fileName: String(h.title_en || h.title_bn || 'main.js'),
          title_bn: String(h.title_bn || h.title_en || 'কোড রান'),
          title_en: String(h.title_en || h.title_bn || 'Code Run'),
          language: (h.language as SupportedLanguage) || 'javascript',
          code: String(h.code || ''),
          analogyType: (h.analogyType as ExecutionTrace['analogyType']) || 'generic_memory',
          verdictStatus: (h.verdictStatus as ExecutionTrace['verdict']['status']) || 'ok',
          favorite: Boolean(h.favorite),
          timestamp: formatCloudTimestamp(h.createdMs),
          createdAt: h.createdMs || undefined,
        }));

        const backendHistory: SavedHistoryItem[] = Array.isArray(backendSession?.history)
          ? backendSession.history.map((h: any) => ({
              id: String(h.id || `run-${Date.now()}`),
              fileName: h.fileName ? String(h.fileName) : String(h.title_en || 'main.js'),
              title_bn: String(h.title_bn || h.title_en || 'কোড রান'),
              title_en: String(h.title_en || h.title_bn || 'Code Run'),
              language: (h.language as SupportedLanguage) || 'javascript',
              code: String(h.code || ''),
              analogyType: (h.analogyType as ExecutionTrace['analogyType']) || 'generic_memory',
              verdictStatus: (h.verdictStatus as ExecutionTrace['verdict']['status']) || 'ok',
              favorite: Boolean(h.favorite),
              timestamp: String(h.timestamp || 'Synced'),
            }))
          : [];

        const seenHistoryIds = new Set(cloudHistory.map((h) => h.id));
        const mergedHistory = [
          ...cloudHistory,
          ...backendHistory.filter((h) => !seenHistoryIds.has(h.id)),
        ].slice(0, 50);

        set((state) => ({
          snippets: cloudSnippets,
          historyItems: mergedHistory,
          progress: cloudData?.progress
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

        // Non-blocking fetch of recent code_executions from Firestore + backend
        void fetchCodeExecutionsFromFirestore(fbUser.uid, 25)
          .then((cloudExecs) => {
            const backendExecs: CodeExecutionRecord[] = Array.isArray(backendSession?.executions)
              ? backendSession.executions
              : [];
            const existingIds = new Set(cloudExecs.map((e) => e.id));
            const merged = [
              ...cloudExecs,
              ...backendExecs.filter((e) => !existingIds.has(e.id)),
            ].slice(0, 30);
            set({ recentExecutions: merged });
          })
          .catch(() => {});
      } catch {
        set({ isCloudSyncing: false });
      }
    });

    return unsubscribe;
  },

  openLoginPage: () => {
    set({ authError: null, historyDropdownOpen: false });
    get().setActiveRoute('/login');
  },

  continueAsGuest: () => {
    set({ authError: null });
    get().setActiveRoute('/');
  },

  clearAuthError: () => set({ authError: null }),

  setActiveRoute: (route) => {
    if (typeof window !== 'undefined') {
      if (route === '/login') {
        if (window.location.pathname !== '/login') {
          window.history.pushState({}, '', '/login');
        }
      } else if (route !== '/share' && window.location.pathname !== '/') {
        window.history.pushState({}, '', '/');
      }
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
    const { code, language, depth, hasExecuted, fileName, stdin, user } = get();
    set({ explainLanguage: nextLang });
    if (!hasExecuted || !code.trim()) return;
    fetchTraceFromApi(
      { code, language, explainLanguage: nextLang, depth, fileName, stdin },
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
    const { code, language, explainLanguage, hasExecuted, fileName, stdin, user } = get();
    set({ depth });
    if (!hasExecuted || !code.trim()) return;
    fetchTraceFromApi({ code, language, explainLanguage, depth, fileName, stdin }, user?.uid)
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
      code: newFile.code,
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
    const { activeFileId, userFiles, trace } = get();
    const updated = userFiles.map((f) => (f.id === activeFileId ? { ...f, code } : f));
    const wasError = Boolean(trace.hasError || trace.verdict.status === 'compile_error');
    set({
      code,
      userFiles: updated,
      isDirty: true,
      apiError: null,
      ...(wasError
        ? {
            executionStatus: 'idle',
            trace: {
              ...trace,
              hasError: false,
              errorDetails: null,
              verdict: { status: 'ok', message: '' },
            },
          }
        : {}),
    });
  },

  resetSnippetToNew: () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    const { activeFileId, userFiles } = get();
    const emptyCode = '';
    const updated = userFiles.map((f) => (f.id === activeFileId ? { ...f, code: emptyCode } : f));
    set({
      code: emptyCode,
      userFiles: updated,
      hasExecuted: false,
      trace: EMPTY_INITIAL_TRACE,
      diagnostics: [],
      executionStatus: 'idle',
      canRun: true,
      isDirty: false,
      currentStepIndex: 0,
      prevStepIndex: 0,
      isPlaying: false,
      apiError: null,
    });
  },

  setStdin: (stdin) => set({ stdin }),
  setCurrentInputValue: (currentInputValue) => set({ currentInputValue }),
  stopTerminalSession: () => {
    closeActiveEventSource();
    const { activeSessionId } = get();
    if (activeSessionId) {
      void fetch('/api/execute/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId }),
      }).catch(() => {});
    }
    set({
      activeSessionId: null,
      isFastRunning: false,
      terminalExecState: get().terminalHistory.length > 0 ? 'COMPLETED' : 'IDLE',
    });
  },
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
  toggleConsoleOpen: () => set((s) => ({ consoleOpen: !s.consoleOpen })),
  clearConsoleOutput: () => {
    closeActiveEventSource();
    const { activeSessionId } = get();
    if (activeSessionId) {
      void fetch('/api/execute/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId }),
      }).catch(() => {});
    }
    set({
      fastRunResult: null,
      terminalHistory: [],
      currentPrompt: '',
      currentInputValue: '',
      terminalExecState: 'IDLE',
      activeSessionId: null,
      isFastRunning: false,
      diagnostics: [],
      executionStatus: 'idle',
    });
  },

  restoreExecutionRecord: (record) => {
    const { userFiles, activeFileId } = get();
    const targetFileName =
      record.file_name ||
      (record.language === 'java'
        ? 'Main.java'
        : record.language === 'python'
        ? 'main.py'
        : record.language === 'cpp'
        ? 'main.cpp'
        : 'main.js');
    const updatedFiles = userFiles.map((f) =>
      f.id === activeFileId
        ? {
            ...f,
            code: record.source_code,
            language: record.language,
            fileName: targetFileName,
          }
        : f
    );
    set({
      code: record.source_code,
      stdin: record.stdin_input || '',
      language: record.language,
      fileName: targetFileName,
      userFiles: updatedFiles,
      consoleOpen: true,
      executionMode: record.execution_mode,
      fastRunResult: {
        success: record.success,
        stdout: record.stdout_output || '',
        stderr: record.stderr_output || '',
        exitCode: record.exit_code ?? (record.success ? 0 : 1),
        executionTimeMs: record.execution_time_ms || 0,
        language: record.language,
        stdinUsed: record.stdin_input || '',
        timestamp: new Date(record.created_at).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
      apiError: null,
    });
  },

  clearRecentExecutions: () => {
    const { user } = get();
    clearLegacyLocalHistoryStorage();
    set({ recentExecutions: [] });
    if (user && !user.isDemo) {
      void fetch('/api/executions', {
        method: 'DELETE',
        headers: { 'x-user-uid': user.uid },
      }).catch(() => {});
      void clearCodeExecutionsFromFirestore(user.uid).catch(() => {});
    }
  },

  runFast: async (overrideCode?: string, overrideStdin?: string) => {
    if (fastAbortController) {
      fastAbortController.abort();
      fastAbortController = null;
    }
    closeActiveEventSource();
    const prevSessionId = get().activeSessionId;
    if (prevSessionId) {
      void fetch('/api/execute/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: prevSessionId }),
      }).catch(() => {});
    }

    const controller = new AbortController();
    fastAbortController = controller;

    let { code, stdin, language, fileName, user, userFiles, activeFileId, explainLanguage } = get();

    if (typeof overrideCode === 'string') {
      code = overrideCode;
      const updatedFiles = userFiles.map((f) => (f.id === activeFileId ? { ...f, code } : f));
      set({ code, userFiles: updatedFiles });
    }
    if (typeof overrideStdin === 'string') {
      stdin = overrideStdin;
      set({ stdin });
    }

    set({
      consoleOpen: true,
      isFastRunning: true,
      executionMode: 'fast',
      apiError: null,
      fastRunResult: null,
      terminalHistory: [],
      currentPrompt: '',
      currentInputValue: '',
      terminalExecState: 'COMPILING',
      activeSessionId: null,
      diagnostics: [],
      executionStatus: 'idle',
    });

    if (!code.trim()) {
      const emptyMsg =
        explainLanguage === 'bn'
          ? 'এডিটর খালি আছে। রান করার জন্য আগে কোড লিখুন।'
          : 'Editor is empty. Please write code before running.';
      set({
        isFastRunning: false,
        terminalExecState: 'ERROR',
        executionStatus: 'error',
        terminalHistory: [{ id: makeTerminalLineId(), type: 'error', text: emptyMsg }],
        fastRunResult: {
          success: false,
          stdout: '',
          stderr: emptyMsg,
          exitCode: 1,
          executionTimeMs: 0,
          language,
          stdinUsed: '',
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
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

    const startedAt = Date.now();
    const runStaticFallback = async (fallbackErr?: string) => {
      try {
        const fbRes = await fetch('/api/execute', {
          method: 'POST',
          signal: controller.signal,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uid': user?.uid || 'guest-local',
          },
          body: JSON.stringify({ code, language, stdin, fileName }),
        });
        const fbRaw = await fbRes.text();
        let fbData: any = null;
        try {
          fbData = fbRaw ? JSON.parse(fbRaw) : null;
        } catch {
          fbData = null;
        }
        if (!fbData) throw new Error(fallbackErr || 'Execution server returned non-JSON response.');

        const executionTimeMs =
          typeof fbData.executionTimeMs === 'number'
            ? fbData.executionTimeMs
            : Math.max(1, Date.now() - startedAt);
        const success = Boolean(
          fbData.success ?? (fbRes.ok && fbData.status !== 'error' && fbData.canRun !== false)
        );
        const stdout = typeof fbData.stdout === 'string' ? fbData.stdout : String(fbData.output || '');
        const stderr =
          typeof fbData.stderr === 'string' && fbData.stderr
            ? fbData.stderr
            : !success
            ? String(fbData.runtimeError || fbData.output || fbData.error?.message_en || 'Execution error')
            : '';
        const exitCode = typeof fbData.exitCode === 'number' ? fbData.exitCode : success ? 0 : 1;
        const fbDiags: ExecutionDiagnostic[] = Array.isArray(fbData.diagnostics)
          ? fbData.diagnostics
          : [];

        const fastRes: FastExecutionResult = {
          success,
          stdout,
          stderr,
          exitCode,
          executionTimeMs,
          timedOut: Boolean(fbData.timedOut),
          language,
          stdinUsed: stdin,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          diagnostics: fbDiags,
        };

        const lines: TerminalLine[] = [];
        if (stdout) {
          stdout
            .replace(/\r\n/g, '\n')
            .split('\n')
            .forEach((t: string) => {
              lines.push({ id: makeTerminalLineId(), type: 'output', text: t });
            });
        }
        if (stderr) {
          stderr
            .replace(/\r\n/g, '\n')
            .split('\n')
            .forEach((t: string) => {
              lines.push({ id: makeTerminalLineId(), type: 'error', text: t });
            });
        }

        const fastHasError = !success || fbDiags.some((d) => d.severity === 'error');
        const fastHasWarning = !fastHasError && fbDiags.some((d) => d.severity === 'warning');
        const fastExecStatus: ExecutionStatus = fastHasError
          ? 'error'
          : fastHasWarning
          ? 'warning'
          : 'success';

        set({
          isFastRunning: false,
          activeSessionId: null,
          currentPrompt: '',
          currentInputValue: '',
          terminalExecState: success ? 'COMPLETED' : 'ERROR',
          terminalHistory: lines,
          fastRunResult: fastRes,
          diagnostics: fbDiags,
          executionStatus: fastExecStatus,
        });

        const currentUser = get().user;
        if (currentUser && !currentUser.isDemo) {
          const record: CodeExecutionRecord = {
            id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: currentUser.uid,
            language,
            source_code: code,
            stdin_input: stdin,
            stdout_output: stdout,
            stderr_output: stderr,
            exit_code: exitCode,
            execution_mode: 'fast',
            execution_time_ms: executionTimeMs,
            success,
            file_name: fileName,
            created_at: new Date().toISOString(),
          };
          set({ recentExecutions: [record, ...get().recentExecutions].slice(0, 30) });
          void fetch('/api/executions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-uid': currentUser.uid },
            body: JSON.stringify(record),
          }).catch(() => {});
          void saveCodeExecutionToFirestore(currentUser.uid, record).catch(() => {});
        }
      } catch (fbErr: any) {
        const errMsg = fbErr?.message || fallbackErr || 'Failed to execute code.';
        set({
          isFastRunning: false,
          activeSessionId: null,
          terminalExecState: 'ERROR',
          executionStatus: 'error',
          terminalHistory: [{ id: makeTerminalLineId(), type: 'error', text: errMsg }],
        });
      }
    };

    try {
      const res = await fetch('/api/execute/start', {
        method: 'POST',
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-user-uid': user?.uid || 'guest-local',
        },
        body: JSON.stringify({ code, language, fileName }),
      });

      let data: any = null;
      try {
        const raw = await res.text();
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (controller.signal.aborted) return;

      if (!res.ok || !data) {
        await runStaticFallback();
        return;
      }

      const diagnostics: ExecutionDiagnostic[] = Array.isArray(data.diagnostics)
        ? data.diagnostics
        : [];

      if (!data.ok || !data.sessionId) {
        const stderr = String(data.stderr || data.runtimeError || 'Compilation or syntax error.');
        const errorLines: TerminalLine[] = stderr
          .replace(/\r\n/g, '\n')
          .split('\n')
          .filter((l, idx, arr) => idx < arr.length - 1 || l.length > 0)
          .map((text) => ({ id: makeTerminalLineId(), type: 'error', text }));

        set({
          isFastRunning: false,
          terminalExecState: 'ERROR',
          diagnostics,
          executionStatus: 'error',
          terminalHistory: errorLines,
          fastRunResult: {
            success: false,
            stdout: '',
            stderr,
            exitCode: 1,
            executionTimeMs: Math.max(1, Date.now() - startedAt),
            language,
            stdinUsed: '',
            timestamp: new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            diagnostics,
          },
        });
        return;
      }

      const sessionId: string = data.sessionId;
      if (typeof EventSource === 'undefined') {
        await runStaticFallback();
        return;
      }

      set({
        activeSessionId: sessionId,
        terminalExecState: 'RUNNING',
        diagnostics,
      });

      const es = new EventSource(`/api/execute/stream/${encodeURIComponent(sessionId)}`);
      activeEventSource = es;

      es.addEventListener('stdout', (ev: MessageEvent) => {
        if (controller.signal.aborted || get().activeSessionId !== sessionId) return;
        try {
          const payload = JSON.parse(ev.data) as { text?: string };
          const chunk = String(payload.text ?? '').replace(/\r\n/g, '\n');
          if (!chunk) return;

          set((s) => {
            const combined = s.currentPrompt + chunk;
            const parts = combined.split('\n');
            const newLines: TerminalLine[] = parts.slice(0, -1).map((text) => ({
              id: makeTerminalLineId(),
              type: 'output',
              text,
            }));
            const nextPrompt = parts[parts.length - 1] ?? '';
            return {
              terminalHistory: newLines.length > 0 ? [...s.terminalHistory, ...newLines] : s.terminalHistory,
              currentPrompt: nextPrompt,
            };
          });
        } catch {
          // Ignore malformed event
        }
      });

      es.addEventListener('stderr', (ev: MessageEvent) => {
        if (controller.signal.aborted || get().activeSessionId !== sessionId) return;
        try {
          const payload = JSON.parse(ev.data) as { text?: string };
          const chunk = String(payload.text ?? '').replace(/\r\n/g, '\n');
          if (!chunk) return;

          const lines = chunk.split('\n');
          if (lines[lines.length - 1] === '') lines.pop();
          if (lines.length === 0) return;

          set((s) => ({
            terminalHistory: [
              ...s.terminalHistory,
              ...lines.map((text) => ({
                id: makeTerminalLineId(),
                type: 'error' as const,
                text,
              })),
            ],
          }));
        } catch {
          // Ignore malformed event
        }
      });

      es.addEventListener('prompt', () => {
        if (controller.signal.aborted || get().activeSessionId !== sessionId) return;
        set({
          terminalExecState: 'WAITING_FOR_INPUT',
          isFastRunning: false,
        });
      });

      es.addEventListener('exit', (ev: MessageEvent) => {
        closeActiveEventSource();
        if (controller.signal.aborted || get().activeSessionId !== sessionId) return;
        try {
          const payload = JSON.parse(ev.data) as {
            exitCode: number | null;
            timedOut?: boolean;
            executionTimeMs?: number;
            success?: boolean;
            stdout?: string;
            stderr?: string;
            stdinUsed?: string;
            diagnostics?: ExecutionDiagnostic[];
          };

          const executionTimeMs =
            typeof payload.executionTimeMs === 'number'
              ? payload.executionTimeMs
              : Math.max(1, Date.now() - startedAt);
          const timedOut = Boolean(payload.timedOut);
          const success = Boolean(payload.success);
          const exitCode = typeof payload.exitCode === 'number' ? payload.exitCode : success ? 0 : 1;
          const stdout = typeof payload.stdout === 'string' ? payload.stdout : '';
          const stderr =
            timedOut && !payload.stderr
              ? `Execution timed out (${executionTimeMs}ms). Possible infinite loop.`
              : typeof payload.stderr === 'string'
              ? payload.stderr
              : '';
          const exitDiags: ExecutionDiagnostic[] = Array.isArray(payload.diagnostics)
            ? payload.diagnostics
            : diagnostics;

          const fastRes: FastExecutionResult = {
            success,
            stdout,
            stderr,
            exitCode,
            executionTimeMs,
            timedOut,
            language,
            stdinUsed: payload.stdinUsed || '',
            timestamp: new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            diagnostics: exitDiags,
          };

          const fastHasError = !success || exitDiags.some((d) => d.severity === 'error');
          const fastHasWarning = !fastHasError && exitDiags.some((d) => d.severity === 'warning');
          const fastExecStatus: ExecutionStatus = fastHasError
            ? 'error'
            : fastHasWarning
            ? 'warning'
            : 'success';

          set((s) => {
            const flushedHistory = [...s.terminalHistory];
            if (s.currentPrompt.length > 0) {
              flushedHistory.push({
                id: makeTerminalLineId(),
                type: 'output',
                text: s.currentPrompt,
              });
            }
            if (timedOut) {
              flushedHistory.push({
                id: makeTerminalLineId(),
                type: 'error',
                text:
                  s.explainLanguage === 'bn'
                    ? 'সময়সীমা অতিক্রম করেছে (সম্ভাব্য অসীম লুপ)।'
                    : `Execution timed out (${executionTimeMs}ms). Possible infinite loop.`,
              });
            }
            return {
              isFastRunning: false,
              activeSessionId: null,
              currentPrompt: '',
              currentInputValue: '',
              terminalExecState: success ? 'COMPLETED' : 'ERROR',
              terminalHistory: flushedHistory,
              fastRunResult: fastRes,
              diagnostics: exitDiags,
              executionStatus: fastExecStatus,
            };
          });

          const currentUser = get().user;
          const isAuthenticated = Boolean(currentUser && !currentUser.isDemo);
          if (isAuthenticated && currentUser) {
            const record: CodeExecutionRecord = {
              id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              userId: currentUser.uid,
              language,
              source_code: code,
              stdin_input: payload.stdinUsed || '',
              stdout_output: stdout,
              stderr_output: stderr,
              exit_code: exitCode,
              execution_mode: 'fast',
              execution_time_ms: executionTimeMs,
              success,
              file_name: fileName,
              created_at: new Date().toISOString(),
            };

            set({ recentExecutions: [record, ...get().recentExecutions].slice(0, 30) });

            void fetch('/api/executions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-user-uid': currentUser.uid,
              },
              body: JSON.stringify(record),
            }).catch(() => {});

            void saveCodeExecutionToFirestore(currentUser.uid, record).catch(() => {});
          }
        } catch {
          set({
            isFastRunning: false,
            activeSessionId: null,
            terminalExecState: 'ERROR',
          });
        }
      });

      es.onerror = () => {
        if (get().activeSessionId !== sessionId) return;
        closeActiveEventSource();
        set((s) => ({
          isFastRunning: false,
          activeSessionId: null,
          terminalExecState: s.terminalHistory.length > 0 ? 'COMPLETED' : 'ERROR',
        }));
      };
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      const errMsg = err?.message || 'Failed to execute code.';
      set({
        isFastRunning: false,
        activeSessionId: null,
        terminalExecState: 'ERROR',
        executionStatus: 'error',
        terminalHistory: [{ id: makeTerminalLineId(), type: 'error', text: errMsg }],
        fastRunResult: {
          success: false,
          stdout: '',
          stderr: errMsg,
          exitCode: 1,
          executionTimeMs: Math.max(1, Date.now() - startedAt),
          language,
          stdinUsed: '',
          timestamp: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      });
    }
  },

  submitTerminalInput: async () => {
    const { activeSessionId, terminalExecState, currentPrompt, currentInputValue } = get();
    if (!activeSessionId || terminalExecState !== 'WAITING_FOR_INPUT') return;

    const answer = currentInputValue;
    set((s) => ({
      terminalHistory: [
        ...s.terminalHistory,
        {
          id: makeTerminalLineId(),
          type: 'prompt-answered',
          text: `${currentPrompt}${answer}`,
          prompt: currentPrompt,
          answer,
        },
      ],
      currentPrompt: '',
      currentInputValue: '',
      terminalExecState: 'RUNNING',
      isFastRunning: true,
    }));

    try {
      await fetch('/api/execute/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId, input: answer }),
      });
    } catch {
      // Errors will surface through the SSE stream or exit handler
    }
  },

  appendTerminalStdinAndRun: async (inputLine: string, overrideCode?: string) => {
    const currentStdin = get().stdin;
    const nextStdin = currentStdin
      ? `${currentStdin.replace(/\n$/, '')}\n${inputLine}`
      : inputLine;
    await get().runFast(overrideCode, nextStdin);
  },

  runVisualize: async (overrideCode?: string) => {
    // 1. Abort any previous hanging execution/Gemini requests
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    const currentAbortController = new AbortController();
    activeAbortController = currentAbortController;

    let {
      code,
      stdin,
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

    const explainStartedAt = Date.now();

    if (typeof overrideCode === 'string') {
      code = overrideCode;
      const updatedFiles = userFiles.map((f) => (f.id === activeFileId ? { ...f, code } : f));
      set({ code, userFiles: updatedFiles });
    }

    // 2. Reset all execution flags, loading states, output streams, and previous error states before starting fresh run
    set({
      isPlaying: false,
      isTracing: true,
      executionMode: 'explain',
      traceProgressStage: 1,
      apiError: null,
      apiNotice: null,
      diagnostics: [],
      executionStatus: 'idle',
      canRun: true,
      currentStepIndex: 0,
      prevStepIndex: 0,
    });

    // If editor is blank, show a clear error and do not generate any animation
    if (!code.trim()) {
      set({
        hasExecuted: true,
        isPlaying: false,
        isTracing: false,
        traceProgressStage: 0,
        executionStatus: 'error',
        canRun: false,
        diagnostics: [
          {
            line: 1,
            severity: 'error',
            message:
              explainLanguage === 'bn'
                ? 'এডিটর খালি আছে। রান ও বিশ্লেষণ করার জন্য আগে আপনার কোড লিখুন।'
                : 'Editor is empty. Please write or paste your code before running.',
          },
        ],
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

    const stage2Timer = setTimeout(() => {
      if (get().isTracing) set({ traceProgressStage: 2 });
    }, 60);

    const stage3Timer = setTimeout(() => {
      if (get().isTracing) set({ traceProgressStage: 3 });
    }, 120);

    try {
      const apiRes = await fetchTraceFromApi(
        { code, language, explainLanguage, depth, fileName, stdin, bypassCache: true },
        user?.uid,
        currentAbortController.signal
      );

      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);

      if (currentAbortController.signal.aborted) {
        return;
      }

      const diagnostics = apiRes.diagnostics || [];
      const hasErrors =
        Boolean(apiRes.error) ||
        diagnostics.some((d) => d.severity === 'error') ||
        Boolean(apiRes.trace?.hasError) ||
        apiRes.trace?.verdict.status === 'compile_error';
      const hasWarnings = diagnostics.some((d) => d.severity === 'warning');
      const executionStatus: ExecutionStatus = hasErrors
        ? 'error'
        : hasWarnings
        ? 'warning'
        : 'success';
      const canRun = apiRes.canRun ?? !hasErrors;

      if (hasErrors) {
        const errMsg =
          apiRes.trace?.errorDetails?.message ||
          apiRes.error?.message_en ||
          apiRes.trace?.verdict.message ||
          'Execution error encountered.';
        set({
          hasExecuted: true,
          isTracing: false,
          traceProgressStage: 0,
          fastRunResult: {
            success: false,
            stdout: '',
            stderr: errMsg,
            exitCode: 1,
            executionTimeMs: Math.max(1, Date.now() - explainStartedAt),
            language,
            stdinUsed: stdin,
            timestamp: new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            diagnostics,
          },
          apiError: apiRes.error || {
            code: 'COMPILE_ERROR',
            message_bn:
              apiRes.trace?.errorDetails?.messageBn ||
              apiRes.trace?.verdict.message ||
              'কোড কম্পাইল বা রান করতে ত্রুটি হয়েছে।',
            message_en: errMsg,
          },
          executionStatus: 'error',
          canRun: false,
          diagnostics,
          trace: apiRes.trace || {
            ...EMPTY_INITIAL_TRACE,
            hasError: true,
            isValidLogic: false,
            errorDetails: null,
            verdict: {
              status: 'compile_error',
              message:
                explainLanguage === 'bn'
                  ? apiRes.error?.message_bn || 'কোড কম্পাইল বা সিনট্যাক্স ত্রুটি।'
                  : apiRes.error?.message_en || 'Compilation or syntax error.',
            },
          },
        });
        return;
      }

      if (apiRes.trace) {
        const nextTrace = apiRes.trace;
        nextTrace.status = executionStatus;
        nextTrace.diagnostics = diagnostics;

        const now = new Date();
        const formattedDate =
          now.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }) +
          ', ' +
          now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          });

        const explainDurationMs = Math.max(1, Date.now() - explainStartedAt);
        const explainStdout = nextTrace.finalOutput || '';
        const isAuthenticated = Boolean(user && !user.isDemo);

        if (isAuthenticated && user) {
          const newEntry: SavedHistoryItem = {
            id: `run-${Date.now()}`,
            fileName: fileName || (language === 'java' ? 'Main.java' : 'main.js'),
            folderName: '',
            title_bn: fileName || (language === 'java' ? 'Main.java' : 'main.js'),
            title_en: fileName || (language === 'java' ? 'Main.java' : 'main.js'),
            language,
            code,
            analogyType: nextTrace.analogyType,
            verdictStatus: nextTrace.verdict.status,
            favorite: false,
            timestamp: formattedDate,
            trace: nextTrace,
            createdAt: Date.now(),
          };

          const updatedHistory = [newEntry, ...historyItems.slice(0, 49)];

          const explainExecRecord: CodeExecutionRecord = {
            id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: user.uid,
            language,
            source_code: code,
            stdin_input: stdin,
            stdout_output: explainStdout,
            stderr_output: '',
            exit_code: 0,
            execution_mode: 'explain',
            execution_time_ms: explainDurationMs,
            success: true,
            file_name: fileName,
            created_at: new Date().toISOString(),
          };
          const updatedExecs = [explainExecRecord, ...get().recentExecutions].slice(0, 30);

          set({
            hasExecuted: true,
            trace: nextTrace,
            diagnostics,
            executionStatus,
            canRun: true,
            apiNotice: apiRes.apiNotice || null,
            apiError: null,
            isTracing: false,
            traceProgressStage: 0,
            isDirty: false,
            currentStepIndex: 0,
            prevStepIndex: 0,
            isPlaying: false,
            historyItems: updatedHistory,
            recentExecutions: updatedExecs,
            fastRunResult: {
              success: true,
              stdout: explainStdout,
              stderr: '',
              exitCode: 0,
              executionTimeMs: explainDurationMs,
              language,
              stdinUsed: stdin,
              timestamp: now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }),
              diagnostics,
            },
          });

          // Persist code_executions log asynchronously
          void fetch('/api/executions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-uid': user.uid,
            },
            body: JSON.stringify(explainExecRecord),
          }).catch(() => {});

          void saveCodeExecutionToFirestore(user.uid, explainExecRecord).catch(() => {});

          // Persist run history to backend API in the background
          void fetch('/api/history', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-uid': user.uid,
            },
            body: JSON.stringify(newEntry),
          }).catch(() => {});

          // Sync run history and active file to Cloud Firestore in the background
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
        } else {
          // Guest Mode: full execution & animation, ZERO history saved
          set({
            hasExecuted: true,
            trace: nextTrace,
            diagnostics,
            executionStatus,
            canRun: true,
            apiNotice: apiRes.apiNotice || null,
            apiError: null,
            isTracing: false,
            traceProgressStage: 0,
            isDirty: false,
            currentStepIndex: 0,
            prevStepIndex: 0,
            isPlaying: false,
            fastRunResult: {
              success: true,
              stdout: explainStdout,
              stderr: '',
              exitCode: 0,
              executionTimeMs: explainDurationMs,
              language,
              stdinUsed: stdin,
              timestamp: now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }),
              diagnostics,
            },
          });
        }
        return;
      }
    } catch (err: any) {
      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);
      if (err?.name === 'AbortError' || currentAbortController.signal.aborted) {
        return;
      }
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

  setSpeed: () => set({ speed: 1 }),

  setReduceMotion: (reduceMotion) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    }
    set({ reduceMotion });
  },

  setEditorFontSize: (val, isDelta = false) => {
    const current = get().editorFontSize;
    const next = isDelta ? Math.min(28, Math.max(12, current + val)) : val;
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
      set({ isAuthLoading: true, isCloudSyncing: true, authError: null });
      const profile = await signInWithGooglePopup();
      if (!profile) {
        // Redirect flow initiated (auth/popup-blocked fallback)
        return;
      }
      set({
        user: profile,
        isAuthLoading: false,
        isCloudSyncing: false,
        authError: null,
        toast: {
          id: `auth-${Date.now()}`,
          message_bn: `স্বাগতম, ${profile.displayName}! গুগল লগইন সম্পন্ন হয়েছে।`,
          message_en: `Welcome, ${profile.displayName}! Signed in with Google.`,
        },
      });
      if (get().activeRoute === '/login') {
        get().setActiveRoute('/');
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      let message_bn = 'গুগল দিয়ে লগইন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।';
      let message_en = 'Could not sign in with Google. Please try again.';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        message_bn = 'লগইন পপআপ বন্ধ করা হয়েছে। লগইন করতে আবার চেষ্টা করুন।';
        message_en = 'Sign-in popup was closed. Please try again.';
      } else if (code === 'auth/unauthorized-domain') {
        message_bn = 'এই ডোমেইনটি Firebase Authentication-এ অনুমোদিত নয়।';
        message_en = 'This domain is not authorized in Firebase Authentication settings.';
      } else if (code === 'auth/network-request-failed') {
        message_bn = 'নেটওয়ার্ক সংযোগে সমস্যা হয়েছে। ইন্টারনেট সংযোগ পরীক্ষা করুন।';
        message_en = 'Network error during Google sign-in. Please check your connection.';
      } else if (err?.message === 'Firebase configuration missing') {
        message_bn = 'Firebase কনফিগারেশন পাওয়া যায়নি।';
        message_en = 'Firebase configuration is missing.';
      }

      set({
        isAuthLoading: false,
        isCloudSyncing: false,
        authError: {
          code: code || 'AUTH_ERROR',
          message_bn,
          message_en,
        },
      });
    }
  },

  signInDemoStudent: () => {
    // Deprecated demo login removed in favor of Guest Mode + Google Auth
    get().continueAsGuest();
  },

  signOutUser: async () => {
    try {
      await signOutFirebase();
    } catch {
      // ignore
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    clearLegacyLocalHistoryStorage();
    set({
      user: null,
      isAuthLoading: false,
      isCloudSyncing: false,
      authError: null,
      guestWorkMigrated: false,
      historyItems: [],
      recentExecutions: [],
      snippets: [],
      historyDropdownOpen: false,
      toast: {
        id: `signout-${Date.now()}`,
        message_bn: 'লগআউট সম্পন্ন হয়েছে। আপনি এখন গেস্ট মোডে আছেন।',
        message_en: 'Logged out successfully. You are now in Guest mode.',
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
    const next = historyItems.filter((item) => item.id !== id);
    set({ historyItems: next });
    if (user && !user.isDemo) {
      void fetch(`/api/history/${id}`, {
        method: 'DELETE',
        headers: { 'x-user-uid': user.uid },
      }).catch(() => {});
      void deleteHistoryFromFirestore(user.uid, id).catch(() => {});
    }
  },

  setHistoryDropdownOpen: (open: boolean) => set({ historyDropdownOpen: open }),
  toggleHistoryDropdown: () =>
    set((state) => ({ historyDropdownOpen: !state.historyDropdownOpen })),

  restoreHistoryItem: (item: SavedHistoryItem) => {
    const { userFiles, activeFileId } = get();
    const restoredFileName = item.fileName || item.title_en;
    const updatedFiles = userFiles.map((f) =>
      f.id === activeFileId
        ? {
            ...f,
            code: item.code,
            fileName: restoredFileName,
            language: item.language,
          }
        : f
    );
    if (item.trace && item.trace.steps && item.trace.steps.length > 0) {
      set({
        code: item.code,
        fileName: restoredFileName,
        language: item.language,
        trace: item.trace,
        hasExecuted: true,
        currentStepIndex: 0,
        prevStepIndex: 0,
        isPlaying: false,
        historyDropdownOpen: false,
        apiError:
          item.verdictStatus === 'compile_error'
            ? {
                code: 'RESTORED_ERROR',
                message_bn: item.trace?.verdict?.message || 'কোডে ত্রুটি আছে',
                message_en: item.trace?.verdict?.message || 'Error in code',
              }
            : null,
        userFiles: updatedFiles,
      });
    } else {
      set({
        code: item.code,
        fileName: restoredFileName,
        language: item.language,
        historyDropdownOpen: false,
        userFiles: updatedFiles,
      });
      void get().runVisualize(item.code);
    }
  },

  clearAllHistory: () => {
    const { user } = get();
    clearLegacyLocalHistoryStorage();
    set({ historyItems: [], historyDropdownOpen: false });
    if (user && !user.isDemo) {
      void fetch('/api/history', {
        method: 'DELETE',
        headers: { 'x-user-uid': user.uid },
      }).catch(() => {});
      void clearHistoryFromFirestore(user.uid).catch(() => {});
    }
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
