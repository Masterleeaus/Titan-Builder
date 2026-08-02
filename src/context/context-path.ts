import path from 'node:path';
import {
  canonicalizeProjectRoot,
  resolveProjectPath,
  type ResolveProjectPathOptions,
} from '../security/project-path.js';

const driveQualifiedPattern = /^[A-Za-z]:/u;
const encodedPathSyntaxPattern = /%(?:2e|2f|5c|00)/iu;

export interface ResolvedContextPath {
  projectRoot: string;
  absolutePath: string;
  relativePath: string;
}

export function normalizeContextReference(value: string): string {
  const raw = String(value || '.').trim();
  if (!raw || raw.includes('\0') || /[\r\n]/u.test(raw)) {
    throw new Error('Context reference must be a non-empty relative path.');
  }

  const portable = raw.replaceAll('\\', '/');
  if (
    path.posix.isAbsolute(portable)
    || path.win32.isAbsolute(raw)
    || driveQualifiedPattern.test(raw)
    || portable.startsWith('//')
    || encodedPathSyntaxPattern.test(portable)
  ) {
    throw new Error('Context reference must be a portable relative path.');
  }

  const segments = portable.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Context reference must not traverse outside the project.');
  }
  return segments.join('/') || '.';
}

export async function resolveContextPath(
  projectRoot: string,
  value: string,
  options: ResolveProjectPathOptions = { requireExisting: true },
): Promise<ResolvedContextPath> {
  const root = await canonicalizeProjectRoot(projectRoot);
  const normalized = normalizeContextReference(value);
  const absolutePath = await resolveProjectPath(root, normalized, options);
  return {
    projectRoot: root,
    absolutePath,
    relativePath: path.relative(root, absolutePath).replaceAll('\\', '/') || '.',
  };
}
