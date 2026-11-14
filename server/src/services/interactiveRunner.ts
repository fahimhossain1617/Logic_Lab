import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { ExecutionDiagnostic, SupportedLanguage } from '../../../shared/types';
import { classifyErrorCategory } from '../../../shared/stdinHelper';
import { preprocessCode, remapDiagnosticsToOriginal } from './codePreprocessor';
import {
  cleanupSandboxWorkspace,
  createSandboxWorkspace,
  getSanitizedEnv,
  killProcessTree,
  resolveExecutable,
  runSandboxedProcess,
  sanitizeSourceFileName,
  sanitizeWorkspacePaths,
} from './toolchains/sandbox';
import { parseGppDiagnostics } from './toolchains/cppToolchain';
import { compileJava } from './toolchains/javaToolchain';
import { checkPythonSyntax } from './toolchains/pythonToolchain';
import { checkJsSyntax, NODE_PRELOAD_CJS } from './toolchains/nodeToolchain';
import { executeViaRemoteSandbox, isLocalExecutionBlockedError } from './toolchains/remoteSandbox';

export type InteractiveEventType = 'stdout' | 'stderr' | 'prompt' | 'exit';

export interface InteractiveEvent {
  type: InteractiveEventType;
  data: Record<string, any>;
}

interface InteractiveSession {
  id: string;
  language: SupportedLanguage;
  code: string;
  fileName?: string;
  workspaceDir: string;
  child: ChildProcess | null;
  isRemoteReplay?: boolean;
  collectedInputs?: string[];
  isInteractive: boolean;
  startedAt: number;
  stdoutAll: string;
  stderrAll: string;
  stdinAll: string;
  exited: boolean;
  exitCode: number | null;
  timedOut: boolean;
  waitingForInput: boolean;
  diagnostics: ExecutionDiagnostic[];
  eventLog: InteractiveEvent[];
  listeners: Set<(ev: InteractiveEvent) => void>;
  promptTimer: NodeJS.Timeout | null;
  stepTimeoutTimer: NodeJS.Timeout | null;
  idleTimeoutTimer: NodeJS.Timeout | null;
}

export type StdinMode = 'auto' | 'batch' | 'interactive';

export interface StartInteractiveResult {
  ok: boolean;
  sessionId?: string;
  diagnostics: ExecutionDiagnostic[];
  stderr?: string;
  runtimeError?: string;
  errorCategory?: 'compile_error' | 'runtime_error' | 'input_error' | null;
  isInteractive?: boolean;
  executionBackend?: 'local' | 'remote';
  interactiveSupported?: boolean;
}

const sessions = new Map<string, InteractiveSession>();
const MAX_ACTIVE_SESSIONS = 16;
const MAX_OUTPUT_BYTES = 128 * 1024;
const STEP_TIMEOUT_MS = 12000;
const IDLE_TIMEOUT_MS = 120_000;
const INITIAL_PROMPT_SETTLE_MS = 450;
const PROMPT_SETTLE_MS = 120;

const UNBUF_C_CODE = `
#include <stdio.h>
__attribute__((constructor))
static void _logiclab_unbuf(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}
`.trim();

const JAVA_RUNNER_CODE = `
import java.io.*;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

public class _LogicLabRunner {
    public static void main(String[] args) throws Exception {
        PrintStream unbufOut = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8") {
            @Override
            public void write(int b) {
                super.write(b);
                flush();
            }
            @Override
            public void write(byte[] buf, int off, int len) {
                super.write(buf, off, len);
                flush();
            }
        };
        System.setOut(unbufOut);
        System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, "UTF-8"));
        if (args.length == 0) return;
        String targetClass = args[0];
        Class<?> cls = Class.forName(targetClass);
        Method m = cls.getMethod("main", String[].class);
        String[] forwarded = new String[Math.max(0, args.length - 1)];
        if (forwarded.length > 0) {
            System.arraycopy(args, 1, forwarded, 0, forwarded.length);
        }
        try {
            m.invoke(null, (Object) forwarded);
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause() != null ? ex.getCause() : ex;
            cause.printStackTrace(System.err);
            System.exit(1);
        }
    }
}
`.trim();

function stripCommentsForInputDetection(code: string, language: SupportedLanguage): string {
  if (language === 'python') {
    return code.replace(/#.*$/gm, '');
  }
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Returns true when code reads STDIN purely via whole-stream EOF APIs (e.g. fs.readFileSync(0),
 * sys.stdin.read()) without line-by-line interactive prompt APIs, so stdin must be closed immediately.
 */
function isWholeStreamEofOnly(code: string, language: SupportedLanguage): boolean {
  const clean = stripCommentsForInputDetection(code, language);
  if (language === 'javascript') {
    const usesWholeStream = /\bfs\.(?:readFileSync|readSync)\s*\(\s*(?:0|['"]\/dev\/stdin['"])/.test(clean);
    const usesLinePrompt = /\b(?:prompt|readline)\s*\(/.test(clean);
    return usesWholeStream && !usesLinePrompt;
  }
  if (language === 'python') {
    const usesWholeStream = /\bsys\.stdin\.(?:read|readlines)\s*\(/.test(clean);
    const usesLinePrompt = /\binput\s*\(/.test(clean);
    return usesWholeStream && !usesLinePrompt;
  }
  return false;
}

/**
 * Detects whether user code contains standard input calls in the target language.
 */
export function hasInputPattern(code: string, language: SupportedLanguage): boolean {
  const clean = stripCommentsForInputDetection(code, language);
  switch (language) {
    case 'python':
      return /\binput\s*\(|sys\.stdin/.test(clean);
    case 'cpp':
      return /\b(?:cin|scanf|fscanf|sscanf|getchar|getc|fgetc|gets|fgets|getline)\b/.test(clean);
    case 'java':
      return /\b(?:Scanner|BufferedReader|Console|System\.in)\b/.test(clean);
    case 'javascript':
    default:
      return /\b(?:prompt|readline|process\.stdin|readFileSync|readSync)\b/.test(clean);
  }
}

function emitSessionEvent(session: InteractiveSession, ev: InteractiveEvent): void {
  session.eventLog.push(ev);
  for (const listener of session.listeners) {
    try {
      listener(ev);
    } catch {
      // Ignore closed listener errors
    }
  }
}

function clearSessionTimers(session: InteractiveSession): void {
  if (session.promptTimer) {
    clearTimeout(session.promptTimer);
    session.promptTimer = null;
  }
  if (session.stepTimeoutTimer) {
    clearTimeout(session.stepTimeoutTimer);
    session.stepTimeoutTimer = null;
  }
  if (session.idleTimeoutTimer) {
    clearTimeout(session.idleTimeoutTimer);
    session.idleTimeoutTimer = null;
  }
}

function schedulePromptCheck(session: InteractiveSession, delayMs = PROMPT_SETTLE_MS): void {
  if (!session.isInteractive || session.exited) return;
  if (session.promptTimer) {
    clearTimeout(session.promptTimer);
  }
  session.promptTimer = setTimeout(() => {
    session.promptTimer = null;
    if (session.exited || session.waitingForInput) return;
    session.waitingForInput = true;
    if (session.stepTimeoutTimer) {
      clearTimeout(session.stepTimeoutTimer);
      session.stepTimeoutTimer = null;
    }
    if (session.idleTimeoutTimer) {
      clearTimeout(session.idleTimeoutTimer);
    }
    session.idleTimeoutTimer = setTimeout(() => {
      session.timedOut = true;
      if (session.child) killProcessTree(session.child);
    }, IDLE_TIMEOUT_MS);

    emitSessionEvent(session, { type: 'prompt', data: {} });
  }, delayMs);
}

function startStepTimer(session: InteractiveSession): void {
  if (session.stepTimeoutTimer) {
    clearTimeout(session.stepTimeoutTimer);
  }
  session.stepTimeoutTimer = setTimeout(() => {
    session.timedOut = true;
    if (session.child) killProcessTree(session.child);
  }, STEP_TIMEOUT_MS);
}

async function runRemoteBatchExecution(session: InteractiveSession): Promise<void> {
  const stdinStr = session.stdinAll;
  const remote = await executeViaRemoteSandbox(
    session.language,
    session.code,
    stdinStr,
    5000,
    session.fileName
  );

  if (!remote) {
    session.exited = true;
    const msg = 'Local compiler is unavailable and remote sandbox is unreachable.';
    session.stderrAll = msg;
    emitSessionEvent(session, { type: 'stderr', data: { text: msg } });
    emitSessionEvent(session, {
      type: 'exit',
      data: {
        exitCode: 1,
        timedOut: false,
        executionTimeMs: Math.max(1, Date.now() - session.startedAt),
        success: false,
        errorCategory: 'runtime_error',
        executionBackend: 'remote',
        interactiveSupported: false,
        stdout: session.stdoutAll,
        stderr: msg,
        stdinUsed: stdinStr,
        diagnostics: session.diagnostics,
      },
    });
    return;
  }

  if (remote.compileFailed) {
    session.exited = true;
    const compileText = remote.compileOutput || remote.stderr || 'Compilation failed.';
    session.stderrAll = compileText;
    emitSessionEvent(session, { type: 'stderr', data: { text: compileText } });
    emitSessionEvent(session, {
      type: 'exit',
      data: {
        exitCode: remote.exitCode ?? 1,
        timedOut: false,
        executionTimeMs: remote.executionTimeMs,
        success: false,
        errorCategory: 'compile_error',
        executionBackend: 'remote',
        interactiveSupported: false,
        stdout: '',
        stderr: compileText,
        stdinUsed: stdinStr,
        diagnostics: session.diagnostics,
      },
    });
    return;
  }

  if (remote.stdout) {
    session.stdoutAll = remote.stdout;
    emitSessionEvent(session, { type: 'stdout', data: { text: remote.stdout } });
  }

  session.exited = true;
  if (remote.stderr) {
    session.stderrAll = remote.stderr;
    emitSessionEvent(session, { type: 'stderr', data: { text: remote.stderr } });
  }

  const success = !remote.timedOut && remote.exitCode === 0;
  const errorCategory = success
    ? null
    : classifyErrorCategory(remote.stderr || remote.runtimeError || (remote.timedOut ? 'timed out' : ''), false);

  emitSessionEvent(session, {
    type: 'exit',
    data: {
      exitCode: remote.exitCode ?? (success ? 0 : 1),
      timedOut: remote.timedOut,
      executionTimeMs: remote.executionTimeMs,
      success,
      errorCategory,
      executionBackend: 'remote',
      interactiveSupported: false,
      stdout: session.stdoutAll,
      stderr: session.stderrAll || remote.runtimeError || '',
      stdinUsed: stdinStr,
      diagnostics: session.diagnostics,
    },
  });
}

function createRemoteBatchSession(
  rawCode: string,
  language: SupportedLanguage,
  fileName: string | undefined,
  diagnostics: ExecutionDiagnostic[],
  initialStdin = ''
): StartInteractiveResult {
  const sessionId = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const session: InteractiveSession = {
    id: sessionId,
    language,
    code: rawCode,
    fileName,
    workspaceDir: '',
    child: null,
    isRemoteReplay: true,
    collectedInputs: [],
    isInteractive: false,
    startedAt: Date.now(),
    stdoutAll: '',
    stderrAll: '',
    stdinAll: initialStdin,
    exited: false,
    exitCode: null,
    timedOut: false,
    waitingForInput: false,
    diagnostics,
    eventLog: [],
    listeners: new Set(),
    promptTimer: null,
    stepTimeoutTimer: null,
    idleTimeoutTimer: null,
  };
  sessions.set(sessionId, session);
  void runRemoteBatchExecution(session);
  return {
    ok: true,
    sessionId,
    diagnostics,
    isInteractive: false,
    executionBackend: 'remote',
    interactiveSupported: false,
  };
}

/**
 * Compiles (if needed) and starts a local interactive or batch child-process session.
 */
export async function startInteractiveSession(
  rawCode: string,
  language: SupportedLanguage,
  fileName?: string,
  initialStdin = '',
  stdinMode: StdinMode = 'auto'
): Promise<StartInteractiveResult> {
  // Evict already-exited sessions before checking live session capacity
  for (const [id, existing] of sessions.entries()) {
    if (existing.exited && Date.now() - existing.startedAt > 5000) {
      sessions.delete(id);
    }
  }
  const activeCount = [...sessions.values()].filter((s) => !s.exited).length;
  if (activeCount >= MAX_ACTIVE_SESSIONS) {
    const busyMsg = 'Too many active execution sessions. Please wait for an existing session to complete.';
    return { ok: false, diagnostics: [], stderr: busyMsg, runtimeError: busyMsg };
  }

  const prep = preprocessCode(rawCode, language);
  const code = prep.code;
  const detectedInput = hasInputPattern(code, language);
  const wholeStreamEofOnly = isWholeStreamEofOnly(code, language);
  const hasPreSuppliedStdin = initialStdin.length > 0;
  const isInteractive =
    stdinMode === 'interactive'
      ? detectedInput && !wholeStreamEofOnly
      : stdinMode === 'batch'
      ? false
      : detectedInput && !hasPreSuppliedStdin && !wholeStreamEofOnly;

  let workspaceDir = '';
  let cmd = '';
  let args: string[] = [];
  let extraEnv: Record<string, string> = {};
  let diagnostics: ExecutionDiagnostic[] = [...prep.diagnostics];

  try {
    if (language === 'cpp') {
      workspaceDir = await createSandboxWorkspace();
      const isC = Boolean(fileName && fileName.toLowerCase().endsWith('.c'));
      const sourceFileName = sanitizeSourceFileName(
        fileName,
        isC ? 'main.c' : 'main.cpp',
        ['.cpp', '.cc', '.cxx', '.c']
      );
      const binaryFileName = process.platform === 'win32' ? 'program.exe' : 'program.out';
      const binaryPath = path.join(workspaceDir, binaryFileName);

      await fs.writeFile(path.join(workspaceDir, sourceFileName), code, 'utf8');
      await fs.writeFile(path.join(workspaceDir, '_unbuf.c'), UNBUF_C_CODE, 'utf8');

      const gppPath = await resolveExecutable('g++');
      if (!gppPath) {
        await cleanupSandboxWorkspace(workspaceDir);
        if (process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
          return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
        }
        const cfgErr = "C++ compiler (g++) not found. Ensure g++ is installed and in PATH, or set GPP_PATH.";
        return { ok: false, diagnostics: [], stderr: cfgErr, runtimeError: cfgErr, errorCategory: 'compile_error' };
      }

      const compileArgs = isC
        ? ['-std=c11', '-Wall', '-Wextra', '-O0', sourceFileName, '_unbuf.c', '-o', binaryFileName]
        : ['-std=c++17', '-Wall', '-Wextra', '-O0', sourceFileName, '_unbuf.c', '-o', binaryFileName];

      const compileRes = await runSandboxedProcess({
        cmd: gppPath,
        args: compileArgs,
        cwd: workspaceDir,
        timeoutMs: 15000,
      });

      const cppDiags = remapDiagnosticsToOriginal(
        parseGppDiagnostics(compileRes.stderr, compileRes.stdout),
        prep
      );
      diagnostics = [...cppDiags, ...prep.diagnostics];
      const hasErrors =
        compileRes.exitCode !== 0 || cppDiags.some((d) => d.severity === 'error');

      if (hasErrors) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = cppDiags.find((d) => d.severity === 'error');
        const errMsg =
          compileRes.stderr.trim() || firstErr?.message || 'C/C++ compilation failed.';
        if (isLocalExecutionBlockedError(errMsg) && process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
          return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: 'compile_error',
          executionBackend: 'local',
          interactiveSupported: true,
        };
      }

      cmd = binaryPath;
      args = [];
    } else if (language === 'java') {
      const compileRes = await compileJava(code, fileName || 'Main.java');
      workspaceDir = compileRes.workspaceDir;
      const mappedJavaDiags = remapDiagnosticsToOriginal(compileRes.diagnostics, prep);
      diagnostics = [...mappedJavaDiags, ...prep.diagnostics];

      if (!compileRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = mappedJavaDiags.find((d) => d.severity === 'error');
        const errMsg =
          compileRes.compilerError ||
          compileRes.stderr.trim() ||
          firstErr?.message ||
          'Java compilation failed.';
        if (
          (compileRes.compilerUnavailable || isLocalExecutionBlockedError(errMsg)) &&
          process.env.REMOTE_SANDBOX_FALLBACK !== 'false'
        ) {
          return createRemoteBatchSession(
            rawCode,
            language,
            compileRes.sourceFileName || fileName,
            prep.diagnostics,
            initialStdin
          );
        }
        return {
          ok: false,
          diagnostics: compileRes.compilerUnavailable ? [] : diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: 'compile_error',
          executionBackend: 'local',
          interactiveSupported: true,
        };
      }

      const javacPath = await resolveExecutable('javac');
      const javaPath = await resolveExecutable('java');
      if (!javaPath) {
        await cleanupSandboxWorkspace(workspaceDir);
        if (process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
          return createRemoteBatchSession(
            rawCode,
            language,
            compileRes.sourceFileName || fileName,
            prep.diagnostics,
            initialStdin
          );
        }
        const cfgErr =
          "Java runtime (java) not found. Ensure a JDK/JRE is installed and 'java' is in PATH, or set JAVA_HOME / JAVA_PATH.";
        return { ok: false, diagnostics: [], stderr: cfgErr, runtimeError: cfgErr, errorCategory: 'compile_error' };
      }

      const mainClass = compileRes.mainClass || 'Main';
      await fs.writeFile(path.join(workspaceDir, '_LogicLabRunner.java'), JAVA_RUNNER_CODE, 'utf8');
      const runnerCompile = javacPath
        ? await runSandboxedProcess({
            cmd: javacPath,
            args: ['-encoding', 'UTF-8', '_LogicLabRunner.java'],
            cwd: workspaceDir,
            timeoutMs: 12000,
          })
        : { exitCode: 1 };

      const javaUtf8Flags = [
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-Dstderr.encoding=UTF-8',
        '-Dstdin.encoding=UTF-8',
        '-Dsun.stdout.encoding=UTF-8',
        '-Dsun.stderr.encoding=UTF-8',
      ];
      cmd = javaPath;
      args =
        runnerCompile.exitCode === 0
          ? [...javaUtf8Flags, '-cp', workspaceDir, '_LogicLabRunner', mainClass]
          : [...javaUtf8Flags, '-cp', workspaceDir, mainClass];
    } else if (language === 'python') {
      const syntaxRes = await checkPythonSyntax(code, fileName || 'script.py');
      workspaceDir = syntaxRes.workspaceDir;
      diagnostics = [...syntaxRes.diagnostics, ...prep.diagnostics];

      if (!syntaxRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = syntaxRes.diagnostics.find((d) => d.severity === 'error');
        const errMsg =
          syntaxRes.compilerError ||
          firstErr?.message ||
          syntaxRes.stderr.trim() ||
          'Python syntax error.';
        if (
          (syntaxRes.compilerUnavailable || isLocalExecutionBlockedError(errMsg)) &&
          process.env.REMOTE_SANDBOX_FALLBACK !== 'false'
        ) {
          return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics: syntaxRes.compilerUnavailable ? [] : diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: 'compile_error',
          executionBackend: 'local',
          interactiveSupported: true,
        };
      }

      const sourceFileName = sanitizeSourceFileName(fileName, 'script.py', ['.py']);
      cmd = (await resolveExecutable('python')) || 'python';
      args = ['-u', sourceFileName];
      extraEnv = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    } else {
      const syntaxRes = await checkJsSyntax(code, fileName || 'script.js');
      workspaceDir = syntaxRes.workspaceDir;
      diagnostics = [...syntaxRes.diagnostics, ...prep.diagnostics];

      if (!syntaxRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = syntaxRes.diagnostics.find((d) => d.severity === 'error');
        const errMsg =
          firstErr?.message || syntaxRes.stderr.trim() || 'JavaScript syntax error.';
        return {
          ok: false,
          diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: 'compile_error',
          executionBackend: 'local',
          interactiveSupported: true,
        };
      }

      const sourceFileName = sanitizeSourceFileName(fileName, 'script.js', ['.js', '.mjs', '.cjs']);
      await fs.writeFile(path.join(workspaceDir, '_preload.cjs'), NODE_PRELOAD_CJS, 'utf8');
      cmd = (await resolveExecutable('node')) || process.execPath;
      args = ['--require', './_preload.cjs', sourceFileName];
    }

    const sessionId = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const child = spawn(cmd, args, {
      cwd: workspaceDir,
      env: { ...getSanitizedEnv(), ...extraEnv },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: InteractiveSession = {
      id: sessionId,
      language,
      code: rawCode,
      fileName,
      workspaceDir,
      child,
      isInteractive,
      startedAt: Date.now(),
      stdoutAll: '',
      stderrAll: '',
      stdinAll: initialStdin,
      exited: false,
      exitCode: null,
      timedOut: false,
      waitingForInput: false,
      diagnostics,
      eventLog: [],
      listeners: new Set(),
      promptTimer: null,
      stepTimeoutTimer: null,
      idleTimeoutTimer: null,
    };

    child.stdin?.on('error', () => {
      // Ignore EPIPE when child exits before consuming stdin
    });

    if (initialStdin && child.stdin) {
      const normalized = initialStdin.replace(/\r\n/g, '\n');
      try {
        child.stdin.write(normalized.endsWith('\n') ? normalized : `${normalized}\n`, 'utf8');
      } catch {
        // Ignore write error on dead child
      }
    }
    if (!isInteractive && child.stdin) {
      child.stdin.end();
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    sessions.set(sessionId, session);
    startStepTimer(session);
    if (isInteractive) {
      schedulePromptCheck(session, INITIAL_PROMPT_SETTLE_MS);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (!text) return;
      if (session.stdoutAll.length < MAX_OUTPUT_BYTES) {
        session.stdoutAll += text;
      }
      session.waitingForInput = false;
      emitSessionEvent(session, { type: 'stdout', data: { text } });
      if (session.isInteractive) {
        schedulePromptCheck(session, PROMPT_SETTLE_MS);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = sanitizeWorkspacePaths(stderrDecoder.write(chunk), session.workspaceDir);
      if (!text) return;
      if (session.stderrAll.length < MAX_OUTPUT_BYTES) {
        session.stderrAll += text;
      }
      emitSessionEvent(session, { type: 'stderr', data: { text } });
    });

    child.on('error', (err: Error) => {
      const msg = `Failed to start process: ${err.message}`;
      if (isLocalExecutionBlockedError(msg) && process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
        session.isRemoteReplay = true;
        session.isInteractive = false;
        session.child = null;
        session.collectedInputs = [];
        clearSessionTimers(session);
        void cleanupSandboxWorkspace(session.workspaceDir);
        void runRemoteBatchExecution(session);
        return;
      }
      session.stderrAll += msg;
      emitSessionEvent(session, { type: 'stderr', data: { text: msg } });
    });

    child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (session.exited || session.isRemoteReplay) return;
      const tailOut = stdoutDecoder.end();
      if (tailOut) {
        if (session.stdoutAll.length < MAX_OUTPUT_BYTES) session.stdoutAll += tailOut;
        emitSessionEvent(session, { type: 'stdout', data: { text: tailOut } });
      }
      const tailErr = sanitizeWorkspacePaths(stderrDecoder.end(), session.workspaceDir);
      if (tailErr) {
        if (session.stderrAll.length < MAX_OUTPUT_BYTES) session.stderrAll += tailErr;
        emitSessionEvent(session, { type: 'stderr', data: { text: tailErr } });
      }
      session.exited = true;
      session.exitCode = exitCode;
      session.waitingForInput = false;
      clearSessionTimers(session);

      const executionTimeMs = Math.max(1, Date.now() - session.startedAt);
      const success = !session.timedOut && exitCode === 0 && !signal;
      const errorCategory = success
        ? null
        : classifyErrorCategory(
            session.stderrAll || (session.timedOut ? 'timed out' : signal || ''),
            false
          );

      emitSessionEvent(session, {
        type: 'exit',
        data: {
          exitCode,
          signal,
          timedOut: session.timedOut,
          executionTimeMs,
          success,
          errorCategory,
          executionBackend: 'local',
          interactiveSupported: true,
          stdout: session.stdoutAll,
          stderr: session.stderrAll,
          stdinUsed: session.stdinAll,
          diagnostics: session.diagnostics,
        },
      });

      void cleanupSandboxWorkspace(session.workspaceDir);
      const cleanupTimer = setTimeout(() => {
        sessions.delete(sessionId);
      }, 30_000);
      cleanupTimer.unref?.();
    });

    return {
      ok: true,
      sessionId,
      diagnostics,
      isInteractive,
      executionBackend: 'local',
      interactiveSupported: true,
    };
  } catch (err: any) {
    if (workspaceDir) {
      await cleanupSandboxWorkspace(workspaceDir);
    }
    const msg = err?.message || 'Execution failed to start.';
    if (isLocalExecutionBlockedError(msg) && process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
      return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
    }
    return {
      ok: false,
      diagnostics,
      stderr: msg,
      runtimeError: msg,
      errorCategory: 'compile_error',
    };
  }
}

/**
 * Subscribes to live events for an interactive session, replaying buffered events first.
 */
export function subscribeToSession(
  sessionId: string,
  listener: (ev: InteractiveEvent) => void
): (() => void) | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  for (const ev of session.eventLog) {
    listener(ev);
  }
  if (session.exited) {
    return () => {};
  }

  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

/**
 * Sends a single line of stdin (or signals EOF) to an active local interactive session.
 */
export function sendSessionInput(sessionId: string, inputLine: string, eof = false): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.exited || session.isRemoteReplay || !session.isInteractive) {
    return false;
  }

  if (!session.child || !session.child.stdin) {
    return false;
  }

  if (session.idleTimeoutTimer) {
    clearTimeout(session.idleTimeoutTimer);
    session.idleTimeoutTimer = null;
  }
  if (session.promptTimer) {
    clearTimeout(session.promptTimer);
    session.promptTimer = null;
  }

  session.waitingForInput = false;
  startStepTimer(session);

  if (eof) {
    try {
      session.child.stdin.end();
    } catch {
      return false;
    }
    return true;
  }

  const line = `${inputLine}\n`;
  session.stdinAll += line;

  try {
    session.child.stdin.write(line, 'utf8');
  } catch {
    return false;
  }

  if (session.isInteractive) {
    schedulePromptCheck(session, PROMPT_SETTLE_MS);
  }
  return true;
}

/**
 * Forcefully stops an active interactive session and cleans up its workspace.
 */
export function stopInteractiveSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  clearSessionTimers(session);
  if (!session.exited && session.child) {
    killProcessTree(session.child);
  }
  void cleanupSandboxWorkspace(session.workspaceDir);
  sessions.delete(sessionId);
  return true;
}

