const exportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const moduleSegmentPattern = /^[A-Za-z0-9_$][A-Za-z0-9._$-]*$/u;
const driveQualifiedPattern = /^[A-Za-z]:/u;
const encodedPathSyntaxPattern = /%(?:2e|2f|5c|23|00)/iu;

export interface ParsedSkillEntrypoint {
  modulePath: string;
  exportName: string;
}

export function parseSkillEntrypoint(value: string): ParsedSkillEntrypoint {
  if (!value || value.includes('\0') || value !== value.trim()) {
    throw new Error('Skill entrypoint must be a non-empty portable module path followed by #exportName.');
  }
  if (value.normalize('NFKC') !== value) {
    throw new Error('Skill entrypoint must not use Unicode compatibility aliases.');
  }

  const firstSeparator = value.indexOf('#');
  if (firstSeparator <= 0 || firstSeparator !== value.lastIndexOf('#')) {
    throw new Error('Skill entrypoint must contain exactly one #exportName separator.');
  }

  const modulePath = value.slice(0, firstSeparator);
  const exportName = value.slice(firstSeparator + 1);
  if (!exportNamePattern.test(exportName)) {
    throw new Error('Skill entrypoint export name must be a JavaScript identifier.');
  }
  if (
    modulePath.startsWith('/')
    || modulePath.startsWith('\\')
    || driveQualifiedPattern.test(modulePath)
    || modulePath.includes('\\')
    || encodedPathSyntaxPattern.test(modulePath)
    || modulePath.includes('%')
  ) {
    throw new Error('Skill entrypoint module must be a portable contained relative path.');
  }

  const segments = modulePath.split('/');
  if (
    segments.length === 0
    || segments.some((segment) => (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || !moduleSegmentPattern.test(segment)
    ))
  ) {
    throw new Error('Skill entrypoint module contains an invalid or traversing path segment.');
  }

  return { modulePath, exportName };
}
