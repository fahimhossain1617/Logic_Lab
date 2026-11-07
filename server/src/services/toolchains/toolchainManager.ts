import { SupportedLanguage } from '../../../../shared/types';
import {
  ToolchainAnalysisResult,
  ToolchainExecutionResult,
} from './types';
import { compileJava, executeJava } from './javaToolchain';
import { compileCpp, executeCpp } from './cppToolchain';
import { checkPythonSyntax, executePython } from './pythonToolchain';
import { checkJsSyntax, executeJs } from './nodeToolchain';
import { cleanupSandboxWorkspace } from './sandbox';

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
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language,
      };
    }
    case 'cpp': {
      const res = await compileCpp(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language,
      };
    }
    case 'python': {
      const res = await checkPythonSyntax(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language,
      };
    }
    case 'javascript':
    default: {
      const res = await checkJsSyntax(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language,
      };
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

