import { resolveProjectPath } from '../security/project-path.js';

export type ExecutableSkillHandler = (input: unknown) => Promise<unknown> | unknown;

export interface ExecutableSkillHandlerRegistry {
  resolve(entrypoint: string): ExecutableSkillHandler | undefined;
}

const PROJECT_PATH_ENTRYPOINT = 'src/security/project-path.ts#resolveProjectPath';

const DEFAULT_BINDINGS: Readonly<Record<string, ExecutableSkillHandler>> = Object.freeze({
  [PROJECT_PATH_ENTRYPOINT]: async (input: unknown) => {
    if (!isObject(input)) throw new Error('Project path skill input must be an object.');
    const projectRoot = input.projectRoot;
    const requestedPath = input.requestedPath;
    if (typeof projectRoot !== 'string' || typeof requestedPath !== 'string') {
      throw new Error('Project path skill requires string projectRoot and requestedPath values.');
    }
    return {
      resolvedPath: await resolveProjectPath(projectRoot, requestedPath),
    };
  },
});

export function createExecutableSkillHandlerRegistry(
  bindings?: Readonly<Record<string, ExecutableSkillHandler>>,
): ExecutableSkillHandlerRegistry {
  const source = bindings ?? DEFAULT_BINDINGS;
  const handlers = new Map<string, ExecutableSkillHandler>();
  for (const [entrypoint, handler] of Object.entries(source)) {
    if (!entrypoint.trim()) throw new Error('Executable skill handler entrypoint is required.');
    if (handlers.has(entrypoint)) throw new Error(`Duplicate executable skill handler: ${entrypoint}`);
    handlers.set(entrypoint, handler);
  }
  return Object.freeze({
    resolve: (entrypoint: string) => handlers.get(entrypoint),
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
