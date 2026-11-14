import { ExecutionDiagnostic, SupportedLanguage } from '../../../../shared/types';
import {
  ToolchainAnalysisResult,
  ToolchainCompileResult,
  ToolchainExecutionResult,
} from './types';
import { compileJava, executeJava, parseJavacDiagnostics } from './javaToolchain';
import { compileCpp, executeCpp, parseGppDiagnostics } from './cppToolchain';
import { checkPythonSyntax, executePython } from './pythonToolchain';
import { checkJsSyntax, executeJs } from './nodeToolchain';
import { cleanupSandboxWorkspace } from './sandbox';
import { executeViaRemoteSandbox, isLocalExecutionBlockedError } from './remoteSandbox';

function parseRemoteAnalysisDiagnostics(
  language: SupportedLanguage,
  compileOutput: string,
  stderr: string
): { canCompile: boolean; diagnostics: ExecutionDiagnostic[] } | null {
  if (language === 'java' || language === 'cpp') {
    const parser = language === 'java' ? parseJavacDiagnostics : parseGppDiagnostics;
    const diagnostics = compileOutput ? parser(compileOutput, '') : [];
    if (diagnostics.length === 0) {
      diagnostics.push({
        line: 1,
        severity: 'error',
        message: (compileOutput || stderr || 'Compilation failed.').trim(),
        source: language,
      });
    }
    return { canCompile: false, diagnostics };
  }

  if (language === 'python') {
    const syntaxMatch = stderr.match(/\b(SyntaxError|IndentationError|TabError):\s*(.+)/);
    if (!syntaxMatch) {
      return { canCompile: true, diagnostics: [] };
    }
    const lineMatch = stderr.match(/,\s*line\s+(\d+)/);
    return {
      canCompile: false,
      diagnostics: [
        {
          line: lineMatch ? parseInt(lineMatch[1], 10) || 1 : 1,
          severity: 'error',
          message: `${syntaxMatch[1]}: ${syntaxMatch[2].trim()}`,
          source: 'python',
        },
      ],
    };
  }

  return null;
}

async function finalizeAnalysis(
  code: string,
  language: SupportedLanguage,
  res: ToolchainCompileResult & { workspaceDir: string },
  fileName?: string
): Promise<ToolchainAnalysisResult> {
  try {
    if (
      !res.success &&
      (res.compilerUnavailable || isLocalExecutionBlockedError(res.stderr))
    ) {
      const remote = await executeViaRemoteSandbox(
        language,
        code,
        '',
        4000,
        res.sourceFileName || fileName
      );
      if (remote) {
        if (language === 'java' || language === 'cpp') {
          if (!remote.compileFailed) {
            return { canCompile: true, diagnostics: [], language };
          }
          const parsed = parseRemoteAnalysisDiagnostics(
            language,
            remote.compileOutput,
            remote.stderr
          );
          if (parsed) {
            return { ...parsed, language };
          }
        } else if (language === 'python') {
          if (remote.exitCode === 0) {
            return { canCompile: true, diagnostics: [], language };
          }
          const parsed = parseRemoteAnalysisDiagnostics(
            language,
            remote.compileOutput,
            remote.stderr
          );
          if (parsed) {
            return { ...parsed, language };
          }
        }
      }
    }

    const diagnostics = [...res.diagnostics];
    if (!res.success && !diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({
        line: 1,
        severity: 'error',
        message:
          res.compilerError ||
          res.stderr.trim() ||
          res.stdout.trim() ||
          'Compilation failed.',
        source: language,
      });
    }

    return {
      canCompile: res.success,
      diagnostics,
      language,
    };
  } finally {
    await cleanupSandboxWorkspace(res.workspaceDir);
  }
}

/**
 * Analyzes code using genuine language compiler/interpreter toolchains
 * without executing user program logic.
 */
export async function analyzeCode(
  code: string,
  language: SupportedLanguage,
  fileName?: string
): Promise<ToolchainAnalysisResult> {
  if (!code.trim()) {
    return {
      canCompile: true,
      diagnostics: [],
      language,
    };
  }

  switch (language) {
    case 'java': {
      const res = await compileJava(code, fileName);
      return finalizeAnalysis(code, language, res, fileName);
    }
    case 'cpp': {
      const res = await compileCpp(code, fileName);
      return finalizeAnalysis(code, language, res, fileName);
    }
    case 'python': {
      const res = await checkPythonSyntax(code, fileName);
      return finalizeAnalysis(code, language, res, fileName);
    }
    case 'javascript':
    default: {
      const res = await checkJsSyntax(code, fileName);
      return finalizeAnalysis(code, language, res, fileName);
    }
  }
}

/**
 * Compiles (if needed) and executes code across all four supported languages
 * inside a secure, resource-limited sandbox using genuine language toolchains.
 */
export async function executeCode(
  code: string,
  language: SupportedLanguage,
  stdin = '',
  timeoutMs = 4000,
  fileName?: string
): Promise<ToolchainExecutionResult> {
  switch (language) {
    case 'java':
      return executeJava(code, stdin, timeoutMs, fileName);
    case 'cpp':
      return executeCpp(code, stdin, timeoutMs, fileName);
    case 'python':
      return executePython(code, stdin, timeoutMs, fileName);
    case 'javascript':
    default:
      return executeJs(code, stdin, timeoutMs, fileName);
  }
}

