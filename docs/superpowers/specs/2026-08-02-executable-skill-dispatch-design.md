# Executable Skill Dispatch Design

## Objective

Make canonical executable Titan skills callable through a single runtime dispatcher that enforces manifest policy before invoking compiled code.

## Scope

This pass implements dispatch for root-runtime executable skills. It wires the existing `titan.security.project-path-containment` package to its existing `resolveProjectPath` implementation and establishes the reusable policy boundary for later executable skills.

Out of scope:

- dynamic installation or execution of arbitrary skill packages;
- browser-side executable skill execution;
- a new approval-token system;
- changes to the tool-library registry or PR #18;
- new executable skill packages beyond the existing path-containment skill.

## Approaches Considered

### 1. Dynamic import from manifest entrypoint

The dispatcher could import the module path declared in each manifest. This is flexible but makes metadata capable of selecting arbitrary code and creates an unsafe package boundary. Rejected.

### 2. One hard-coded function per skill ID

A switch on canonical skill IDs would work for the first executable skill but couples identity, policy, and execution in one growing file. Rejected as a non-scalable interim design.

### 3. Static handler bindings keyed by manifest entrypoint

A compiled handler table maps exact approved entrypoint strings to typed adapters. Manifests select only among already-registered handlers, while the dispatcher independently enforces kind, runtime, capabilities, approval mode, and input/output contracts. Selected.

## Architecture

### `src/skills/handlers.ts`

Owns the static executable binding table. Each binding declares:

- the exact manifest entrypoint string;
- a handler function accepting an unknown object and returning an unknown object;
- an adapter around an existing authoritative implementation.

No manifest path is dynamically imported.

### `src/skills/schema-validation.ts`

Provides the minimal JSON-object contract validation required by current manifests:

- root value must be an object;
- required properties must be present;
- undeclared properties are rejected when `additionalProperties` is `false`;
- declared `string`, `boolean`, `number`, `integer`, `array`, and `object` property types are checked.

It returns validation issues with stable paths. It does not attempt to become a complete JSON Schema engine.

### `src/skills/dispatcher.ts`

Resolves a canonical skill or alias through `SkillRegistry`, then enforces this sequence:

1. skill exists;
2. skill kind is `executable`;
3. requested runtime target is declared by the manifest;
4. every manifest capability is present in the caller's granted capability set;
5. `approval: explicit` requires `approvalGranted: true`;
6. `approval: policy` requires `policyApprovalGranted: true`;
7. high-side-effect risks cannot execute without explicit or policy approval evidence;
8. input matches the manifest input object schema;
9. the exact manifest entrypoint is present in the static handler registry;
10. handler executes;
11. output matches the manifest output object schema.

Failures throw `SkillDispatchError` with a stable code and no partial execution.

## Public Interfaces

```ts
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

export function createExecutableSkillDispatcher(options: {
  registry: SkillRegistry;
  handlers?: ExecutableSkillHandlerRegistry;
}): {
  dispatch(request: ExecutableSkillDispatchRequest): Promise<ExecutableSkillDispatchResult>;
};
```

## Path-Containment Adapter

The adapter accepts:

```ts
{
  projectRoot: string;
  requestedPath: string;
}
```

It calls the existing `resolveProjectPath(projectRoot, requestedPath)` and returns:

```ts
{
  resolvedPath: string;
}
```

The authoritative path-security logic remains in `src/security/project-path.ts`.

## Error Model

`SkillDispatchError` codes:

- `SKILL_NOT_FOUND`
- `SKILL_NOT_EXECUTABLE`
- `RUNTIME_NOT_ALLOWED`
- `CAPABILITY_NOT_GRANTED`
- `APPROVAL_REQUIRED`
- `HANDLER_NOT_REGISTERED`
- `INVALID_INPUT`
- `INVALID_OUTPUT`

Handler exceptions propagate with their original message and cause; policy failures happen before the handler is called.

## Security Requirements

- Never import a module path from manifest metadata.
- Never execute a handler before all policy and input checks pass.
- Caller capability grants must be an explicit subset check, not inferred from risk.
- Aliases resolve to the same canonical skill and policy as canonical IDs.
- Guidance and orchestration skills cannot enter executable dispatch.
- The dispatcher must not weaken the existing operation approval store or tool registry.

## Testing

Focused tests must prove:

- the `project-path-containment` canonical ID executes successfully;
- a legacy alias resolves to the same canonical skill when an alias exists;
- missing capability grants fail before handler invocation;
- wrong runtime target fails before handler invocation;
- guidance skills are rejected;
- explicit and policy approval modes are enforced with synthetic registry fixtures;
- unknown entrypoints fail closed;
- invalid input and invalid handler output are rejected;
- path traversal remains rejected by the authoritative path resolver;
- the complete repository verification matrix remains green on Linux and Windows.

## Success Criteria

- One manifest-driven dispatcher is exported from `src/skills/index.ts`.
- The existing executable skill can run through it without dynamic imports.
- Policy failures are stable, testable, and happen before execution.
- No changes are made to the active tool-library branch or browser execution authority.
