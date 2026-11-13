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
 * Checks Python syntax without executing user code
 */
export async function checkPythonSyntax(
  code: string,
  fileName = 'script.py'
): Promise<ToolchainCompileResult & { workspaceDir: string }> {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = sanitizeSourceFileName(fileName, 'script.py', ['.py']);
  const sourceFilePath = path.join(workspaceDir, sourceFileName);

  await fs.writeFile(sourceFilePath, code, 'utf8');

  const pythonPath = await resolveExecutable('python');
  if (!pythonPath) {
    const configMsg =
      "Python interpreter not found. Ensure Python 3 is installed and in PATH, or set PYTHON_PATH.";
    return {
      success: false,
      diagnostics: [],
      stdout: '',
      stderr: configMsg,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg,
    };
  }

  // Use python built-in ast parser via command line to get exact syntax diagnostics as JSON
  const pyCheckerScript = `
import ast, json, sys

try:
    with open(${JSON.stringify(sourceFileName)}, 'r', encoding='utf-8') as f:
        src = f.read()
    ast.parse(src)
    print(json.dumps({"success": True, "diagnostics": []}))
except SyntaxError as e:
    diag = [{
        "line": e.lineno or 1,
        "column": e.offset or 1,
        "severity": "error",
        "message": f"{type(e).__name__}: {e.msg}",
        "source": "python"
    }]
    print(json.dumps({"success": False, "diagnostics": diag}))
except Exception as e:
    diag = [{
        "line": 1,
        "severity": "error",
        "message": str(e),
        "source": "python"
    }]
    print(json.dumps({"success": False, "diagnostics": diag}))
`.trim();

  const procRes = await runSandboxedProcess({
    cmd: pythonPath,
    args: ['-c', pyCheckerScript],
    cwd: workspaceDir,
    timeoutMs: 4000,
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  let diagnostics: ExecutionDiagnostic[] = [];
  let success = true;

  try {
    const parsed = JSON.parse(procRes.stdout.trim());
    success = Boolean(parsed.success);
    diagnostics = parsed.diagnostics || [];
  } catch {
    if (procRes.stderr) {
      diagnostics.push({
        line: 1,
        severity: 'error',
        message: procRes.stderr.trim(),
        source: 'python',
      });
      success = false;
    }
  }

  return {
    success,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    workingDir: workspaceDir,
    workspaceDir,
  };
}

/**
 * Executes Python code in the sandbox
 */
export async function executePython(
  code: string,
  stdin = '',
  timeoutMs = 4000,
  fileName = 'script.py'
): Promise<ToolchainExecutionResult> {
  const syntaxRes = await checkPythonSyntax(code, fileName);

  try {
    if (!syntaxRes.success) {
      // Fallback to remote sandbox if python is unavailable on host (e.g. serverless)
      if (isLocalExecutionBlockedError(syntaxRes.stderr)) {
        const remote = await executeViaRemoteSandbox('python', code, stdin, timeoutMs);
        if (remote) {
          return buildRemoteToolchainResult(remote, []);
        }
      }

      const firstError = syntaxRes.diagnostics.find((d) => d.severity === 'error');
      const errorMsg =
        firstError?.message || syntaxRes.stderr.trim() || 'Python syntax error.';
      return {
        status: 'error',
        canRun: false,
        stdout: '',
        stderr: syntaxRes.stderr,
        output: errorMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: errorMsg,
        runtimeErrorLine: firstError?.line || 1,
        executionTimeMs: 0,
        diagnostics: syntaxRes.diagnostics,
      };
    }

    const sourceFileName = sanitizeSourceFileName(fileName, 'script.py', ['.py']);
    const pythonPath = (await resolveExecutable('python')) || 'python';

    // Execute with unbuffered python (-u) and forced UTF-8 I/O on Windows
    const runRes = await runSandboxedProcess({
      cmd: pythonPath,
      args: ['-u', sourceFileName],
      cwd: syntaxRes.workspaceDir,
      stdin,
      timeoutMs,
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    if (runRes.exitCode !== 0 && isLocalExecutionBlockedError(runRes.stderr)) {
      const remote = await executeViaRemoteSandbox('python', code, stdin, timeoutMs);
      if (remote) {
        return buildRemoteToolchainResult(remote, syntaxRes.diagnostics);
      }
    }

    let runtimeError: string | null = null;
    let runtimeErrorLine: number | undefined;

    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0 && runRes.stderr) {
      runtimeError = runRes.stderr.trim();
      // Parse last line number from traceback
      const lineMatches = [...runRes.stderr.matchAll(/File\s+["'][^"']+["'],\s+line\s+(\d+)/g)];
      if (lineMatches.length > 0) {
        runtimeErrorLine = parseInt(lineMatches[lineMatches.length - 1][1], 10);
      }
    }

    const hasWarnings = syntaxRes.diagnostics.some((d) => d.severity === 'warning');
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
      diagnostics: syntaxRes.diagnostics,
    };
  } finally {
    await cleanupSandboxWorkspace(syntaxRes.workspaceDir);
  }
}

