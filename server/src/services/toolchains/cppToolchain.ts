import fs from 'node:fs/promises';
import path from 'node:path';
import { runSandboxedProcess, createSandboxWorkspace, cleanupSandboxWorkspace } from './sandbox';
import { ToolchainCompileResult, ToolchainExecutionResult } from './types';
import { ExecutionDiagnostic } from '../../../../shared/types';

/**
 * Parses compiler output from g++ (both errors and warnings)
 */
export function parseGppDiagnostics(stderr: string, stdout: string): ExecutionDiagnostic[] {
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split('\n');
  const diagnostics: ExecutionDiagnostic[] = [];

  // Match: program.cpp:5:10: error: expected ';'
  // Match: program.cpp:5:10: warning: unused variable
  const diagRegex = /^.*?[\\/]?([A-Za-z0-9_.-]+\.cpp):(\d+):(\d+):\s*(error|warning|fatal error):\s*(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(diagRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      const column = parseInt(match[3], 10) || 1;
      const isError = match[4].includes('error');
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
 * Compiles C++ code with g++
 */
export async function compileCpp(
  code: string,
  fileName = 'main.cpp'
): Promise<ToolchainCompileResult & { workspaceDir: string; binaryPath: string }> {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = fileName.endsWith('.cpp') ? fileName : 'main.cpp';
  const sourceFilePath = path.join(workspaceDir, sourceFileName);
  const binaryFileName = process.platform === 'win32' ? 'program.exe' : 'program.out';
  const binaryFilePath = path.join(workspaceDir, binaryFileName);

  await fs.writeFile(sourceFilePath, code, 'utf8');

  // Compile with C++17 and standard warning flags
  const procRes = await runSandboxedProcess({
    cmd: 'g++',
    args: ['-std=c++17', '-Wall', '-Wextra', '-O2', sourceFileName, '-o', binaryFileName],
    cwd: workspaceDir,
    timeoutMs: 8000,
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

    let runtimeError: string | null = null;
    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0 && runRes.exitCode !== null) {
      runtimeError = runRes.stderr.trim() || `Process exited with error code ${runRes.exitCode}.`;
    }

    const hasWarnings = compileRes.diagnostics.some((d) => d.severity === 'warning');
    const status: 'success' | 'warning' | 'error' =
      runRes.timedOut || (runRes.exitCode !== 0 && runRes.exitCode !== null)
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
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: compileRes.diagnostics,
    };
  } finally {
    await cleanupSandboxWorkspace(compileRes.workspaceDir);
  }
}

