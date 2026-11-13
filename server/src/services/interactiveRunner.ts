import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { ExecutionDiagnostic, SupportedLanguage } from '../../../shared/types';
import { preprocessCode } from './codePreprocessor';
import {
  cleanupSandboxWorkspace,
  createSandboxWorkspace,
  getSanitizedEnv,
  killProcessTree,
  resolveExecutable,
  runSandboxedProcess,
  sanitizeSourceFileName,
} from './toolchains/sandbox';
import { parseGppDiagnostics } from './toolchains/cppToolchain';
import { compileJava, extractJavaClassName } from './toolchains/javaToolchain';
import { checkPythonSyntax } from './toolchains/pythonToolchain';
import { checkJsSyntax } from './toolchains/nodeToolchain';
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

export interface StartInteractiveResult {
  ok: boolean;
  sessionId?: string;
  diagnostics: ExecutionDiagnostic[];
  stderr?: string;
  runtimeError?: string;
  isInteractive?: boolean;
}

const sessions = new Map<string, InteractiveSession>();
const MAX_OUTPUT_BYTES = 128 * 1024;
const STEP_TIMEOUT_MS = 12000;
const IDLE_TIMEOUT_MS = 120_000;
const PROMPT_SETTLE_MS = 85;

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

const NODE_PRELOAD_CJS = `
const fs = require('fs');
globalThis.prompt = function(message) {
  if (message !== undefined && message !== null) {
    process.stdout.write(String(message));
  }
  const buf = Buffer.alloc(1);
  const bytes = [];
  while (true) {
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(0, buf, 0, 1, null);
    } catch (err) {
      if (err && (err.code === 'EAGAIN' || err.code === 'EINTR')) continue;
      break;
    }
    if (bytesRead === 0) break;
    const b = buf[0];
    if (b === 10) break; // '\\n'
    if (b !== 13) bytes.push(b); // skip '\\r'
  }
  return Buffer.from(bytes).toString('utf8');
};
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

async function runRemoteReplayStep(session: InteractiveSession): Promise<void> {
  const inputs = session.collectedInputs || [];
  const stdinStr = inputs.join('\n');
  const remote = await executeViaRemoteSandbox(session.language, session.code, stdinStr, 5000);

  if (!remote) {
    session.exited = true;
    const msg = 'Local compiler is unavailable and remote sandbox is unreachable.';
    emitSessionEvent(session, { type: 'stderr', data: { text: msg } });
    emitSessionEvent(session, {
      type: 'exit',
      data: {
        exitCode: 1,
        timedOut: false,
        executionTimeMs: Math.max(1, Date.now() - session.startedAt),
        success: false,
        stdout: session.stdoutAll,
        stderr: msg,
        stdinUsed: stdinStr,
        diagnostics: session.diagnostics,
      },
    });
    return;
  }

  if (remote.compileOutput && remote.exitCode !== 0 && !remote.stdout) {
    session.exited = true;
    session.stderrAll = remote.compileOutput;
    emitSessionEvent(session, { type: 'stderr', data: { text: remote.compileOutput } });
    emitSessionEvent(session, {
      type: 'exit',
      data: {
        exitCode: remote.exitCode ?? 1,
        timedOut: false,
        executionTimeMs: remote.executionTimeMs,
        success: false,
        stdout: '',
        stderr: remote.compileOutput,
        stdinUsed: stdinStr,
        diagnostics: session.diagnostics,
      },
    });
    return;
  }

  const prevLen = session.stdoutAll.length;
  const fullStdout = remote.stdout || '';
  const delta = fullStdout.slice(prevLen);
  if (delta) {
    session.stdoutAll = fullStdout;
    emitSessionEvent(session, { type: 'stdout', data: { text: delta } });
  }

  // If the program requires input and we haven't provided all inputs yet, prompt again if stderr indicates EOF/input wait or if we have more inputs to collect
  const hitEof =
    session.isInteractive &&
    (remote.stderr?.toLowerCase().includes('eof') ||
      remote.runtimeError?.toLowerCase().includes('eof') ||
      (inputs.length === 0 && !remote.stderr));

  if (hitEof && inputs.length < 20) {
    session.waitingForInput = true;
    emitSessionEvent(session, { type: 'prompt', data: {} });
    return;
  }

  session.exited = true;
  if (remote.stderr) {
    session.stderrAll += remote.stderr;
    emitSessionEvent(session, { type: 'stderr', data: { text: remote.stderr } });
  }
  emitSessionEvent(session, {
    type: 'exit',
    data: {
      exitCode: remote.exitCode ?? 0,
      timedOut: remote.timedOut,
      executionTimeMs: remote.executionTimeMs,
      success: !remote.timedOut && (remote.exitCode === 0 || remote.exitCode === null),
      stdout: session.stdoutAll,
      stderr: session.stderrAll,
      stdinUsed: stdinStr,
      diagnostics: session.diagnostics,
    },
  });
}

function createRemoteReplaySession(
  rawCode: string,
  language: SupportedLanguage,
  fileName: string | undefined,
  isInteractive: boolean,
  diagnostics: ExecutionDiagnostic[],
  initialStdin = ''
): StartInteractiveResult {
  const sessionId = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const initialInputs = initialStdin ? initialStdin.replace(/\r\n/g, '\n').split('\n') : [];
  const session: InteractiveSession = {
    id: sessionId,
    language,
    code: rawCode,
    fileName,
    workspaceDir: '',
    child: null,
    isRemoteReplay: true,
    collectedInputs: initialInputs,
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
  sessions.set(sessionId, session);
  void runRemoteReplayStep(session);
  return {
    ok: true,
    sessionId,
    diagnostics,
    isInteractive,
  };
}

/**
 * Compiles (if needed) and starts an interactive child-process session.
 */
export async function startInteractiveSession(
  rawCode: string,
  language: SupportedLanguage,
  fileName?: string,
  initialStdin = ''
): Promise<StartInteractiveResult> {
  const prep = preprocessCode(rawCode, language);
  const code = prep.code;
  const isInteractive = hasInputPattern(code, language);

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
          return createRemoteReplaySession(rawCode, language, fileName, isInteractive, prep.diagnostics, initialStdin);
        }
        const cfgErr = "C++ compiler (g++) not found. Ensure g++ is installed and in PATH, or set GPP_PATH.";
        return { ok: false, diagnostics: [], stderr: cfgErr, runtimeError: cfgErr };
      }

      const compileArgs = isC
        ? ['-Wall', '-Wextra', '-O0', sourceFileName, '_unbuf.c', '-o', binaryFileName]
        : ['-std=c++17', '-Wall', '-Wextra', '-O0', sourceFileName, '_unbuf.c', '-o', binaryFileName];

      const compileRes = await runSandboxedProcess({
        cmd: gppPath,
        args: compileArgs,
        cwd: workspaceDir,
        timeoutMs: 15000,
      });

      const cppDiags = parseGppDiagnostics(compileRes.stderr, compileRes.stdout);
      diagnostics = [...cppDiags, ...prep.diagnostics];
      const hasErrors =
        compileRes.exitCode !== 0 || cppDiags.some((d) => d.severity === 'error');

      if (hasErrors) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = cppDiags.find((d) => d.severity === 'error');
        const errMsg =
          compileRes.stderr.trim() || firstErr?.message || 'C/C++ compilation failed.';
        if (isLocalExecutionBlockedError(errMsg) && process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
          return createRemoteReplaySession(rawCode, language, fileName, isInteractive, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
        };
      }

      cmd = binaryPath;
      args = [];
    } else if (language === 'java') {
      const compileRes = await compileJava(code, fileName || 'Main.java');
      workspaceDir = compileRes.workspaceDir;
      diagnostics = [...compileRes.diagnostics, ...prep.diagnostics];

      if (!compileRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = compileRes.diagnostics.find((d) => d.severity === 'error');
        const errMsg =
          compileRes.compilerError ||
          compileRes.stderr.trim() ||
          firstErr?.message ||
          'Java compilation failed.';
        if (
          (compileRes.compilerUnavailable || isLocalExecutionBlockedError(errMsg)) &&
          process.env.REMOTE_SANDBOX_FALLBACK !== 'false'
        ) {
          return createRemoteReplaySession(rawCode, language, fileName, isInteractive, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics: compileRes.compilerUnavailable ? [] : diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
        };
      }

      const javacPath = await resolveExecutable('javac');
      const javaPath = await resolveExecutable('java');
      if (!javaPath) {
        await cleanupSandboxWorkspace(workspaceDir);
        if (process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
          return createRemoteReplaySession(rawCode, language, fileName, isInteractive, prep.diagnostics, initialStdin);
        }
        const cfgErr =
          "Java runtime (java) not found. Ensure a JDK/JRE is installed and 'java' is in PATH, or set JAVA_HOME / JAVA_PATH.";
        return { ok: false, diagnostics: [], stderr: cfgErr, runtimeError: cfgErr };
      }

      const className = extractJavaClassName(code, fileName || 'Main.java');
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
          ? [...javaUtf8Flags, '-cp', workspaceDir, '_LogicLabRunner', className]
          : [...javaUtf8Flags, '-cp', workspaceDir, className];
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
          return createRemoteReplaySession(rawCode, language, fileName, isInteractive, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics: syntaxRes.compilerUnavailable ? [] : diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
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

    if (initialStdin && child.stdin) {
      const normalized = initialStdin.replace(/\r\n/g, '\n');
      try {
        child.stdin.write(normalized.endsWith('\n') ? normalized : `${normalized}\n`, 'utf8');
      } catch {
        // Ignore write error on dead child
      }
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    sessions.set(sessionId, session);
    startStepTimer(session);
    if (isInteractive) {
      schedulePromptCheck(session, PROMPT_SETTLE_MS);
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
      const text = stderrDecoder.write(chunk);
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
        session.child = null;
        session.collectedInputs = initialStdin ? initialStdin.replace(/\r\n/g, '\n').split('\n') : [];
        clearSessionTimers(session);
        void cleanupSandboxWorkspace(session.workspaceDir);
        void runRemoteReplayStep(session);
        return;
      }
      session.stderrAll += msg;
      emitSessionEvent(session, { type: 'stderr', data: { text: msg } });
    });

    child.on('close', (exitCode: number | null) => {
      if (session.exited || session.isRemoteReplay) return;
      const tailOut = stdoutDecoder.end();
      if (tailOut) {
        if (session.stdoutAll.length < MAX_OUTPUT_BYTES) session.stdoutAll += tailOut;
        emitSessionEvent(session, { type: 'stdout', data: { text: tailOut } });
      }
      const tailErr = stderrDecoder.end();
      if (tailErr) {
        if (session.stderrAll.length < MAX_OUTPUT_BYTES) session.stderrAll += tailErr;
        emitSessionEvent(session, { type: 'stderr', data: { text: tailErr } });
      }
      session.exited = true;
      session.exitCode = exitCode;
      session.waitingForInput = false;
      clearSessionTimers(session);

      const executionTimeMs = Math.max(1, Date.now() - session.startedAt);
      const success = !session.timedOut && (exitCode === 0 || exitCode === null);

      emitSessionEvent(session, {
        type: 'exit',
        data: {
          exitCode,
          timedOut: session.timedOut,
          executionTimeMs,
          success,
          stdout: session.stdoutAll,
          stderr: session.stderrAll,
          stdinUsed: session.stdinAll,
          diagnostics: session.diagnostics,
        },
      });

      void cleanupSandboxWorkspace(session.workspaceDir);
      setTimeout(() => {
        sessions.delete(sessionId);
      }, 30_000);
    });

    return {
      ok: true,
      sessionId,
      diagnostics,
      isInteractive,
    };
  } catch (err: any) {
    if (workspaceDir) {
      await cleanupSandboxWorkspace(workspaceDir);
    }
    const msg = err?.message || 'Execution failed to start.';
    if (isLocalExecutionBlockedError(msg) && process.env.REMOTE_SANDBOX_FALLBACK !== 'false') {
      return createRemoteReplaySession(rawCode, language, fileName, isInteractive, prep.diagnostics, initialStdin);
    }
    return {
      ok: false,
      diagnostics,
      stderr: msg,
      runtimeError: msg,
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
 * Sends a single line of stdin to an active interactive session.
 */
export function sendSessionInput(sessionId: string, inputLine: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.exited) {
    return false;
  }

  if (session.isRemoteReplay) {
    session.waitingForInput = false;
    session.stdinAll += `${inputLine}\n`;
    session.collectedInputs = [...(session.collectedInputs || []), inputLine];
    void runRemoteReplayStep(session);
    return true;
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
  const line = `${inputLine}\n`;
  session.stdinAll += line;

  startStepTimer(session);
  try {
    session.child.stdin.write(line, 'utf8');
  } catch {
    return false;
  }

  if (session.isInteractive) {
    schedulePromptCheck(session, 110);
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

