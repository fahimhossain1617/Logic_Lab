import { ExecutionDiagnostic, SupportedLanguage } from '../../../../shared/types';
import { ToolchainExecutionResult } from './types';

export interface RemoteSandboxResult {
  ok: boolean;
  provider: 'piston' | 'judge0';
  stdout: string;
  stderr: string;
  compileOutput: string;
  exitCode: number | null;
  timedOut: boolean;
  runtimeError: string | null;
  executionTimeMs: number;
}

const DEFAULT_JUDGE0_URL = 'https://ce.judge0.com';

const JUDGE0_LANGUAGE_IDS: Record<SupportedLanguage, number> = {
  cpp: 105,        // C++ (GCC 14.1.0)
  java: 91,        // Java (JDK 17.0.6)
  python: 100,     // Python (3.12.5)
  javascript: 102, // JavaScript (Node.js 22.08.0)
};

const PISTON_LANGUAGES: Record<SupportedLanguage, { language: string; fileName: string }> = {
  cpp: { language: 'c++', fileName: 'main.cpp' },
  java: { language: 'java', fileName: 'Main.java' },
  python: { language: 'python', fileName: 'main.py' },
  javascript: { language: 'javascript', fileName: 'main.js' },
};

function normalizeStdin(stdin: string): string {
  if (!stdin) return '';
  const normalized = stdin.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

/**
 * Detects OS binary execution blocks (e.g. Windows Device Guard / AppLocker blocking Temp .exe)
 * or missing local binary runtime errors.
 */
export function isLocalExecutionBlockedError(stderr: string): boolean {
  const lower = (stderr || '').toLowerCase();
  return (
    lower.includes('spawn unknown') ||
    lower.includes('spawn eacces') ||
    lower.includes('spawn eperm') ||
    lower.includes('spawn enoent') ||
    lower.includes('device guard') ||
    lower.includes('blocked by your organization')
  );
}

async function runPiston(
  baseUrl: string,
  language: SupportedLanguage,
  code: string,
  stdin: string,
  timeoutMs: number,
  fileName?: string
): Promise<RemoteSandboxResult | null> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/execute`;
  const cfg = PISTON_LANGUAGES[language];
  const resolvedFileName = fileName && fileName.trim() ? fileName.trim() : cfg.fileName;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs + 6000, 10000));
  const startedAt = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        language: cfg.language,
        version: '*',
        files: [{ name: resolvedFileName, content: code }],
        stdin: normalizeStdin(stdin),
        run_timeout: timeoutMs,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      compile?: { stdout?: string; stderr?: string; code?: number; signal?: string };
      run?: { stdout?: string; stderr?: string; code?: number; signal?: string };
    };

    const elapsed = Date.now() - startedAt;
    if (data.compile && data.compile.code && data.compile.code !== 0) {
      const compileStderr = data.compile.stderr || data.compile.stdout || 'Compilation failed.';
      return {
        ok: true,
        provider: 'piston',
        stdout: '',
        stderr: compileStderr,
        compileOutput: compileStderr,
        exitCode: data.compile.code ?? 1,
        timedOut: false,
        runtimeError: compileStderr,
        executionTimeMs: elapsed,
      };
    }

    const run = data.run ?? {};
    const timedOut = run.signal === 'SIGKILL' && elapsed >= timeoutMs;
    const exitCode = typeof run.code === 'number' ? run.code : run.signal ? 1 : 0;
    const stderr = run.stderr ?? '';
    const runtimeError = timedOut
      ? `Execution timed out (${timeoutMs}ms). Possible infinite loop.`
      : exitCode !== 0
      ? stderr.trim() || `Process exited with error code ${exitCode}.`
      : null;

    return {
      ok: true,
      provider: 'piston',
      stdout: run.stdout ?? '',
      stderr,
      compileOutput: '',
      exitCode,
      timedOut,
      runtimeError,
      executionTimeMs: elapsed,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Judge0 CE always compiles Java submissions as `Main.java` and runs `java Main`.
 * When the user's Java code uses a custom `public class <ClassName>` that matches
 * their active filename (or default Main.java), adapt the source so Judge0 compiles
 * and invokes `<ClassName>.main(args)` without throwing a `Main.java` filename error.
 */
function adaptJavaCodeForJudge0(code: string, fileName?: string): string {
  const pubMatch = code.match(/\bpublic\s+((?:final\s+|abstract\s+)?class\s+)([A-Za-z_$][\w$]*)\b/);
  if (!pubMatch || !pubMatch[2] || pubMatch[2] === 'Main') {
    return code;
  }
  const className = pubMatch[2];
  const trimmedFile = (fileName || '').trim();
  const stem = trimmedFile.replace(/\.java$/i, '');
  const isDefaultOrMatching =
    !stem || /^main\d*$/i.test(stem) || stem === className;
  if (!isDefaultOrMatching) {
    return code;
  }
  const demoted = code.replace(
    /\bpublic\s+((?:final\s+|abstract\s+)?class\s+)([A-Za-z_$][\w$]*)\b/,
    '$1$2'
  );
  if (/\bclass\s+Main\b/.test(demoted)) {
    return demoted;
  }
  return `${demoted}\npublic class Main { public static void main(String[] args) throws Exception { ${className}.main(args); } }\n`;
}

async function runJudge0(
  baseUrl: string,
  language: SupportedLanguage,
  code: string,
  stdin: string,
  timeoutMs: number,
  fileName?: string
): Promise<RemoteSandboxResult | null> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/submissions?base64_encoded=false&wait=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs + 8000, 12000));
  const startedAt = Date.now();
  const cpuLimitSec = Math.max(1, Math.min(10, Math.ceil(timeoutMs / 1000)));
  const sourceCode = language === 'java' ? adaptJavaCodeForJudge0(code, fileName) : code;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        language_id: JUDGE0_LANGUAGE_IDS[language],
        source_code: sourceCode,
        stdin: normalizeStdin(stdin),
        cpu_time_limit: cpuLimitSec,
        wall_time_limit: cpuLimitSec + 2,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      stdout?: string | null;
      stderr?: string | null;
      compile_output?: string | null;
      message?: string | null;
      time?: string | null;
      exit_code?: number | null;
      status?: { id?: number; description?: string };
    };

    const elapsed =
      data.time && !Number.isNaN(Number(data.time))
        ? Math.max(1, Math.round(Number(data.time) * 1000))
        : Date.now() - startedAt;

    const statusId = data.status?.id ?? 0;
    // Judge0 status IDs: 3 = Accepted, 5 = Time Limit Exceeded, 6 = Compilation Error, 7..12 = Runtime Error
    const timedOut = statusId === 5;
    const compileOutput = data.compile_output ?? '';
    const rawStderr = data.stderr ?? data.message ?? '';

    if (statusId === 6) {
      return {
        ok: true,
        provider: 'judge0',
        stdout: '',
        stderr: compileOutput || rawStderr || 'Compilation error.',
        compileOutput,
        exitCode: 1,
        timedOut: false,
        runtimeError: compileOutput || rawStderr || 'Compilation error.',
        executionTimeMs: elapsed,
      };
    }

    const isSuccess = statusId === 3;
    const exitCode =
      typeof data.exit_code === 'number' ? data.exit_code : isSuccess ? 0 : 1;
    const combinedStderr = rawStderr || (isSuccess ? '' : data.status?.description || '');
    const runtimeError = timedOut
      ? `Execution timed out (${timeoutMs}ms). Possible infinite loop.`
      : !isSuccess
      ? combinedStderr.trim() || data.status?.description || 'Runtime execution failed.'
      : null;

    return {
      ok: true,
      provider: 'judge0',
      stdout: data.stdout ?? '',
      stderr: combinedStderr,
      compileOutput,
      exitCode,
      timedOut,
      runtimeError,
      executionTimeMs: elapsed,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Converts a RemoteSandboxResult into a standard ToolchainExecutionResult.
 */
export function buildRemoteToolchainResult(
  remote: RemoteSandboxResult,
  diagnostics: ExecutionDiagnostic[],
  runtimeErrorLine?: number
): ToolchainExecutionResult {
  const status: 'success' | 'warning' | 'error' =
    remote.timedOut || (remote.exitCode !== 0 && remote.exitCode !== null)
      ? 'error'
      : diagnostics.some((d) => d.severity === 'warning')
      ? 'warning'
      : 'success';
  const output = remote.runtimeError
    ? remote.stdout
      ? `${remote.stdout}\n${remote.runtimeError}`
      : remote.runtimeError
    : remote.stdout;
  return {
    status,
    canRun: status !== 'error',
    stdout: remote.stdout,
    stderr: remote.stderr,
    output,
    exitCode: remote.exitCode,
    timedOut: remote.timedOut,
    runtimeError: remote.runtimeError,
    ...(runtimeErrorLine !== undefined ? { runtimeErrorLine } : {}),
    executionTimeMs: remote.executionTimeMs,
    diagnostics,
  };
}

/**
 * Executes code via a configured Piston instance or Judge0 CE sandbox when local
 * binary execution is unavailable or blocked by OS security policy.
 */
export async function executeViaRemoteSandbox(
  language: SupportedLanguage,
  code: string,
  stdin = '',
  timeoutMs = 4000,
  fileName?: string
): Promise<RemoteSandboxResult | null> {
  if (process.env.REMOTE_SANDBOX_FALLBACK === 'false') {
    return null;
  }

  const pistonUrl = process.env.PISTON_API_URL?.trim();
  if (pistonUrl) {
    const pistonRes = await runPiston(pistonUrl, language, code, stdin, timeoutMs, fileName);
    if (pistonRes?.ok) return pistonRes;
  }

  const judge0Url = process.env.JUDGE0_API_URL?.trim() || DEFAULT_JUDGE0_URL;
  return await runJudge0(judge0Url, language, code, stdin, timeoutMs, fileName);
}

