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
import { classifyErrorCategory } from '../../../../shared/stdinHelper';

/**
 * Parses compiler output from g++ (both errors and warnings)
 */
export function parseGppDiagnostics(stderr: string, stdout: string): ExecutionDiagnostic[] {
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split('\n');
  const diagnostics: ExecutionDiagnostic[] = [];

  // Match any filename (including spaces and Unicode): program.cpp:5:10: error: expected ';'
  const diagRegex = /^(.+?\.(?:cpp|cc|cxx|c|hpp|h)):(\d+):(\d+):\s*(error|warning|fatal error):\s*(.+)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(diagRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      const column = parseInt(match[3], 10) || 1;
      const isError = match[4].toLowerCase().includes('error');
      const severity = isError ? 'error' : 'warning';
      const message = match[5].trim();

      diagnostics.push({
        line: lineNum,
        column,
        severity,
        message,
        source: 'g++',
      });
    }
  }

  return diagnostics;
}

/**
 * Compiles C++ / C code with g++
 */
export async function compileCpp(
  code: string,
  fileName = 'main.cpp'
): Promise<ToolchainCompileResult & { workspaceDir: string; binaryPath: string; sourceFileName: string }> {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = sanitizeSourceFileName(fileName, 'main.cpp', ['.cpp', '.cc', '.cxx', '.c']);
  const sourceFilePath = path.join(workspaceDir, sourceFileName);
  const binaryFileName = process.platform === 'win32' ? 'program.exe' : 'program.out';
  const binaryFilePath = path.join(workspaceDir, binaryFileName);

  await fs.writeFile(sourceFilePath, code, 'utf8');

  const gppPath = await resolveExecutable('g++');
  if (!gppPath) {
    const configMsg =
      "C++ compiler (g++) not found. Ensure g++ is installed and in PATH, or set GPP_PATH.";
    return {
      success: false,
      diagnostics: [],
      stdout: '',
      stderr: configMsg,
      executablePath: binaryFilePath,
      binaryPath: binaryFilePath,
      sourceFileName,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg,
    };
  }

  const isCSource = sourceFileName.toLowerCase().endsWith('.c');
  const stdFlag = isCSource ? '-std=c11' : '-std=c++17';

  // Compile with C++17 (or C11 for .c) and standard warning flags (-O0 for fast, contention-free compilation)
  const procRes = await runSandboxedProcess({
    cmd: gppPath,
    args: [stdFlag, '-Wall', '-Wextra', '-O0', sourceFileName, '-o', binaryFileName],
    cwd: workspaceDir,
    timeoutMs: 15000,
  });

  const diagnostics = parseGppDiagnostics(procRes.stderr, procRes.stdout);
  const hasErrors = procRes.exitCode !== 0 || diagnostics.some((d) => d.severity === 'error');

  return {
    success: !hasErrors,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    executablePath: binaryFilePath,
    binaryPath: binaryFilePath,
    sourceFileName,
    workingDir: workspaceDir,
    workspaceDir,
  };
}

/**
 * Executes a compiled C++ binary in the sandbox
 */
export async function executeCpp(
  code: string,
  stdin = '',
  timeoutMs = 4000,
  fileName = 'main.cpp'
): Promise<ToolchainExecutionResult> {
  const compileRes = await compileCpp(code, fileName);

  try {
    if (!compileRes.success) {
      // Fallback to remote sandbox if g++ is unavailable on host (e.g. serverless)
      if (compileRes.compilerUnavailable || isLocalExecutionBlockedError(compileRes.stderr)) {
        const remote = await executeViaRemoteSandbox(
          'cpp',
          code,
          stdin,
          timeoutMs,
          compileRes.sourceFileName
        );
        if (remote) {
          const remoteDiagnostics = remote.compileOutput
            ? parseGppDiagnostics(remote.compileOutput, '')
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
          'C++ compiler (g++) is unavailable on this host.';
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
        firstError?.message || compileRes.stderr.trim() || 'C++ compilation failed.';
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
        errorCategory: 'compile_error',
        executionBackend: 'local',
        executionTimeMs: 0,
        diagnostics: compileRes.diagnostics,
      };
    }

    const runRes = await runSandboxedProcess({
      cmd: compileRes.binaryPath,
      args: [],
      cwd: compileRes.workspaceDir,
      stdin,
      timeoutMs,
    });

    const hasWarnings = compileRes.diagnostics.some((d) => d.severity === 'warning');

    if (runRes.exitCode !== 0 && isLocalExecutionBlockedError(runRes.stderr)) {
      const remote = await executeViaRemoteSandbox('cpp', code, stdin, timeoutMs);
      if (remote) {
        return buildRemoteToolchainResult(remote, compileRes.diagnostics);
      }

      const blockedMsg =
        'Local compiled C++ executable was blocked by OS security policy (Device Guard), and remote sandbox execution was unavailable.';
      return {
        status: 'error',
        canRun: false,
        stdout: '',
        stderr: blockedMsg,
        output: blockedMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: blockedMsg,
        executionTimeMs: runRes.executionTimeMs,
        diagnostics: compileRes.diagnostics,
      };
    }

    let runtimeError: string | null = null;
    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0) {
      runtimeError =
        runRes.stderr.trim() ||
        (runRes.exitCode === null
          ? 'Process terminated abnormally by signal.'
          : `Process exited with error code ${runRes.exitCode}.`);
    }

    const isFailure = runRes.timedOut || runRes.exitCode !== 0;
    const status: 'success' | 'warning' | 'error' = isFailure
      ? 'error'
      : hasWarnings
      ? 'warning'
      : 'success';
    const errorCategory = isFailure
      ? classifyErrorCategory(runRes.stderr || runtimeError || '', false)
      : undefined;

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
      ...(errorCategory ? { errorCategory } : {}),
      executionBackend: 'local',
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: compileRes.diagnostics,
    };
  } finally {
    await cleanupSandboxWorkspace(compileRes.workspaceDir);
  }
}

