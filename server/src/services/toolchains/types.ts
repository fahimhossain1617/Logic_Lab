import { ExecutionDiagnostic, SupportedLanguage } from '../../../../shared/types';

export interface ToolchainCompileResult {
  success: boolean;
  diagnostics: ExecutionDiagnostic[];
  stdout: string;
  stderr: string;
  mainClass?: string;
  executablePath?: string;
  workingDir?: string;
}

export interface ToolchainExecutionResult {
  status: 'success' | 'warning' | 'error';
  canRun: boolean;
  stdout: string;
  stderr: string;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  runtimeError: string | null;
  runtimeErrorLine?: number;
  executionTimeMs: number;
  diagnostics: ExecutionDiagnostic[];
}

export interface ToolchainAnalysisResult {
  canCompile: boolean;
  diagnostics: ExecutionDiagnostic[];
  language: SupportedLanguage;
}

