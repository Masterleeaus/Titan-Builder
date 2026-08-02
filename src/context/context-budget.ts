import path from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';

export interface ContextBudgetOptions {
  totalCharacters?: number;
  perFileCharacters?: number;
  maxFiles?: number;
}

export interface ContextBudgetItem {
  path: string;
  content: string;
  characters: number;
  originalCharacters: number;
  truncated: boolean;
  priority: number;
}

export interface ExcludedContextItem {
  path: string;
  reason: 'sensitive' | 'binary' | 'ignored' | 'missing' | 'budget' | 'max-files' | 'outside-root';
}

export interface ContextBudgetResult {
  projectRoot: string;
  refs: string[];
  limitCharacters: number;
  perFileCharacters: number;
  maxFiles: number;
  totalCharacters: number;
  included: ContextBudgetItem[];
  excluded: ExcludedContextItem[];
}

const DEFAULT_TOTAL = 120_000;
const DEFAULT_PER_FILE = 32_000;
const DEFAULT_MAX_FILES = 30;
const IGNORED_DIRECTORIES = new Set([
  '.git', '.openbrowser', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'vendor',
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff', '.avif', '.heic',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.mov', '.avi', '.exe', '.dll', '.bin', '.dat', '.sqlite', '.db',
]);
const EXACT_SENSITIVE_NAMES = new Set([
  '.npmrc', '.yarnrc', '.pypirc', '.netrc', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  'credentials', 'credentials.json', 'service-account.json', 'application_default_credentials.json',
]);
const PRIVATE_KEY_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);

export async function buildBudgetedContext(
  projectRoot: string,
  refs: string[] = ['.'],
  options: ContextBudgetOptions = {},
): Promise<ContextBudgetResult> {
  const root = await canonicalRoot(projectRoot);
  const limitCharacters = clampInteger(options.totalCharacters, 100, 2_000_000, DEFAULT_TOTAL);
  const perFileCharacters = clampInteger(options.perFileCharacters, 100, 500_000, DEFAULT_PER_FILE);
  const maxFiles = clampInteger(options.maxFiles, 1, 500, DEFAULT_MAX_FILES);
  const normalizedRefs = [...new Set((refs.length ? refs : ['.']).map(normalizeRelativeRef))];
  const excluded: ExcludedContextItem[] = [];
  const candidates = new Map<string, { explicit: boolean }>();

  for (const ref of normalizedRefs) {
    const absolute = path.resolve(root, ref);
    if (!isInside(root, absolute)) {
      excluded.push({ path: ref, reason: 'outside-root' });
      continue;
    }
    let target: string;
    let info;
    try {
      target = await realpath(absolute);
      if (!isInside(root, target)) {
        excluded.push({ path: ref, reason: 'outside-root' });
        continue;
      }
      info = await stat(target);
    } catch {
      excluded.push({ path: ref, reason: 'missing' });
      continue;
    }
    if (info.isDirectory()) {
      await collectDirectory(root, target, candidates, excluded, ref !== '.');
    } else if (info.isFile()) {
      candidates.set(toRelative(root, target), { explicit: true });
    }
  }

  const ordered = [...candidates.entries()]
    .map(([relativePath, metadata]) => ({ path: relativePath, priority: contextPriority(relativePath, metadata.explicit) }))
    .sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path));

  const included: ContextBudgetItem[] = [];
  let totalCharacters = 0;

  for (const candidate of ordered) {
    if (isSensitiveContextPath(candidate.path)) {
      excluded.push({ path: candidate.path, reason: 'sensitive' });
      continue;
    }
    if (isBinaryContextPath(candidate.path)) {
      excluded.push({ path: candidate.path, reason: 'binary' });
      continue;
    }
    if (included.length >= maxFiles) {
      excluded.push({ path: candidate.path, reason: 'max-files' });
      continue;
    }
    if (totalCharacters >= limitCharacters) {
      excluded.push({ path: candidate.path, reason: 'budget' });
      continue;
    }

    let content: string;
    try {
      content = await readFile(path.join(root, candidate.path), 'utf8');
    } catch {
      excluded.push({ path: candidate.path, reason: 'missing' });
      continue;
    }
    const remaining = limitCharacters - totalCharacters;
    const allowed = Math.min(perFileCharacters, remaining);
    if (allowed <= 0) {
      excluded.push({ path: candidate.path, reason: 'budget' });
      continue;
    }
    const sliced = content.slice(0, allowed);
    included.push({
      path: candidate.path,
      content: sliced,
      characters: sliced.length,
      originalCharacters: content.length,
      truncated: sliced.length < content.length,
      priority: candidate.priority,
    });
    totalCharacters += sliced.length;
  }

  return {
    projectRoot: root,
    refs: normalizedRefs,
    limitCharacters,
    perFileCharacters,
    maxFiles,
    totalCharacters,
    included,
    excluded: dedupeExcluded(excluded),
  };
}

export function formatContextBudgetPreview(result: ContextBudgetResult): string {
  const includedLines = result.included.length
    ? result.included.map((item) =>
        `- ${item.path} · ${item.characters}/${item.originalCharacters} chars${item.truncated ? ' · truncated' : ''}`,
      )
    : ['- none'];
  const excludedCounts = new Map<string, number>();
  for (const item of result.excluded) excludedCounts.set(item.reason, (excludedCounts.get(item.reason) ?? 0) + 1);
  const excludedSummary = [...excludedCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}:${count}`)
    .join(' · ') || 'none';

  return [
    'Context budget preview',
    `Budget: ${result.totalCharacters}/${result.limitCharacters} characters`,
    `Files: ${result.included.length}/${result.maxFiles}`,
    `Per-file cap: ${result.perFileCharacters} characters`,
    '',
    'Included:',
    ...includedLines,
    '',
    `Excluded: ${excludedSummary}`,
  ].join('\n');
}

export function formatBudgetedContextMarkdown(result: ContextBudgetResult): string {
  if (result.included.length === 0) return '';
  const sections = result.included.flatMap((item) => [
    `### ${item.path}`,
    '',
    '```' + detectLanguage(item.path),
    item.content,
    '```',
    item.truncated ? '\n*(truncated by OpenBrowser context budget)*' : '',
    '',
  ]);
  return ['--- Budgeted Context Files ---', '', ...sections, '--- End Budgeted Context Files ---'].filter(Boolean).join('\n');
}

export function isSensitiveContextPath(inputPath: string): boolean {
  const normalized = inputPath.replaceAll('\\', '/').replace(/^\.\//u, '').toLowerCase();
  if (!normalized) return false;
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments.at(-1) || '';
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (EXACT_SENSITIVE_NAMES.has(basename)) return true;
  if (segments.includes('.ssh') || segments.includes('.gnupg')) return true;
  if (normalized === '.aws/credentials' || normalized.endsWith('/.aws/credentials')) return true;
  if (PRIVATE_KEY_EXTENSIONS.has(path.extname(basename))) return true;
  return /(?:^|[-_.])(credential|credentials|service[-_.]?account|private[-_.]?key)(?:[-_.]|$)/u.test(basename);
}

function isBinaryContextPath(inputPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(inputPath).toLowerCase());
}

async function collectDirectory(
  root: string,
  directory: string,
  candidates: Map<string, { explicit: boolean }>,
  excluded: ExcludedContextItem[],
  explicit: boolean,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = toRelative(root, absolute);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        excluded.push({ path: `${relative}/`, reason: 'ignored' });
        continue;
      }
      await collectDirectory(root, absolute, candidates, excluded, explicit);
    } else if (entry.isFile()) {
      candidates.set(relative, { explicit });
    }
  }
}

function contextPriority(relativePath: string, explicit: boolean): number {
  const normalized = relativePath.toLowerCase();
  const basename = path.posix.basename(normalized);
  if (['package.json', 'tsconfig.json', 'jsconfig.json', 'composer.json', 'pyproject.toml', 'cargo.toml', 'readme.md'].includes(normalized)) return 0;
  if (explicit) return 1;
  if (/^(src|app|lib)\/(index|main|bootstrap|entry)\.[^/]+$/u.test(normalized)) return 2;
  if (/(^|\/)(test|tests|spec|specs)(\/|\.)/u.test(normalized) || /\.(test|spec)\.[^/]+$/u.test(normalized)) return 3;
  if (normalized.startsWith('docs/') || basename.startsWith('readme')) return 4;
  if (/\.(config|rc)\.[^/]+$/u.test(normalized) || basename.includes('config')) return 5;
  return 10;
}

async function canonicalRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  try { return await realpath(resolved); } catch { return resolved; }
}

function normalizeRelativeRef(value: string): string {
  const normalized = String(value || '.').trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  return normalized || '.';
}

function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).replaceAll('\\', '/');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value as number)));
}

function dedupeExcluded(items: ExcludedContextItem[]): ExcludedContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.path}\0${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx', '.json': 'json',
    '.md': 'markdown', '.css': 'css', '.html': 'html', '.php': 'php', '.py': 'python',
    '.sh': 'bash', '.ps1': 'powershell', '.yml': 'yaml', '.yaml': 'yaml', '.sql': 'sql',
  };
  return map[ext] ?? '';
}
