import fs from 'node:fs/promises';
import path from 'node:path';
import {
  runSandboxedProcess,
  createSandboxWorkspace,
  cleanupSandboxWorkspace,
  resolveExecutable,
  sanitizeSourceFileName,
} from './sandbox';
import {
  buildRemoteToolchainResult,
  executeViaRemoteSandbox,
  isLocalExecutionBlockedError,
} from './remoteSandbox';
import { ToolchainCompileResult, ToolchainExecutionResult } from './types';
import { ExecutionDiagnostic } from '../../../../shared/types';

/**
 * Extracts public class name or top-level class name from Java source
 */
export function extractJavaClassName(code: string, fallbackFileName = 'Main.java'): string {
  // 1. Look for public class declaration
  const pubMatch = code.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  if (pubMatch && pubMatch[1]) {
    return pubMatch[1];
  }

  // 2. Look for any class declaration
  const classMatch = code.match(/\bclass\s+([A-Za-z_$][\w$]*)\b/);
  if (classMatch && classMatch[1]) {
    return classMatch[1];
  }

  // 3. Fallback to filename without .java
  const base = fallbackFileName.replace(/\.java$/i, '').trim();
  return base || 'Main';
}

/**
 * Parses compiler output from javac (both errors and warnings from -Xlint)
 */
export function parseJavacDiagnostics(stderr: string, stdout: string): ExecutionDiagnostic[] {
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split('\n');
  const diagnostics: ExecutionDiagnostic[] = [];

  // Match: File.java:12: error: message OR File.java:12: warning: message
  const diagRegex = /^.*?[\\/]?([A-Za-z0-9_$]+\.java):(\d+):\s*(error|warning):\s*(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(diagRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      const severity = match[3] === 'error' ? 'error' : 'warning';
      let message = match[4].trim();

      let column: number | undefined;

      // Check next lines for caret line (`^`)
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const nextRaw = lines[j];
        const caretIdx = nextRaw.indexOf('^');
        if (caretIdx >= 0 && nextRaw.trim().startsWith('^')) {
          column = caretIdx + 1;
          break;
        }
      }

      diagnostics.push({
        line: lineNum,
        column,
        severity,
        message,
        source: 'javac',
      });
    }
  }

  return diagnostics;
}

/**
 * Compiles Java code with javac and -Xlint:all
 */
export async function compileJava(
  code: string,
  fileName = 'Main.java'
): Promise<ToolchainCompileResult & { workspaceDir: string }> {
  const workspaceDir = await createSandboxWorkspace();
  const className = extractJavaClassName(code, fileName);
  const sourceFileName = sanitizeSourceFileName(fileName, `${className}.java`, ['.java']);
  const sourceFilePath = path.join(workspaceDir, sourceFileName);

  await fs.writeFile(sourceFilePath, code, 'utf8');

  const javacPath = await resolveExecutable('javac');
  if (!javacPath) {
    const configMsg =
      "Java compiler (javac) not found. Ensure a JDK is installed and 'javac' is in PATH, or set JAVA_HOME / JAVAC_PATH.";
    return {
      success: false,
      diagnostics: [],
      stdout: '',
      stderr: configMsg,
      mainClass: className,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg,
    };
  }

  // Run javac with standard UTF-8 encoding and -Xlint
  const procRes = await runSandboxedProcess({
    cmd: javacPath,
    args: ['-encoding', 'UTF-8', '-Xlint:all', '-d', workspaceDir, sourceFileName],
    cwd: workspaceDir,
    timeoutMs: 15000,
  });

  if (procRes.spawnErrorCode === 'ENOENT' || procRes.spawnErrorCode === 'EACCES' || procRes.spawnErrorCode === 'EPERM') {
    const configMsg = `Java compiler failed to start (${procRes.spawnErrorCode}): ${procRes.stderr.trim()}`;
    return {
      success: false,
      diagnostics: [],
      stdout: procRes.stdout,
      stderr: configMsg,
      mainClass: className,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg,
    };
  }

  const diagnostics = parseJavacDiagnostics(procRes.stderr, procRes.stdout);
  const hasErrors = procRes.exitCode !== 0 || diagnostics.some((d) => d.severity === 'error');

  return {
    success: !hasErrors,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    mainClass: className,
    workingDir: workspaceDir,
    workspaceDir,
  };
}

/**
 * Executes a compiled Java class in the sandbox
 */
export async function executeJava(
  code: string,
  stdin = '',
  timeoutMs = 4000,
  fileName = 'Main.java'
): Promise<ToolchainExecutionResult> {
  const compileRes = await compileJava(code, fileName);

  try {
    if (!compileRes.success) {
      // Fallback to remote sandbox if javac is unavailable on host (e.g. serverless)
      if (compileRes.compilerUnavailable || isLocalExecutionBlockedError(compileRes.stderr)) {
        const remote = await executeViaRemoteSandbox('java', code, stdin, timeoutMs);
        if (remote) {
          const remoteDiagnostics = remote.compileOutput
            ? parseJavacDiagnostics(remote.compileOutput, '')
            : [];
          const hasRemoteCompileErr = remote.exitCode !== 0 && Boolean(remote.compileOutput);
          return buildRemoteToolchainResult(
            remote,
            remoteDiagnostics,
            hasRemoteCompileErr ? remoteDiagnostics[0]?.line || 1 : undefined
          );
        }
      }

      if (compileRes.compilerUnavailable) {
        const configMsg =
          compileRes.compilerError ||
          compileRes.stderr.trim() ||
          'Java compiler (javac) is unavailable on this host.';
        return {
          status: 'error',
          canRun: false,
          stdout: '',
          stderr: configMsg,
          output: configMsg,
          exitCode: 1,
          timedOut: false,
          runtimeError: configMsg,
          executionTimeMs: 0,
          diagnostics: [],
        };
      }

      const firstError = compileRes.diagnostics.find((d) => d.severity === 'error');
      const errorMsg =
        firstError?.message || compileRes.stderr.trim() || 'Java compilation failed.';
      return {
        status: 'error',
        canRun: false,
        stdout: '',
        stderr: compileRes.stderr,
        output: compileRes.stderr || errorMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: errorMsg,
        runtimeErrorLine: firstError?.line || 1,
        executionTimeMs: 0,
        diagnostics: compileRes.diagnostics,
      };
    }

    const mainClass = compileRes.mainClass || 'Main';
    const javaPath = await resolveExecutable('java');
    if (!javaPath) {
      const remote = await executeViaRemoteSandbox('java', code, stdin, timeoutMs);
      if (remote) {
        return buildRemoteToolchainResult(remote, compileRes.diagnostics);
      }
      const configMsg =
        "Java runtime (java) not found. Ensure a JDK/JRE is installed and 'java' is in PATH, or set JAVA_HOME / JAVA_PATH.";
      return {
        status: 'error',
        canRun: false,
        stdout: '',
        stderr: configMsg,
        output: configMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: configMsg,
        executionTimeMs: 0,
        diagnostics: compileRes.diagnostics,
      };
    }

    // Execute with java runtime in sandbox (force UTF-8 across stdio and default charset on Windows/Java 18+)
    const runRes = await runSandboxedProcess({
      cmd: javaPath,
      args: [
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-Dstderr.encoding=UTF-8',
        '-Dstdin.encoding=UTF-8',
        '-Dsun.stdout.encoding=UTF-8',
        '-Dsun.stderr.encoding=UTF-8',
        '-Xmx256m',
        '-cp',
        compileRes.workspaceDir,
        mainClass,
      ],
      cwd: compileRes.workspaceDir,
      stdin,
      timeoutMs,
    });

    if (runRes.exitCode !== 0 && isLocalExecutionBlockedError(runRes.stderr)) {
      const remote = await executeViaRemoteSandbox('java', code, stdin, timeoutMs);
      if (remote) {
        return buildRemoteToolchainResult(remote, compileRes.diagnostics);
      }
    }

    // Check runtime errors and exceptions
    let runtimeError: string | null = null;
    let runtimeErrorLine: number | undefined;

    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0 && runRes.stderr) {
      runtimeError = runRes.stderr.trim();
      const lineMatch = runRes.stderr.match(/at\s+[\w.$]+\.main\([^:]+:(\d+)\)/);
      if (lineMatch) {
        runtimeErrorLine = parseInt(lineMatch[1], 10);
      }
    }

    const hasWarnings = compileRes.diagnostics.some((d) => d.severity === 'warning');
    const status: 'success' | 'warning' | 'error' =
      runRes.timedOut || (runRes.exitCode !== 0 && Boolean(runtimeError))
        ? 'error'
        : hasWarnings
        ? 'warning'
        : 'success';

    const output = runtimeError
      ? runRes.stdout ? `${runRes.stdout}\n${runtimeError}` : runtimeError
      : runRes.stdout;

    return {
      status,
      canRun: status !== 'error',
      stdout: runRes.stdout,
      stderr: runRes.stderr,
      output,
      exitCode: runRes.exitCode,
      timedOut: runRes.timedOut,
      runtimeError,
      runtimeErrorLine,
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: compileRes.diagnostics,
    };
  } finally {
    await cleanupSandboxWorkspace(compileRes.workspaceDir);
  }
}

