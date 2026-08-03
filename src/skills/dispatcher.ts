import {
  createExecutableSkillHandlerRegistry,
  type ExecutableSkillHandlerRegistry,
} from './handlers.js';
import type { TitanSkillManifest } from './manifest.js';
import type { SkillRegistry } from './registry.js';
import {
  validateObjectSchema,
  type ObjectSchemaIssue,
} from './schema-validation.js';

export type SkillRuntimeTarget = TitanSkillManifest['runtimeTargets'][number];
export type SkillCapability = TitanSkillManifest['capabilities'][number];

export type SkillDispatchErrorCode =
  | 'SKILL_NOT_FOUND'
  | 'SKILL_NOT_EXECUTABLE'
  | 'RUNTIME_NOT_ALLOWED'
  | 'CAPABILITY_NOT_GRANTED'
  | 'APPROVAL_REQUIRED'
  | 'HANDLER_NOT_REGISTERED'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT';

export class SkillDispatchError extends Error {
  readonly code: SkillDispatchErrorCode;
  readonly skillId: string;
  readonly issues: readonly ObjectSchemaIssue[];

  constructor(
    code: SkillDispatchErrorCode,
    skillId: string,
    message: string,
    issues: readonly ObjectSchemaIssue[] = [],
  ) {
    super(message);
    this.name = 'SkillDispatchError';
    this.code = code;
    this.skillId = skillId;
    this.issues = Object.freeze([...issues]);
  }
}

export interface ExecutableSkillDispatchRequest {
  skillId: string;
  input: unknown;
  runtimeTarget: SkillRuntimeTarget;
  grantedCapabilities: readonly SkillCapability[];
  approvalGranted?: boolean;
  policyApprovalGranted?: boolean;
}

export interface ExecutableSkillDispatchResult {
  skillId: string;
  output: unknown;
}

export interface ExecutableSkillDispatcher {
  dispatch(request: ExecutableSkillDispatchRequest): Promise<ExecutableSkillDispatchResult>;
}

export interface ExecutableSkillDispatcherOptions {
  registry: SkillRegistry;
  handlers?: ExecutableSkillHandlerRegistry;
}

const HIGH_SIDE_EFFECT_RISKS = new Set<TitanSkillManifest['risk']>([
  'NETWORK_WRITE',
  'ARBITRARY_EXECUTION',
  'DESTRUCTIVE',
  'PUBLISH',
]);

export function createExecutableSkillDispatcher(
  options: ExecutableSkillDispatcherOptions,
): ExecutableSkillDispatcher {
  const handlers = options.handlers ?? createExecutableSkillHandlerRegistry();

  return Object.freeze({
    async dispatch(request: ExecutableSkillDispatchRequest): Promise<ExecutableSkillDispatchResult> {
      const loaded = options.registry.resolve(request.skillId);
      if (!loaded) {
        throw new SkillDispatchError(
          'SKILL_NOT_FOUND',
          request.skillId,
          `Executable skill was not found: ${request.skillId}`,
        );
      }

      const manifest = loaded.manifest;
      const skillId = manifest.id;
      if (manifest.kind !== 'executable') {
        throw new SkillDispatchError(
          'SKILL_NOT_EXECUTABLE',
          skillId,
          `Skill is not executable: ${skillId}`,
        );
      }

      if (!manifest.runtimeTargets.includes(request.runtimeTarget)) {
        throw new SkillDispatchError(
          'RUNTIME_NOT_ALLOWED',
          skillId,
          `Skill ${skillId} does not allow runtime target ${request.runtimeTarget}.`,
        );
      }

      const grants = new Set(request.grantedCapabilities);
      const missingCapabilities = manifest.capabilities.filter((capability) => !grants.has(capability));
      if (missingCapabilities.length > 0) {
        throw new SkillDispatchError(
          'CAPABILITY_NOT_GRANTED',
          skillId,
          `Skill ${skillId} requires ungranted capabilities: ${missingCapabilities.join(', ')}.`,
        );
      }

      if (manifest.approval === 'explicit' && request.approvalGranted !== true) {
        throw new SkillDispatchError(
          'APPROVAL_REQUIRED',
          skillId,
          `Skill ${skillId} requires explicit approval.`,
        );
      }
      if (manifest.approval === 'policy' && request.policyApprovalGranted !== true) {
        throw new SkillDispatchError(
          'APPROVAL_REQUIRED',
          skillId,
          `Skill ${skillId} requires policy approval.`,
        );
      }
      if (
        HIGH_SIDE_EFFECT_RISKS.has(manifest.risk)
        && manifest.approval === 'none'
        && request.approvalGranted !== true
        && request.policyApprovalGranted !== true
      ) {
        throw new SkillDispatchError(
          'APPROVAL_REQUIRED',
          skillId,
          `High-side-effect skill ${skillId} requires approval evidence.`,
        );
      }

      const inputValidation = validateObjectSchema(request.input, manifest.inputs);
      if (!inputValidation.success) {
        throw new SkillDispatchError(
          'INVALID_INPUT',
          skillId,
          `Skill input does not match the manifest contract: ${skillId}`,
          inputValidation.issues,
        );
      }

      const entrypoint = manifest.entrypoint ?? '';
      const handler = handlers.resolve(entrypoint);
      if (!handler) {
        throw new SkillDispatchError(
          'HANDLER_NOT_REGISTERED',
          skillId,
          `No static executable handler is registered for ${entrypoint || skillId}.`,
        );
      }

      const output = await handler(request.input);
      const outputValidation = validateObjectSchema(output, manifest.outputs);
      if (!outputValidation.success) {
        throw new SkillDispatchError(
          'INVALID_OUTPUT',
          skillId,
          `Skill output does not match the manifest contract: ${skillId}`,
          outputValidation.issues,
        );
      }

      return Object.freeze({ skillId, output });
    },
  });
}
