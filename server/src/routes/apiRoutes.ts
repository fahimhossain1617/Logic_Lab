import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  generateExecutionTrace,
  getCacheSize,
  isGeminiKeyConfigured,
} from '../services/geminiTraceService';
import { traceRateLimiter } from '../middleware/rateLimitAndSecurity';
import { SAMPLE_PROGRAMS } from '../../../src/data/sampleTraces';
import { PROBLEM_LIBRARY } from '../../../src/data/problemLibrary';
import { runDeterministicMultiLanguage } from '../tracers/realExecutionRunner';
import { ExecutionTrace, SupportedLanguage } from '../../../shared/types';

export const apiRouter = Router();

const TraceRequestSchema = z.object({
  code: z.string().min(1, 'Code cannot be empty'),
  language: z.enum(['javascript', 'python', 'cpp', 'java']).default('javascript'),
  explainLanguage: z.enum(['bn', 'en']).default('bn'),
  depth: z.enum(['simple', 'detailed']).default('simple'),
  fileName: z.string().optional(),
  stdin: z.string().optional().default(''),
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

const snippetsByUid = new Map<string, StoredSnippet[]>();
const historyByUid = new Map<string, StoredHistoryItem[]>();
const progressByUid = new Map<string, StoredProgress>();
const settingsByUid = new Map<string, Record<string, any>>();
const sharesById = new Map<string, StoredShare>();

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

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'logic-lab-api',
    geminiConfigured: isGeminiKeyConfigured(),
    cacheSize: getCacheSize(),
    problemsCount: PROBLEM_LIBRARY.length,
    sharesCount: sharesById.size,
    timestamp: new Date().toISOString(),
  });
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

// Sandboxed Real Execution Endpoint (/api/execute)
apiRouter.post('/execute', traceRateLimiter, (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const language: SupportedLanguage = req.body?.language || 'javascript';
  const stdin = typeof req.body?.stdin === 'string' ? req.body.stdin : '';

  if (!code.trim()) {
    return res.status(400).json({
      error: {
        code: 'EMPTY_CODE',
        message_bn: 'চালানোর জন্য কোড লিখুন।',
        message_en: 'Please provide non-empty code to execute.',
      },
    });
  }

  const result = runDeterministicMultiLanguage(code, language, stdin, 1200);
  return res.json({
    traceSource: 'real_execution',
    language,
    ...result,
  });
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
  res.json({ snippets: next });
});

apiRouter.delete('/snippets/:id', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const next = list.filter((s) => s.id !== req.params.id);
  snippetsByUid.set(uid, next);
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
  const entry: StoredHistoryItem = {
    id: req.body?.id || `run-${Date.now()}`,
    uid,
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
  res.json({ entry, history: next });
});

apiRouter.delete('/history/:id', (req: Request, res: Response) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  const next = list.filter((h) => h.id !== req.params.id);
  historyByUid.set(uid, next);
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
