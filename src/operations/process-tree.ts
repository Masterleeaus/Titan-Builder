import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessTreeTerminationResult {
  gracefulTermination: boolean;
  forcedTermination: boolean;
  descendantCount: number;
  error?: string;
}

async function getChildProcesses(pid: number): Promise<number[]> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `PPID eq ${pid}`, '/FO', 'CSV', '/NH']);
      const pids: number[] = [];
      const lines = stdout.split('\n').filter((line) => line.trim());
      for (const line of lines) {
        const match = line.match(/^"([^"]+)","(\d+)/);
        if (match) {
          pids.push(parseInt(match[2], 10));
        }
      }
      return pids;
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)]);
    return stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => parseInt(line, 10));
  } catch {
    return [];
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcessTree(
  pid: number,
  gracefulTimeoutMs: number = 1000,
): Promise<ProcessTreeTerminationResult> {
  let descendantCount = 0;
  let gracefulTermination = false;
  let forcedTermination = false;
  let error: string | undefined;

  try {
    const children = await getChildProcesses(pid);
    descendantCount = children.length;

    for (const child of children) {
      try {
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/PID', String(child), '/F']);
        } else {
          process.kill(child, 'SIGTERM');
        }
      } catch (e) {
        // Child may have already exited
      }
    }
  } catch (e) {
    error = `Failed to enumerate or terminate descendants: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Attempt graceful termination
  gracefulTermination = await attemptGracefulTermination(pid, gracefulTimeoutMs);

  // If graceful termination didn't work, force kill
  if (!gracefulTermination && isProcessAlive(pid)) {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
      } else {
        process.kill(pid, 'SIGKILL');
      }
      forcedTermination = true;
    } catch (e) {
      error = `Forced termination failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return {
    gracefulTermination,
    forcedTermination,
    descendantCount,
    error,
  };
}

async function attemptGracefulTermination(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        execFileAsync('taskkill', ['/PID', String(pid)])
          .then(() => resolve(true))
          .catch(() => resolve(false));
      } else {
        process.kill(pid, 'SIGTERM');
        const timer = setTimeout(() => resolve(false), timeoutMs);
        const interval = setInterval(() => {
          if (!isProcessAlive(pid)) {
            clearTimeout(timer);
            clearInterval(interval);
            resolve(true);
          }
        }, 50);
      }
    } catch {
      resolve(false);
    }
  });
}

export { terminateProcessTree };
