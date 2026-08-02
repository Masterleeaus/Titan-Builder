# Canonical Guidance Skill Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five temporary browser guidance fallbacks with canonical Titan skill packages while preserving every legacy ID through manifest aliases.

**Architecture:** Add five strict guidance packages to the canonical filesystem library, generate the extension catalog from those packages, then remove the hard-coded fallback registry. Existing workspace composition continues to resolve stored and profile IDs through the extension registry, so consumers receive canonical records without changing their saved configuration.

**Tech Stack:** TypeScript, JavaScript ES modules, Node test runner, Zod manifest validation, generated JavaScript catalog, pnpm, GitHub Actions.

## Global Constraints

- Start from `main` commit `09ce008b0fd024fcfd92262a221a02ab9fa30045` on `feature/skill-library-pass-03`.
- Canonical IDs must use the exact `titan.guidance.*` names in the approved design.
- Preserve `testing`, `security`, `architecture`, `git`, and `performance` only as aliases.
- Do not rewrite, migrate, or delete custom user skills.
- Do not add executable entrypoints, capabilities, permissions, or approval requirements.
- Do not modify the agent-profile catalog.
- Do not merge into `main` automatically.

---

### Task 1: Lock the migration contract with failing extension tests

**Files:**
- Modify: `browser-extension/src/skill-registry.test.mjs`
- Modify: `browser-extension/src/workspace-skill-activation.test.mjs`

**Interfaces:**
- Consumes: `BUILTIN_SKILLS`, `resolveBuiltinSkillId()`, `resolveWorkspaceContext()`.
- Produces: test expectations for the five canonical IDs and six total legacy alias mappings.

- [ ] **Step 1: Replace the fallback-presence test with canonical migration assertions**

```js
const LEGACY_TO_CANONICAL = Object.freeze({
  debugging: 'titan.guidance.systematic-debugging',
  testing: 'titan.guidance.test-driven-development',
  security: 'titan.guidance.extension-security',
  architecture: 'titan.guidance.architecture-review',
  git: 'titan.guidance.git-discipline',
  performance: 'titan.guidance.browser-performance',
});

test('resolves every built-in legacy id to a canonical guidance skill', () => {
  for (const [legacyId, canonicalId] of Object.entries(LEGACY_TO_CANONICAL)) {
    assert.equal(resolveBuiltinSkillId(legacyId), canonicalId);
    assert.ok(BUILTIN_SKILLS.some((skill) => skill.id === canonicalId));
    assert.equal(BUILTIN_SKILLS.some((skill) => skill.id === legacyId), false);
  }
});
```

- [ ] **Step 2: Update profile activation expectations**

```js
assert.ok(context.skills.some((skill) => skill.id === 'titan.guidance.systematic-debugging'));
assert.ok(context.skills.some((skill) => skill.id === 'titan.guidance.test-driven-development'));
assert.ok(context.skills.some((skill) => skill.id === 'titan.guidance.git-discipline'));
assert.equal(context.skills.some((skill) => ['debugging', 'testing', 'git'].includes(skill.id)), false);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm exec node --test browser-extension/src/skill-registry.test.mjs browser-extension/src/workspace-skill-activation.test.mjs
```

Expected: FAIL because the five skills still have legacy IDs and no canonical aliases.

- [ ] **Step 4: Commit the red tests**

```bash
git add browser-extension/src/skill-registry.test.mjs browser-extension/src/workspace-skill-activation.test.mjs
git commit -m "test: define canonical guidance migration contract"
```

### Task 2: Add five canonical guidance packages

**Files:**
- Create: `browser-extension/skill-library/packages/test-driven-development/manifest.json`
- Create: `browser-extension/skill-library/packages/test-driven-development/instructions.md`
- Create: `browser-extension/skill-library/packages/extension-security/manifest.json`
- Create: `browser-extension/skill-library/packages/extension-security/instructions.md`
- Create: `browser-extension/skill-library/packages/architecture-review/manifest.json`
- Create: `browser-extension/skill-library/packages/architecture-review/instructions.md`
- Create: `browser-extension/skill-library/packages/git-discipline/manifest.json`
- Create: `browser-extension/skill-library/packages/git-discipline/instructions.md`
- Create: `browser-extension/skill-library/packages/browser-performance/manifest.json`
- Create: `browser-extension/skill-library/packages/browser-performance/instructions.md`

**Interfaces:**
- Consumes: Titan Skill Manifest schema version `1`.
- Produces: five discoverable guidance packages with aliases matching the old IDs.

- [ ] **Step 1: Create each manifest using the systematic-debugging package shape**

Every manifest must set:

```json
{
  "schemaVersion": "1",
  "version": "1.0.0",
  "status": "stable",
  "kind": "guidance",
  "owner": "Titan Builder",
  "runtimeTargets": ["cli", "extension-sidepanel"],
  "instructions": "instructions.md",
  "inputs": {"type": "object", "additionalProperties": false, "properties": {}},
  "outputs": {"type": "object", "additionalProperties": false, "properties": {}},
  "dependencies": [],
  "capabilities": [],
  "risk": "READ",
  "approval": "none",
  "compatibility": {
    "minTitanVersion": "0.5.0",
    "platforms": ["linux", "windows", "macos", "browser"]
  }
}
```

Use the exact IDs, names, descriptions, tags, categories, and aliases from the design document.

- [ ] **Step 2: Create the five instruction files**

Each file must contain one focused paragraph matching the approved instruction content and must not mention implementation details unique to the old fallback array.

- [ ] **Step 3: Generate the catalog**

Run:

```bash
pnpm run generate:skills
```

Expected: `browser-extension/src/generated/skill-catalog.js` contains seven packages total and six guidance instruction records.

- [ ] **Step 4: Run focused migration tests**

Run:

```bash
pnpm run test:skills
pnpm exec node --test browser-extension/src/skill-registry.test.mjs browser-extension/src/workspace-skill-activation.test.mjs
```

Expected: extension tests still fail until the fallback registry is removed, while root manifest discovery passes.

- [ ] **Step 5: Commit canonical packages and generated catalog**

```bash
git add browser-extension/skill-library/packages browser-extension/src/generated/skill-catalog.js
git commit -m "feat: add canonical built-in guidance skill packages"
```

### Task 3: Remove the temporary fallback registry

**Files:**
- Modify: `browser-extension/src/skill-registry.js`
- Test: `browser-extension/src/skill-registry.test.mjs`
- Test: `browser-extension/src/workspace-skill-activation.test.mjs`

**Interfaces:**
- Consumes: `GENERATED_SKILL_CATALOG`.
- Produces: `createExtensionSkillRegistry({ generatedSkills? })`, `BUILTIN_SKILLS`, `ALL_BUILTIN_SKILLS`, `resolveBuiltinSkillId()`.

- [ ] **Step 1: Delete `LEGACY_GUIDANCE_SKILLS`**

Remove the complete hard-coded fallback array.

- [ ] **Step 2: Remove the `legacySkills` option and loop**

Change the factory signature to:

```js
export function createExtensionSkillRegistry({
  generatedSkills = GENERATED_SKILL_CATALOG,
} = {}) {
```

Delete:

```js
for (const legacy of legacySkills) add(Object.freeze({ ...legacy }), []);
```

- [ ] **Step 3: Update the collision test fixture**

Call `createExtensionSkillRegistry({ generatedSkills: [...] })` without `legacySkills`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec node --test browser-extension/src/skill-registry.test.mjs browser-extension/src/workspace-skill-activation.test.mjs
pnpm run test:skills
pnpm run check:skills
```

Expected: all pass.

- [ ] **Step 5: Commit fallback removal**

```bash
git add browser-extension/src/skill-registry.js browser-extension/src/skill-registry.test.mjs browser-extension/src/workspace-skill-activation.test.mjs
git commit -m "refactor: remove legacy guidance skill fallbacks"
```

### Task 4: Add repository-level package discovery coverage

**Files:**
- Modify: `src/skills/registry.test.ts`

**Interfaces:**
- Consumes: `loadSkillRegistry(libraryRoot)` and the real canonical package directory.
- Produces: regression coverage for the exact seven-package library and all six aliases.

- [ ] **Step 1: Add a real-library discovery test**

```ts
test('loads the canonical repository skill library and resolves all built-in aliases', async () => {
  const libraryRoot = path.resolve('browser-extension/skill-library/packages');
  const registry = await loadSkillRegistry(libraryRoot);
  const ids = registry.list().map((skill) => skill.manifest.id);

  assert.deepEqual(ids, [
    'titan.guidance.architecture-review',
    'titan.guidance.browser-performance',
    'titan.guidance.extension-security',
    'titan.guidance.git-discipline',
    'titan.guidance.systematic-debugging',
    'titan.guidance.test-driven-development',
    'titan.security.project-path-containment',
  ]);
  assert.equal(registry.canonicalId('testing'), 'titan.guidance.test-driven-development');
  assert.equal(registry.canonicalId('security'), 'titan.guidance.extension-security');
  assert.equal(registry.canonicalId('architecture'), 'titan.guidance.architecture-review');
  assert.equal(registry.canonicalId('git'), 'titan.guidance.git-discipline');
  assert.equal(registry.canonicalId('performance'), 'titan.guidance.browser-performance');
});
```

- [ ] **Step 2: Run root skill tests**

Run:

```bash
pnpm run test:skills
```

Expected: PASS with the real library discovered deterministically.

- [ ] **Step 3: Commit repository discovery coverage**

```bash
git add src/skills/registry.test.ts
git commit -m "test: verify canonical repository skill inventory"
```

### Task 5: Document and verify Pass 03

**Files:**
- Create: `.titan/todo/issues/skill-library-pass-03.md`
- Modify: `browser-extension/skill-library/README.md`
- Verify: repository and companion workflows.

**Interfaces:**
- Consumes: final canonical registry and generated catalog.
- Produces: accurate operator documentation and cross-platform verification evidence.

- [ ] **Step 1: Update the library README**

Document that all six built-in guidance skills are canonical, legacy IDs are aliases, and the fallback registry has been removed.

- [ ] **Step 2: Add the Pass 03 completion record**

Record:

```text
Canonical packages: 7
Canonical guidance skills: 6
Canonical executable skills: 1
Temporary legacy guidance fallbacks: 0
```

State the next pass as manifest-driven executable dispatch and permission enforcement, not more guidance migration.

- [ ] **Step 3: Run complete local verification where available**

Run:

```bash
pnpm run verify
pnpm --dir browser-extension run verify
```

Expected: PASS. If the execution environment cannot install or run locally, use the repository's Ubuntu and Windows Actions matrices as the authoritative gate.

- [ ] **Step 4: Review the final diff against current `main`**

Confirm that no agent-profile catalog, executable runtime, permissions, or custom skill code changed.

- [ ] **Step 5: Commit documentation**

```bash
git add .titan/todo/issues/skill-library-pass-03.md browser-extension/skill-library/README.md
git commit -m "docs: record canonical guidance skill migration"
```

- [ ] **Step 6: Push and open a draft PR**

Open a draft pull request targeting `main`. Do not enable auto-merge and do not merge it.

- [ ] **Step 7: Verify all five GitHub Actions gates**

Required successful jobs:

- root Ubuntu;
- root Windows;
- existing application pipeline;
- workspace companion Linux;
- workspace companion Windows.
