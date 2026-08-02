import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export interface ProjectStatus {
  projectRoot: string;
  projectName: string;
  isGitRepository: boolean;
  repositoryRoot?: string;
  branch: string;
  dirty: boolean;
  changedFiles: number;
  remote?: string;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'unknown';
}

export async function readProjectStatus(projectRoot: string): Promise<ProjectStatus> {
  const root = path.resolve(projectRoot);
  const packageManager = await detectPackageManager(root);
  const base: ProjectStatus = {
    projectRoot: root,
    projectName: path.basename(root),
    isGitRepository: false,
    branch: 'not-a-git-repository',
    dirty: false,
    changedFiles: 0,
    packageManager,
  };

  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return base;
  }

  const [repositoryRoot, branch, status, remote] = await Promise.all([
    runGit(root, ['rev-parse', '--show-toplevel']),
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(root, ['status', '--porcelain']),
    runGit(root, ['remote', 'get-url', 'origin']),
  ]);

  const changedFiles = status ? status.split(/\r?\n/).filter(Boolean).length : 0;

  return {
    ...base,
    isGitRepository: true,
    repositoryRoot: repositoryRoot || root,
    projectName: path.basename(repositoryRoot || root),
    branch: branch || 'unknown',
    dirty: changedFiles > 0,
    changedFiles,
    remote: remote || undefined,
  };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 15_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function detectPackageManager(root: string): Promise<ProjectStatus['packageManager']> {
  if (await pathExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await pathExists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await pathExists(path.join(root, 'bun.lockb'))) return 'bun';
  if (await pathExists(path.join(root, 'package-lock.json'))) return 'npm';
  if (await pathExists(path.join(root, 'package.json'))) return 'npm';
  return 'unknown';
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
