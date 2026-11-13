import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
export function getSanitizedEnv(): NodeJS.ProcessEnv {
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
 * Terminates a child process and its descendants cleanly across Windows and Unix
 */
export function killProcessTree(childProcess: any): void {
  if (!childProcess || !childProcess.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], {
        windowsHide: true,
      });
    } catch {
      try {
        childProcess.kill('SIGKILL');
      } catch {
        // Ignore already-exited errors
      }
    }
  } else {
    try {
      childProcess.kill('SIGKILL');
    } catch {
      // Ignore already-exited errors
    }
  }
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
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');

      const finish = (exitCode: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const tailOut = stdoutDecoder.end();
        const tailErr = stderrDecoder.end();
        if (tailOut && stdoutData.length < maxBufferBytes) stdoutData += tailOut;
        if (tailErr && stderrData.length < maxBufferBytes) stderrData += tailErr;
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
          stdoutData += stdoutDecoder.write(chunk);
        }
      });

      childProcess.stderr.on('data', (chunk: Buffer) => {
        if (stderrData.length < maxBufferBytes) {
          stderrData += stderrDecoder.write(chunk);
        }
      });

      childProcess.on('error', (err: Error) => {
        stderrData += `\nFailed to start process: ${err.message}`;
        finish(-1);
      });

      childProcess.on('close', (code: number | null) => {
        finish(code);
      });

      // Write stdin if provided (normalize CRLF and ensure trailing newline for Scanner/cin/input/readline)
      if (stdin) {
        const normalizedStdin = stdin.replace(/\r\n/g, '\n');
        childProcess.stdin.write(
          normalizedStdin.endsWith('\n') ? normalizedStdin : `${normalizedStdin}\n`,
          'utf8'
        );
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
