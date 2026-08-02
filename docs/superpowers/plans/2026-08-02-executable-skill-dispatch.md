# Executable Skill Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a closed, manifest-driven root dispatcher for executable Titan skills with capability, runtime, approval, input, output, and handler-binding enforcement.

**Architecture:** The canonical `SkillRegistry` remains the identity and manifest source. A static compiled handler registry binds exact manifest entrypoints to adapters around existing authoritative implementations; `dispatcher.ts` applies all policy checks before invocation. A focused object-schema validator enforces the subset used by current manifests without introducing a new dependency or dynamic imports.

**Tech Stack:** TypeScript 5.9, Node.js 22, Zod-backed manifest validation, Node test runner through `tsx`, pnpm 11.2.2.

## Global Constraints

- Work only on `feature/skill-library-pass-04`, based on verified Pass 03 head `4f0dbbb15082ddd976fc16981c1c94c2de244970`.
- Never dynamically import a module path supplied by a manifest.
- Do not modify the tool-library registry or PR #18.
- Preserve `src/security/project-path.ts` as the sole path-containment implementation.
- Do not introduce new production dependencies.
- Policy and input validation must complete before handler invocation.
- Alias and canonical ID dispatch must produce the same canonical skill ID.
- Full Linux and Windows verification is required before completion.

---

### Task 1: Define the failing dispatcher contract

**Files:**
- Create: `src/skills/dispatcher.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createSkillRegistry`, `LoadedSkillPackage`, and the existing path-containment package manifest.
- Produces: executable behavioral requirements for `createExecutableSkillDispatcher`, `createExecutableSkillHandlerRegistry`, and `SkillDispatchError`.

- [ ] **Step 1: Create synthetic package helpers and success test**

Write a test that loads the real skill library, constructs the dispatcher, grants `filesystem.read`, dispatches `titan.security.project-path-containment`, and asserts the output is `{ resolvedPath: <canonical target> }`.

- [ ] **Step 2: Add fail-closed policy tests**

Add separate tests for:

```ts
await assert.rejects(
  () => dispatcher.dispatch({
    skillId: 'titan.security.project-path-containment',
    input: { projectRoot, requestedPath: 'note.txt' },
    runtimeTarget: 'root',
    grantedCapabilities: [],
  }),
  (error: unknown) => error instanceof SkillDispatchError && error.code === 'CAPABILITY_NOT_GRANTED',
);
```

Also cover wrong runtime, guidance kind, explicit approval, policy approval, unregistered entrypoint, invalid input, invalid output, and traversal rejection.

- [ ] **Step 3: Wire the test into `test:skills`**

Change:

```json
"test:skills": "tsx --test src/skills/manifest.test.ts src/skills/registry.test.ts src/skills/dispatcher.test.ts"
```

- [ ] **Step 4: Run the focused suite and confirm RED**

Run: `pnpm run test:skills`

Expected: failure because `src/skills/dispatcher.ts` and `src/skills/handlers.ts` do not exist.

- [ ] **Step 5: Commit the red contract**

```bash
git add src/skills/dispatcher.test.ts package.json
git commit -m "test: define executable skill dispatch contract"
```

### Task 2: Add focused object-schema validation

**Files:**
- Create: `src/skills/schema-validation.ts`
- Test: `src/skills/dispatcher.test.ts`

**Interfaces:**
- Produces: `validateObjectSchema(value: unknown, schema: Record<string, unknown>): ObjectSchemaValidationResult`.
- Consumed by: `src/skills/dispatcher.ts` for both manifest input and output validation.

- [ ] **Step 1: Add invalid input and invalid output assertions**

The input test supplies a number for `projectRoot` and expects `INVALID_INPUT`. The output test registers a synthetic handler returning `{ resolvedPath: 42 }` against an output schema requiring a string and expects `INVALID_OUTPUT`.

- [ ] **Step 2: Implement stable validation issues**

Create:

```ts
export interface ObjectSchemaIssue {
  path: string;
  message: string;
}

export type ObjectSchemaValidationResult =
  | { success: true; issues: [] }
  | { success: false; issues: ObjectSchemaIssue[] };
```

Support object roots, `required`, `properties`, `additionalProperties: false`, and property types `string`, `boolean`, `number`, `integer`, `array`, and `object`.

- [ ] **Step 3: Run the focused tests**

Run: `pnpm run test:skills`

Expected: schema-specific tests pass; dispatcher tests may still fail because dispatcher and handlers are absent.

- [ ] **Step 4: Commit the validator**

```bash
git add src/skills/schema-validation.ts src/skills/dispatcher.test.ts
git commit -m "feat: validate executable skill object contracts"
```

### Task 3: Add static handlers and policy-enforcing dispatcher

**Files:**
- Create: `src/skills/handlers.ts`
- Create: `src/skills/dispatcher.ts`
- Modify: `src/skills/index.ts`
- Test: `src/skills/dispatcher.test.ts`

**Interfaces:**
- Produces:

```ts
export type ExecutableSkillHandler = (input: unknown) => Promise<unknown> | unknown;

export interface ExecutableSkillHandlerRegistry {
  resolve(entrypoint: string): ExecutableSkillHandler | undefined;
}

export function createExecutableSkillHandlerRegistry(
  bindings?: Readonly<Record<string, ExecutableSkillHandler>>,
): ExecutableSkillHandlerRegistry;
```

```ts
export type SkillDispatchErrorCode =
  | 'SKILL_NOT_FOUND'
  | 'SKILL_NOT_EXECUTABLE'
  | 'RUNTIME_NOT_ALLOWED'
  | 'CAPABILITY_NOT_GRANTED'
  | 'APPROVAL_REQUIRED'
  | 'HANDLER_NOT_REGISTERED'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT';
```

```ts
export function createExecutableSkillDispatcher(options: {
  registry: SkillRegistry;
  handlers?: ExecutableSkillHandlerRegistry;
}): ExecutableSkillDispatcher;
```

- [ ] **Step 1: Implement the static default handler binding**

Bind only:

```ts
'src/security/project-path.ts#resolveProjectPath'
```

The adapter checks object fields, calls `resolveProjectPath(projectRoot, requestedPath)`, and returns `{ resolvedPath }`.

- [ ] **Step 2: Implement ordered policy enforcement**

Apply existence, kind, runtime target, capability subset, approval mode, schema input, handler lookup, handler call, and schema output checks in that order. `SkillDispatchError` must expose `code`, `skillId`, and optional issue details.

- [ ] **Step 3: Export the dispatcher API**

Add exports from `src/skills/index.ts` for dispatcher, handler registry, schema validation, and their public types.

- [ ] **Step 4: Run the focused suite and confirm GREEN**

Run: `pnpm run test:skills`

Expected: all manifest, registry, and dispatcher tests pass with zero failures.

- [ ] **Step 5: Commit the dispatcher**

```bash
git add src/skills/handlers.ts src/skills/dispatcher.ts src/skills/index.ts src/skills/dispatcher.test.ts
git commit -m "feat: dispatch executable skills with manifest policy"
```

### Task 4: Document, verify, and review the branch

**Files:**
- Modify: `browser-extension/skill-library/README.md`
- Create: `.titan/todo/issues/skill-library-pass-04.md`

**Interfaces:**
- Documents the executable runtime boundary and evidence for future skill authors.

- [ ] **Step 1: Document the executable lifecycle**

Describe that manifests do not authorize arbitrary imports, entrypoints must have static compiled bindings, callers must grant all capabilities, and approval evidence is checked before invocation.

- [ ] **Step 2: Record Pass 04 inventory and next dependency**

State that seven canonical packages remain, one executable skill is now runtime-dispatchable, and the next pass can extract additional low-risk executable wrappers using the same handler and policy boundary.

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm run typecheck
pnpm run test:skills
pnpm run check:skills
```

Expected: all commands exit zero.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm run verify
```

Expected: typecheck, all Node and integration tests, build, CLI smoke, skill catalog drift, and extension checks exit zero.

- [ ] **Step 5: Verify pull-request matrices**

Require successful jobs for:

- root Ubuntu;
- root Windows;
- existing application pipeline;
- workspace companion Linux;
- workspace companion Windows.

- [ ] **Step 6: Review the final diff**

Confirm the branch changes only skill runtime, tests, package test wiring, and documentation; confirm PR #18 files are untouched.

- [ ] **Step 7: Preserve the branch and draft PR**

Do not merge or enable auto-merge. Record the verified head SHA and exact inventory in the PR description.
