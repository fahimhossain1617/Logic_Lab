import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export interface ProcessRunOptions {
  cmd: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  maxBufferBytes?: number;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  executionTimeMs: number;
}

const SANDBOX_BASE_DIR = path.join(os.tmpdir(), 'logic-lab-sandbox');

/**
 * Creates an isolated temporary directory for compilation/execution
 */
export async function createSandboxWorkspace(): Promise<string> {
  const dirName = `run-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const fullPath = path.join(SANDBOX_BASE_DIR, dirName);
  await fs.mkdir(fullPath, { recursive: true });
  return fullPath;
}

/**
 * Safely removes a sandbox directory and all its contents
 */
export async function cleanupSandboxWorkspace(dirPath: string): Promise<void> {
  try {
    if (dirPath && dirPath.startsWith(SANDBOX_BASE_DIR)) {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Sanitizes PATH to include compilers while stripping sensitive credentials
 */
function getSanitizedEnv(): NodeJS.ProcessEnv {
  // Pass PATH, SYSTEMROOT, TEMP, and standard system variables
  const cleanEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '',
    SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
    USERPROFILE: process.env.USERPROFILE || 'C:\\Users\\fahim',
    LOCALAPPDATA: process.env.LOCALAPPDATA || 'C:\\Users\\fahim\\AppData\\Local',
    APPDATA: process.env.APPDATA || 'C:\\Users\\fahim\\AppData\\Roaming',
    HOMEDRIVE: process.env.HOMEDRIVE || 'C:',
    HOMEPATH: process.env.HOMEPATH || '\\Users\\fahim',
  };
  return cleanEnv;
}

/**
 * Executes a process inside the sandbox with strict timeouts, I/O limits, and process-tree termination
 */
export async function runSandboxedProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  const {
    cmd,
    args,
    cwd,
    stdin = '',
    timeoutMs = 4000,
    env = {},
    maxBufferBytes = 128 * 1024,
  } = options;

  const startTime = Date.now();
  let timedOut = false;
  let stdoutData = '';
  let stderrData = '';
  let childProcess: any = null;

  return new Promise<ProcessRunResult>((resolve) => {
    try {
      const mergedEnv = {
        ...getSanitizedEnv(),
        ...env,
      };

      childProcess = spawn(cmd, args, {
        cwd,
        env: mergedEnv,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let finished = false;

      const finish = (exitCode: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          stdout: stdoutData,
          stderr: stderrData,
          exitCode,
          timedOut,
          executionTimeMs: Date.now() - startTime,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        if (childProcess && childProcess.pid) {
          // On Windows, use taskkill to kill the whole process tree (/T /F)
          if (process.platform === 'win32') {
            try {
              spawn('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], {
                windowsHide: true,
              });
            } catch {
              childProcess.kill('SIGKILL');
            }
          } else {
            childProcess.kill('SIGKILL');
          }
        }
        finish(null);
      }, timeoutMs);

      childProcess.stdout.on('data', (chunk: Buffer) => {
        if (stdoutData.length < maxBufferBytes) {
          stdoutData += chunk.toString('utf8');
        }
      });

      childProcess.stderr.on('data', (chunk: Buffer) => {
        if (stderrData.length < maxBufferBytes) {
          stderrData += chunk.toString('utf8');
        }
      });

      childProcess.on('error', (err: Error) => {
        stderrData += `\nFailed to start process: ${err.message}`;
        finish(-1);
      });

      childProcess.on('close', (code: number | null) => {
        finish(code);
      });

      // Write stdin if provided
      if (stdin) {
        childProcess.stdin.write(stdin);
      }
      childProcess.stdin.end();
    } catch (err: any) {
      resolve({
        stdout: '',
        stderr: err?.message || 'Process invocation error',
        exitCode: -1,
        timedOut: false,
        executionTimeMs: Date.now() - startTime,
      });
    }
  });
}
