import { resolveProjectPath } from '../security/project-path.js';
import type { ParsedSkillEntrypoint } from './entrypoint.js';

export type SkillRuntimeHandler = (input: unknown) => Promise<unknown>;

export interface ApprovedSkillEntrypoint extends ParsedSkillEntrypoint {
  handler: SkillRuntimeHandler;
}

const registrations = new Map<string, ApprovedSkillEntrypoint>([
  [
    'titan.security.project-path-containment',
    {
      modulePath: 'runtime/entrypoint.js',
      exportName: 'resolveProjectPath',
      handler: resolveProjectPathSkill,
    },
  ],
]);

export function resolveApprovedSkillEntrypoint(
  skillId: string,
  entrypoint: ParsedSkillEntrypoint,
): ApprovedSkillEntrypoint {
  const registration = registrations.get(skillId);
  if (
    !registration
    || registration.modulePath !== entrypoint.modulePath
    || registration.exportName !== entrypoint.exportName
  ) {
    throw new Error(
      `Skill entrypoint is not registered in the closed runtime dispatcher: ${skillId} -> ${entrypoint.modulePath}#${entrypoint.exportName}`,
    );
  }
  return {
    modulePath: registration.modulePath,
    exportName: registration.exportName,
    handler: registration.handler,
  };
}

async function resolveProjectPathSkill(input: unknown): Promise<unknown> {
  if (!isRecord(input) || typeof input.projectRoot !== 'string' || typeof input.requestedPath !== 'string') {
    throw new Error('Project path containment skill requires string projectRoot and requestedPath inputs.');
  }
  return {
    resolvedPath: await resolveProjectPath(input.projectRoot, input.requestedPath),
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input));
}
