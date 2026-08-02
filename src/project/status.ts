import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  GitConfiguredHelperError,
  runHardenedGit,
} from '../git/hardened-read.js';

export interface ProjectStatus {
  projectRoot: string;
  projectName: string;
  isGitRepository: boolean;
  repositoryRoot?: string;
  branch: string;
  dirty: boolean | null;
  changedFiles: number | null;
  workingTreeReason?: string;
  remote?: string;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'unknown';
}

export interface ReadProjectStatusOptions {
  env?: NodeJS.ProcessEnv;
}

export async function readProjectStatus(
  projectRoot: string,
  options: ReadProjectStatusOptions = {},
): Promise<ProjectStatus> {
  const root = path.resolve(projectRoot);
  const environment = options.env ?? process.env;
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

  const inside = await runMetadataGit(root, ['rev-parse', '--is-inside-work-tree'], environment);
  if (inside !== 'true') {
    return base;
  }

  const [repositoryRootValue, branch, remote] = await Promise.all([
    runMetadataGit(root, ['rev-parse', '--show-toplevel'], environment),
    runMetadataGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], environment),
    runMetadataGit(root, ['remote', 'get-url', 'origin'], environment),
  ]);
  const repositoryRoot = repositoryRootValue || root;

  let dirty: boolean | null = null;
  let changedFiles: number | null = null;
  let workingTreeReason: string | undefined;

  try {
    const status = await runHardenedGit(repositoryRoot, ['status', '--porcelain'], {
      env: environment,
      rejectConfiguredHelpers: true,
    });
    changedFiles = status.stdout
      .split(/\r?\n/u)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .length;
    dirty = changedFiles > 0;
  } catch (error) {
    if (error instanceof GitConfiguredHelperError) {
      workingTreeReason = 'Not inspected: configured Git helpers require explicit approval.';
    } else {
      workingTreeReason = 'Not inspected: hardened Git status failed.';
    }
  }

  return {
    ...base,
    isGitRepository: true,
    repositoryRoot,
    projectName: path.basename(repositoryRoot),
    branch: branch || 'unknown',
    dirty,
    changedFiles,
    workingTreeReason,
    remote: remote || undefined,
  };
}

async function runMetadataGit(
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const result = await runHardenedGit(cwd, args, { env: environment });
    return result.stdout.trim();
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
