import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export type ToolchainExecutable = 'javac' | 'java' | 'g++' | 'python' | 'node';

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
  spawnErrorCode?: string;
}

const executableCache = new Map<ToolchainExecutable, string | null>();

export function clearExecutableCache(): void {
  executableCache.clear();
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) return false;
    // Skip 0-byte Windows Store app execution aliases (e.g., WindowsApps\python.exe)
    if (process.platform === 'win32' && stat.size === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function findInDir(dir: string, names: string[]): string | null {
  if (!dir) return null;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const name of names) {
    for (const ext of exts) {
      const candidate = name.toLowerCase().endsWith(ext)
        ? path.join(dir, name)
        : path.join(dir, `${name}${ext}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function listSubdirBins(parentDir: string, prefixPattern?: RegExp): string[] {
  try {
    if (!fsSync.existsSync(parentDir)) return [];
    const entries = fsSync
      .readdirSync(parentDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && (!prefixPattern || prefixPattern.test(d.name)))
      .map((d) => d.name)
      .sort()
      .reverse();
    const bins: string[] = [];
    for (const name of entries) {
      bins.push(path.join(parentDir, name, 'bin'));
      if (process.platform === 'darwin') {
        bins.push(path.join(parentDir, name, 'Contents', 'Home', 'bin'));
      }
    }
    return bins;
  } catch {
    return [];
  }
}

function getStandardSearchDirs(tool: ToolchainExecutable): string[] {
  const isWin = process.platform === 'win32';
  const dirs: string[] = [];

  if (tool === 'javac' || tool === 'java') {
    if (process.env.JAVA_HOME?.trim()) {
      dirs.push(path.join(process.env.JAVA_HOME.trim(), 'bin'));
    }
    if (isWin) {
      const pf = process.env.ProgramFiles || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      dirs.push(
        path.join(pf, 'Common Files', 'Oracle', 'Java', 'javapath'),
        path.join(pf86, 'Common Files', 'Oracle', 'Java', 'javapath'),
        ...listSubdirBins(path.join(pf, 'Java')),
        ...listSubdirBins(path.join(pf, 'Eclipse Adoptium')),
        ...listSubdirBins(path.join(pf, 'Microsoft')),
        ...listSubdirBins(path.join(pf, 'Amazon Corretto')),
        ...listSubdirBins(path.join(pf, 'Zulu')),
        ...listSubdirBins(path.join(pf, 'BellSoft'))
      );
    } else {
      dirs.push(
        '/usr/bin',
        '/usr/local/bin',
        ...listSubdirBins('/usr/lib/jvm'),
        ...listSubdirBins('/Library/Java/JavaVirtualMachines'),
        ...listSubdirBins('/opt/homebrew/opt', /^openjdk/)
      );
    }
  } else if (tool === 'g++') {
    if (isWin) {
      dirs.push(
        'C:\\MinGW\\bin',
        'C:\\msys64\\ucrt64\\bin',
        'C:\\msys64\\mingw64\\bin',
        'C:\\msys64\\mingw32\\bin',
        'C:\\TDM-GCC-64\\bin'
      );
    } else {
      dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin');
    }
  } else if (tool === 'python') {
    if (isWin) {
      const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      dirs.push(
        path.join(localApp, 'Python', 'bin'),
        ...listSubdirBins(path.join(localApp, 'Programs', 'Python')).map((b) => path.dirname(b))
      );
    } else {
      dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin');
    }
  } else if (tool === 'node') {
    if (isWin) {
      dirs.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'));
    } else {
      dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin');
    }
  }

  return dirs;
}

/**
 * Resolves the absolute path of a compiler/interpreter executable across
 * environment overrides, PATH, and standard OS installation directories.
 */
export async function resolveExecutable(tool: ToolchainExecutable): Promise<string | null> {
  if (executableCache.has(tool)) {
    return executableCache.get(tool) ?? null;
  }

  // 1. Explicit environment variable overrides
  const envOverrides: Record<ToolchainExecutable, (string | undefined)[]> = {
    javac: [
      process.env.JAVAC_PATH,
      process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
        : undefined,
    ],
    java: [
      process.env.JAVA_PATH,
      process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
        : undefined,
    ],
    'g++': [process.env.GPP_PATH, process.env.CXX],
    python: [process.env.PYTHON_PATH],
    node: [
      process.env.LOGICLAB_NODE_PATH,
      path.basename(process.execPath).toLowerCase().startsWith('node') ? process.execPath : undefined,
    ],
  };

  for (const override of envOverrides[tool]) {
    const trimmed = override?.trim();
    if (trimmed && isExecutableFile(trimmed)) {
      executableCache.set(tool, trimmed);
      return trimmed;
    }
  }

  // 2. Search PATH entries
  const rawPath = process.env.PATH || process.env.Path || '';
  const pathDirs = rawPath.split(path.delimiter).filter(Boolean);
  const candidateNames =
    tool === 'python'
      ? process.platform === 'win32'
        ? ['python', 'python3']
        : ['python3', 'python']
      : [tool];

  for (const dir of pathDirs) {
    const found = findInDir(dir, candidateNames);
    if (found) {
      executableCache.set(tool, found);
      return found;
    }
  }

  // 3. Search standard OS installation directories
  for (const dir of getStandardSearchDirs(tool)) {
    const found = findInDir(dir, candidateNames);
    if (found) {
      executableCache.set(tool, found);
      return found;
    }
  }

  executableCache.set(tool, null);
  return null;
}

/**
 * Checks local availability of all supported language toolchains.
 */
export async function getToolchainAvailability(): Promise<Record<ToolchainExecutable, string | null>> {
  const [javac, java, gpp, python, node] = await Promise.all([
    resolveExecutable('javac'),
    resolveExecutable('java'),
    resolveExecutable('g++'),
    resolveExecutable('python'),
    resolveExecutable('node'),
  ]);
  return { javac, java, 'g++': gpp, python, node };
}

/**
 * Sanitizes a user-provided source filename to prevent path traversal and invalid characters.
 */
export function sanitizeSourceFileName(
  fileName: string | undefined,
  defaultName: string,
  allowedExts: string[]
): string {
  const base = fileName ? path.basename(fileName).replace(/[^A-Za-z0-9_.-]/g, '') : '';
  if (!base) return defaultName;
  const lower = base.toLowerCase();
  if (allowedExts.some((ext) => lower.endsWith(ext))) {
    return base;
  }
  return defaultName;
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
  // Pass PATH, SYSTEMROOT, TEMP, and standard system variables while stripping secrets
  const cleanEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || process.env.Path || '',
    SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
    USERPROFILE: process.env.USERPROFILE || os.homedir(),
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    APPDATA: process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    HOMEDRIVE: process.env.HOMEDRIVE || 'C:',
    HOMEPATH: process.env.HOMEPATH || '\\Users\\fahim',
  };
  if (process.env.JAVA_HOME) {
    cleanEnv.JAVA_HOME = process.env.JAVA_HOME;
  }
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

const MAX_CONCURRENT_SANDBOX_PROCESSES = 4;
let activeSandboxProcesses = 0;
const processWaitQueue: Array<() => void> = [];

async function acquireProcessSlot(): Promise<void> {
  if (activeSandboxProcesses < MAX_CONCURRENT_SANDBOX_PROCESSES) {
    activeSandboxProcesses += 1;
    return;
  }
  await new Promise<void>((resolve) => processWaitQueue.push(resolve));
  activeSandboxProcesses += 1;
}

function releaseProcessSlot(): void {
  activeSandboxProcesses = Math.max(0, activeSandboxProcesses - 1);
  const next = processWaitQueue.shift();
  if (next) next();
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

  await acquireProcessSlot();
  const startTime = Date.now();
  let timedOut = false;
  let stdoutData = '';
  let stderrData = '';
  let spawnErrorCode: string | undefined;
  let childProcess: any = null;

  try {
    return await new Promise<ProcessRunResult>((resolve) => {
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
            ...(spawnErrorCode ? { spawnErrorCode } : {}),
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

        childProcess.on('error', (err: NodeJS.ErrnoException) => {
          spawnErrorCode = err.code;
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
  } finally {
    releaseProcessSlot();
  }
}
