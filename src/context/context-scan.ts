import path from 'node:path';
import fg from 'fast-glob';
import fs from 'fs-extra';
import { parse as parseJsonc } from 'jsonc-parser';
import { saveContextSummary } from '../memory/index.js';
import { CONTEXT_IGNORE } from './file-context.js';

const MAX_FILES_DISCOVERY = 10000;
const MAX_FILES_DISPLAY = 250;

export interface ProjectContext {
  projectRoot: string;
  files: string[];
  packageJson?: {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  tsconfig?: unknown;
  summary: string;
  totalFileCount: number;
  isTruncated: boolean;
}

export async function scanProject(projectRoot: string): Promise<ProjectContext> {
  const allFiles = await fg('**/*', {
    cwd: projectRoot,
    dot: true,
    onlyFiles: true,
    ignore: CONTEXT_IGNORE,
  });

  const totalFileCount = allFiles.length;
  const isTruncated = totalFileCount > MAX_FILES_DISCOVERY;
  const files = allFiles.slice(0, MAX_FILES_DISCOVERY);

  const packageJson = await readJsonIfExists(path.join(projectRoot, 'package.json'));
  const tsconfig = await readJsoncIfExists(path.join(projectRoot, 'tsconfig.json'));
  const summary = formatSummary(files, totalFileCount, isTruncated, packageJson, tsconfig);

  return { projectRoot, files, packageJson, tsconfig, summary, totalFileCount, isTruncated };
}

export async function generateContext(projectRoot: string): Promise<string> {
  const context = await scanProject(projectRoot);
  await saveContextSummary(projectRoot, context.summary);
  return context.summary;
}

function formatSummary(
  files: string[],
  totalFileCount: number,
  isTruncated: boolean,
  packageJson: ProjectContext['packageJson'],
  tsconfig: unknown,
): string {
  const displayFiles = files.slice(0, MAX_FILES_DISPLAY);
  const tree = displayFiles.map((file) => `- ${file}`).join('\n');
  const scripts = packageJson?.scripts
    ? Object.keys(packageJson.scripts).join(', ')
    : 'none detected';
  const deps = packageJson?.dependencies
    ? Object.keys(packageJson.dependencies).join(', ')
    : 'none detected';
  const devDeps = packageJson?.devDependencies
    ? Object.keys(packageJson.devDependencies).join(', ')
    : 'none detected';

  const projectLabel = packageJson?.name ? `Project: ${packageJson.name}` : 'Project';

  const fileCountStr = isTruncated
    ? `${totalFileCount} (first ${MAX_FILES_DISCOVERY} analyzed, first ${MAX_FILES_DISPLAY} shown)`
    : `${totalFileCount}${totalFileCount > MAX_FILES_DISPLAY ? ` (first ${MAX_FILES_DISPLAY} shown)` : ''}`;

  return [
    projectLabel,
    `Package version: ${packageJson?.version ?? 'unknown'}`.trim(),
    `Scripts: ${scripts}`,
    `Dependencies: ${deps}`,
    `Dev dependencies: ${devDeps}`,
    `TypeScript config: ${tsconfig ? 'present' : 'not detected'}`,
    '',
    `Files (${fileCountStr}):`,
    tree || '- no files detected',
  ].join('\n');
}

async function readJsonIfExists(filePath: string): Promise<ProjectContext['packageJson']> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return (await fs.readJson(filePath)) as ProjectContext['packageJson'];
}

async function readJsoncIfExists(filePath: string): Promise<unknown> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return parseJsonc(await fs.readFile(filePath, 'utf8'));
}
