import fs from 'node:fs/promises';
import path from 'node:path';
import { runSandboxedProcess, createSandboxWorkspace, cleanupSandboxWorkspace } from './sandbox';
import { ToolchainCompileResult, ToolchainExecutionResult } from './types';
import { ExecutionDiagnostic } from '../../../../shared/types';

/**
 * Parses Node.js syntax check output (from node --check)
 */
export function parseNodeDiagnostics(stderr: string, stdout: string): ExecutionDiagnostic[] {
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split('\n');
  const diagnostics: ExecutionDiagnostic[] = [];

  // Match: script.js:5
  const lineMatchRegex = /^.*?[\\/]?([A-Za-z0-9_.-]+\.js):(\d+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(lineMatchRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      let column: number | undefined;
      let message = 'SyntaxError';

      // Look ahead for caret `^` and error message
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const nextRaw = lines[j];
        const caretIdx = nextRaw.indexOf('^');
        if (caretIdx >= 0 && nextRaw.trim().startsWith('^')) {
          column = caretIdx + 1;
        }
        if (/^(?:SyntaxError|ReferenceError|TypeError|Error):/.test(lines[j].trim())) {
          message = lines[j].trim();
          break;
        }
      }

      diagnostics.push({
        line: lineNum,
        column,
        severity: 'error',
        message,
        source: 'node',
      });
      break;
    }
  }

  return diagnostics;
}

/**
 * Checks JavaScript syntax using node --check
 */
export async function checkJsSyntax(
  code: string,
  fileName = 'script.js'
): Promise<ToolchainCompileResult & { workspaceDir: string }> {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = fileName.endsWith('.js') ? fileName : 'script.js';
  const sourceFilePath = path.join(workspaceDir, sourceFileName);

  await fs.writeFile(sourceFilePath, code, 'utf8');

  const procRes = await runSandboxedProcess({
    cmd: 'node',
    args: ['--check', sourceFileName],
    cwd: workspaceDir,
    timeoutMs: 4000,
  });

  const diagnostics = parseNodeDiagnostics(procRes.stderr, procRes.stdout);
  const hasErrors = procRes.exitCode !== 0 || diagnostics.some((d) => d.severity === 'error');

  return {
    success: !hasErrors,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    workingDir: workspaceDir,
    workspaceDir,
  };
}

/**
 * Executes JavaScript in the sandbox using Node.js
 */
export async function executeJs(
  code: string,
  stdin = '',
  timeoutMs = 4000,
  fileName = 'script.js'
): Promise<ToolchainExecutionResult> {
  const syntaxRes = await checkJsSyntax(code, fileName);

  try {
    if (!syntaxRes.success) {
      const firstError = syntaxRes.diagnostics.find((d) => d.severity === 'error');
      const errorMsg =
        firstError?.message || syntaxRes.stderr.trim() || 'JavaScript syntax error.';
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

    const sourceFileName = fileName.endsWith('.js') ? fileName : 'script.js';

    const runRes = await runSandboxedProcess({
      cmd: 'node',
      args: [sourceFileName],
      cwd: syntaxRes.workspaceDir,
      stdin,
      timeoutMs,
    });

    let runtimeError: string | null = null;
    let runtimeErrorLine: number | undefined;

    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0 && runRes.stderr) {
      runtimeError = runRes.stderr.trim();
      const lineMatch = runRes.stderr.match(/^[\\/]?.*\.js:(\d+)/m);
      if (lineMatch) {
        runtimeErrorLine = parseInt(lineMatch[1], 10);
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

