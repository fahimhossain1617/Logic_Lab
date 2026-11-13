import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  generateExecutionTrace,
  getCacheSize,
  clearTraceCache,
  isGeminiKeyConfigured,
} from '../services/geminiTraceService';
import { preprocessCode } from '../services/codePreprocessor';
import { traceRateLimiter } from '../middleware/rateLimitAndSecurity';
import { SAMPLE_PROGRAMS } from '../../../src/data/sampleTraces';
import { PROBLEM_LIBRARY } from '../../../src/data/problemLibrary';
import { runDeterministicMultiLanguage } from '../tracers/realExecutionRunner';
import { analyzeCode, executeCode } from '../services/toolchains/toolchainManager';
import { getToolchainAvailability } from '../services/toolchains/sandbox';
import {
  sendSessionInput,
  startInteractiveSession,
  stopInteractiveSession,
  subscribeToSession,
} from '../services/interactiveRunner';
import {
  CodeExecutionRecord,
  ExecutionDiagnostic,
  ExecutionStatus,
  ExecutionTrace,
  SupportedLanguage,
} from '../../../shared/types';

export const apiRouter = Router();

const TraceRequestSchema = z.object({
  code: z.string().min(1, 'Code cannot be empty'),
  language: z.enum(['javascript', 'python', 'cpp', 'java']).default('javascript'),
  explainLanguage: z.enum(['bn', 'en']).default('bn'),
  depth: z.enum(['simple', 'detailed']).default('simple'),
  fileName: z.string().optional(),
  stdin: z.string().optional().default(''),
  bypassCache: z.boolean().optional().default(false),
});

// Server-side persistence store (paired with Cloud Firestore on the client)
interface StoredSnippet {
  id: string;
  uid: string;
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

interface StoredHistoryItem {
  id: string;
  uid: string;
  title_bn: string;
  title_en: string;
  language: SupportedLanguage;
  code: string;
  analogyType: ExecutionTrace['analogyType'];
  verdictStatus: ExecutionTrace['verdict']['status'];
  favorite: boolean;
  timestamp: string;
}

interface StoredProgress {
  uid: string;
  streak: number;
  lastActiveDate: string;
  completedProblemIds: string[];
  badges: string[];
  topicsCovered: string[];
}

interface StoredShare {
  shareId: string;
  authorUid: string;
  authorName: string;
  title_bn: string;
  title_en: string;
  language: SupportedLanguage;
  code: string;
  stdin: string;
  trace: ExecutionTrace;
  createdAt: string;
}

interface StoredUserAccount {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  lastLoginAt: string;
}

const snippetsByUid = new Map<string, StoredSnippet[]>();
const historyByUid = new Map<string, StoredHistoryItem[]>();
const executionsByUid = new Map<string, CodeExecutionRecord[]>();
const progressByUid = new Map<string, StoredProgress>();
const settingsByUid = new Map<string, Record<string, any>>();
const userAccountsByUid = new Map<string, StoredUserAccount>();
const sharesById = new Map<string, StoredShare>();

const PERSIST_FILE_PATH = path.join(os.tmpdir(), 'logic-lab-auth-store.json');
const IS_TEST_RUNNER = Boolean(process.env.NODE_TEST_CONTEXT || process.argv.some((a) => a.includes('test')));

function loadPersistedAuthStore() {
  if (IS_TEST_RUNNER) return;
  try {
    if (!fs.existsSync(PERSIST_FILE_PATH)) return;
    const raw = fs.readFileSync(PERSIST_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.users && typeof parsed.users === 'object') {
        for (const [k, v] of Object.entries(parsed.users)) {
          userAccountsByUid.set(k, v as StoredUserAccount);
        }
      }
      if (parsed.history && typeof parsed.history === 'object') {
        for (const [k, v] of Object.entries(parsed.history)) {
          if (Array.isArray(v)) historyByUid.set(k, v as StoredHistoryItem[]);
        }
      }
      if (parsed.executions && typeof parsed.executions === 'object') {
        for (const [k, v] of Object.entries(parsed.executions)) {
          if (Array.isArray(v)) executionsByUid.set(k, v as CodeExecutionRecord[]);
        }
      }
      if (parsed.snippets && typeof parsed.snippets === 'object') {
        for (const [k, v] of Object.entries(parsed.snippets)) {
          if (Array.isArray(v)) snippetsByUid.set(k, v as StoredSnippet[]);
        }
      }
    }
  } catch {
    // Non-fatal on read-only environments
  }
}

function savePersistedAuthStore() {
  if (IS_TEST_RUNNER) return;
  try {
    const serializeAuthenticated = <T>(m: Map<string, T>) => {
      const out: Record<string, T> = {};
      for (const [k, v] of m.entries()) {
        if (k !== 'guest-local' && !k.startsWith('user-')) {
          out[k] = v;
        }
      }
      return out;
    };
    const payload = {
      users: Object.fromEntries(userAccountsByUid.entries()),
      history: serializeAuthenticated(historyByUid),
      executions: serializeAuthenticated(executionsByUid),
      snippets: serializeAuthenticated(snippetsByUid),
    };
    fs.writeFileSync(PERSIST_FILE_PATH, JSON.stringify(payload), 'utf8');
  } catch {
    // Non-fatal on read-only/serverless environments
  }
}

loadPersistedAuthStore();

async function verifyFirebaseIdToken(idToken: string): Promise<{
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
} | null> {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (apiKey && !apiKey.startsWith('YOUR_')) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const user = data?.users?.[0];
        if (user?.localId) {
          return {
            uid: String(user.localId),
            email: String(user.email || ''),
            displayName: String(user.displayName || user.email?.split('@')[0] || 'Logic Lab User'),
            photoURL: String(user.photoUrl || ''),
          };
        }
      }
    } catch {
      // Fallback to JWT claim decode below if network unavailable
    }
  }

  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const uid = payload.user_id || payload.sub;
    if (!uid || typeof uid !== 'string') return null;
    return {
      uid,
      email: String(payload.email || ''),
      displayName: String(payload.name || payload.email?.split('@')[0] || 'Logic Lab User'),
      photoURL: String(payload.picture || ''),
    };
  } catch {
    return null;
  }
}

// Seed default demo share link so `/s/demo-swap` always works
sharesById.set('demo-swap', {
  shareId: 'demo-swap',
  authorUid: 'demo-instructor',
  authorName: 'Logic Lab Instructor',
  title_bn: SAMPLE_PROGRAMS[0].title_bn,
  title_en: SAMPLE_PROGRAMS[0].title_en,
  language: 'javascript',
  code: SAMPLE_PROGRAMS[0].codes.javascript,
  stdin: '',
  trace: SAMPLE_PROGRAMS[0].traces.bn.simple,
  createdAt: new Date().toISOString(),
});

function resolveUid(req: Request): string {
  const headerUid = req.headers['x-user-uid'];
  if (typeof headerUid === 'string' && headerUid.trim()) {
    return headerUid.trim().slice(0, 128);
  }
  return 'guest-local';
}

apiRouter.get('/health', async (_req: Request, res: Response) => {
  const availability = await getToolchainAvailability();
  res.json({
    status: 'ok',
    service: 'logic-lab-api',
    geminiConfigured: isGeminiKeyConfigured(),
    toolchains: {
      java: Boolean(availability.javac && availability.java),
      cpp: Boolean(availability['g++']),
      python: Boolean(availability.python),
      javascript: Boolean(availability.node),
    },
    cacheSize: getCacheSize(),
    problemsCount: PROBLEM_LIBRARY.length,
    sharesCount: sharesById.size,
    timestamp: new Date().toISOString(),
  });
});

// Auth Session Endpoints (/api/auth/session, /api/auth/logout)
apiRouter.post('/auth/session', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

  let verifiedUser: {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
  } | null = null;

  if (bearerToken) {
    verifiedUser = await verifyFirebaseIdToken(bearerToken);
  }

  const uid = verifiedUser?.uid || resolveUid(req);
  if (!uid || uid === 'guest-local') {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message_bn: 'বৈধ লগইন সেশন পাওয়া যায়নি।',
        message_en: 'No valid authenticated session found.',
      },
    });
  }

  const account: StoredUserAccount = {
    uid,
    email: verifiedUser?.email || String(req.body?.email || '').slice(0, 200),
    displayName:
      verifiedUser?.displayName ||
      String(req.body?.displayName || 'Logic Lab User').slice(0, 120),
    photoURL: verifiedUser?.photoURL || String(req.body?.photoURL || '').slice(0, 500),
    lastLoginAt: new Date().toISOString(),
  };

  userAccountsByUid.set(uid, account);
  savePersistedAuthStore();

  return res.json({
    authenticated: true,
    user: account,
    history: historyByUid.get(uid) || [],
    executions: executionsByUid.get(uid) || [],
    snippets: snippetsByUid.get(uid) || [],
  });
});

apiRouter.get('/auth/session', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
  let uid = resolveUid(req);
  if (bearerToken) {
    const verified = await verifyFirebaseIdToken(bearerToken);
    if (verified?.uid) uid = verified.uid;
  }
  if (!uid || uid === 'guest-local') {
    return res.json({ authenticated: false, user: null });
  }
  const account = userAccountsByUid.get(uid) || null;
  return res.json({
    authenticated: Boolean(account),
    user: account,
  });
});

apiRouter.post('/auth/logout', (_req: Request, res: Response) => {
  return res.json({ authenticated: false, ok: true });
});

apiRouter.post('/trace', traceRateLimiter, async (req: Request, res: Response) => {
  const rawCode = typeof req.body?.code === 'string' ? req.body.code : '';
  const lineCount = rawCode.split('\n').length;

  // Reject code longer than 6,000 characters or 200 lines
  if (rawCode.length > 6000 || lineCount > 200) {
    return res.status(400).json({
      error: {
        code: 'CODE_TOO_LONG',
        message_bn:
          'কোডটি অনেক বড় (সর্বোচ্চ ২০০ লাইন বা ৬,০০০ অক্ষর অনুমোদিত)। অনুগ্রহ করে ছোট অংশ ভিজ্যুয়ালাইজ করুন।',
        message_en:
          'Code exceeds maximum size limit (200 lines or 6,000 characters). Please paste a shorter snippet.',
      },
    });
  }

  const parsed = TraceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message_bn: 'অনুগ্রহ করে বৈধ কোড এবং ভাষা নির্বাচন করুন।',
        message_en: 'Invalid request parameters. Please provide non-empty code and a supported language.',
      },
    });
  }

  try {
    const result = await generateExecutionTrace(parsed.data);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'TRACE_GENERATION_FAILED',
        message_bn: 'কোড বিশ্লেষণ করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
        message_en: err?.message || 'Failed to generate execution trace.',
      },
    });
  }
});

// Clear runtime cache endpoint (/api/cache/clear)
apiRouter.post('/cache/clear', (_req: Request, res: Response) => {
  clearTraceCache();
  res.json({
    status: 'ok',
    message: 'Runtime cache cleared successfully.',
  });
});

// Real-time Code Analysis Endpoint (/api/analyze)
apiRouter.post('/analyze', traceRateLimiter, async (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const language: SupportedLanguage = req.body?.language || 'javascript';
  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : undefined;

  if (!code.trim()) {
    return res.json({ canCompile: true, diagnostics: [], language });
  }

  try {
    const analysis = await analyzeCode(code, language, fileName);
    return res.json(analysis);
  } catch (err: any) {
    return res.json({
      canCompile: false,
      diagnostics: [
        {
          line: 1,
          severity: 'error' as const,
          message: err?.message || 'Code analysis error',
          source: language,
        },
      ],
      language,
    });
  }
});

// Sandboxed Real Execution Endpoint (/api/execute)
apiRouter.post('/execute', traceRateLimiter, async (req: Request, res: Response) => {
  const execStartedAt = Date.now();
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const rawLang = req.body?.language;
  const language: SupportedLanguage =
    rawLang === 'python' || rawLang === 'cpp' || rawLang === 'java' || rawLang === 'javascript'
      ? rawLang
      : 'javascript';
  const stdin = typeof req.body?.stdin === 'string' ? req.body.stdin : '';
  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : undefined;

  if (!code.trim()) {
    return res.status(400).json({
      success: false,
      stdout: '',
      stderr: 'Please provide non-empty code to execute.',
      exitCode: 1,
      executionTimeMs: 0,
      error: {
        code: 'EMPTY_CODE',
        message_bn: 'চালানোর জন্য কোড লিখুন।',
        message_en: 'Please provide non-empty code to execute.',
      },
    });
  }

  const prep = preprocessCode(code, language);

  // 1. Run actual toolchain compilation and sandboxed execution with real stdin piping (zero AI tokens)
  const toolchainRes = await executeCode(prep.code, language, stdin, 4000, fileName);

  // 2. Run deterministic step simulation for UI visualization compatibility
  const simResult = runDeterministicMultiLanguage(prep.code, language, stdin, 1200);

  // Adjust line numbers if boilerplate lines were prepended
  if (prep.injectedPrefixLines > 0) {
    for (const st of simResult.recordedSteps) {
      st.line = Math.max(1, st.line - prep.injectedPrefixLines);
    }
  }

  // Combine real compiler/runtime diagnostics with minor preprocessor warnings
  const combinedDiagnostics: ExecutionDiagnostic[] = [
    ...toolchainRes.diagnostics,
    ...prep.diagnostics,
  ];

  const hasErrors =
    toolchainRes.status === 'error' ||
    combinedDiagnostics.some((d) => d.severity === 'error');
  const hasWarnings = combinedDiagnostics.some((d) => d.severity === 'warning');
  const status: ExecutionStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'success';
  const canRun = !hasErrors;
  const success =
    canRun &&
    !toolchainRes.timedOut &&
    (toolchainRes.exitCode === 0 || toolchainRes.exitCode === null);

  const output = toolchainRes.output || simResult.stdout || '';
  const stdout =
    typeof toolchainRes.stdout === 'string' && (toolchainRes.stdout.length > 0 || !canRun)
      ? toolchainRes.stdout
      : simResult.stdout || '';
  const stderr =
    toolchainRes.stderr ||
    toolchainRes.runtimeError ||
    (!canRun ? output : simResult.stderr || '');
  const executionTimeMs = Math.max(
    1,
    toolchainRes.executionTimeMs > 0
      ? toolchainRes.executionTimeMs
      : Date.now() - execStartedAt
  );

  return res.json({
    ...simResult,
    success,
    status,
    canRun,
    output,
    stdout,
    stderr,
    exitCode: toolchainRes.exitCode,
    executionTimeMs,
    timedOut: toolchainRes.timedOut,
    runtimeError: toolchainRes.runtimeError,
    diagnostics: combinedDiagnostics,
    visualizerData: canRun ? simResult : null,
    traceSource: 'real_execution',
    language,
  });
});

// Interactive Terminal Execution Endpoints (/api/execute/start, /stream/:sessionId, /input, /stop)
apiRouter.post('/execute/start', traceRateLimiter, async (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const rawLang = req.body?.language;
  const language: SupportedLanguage =
    rawLang === 'python' || rawLang === 'cpp' || rawLang === 'java' || rawLang === 'javascript'
      ? rawLang
      : 'javascript';
  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : undefined;
  const stdin = typeof req.body?.stdin === 'string' ? req.body.stdin : '';

  if (!code.trim()) {
    return res.status(400).json({
      ok: false,
      diagnostics: [],
      stderr: 'Please provide non-empty code to execute.',
      runtimeError: 'Please provide non-empty code to execute.',
    });
  }

  const result = await startInteractiveSession(code, language, fileName, stdin);
  if (!result.ok) {
    return res.status(200).json(result);
  }
  return res.json(result);
});

apiRouter.get('/execute/stream/:sessionId', (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || '');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const unsubscribe = subscribeToSession(sessionId, (ev) => {
    res.write(`event: ${ev.type}\n`);
    res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
    if (ev.type === 'exit') {
      res.end();
    }
  });

  if (!unsubscribe) {
    res.write(`event: exit\n`);
    res.write(
      `data: ${JSON.stringify({
        exitCode: 1,
        timedOut: false,
        executionTimeMs: 0,
        success: false,
        stdout: '',
        stderr: 'Execution session not found or expired.',
      })}\n\n`
    );
    res.end();
    return;
  }

  req.on('close', () => {
    unsubscribe();
  });
});

apiRouter.post('/execute/input', (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  const input = typeof req.body?.input === 'string' ? req.body.input : '';

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing sessionId' });
  }

  const ok = sendSessionInput(sessionId, input);
  return res.json({ ok });
});

apiRouter.post('/execute/stop', (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  if (!sessionId) {
    return res.status(400).json({ ok: false });
  }
  const ok = stopInteractiveSession(sessionId);
  return res.json({ ok });
});

// Code Executions Log CRUD (/api/executions) — guest & signed-in fallback store
apiRouter.get('/executions', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = executionsByUid.get(uid) || [];
  res.json({ executions: list });
});

apiRouter.post('/executions', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = executionsByUid.get(uid) || [];
  const rawLang = req.body?.language;
  const language: SupportedLanguage =
    rawLang === 'python' || rawLang === 'cpp' || rawLang === 'java' || rawLang === 'javascript'
      ? rawLang
      : 'javascript';
  const execution_mode = req.body?.execution_mode === 'explain' ? 'explain' : 'fast';

  const record: CodeExecutionRecord = {
    id: String(req.body?.id || `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 120),
    userId: uid === 'guest-local' ? null : uid,
    language,
    source_code: String(req.body?.source_code || '').slice(0, 20000),
    stdin_input: String(req.body?.stdin_input || '').slice(0, 4000),
    stdout_output: String(req.body?.stdout_output || '').slice(0, 20000),
    stderr_output: req.body?.stderr_output ? String(req.body.stderr_output).slice(0, 10000) : '',
    exit_code: typeof req.body?.exit_code === 'number' ? req.body.exit_code : null,
    execution_mode,
    execution_time_ms: Math.max(0, Math.round(Number(req.body?.execution_time_ms) || 0)),
    success: Boolean(req.body?.success ?? true),
    file_name: req.body?.file_name ? String(req.body.file_name).slice(0, 140) : undefined,
    created_at: req.body?.created_at ? String(req.body.created_at) : new Date().toISOString(),
  };

  const next = [record, ...list.filter((item) => item.id !== record.id)].slice(0, 30);
  executionsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ execution: record, executions: next });
});

apiRouter.delete('/executions', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  executionsByUid.set(uid, []);
  savePersistedAuthStore();
  res.json({ executions: [] });
});

apiRouter.delete('/executions/:id', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = executionsByUid.get(uid) || [];
  const next = list.filter((item) => item.id !== req.params.id);
  executionsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ executions: next });
});

// Curated 13-problem library endpoints
apiRouter.get('/problems', (_req: Request, res: Response) => {
  res.json({
    problems: PROBLEM_LIBRARY,
  });
});

apiRouter.get('/problems/:id', (req: Request, res: Response) => {
  const found = PROBLEM_LIBRARY.find((p) => p.id === req.params.id);
  if (!found) {
    return res.status(404).json({
      error: {
        code: 'PROBLEM_NOT_FOUND',
        message_bn: 'প্রবলেমটি খুঁজে পাওয়া যায়নি।',
        message_en: 'Problem not found.',
      },
    });
  }
  return res.json({ problem: found });
});

// Snippets CRUD
apiRouter.get('/snippets', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  res.json({ snippets: list });
});

apiRouter.post('/snippets', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const item: StoredSnippet = {
    id: req.body?.id || `snip-${Date.now()}`,
    uid,
    title_bn: String(req.body?.title_bn || 'সংরক্ষিত কোড').slice(0, 160),
    title_en: String(req.body?.title_en || 'Saved Snippet').slice(0, 160),
    language: req.body?.language || 'javascript',
    code: String(req.body?.code || '').slice(0, 20000),
    stdin: String(req.body?.stdin || '').slice(0, 2000),
    analogyType: req.body?.analogyType || 'generic_memory',
    isFavorite: Boolean(req.body?.isFavorite),
    problemId: req.body?.problemId,
    updatedAt: new Date().toISOString(),
  };
  const next = [item, ...list.filter((s) => s.id !== item.id)].slice(0, 50);
  snippetsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ snippet: item, snippets: next });
});

apiRouter.put('/snippets/:id', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const next = list.map((s) =>
    s.id === req.params.id
      ? {
          ...s,
          ...req.body,
          id: s.id,
          uid,
          updatedAt: new Date().toISOString(),
        }
      : s
  );
  snippetsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ snippets: next });
});

apiRouter.delete('/snippets/:id', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const next = list.filter((s) => s.id !== req.params.id);
  snippetsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ snippets: next });
});

// History CRUD
apiRouter.get('/history', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  res.json({ history: list });
});

apiRouter.post('/history', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  const entry: StoredHistoryItem & { fileName?: string } = {
    id: req.body?.id || `run-${Date.now()}`,
    uid,
    fileName: req.body?.fileName ? String(req.body.fileName).slice(0, 140) : undefined,
    title_bn: String(req.body?.title_bn || 'কোড রান').slice(0, 160),
    title_en: String(req.body?.title_en || 'Code Run').slice(0, 160),
    language: req.body?.language || 'javascript',
    code: String(req.body?.code || '').slice(0, 20000),
    analogyType: req.body?.analogyType || 'generic_memory',
    verdictStatus: req.body?.verdictStatus || 'correct',
    favorite: Boolean(req.body?.favorite),
    timestamp: req.body?.timestamp || 'Just now',
  };
  const next = [entry, ...list.filter((h) => h.id !== entry.id)].slice(0, 30);
  historyByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ entry, history: next });
});

apiRouter.delete('/history', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  historyByUid.set(uid, []);
  savePersistedAuthStore();
  res.json({ history: [] });
});

apiRouter.delete('/history/:id', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  const next = list.filter((h) => h.id !== req.params.id);
  historyByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ history: next });
});

// Progress & Settings
apiRouter.get('/progress', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const progress = progressByUid.get(uid) || {
    uid,
    streak: 3,
    lastActiveDate: new Date().toISOString().slice(0, 10),
    completedProblemIds: ['swap_correct', 'swap_faulty', 'bubble_sort', 'infinite_loop'],
    badges: ['first_visualize', 'bug_hunter', 'swap_master'],
    topicsCovered: ['Variables & Memory', 'Sorting', 'Loops & Control Flow'],
  };
  res.json({ progress });
});

apiRouter.put('/progress', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const updated: StoredProgress = {
    uid,
    streak: Number(req.body?.streak ?? 3),
    lastActiveDate: String(req.body?.lastActiveDate || new Date().toISOString().slice(0, 10)),
    completedProblemIds: Array.isArray(req.body?.completedProblemIds)
      ? req.body.completedProblemIds
      : [],
    badges: Array.isArray(req.body?.badges) ? req.body.badges : [],
    topicsCovered: Array.isArray(req.body?.topicsCovered) ? req.body.topicsCovered : [],
  };
  progressByUid.set(uid, updated);
  res.json({ progress: updated });
});

apiRouter.get('/settings', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  res.json({ settings: settingsByUid.get(uid) || {} });
});

apiRouter.put('/settings', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const next = { ...(settingsByUid.get(uid) || {}), ...req.body };
  settingsByUid.set(uid, next);
  res.json({ settings: next });
});

// Public Share Links (/api/share & /api/share/:id)
apiRouter.post('/share', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const shareId =
    req.body?.shareId ||
    `ll-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
  const share: StoredShare = {
    shareId,
    authorUid: uid,
    authorName: String(req.body?.authorName || 'Logic Lab Student').slice(0, 120),
    title_bn: String(req.body?.title_bn || 'শেয়ার করা ভিজ্যুয়ালাইজেশন').slice(0, 160),
    title_en: String(req.body?.title_en || 'Shared Visualization').slice(0, 160),
    language: req.body?.language || 'javascript',
    code: String(req.body?.code || SAMPLE_PROGRAMS[0].codes.javascript).slice(0, 20000),
    stdin: String(req.body?.stdin || '').slice(0, 2000),
    trace: req.body?.trace || SAMPLE_PROGRAMS[0].traces.bn.simple,
    createdAt: new Date().toISOString(),
  };
  sharesById.set(shareId, share);
  res.json({ share });
});

apiRouter.get('/share/:id', (req: Request, res: Response) => {
  const share = sharesById.get(req.params.id);
  if (!share) {
    return res.status(404).json({
      error: {
        code: 'SHARE_NOT_FOUND',
        message_bn: 'শেয়ার করা লিংকটি খুঁজে পাওয়া যায়নি।',
        message_en: 'Shared visualization link not found.',
      },
    });
  }
  return res.json({ share });
});
