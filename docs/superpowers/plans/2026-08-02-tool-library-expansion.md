# Tool Library Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Titan Builder's static approved-command registry into a backward-compatible, manifest-driven tool catalog and add four secure Git read tools plus catalog/knowledge discovery.

**Architecture:** Keep `RUN_TOOL`, operation planning, approval, and execution authoritative. Add strict public manifests and trusted bundled resolvers, then delegate the existing registry API to an immutable built-in catalog. Expose only public metadata through the authenticated bridge.

**Tech Stack:** Node.js 22, TypeScript ESM, Zod, Fastify, Node test runner, existing pnpm verification pipeline.

## Global Constraints

- Work only on `feature/tool-library-expansion`.
- Do not modify `main` directly.
- Preserve every existing tool ID and invocation shape.
- Preserve `shell: false`, current risk levels, current approval behavior, path containment, input locking, and Windows command-shim handling.
- Add no runtime dependencies.
- Do not create a parallel executor, database, browser automation path, or provider runtime.
- Maintain `.titan/todo/issues/tool-library-expansion.md` and `.titan/todo/issues/planned-tools.md` as discoveries and statuses change.

---

## File map

- Create `src/tools/manifest.ts`: strict public tool specification and validation.
- Create `src/tools/types.ts`: trusted built-in definition and resolver interfaces.
- Create `src/tools/catalog.ts`: built-in definitions, immutable registration, ID/alias resolution.
- Modify `src/tools/registry.ts`: compatibility facade over the catalog.
- Create `src/tools/knowledge.ts`: deterministic Knowledge Engine metadata export.
- Create `src/tools/index.ts`: stable public exports.
- Create `src/tools/manifest.test.ts`: specification validation tests.
- Create `src/tools/catalog.test.ts`: registration, alias, ordering, immutability tests.
- Modify `src/tools/registry.test.ts`: compatibility and four new Git tools.
- Modify `src/server/index.ts`: authenticated read-only `GET /tools` route.
- Modify `src/server/security.ts`: classify `/tools` as the existing control/read scope if required by current route mapping.
- Modify `src/server/security.test.ts`: route authorization test.
- Modify `src/server/browser-workflow.integration.test.ts` or create `src/server/tools.integration.test.ts`: endpoint contract test.
- Modify `package.json`: include new test files in `test:node`.
- Modify `README.md`: document catalog discovery and new Git tools.
- Update `.titan/todo/issues/*.md`: implementation and validation status.

---

### Task 1: Tool manifest contract

**Files:**
- Create: `src/tools/manifest.ts`
- Test: `src/tools/manifest.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `TitanToolManifest`, `validateToolManifest(input)`, `parseToolManifest(input)`, `TOOL_MANIFEST_SCHEMA_VERSION`.

- [ ] **Step 1: Write failing validation tests**

Cover a complete valid manifest; malformed canonical ID; invalid semantic version; non-object input/output schemas; duplicate aliases/dependencies/capabilities; self alias/dependency; high-risk tool with `approval: none`; missing responsibilities, security, validation, tests, documentation, examples, or compatibility.

- [ ] **Step 2: Verify the new test is included in `test:node` and fails before implementation**

Run: `node --experimental-strip-types --test src/tools/manifest.test.ts`
Expected: FAIL because `manifest.ts` does not exist.

- [ ] **Step 3: Implement strict schema and field-specific issue formatting**

Use Zod `.strict()`. Require JSON object schemas for inputs/outputs. Use canonical `titan.tool.*` IDs, semantic versions, kebab-case categories/tags, declared permissions/capabilities, services, commands, configuration, security, failure handling, validation, tests, documentation, examples, knowledge relationships, risk, approval, and compatibility.

- [ ] **Step 4: Run manifest tests**

Run: `node --experimental-strip-types --test src/tools/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/manifest.ts src/tools/manifest.test.ts package.json
git commit -m "feat: add strict Titan tool manifest contract"
```

### Task 2: Trusted catalog and compatibility registry

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/catalog.ts`
- Create: `src/tools/catalog.test.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/registry.test.ts`
- Create: `src/tools/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TitanToolManifest`, `parseToolManifest`.
- Produces: `BuiltinToolDefinition`, `ToolRegistry`, `createToolRegistry()`, `builtinToolRegistry`, and preserved registry exports.

- [ ] **Step 1: Write catalog tests**

Test deterministic ordering, canonical resolution, aliases, duplicate ID collision, duplicate alias collision, alias-to-ID collision, immutable list results, and resolver delegation.

- [ ] **Step 2: Extend registry tests before implementation**

Record every current tool's exact executable, args, risk, cwd, display command, and `shell: false` behavior as compatibility assertions.

- [ ] **Step 3: Implement trusted definition and immutable registry**

`BuiltinToolDefinition` contains a validated public manifest, a resolver `(args, projectRoot) => ToolInvocation`, and optional `(invocation) => ToolInputFile[]`. Catalog creation validates/finalizes manifests, sorts by canonical tool ID, freezes definitions, and detects collisions.

- [ ] **Step 4: Move existing tool definitions into the catalog**

Retain current helper logic for argument validation, package script allow-listing, platform commands, display quoting, Windows command-shim wrapping, and input-file locking. Preserve `src/tools/registry.ts` as the consumer-facing compatibility facade.

- [ ] **Step 5: Run catalog and registry tests**

Run: `node --experimental-strip-types --test src/tools/catalog.test.ts src/tools/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/tools/catalog.ts src/tools/catalog.test.ts src/tools/registry.ts src/tools/registry.test.ts src/tools/index.ts package.json
git commit -m "refactor: make the tool registry manifest driven"
```

### Task 3: Four secure Git read tools

**Files:**
- Modify: `src/tools/catalog.ts`
- Modify: `src/tools/registry.test.ts`
- Modify: `.titan/todo/issues/planned-tools.md`
- Modify: `.titan/todo/issues/tool-library-expansion.md`

**Interfaces:**
- Produces tool IDs: `git.root`, `git.branch.list`, `git.remote.list`, `git.show`.

- [ ] **Step 1: Add failing success and failure tests**

Assert:

```text
git.root -> git rev-parse --show-toplevel
git.branch.list -> git branch --format=%(refname:short)
git.branch.list --all -> git branch --all --format=%(refname:short)
git.remote.list -> git remote
git.show main -> git show --no-ext-diff --stat --oneline --decorate --no-renames main --
```

Reject extra args, unsupported branch modes, revisions beginning with `-`, revision ranges, reflog syntax, ancestry syntax, colon/pathspec syntax, whitespace, control characters, and backslashes.

- [ ] **Step 2: Implement fixed command templates and strict revision validation**

Do not use `git remote -v`. Preserve `shell: false`. Use a `--` separator for `git.show`.

- [ ] **Step 3: Run focused tests**

Run: `node --experimental-strip-types --test src/tools/registry.test.ts`
Expected: PASS.

- [ ] **Step 4: Update roadmap and audit log immediately**

Change implementation states to `implemented`; leave validation `pending CI` until full verification succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/tools/catalog.ts src/tools/registry.test.ts .titan/todo/issues/planned-tools.md .titan/todo/issues/tool-library-expansion.md
git commit -m "feat: add bounded Git discovery tools"
```

### Task 4: Knowledge metadata export

**Files:**
- Create: `src/tools/knowledge.ts`
- Create: `src/tools/knowledge.test.ts`
- Modify: `src/tools/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ToolRegistry` public manifests.
- Produces: `ToolKnowledgeRecord`, `createToolKnowledgeRecords(registry)`.

- [ ] **Step 1: Write failing deterministic export tests**

Assert stable IDs, summaries, keywords, category, related tools/agents/skills/workflows, dependencies, version, compatibility, and sorted deterministic output. Ensure no executable or local path fields exist.

- [ ] **Step 2: Implement database-agnostic normalized records**

Return frozen records suitable for later SQLite insertion. Do not write files or create a database.

- [ ] **Step 3: Run tests**

Run: `node --experimental-strip-types --test src/tools/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tools/knowledge.ts src/tools/knowledge.test.ts src/tools/index.ts package.json
git commit -m "feat: export tool knowledge metadata"
```

### Task 5: Authenticated tool catalog API

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/security.ts`
- Modify: `src/server/security.test.ts`
- Create: `src/server/tools.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `builtinToolRegistry`, `createToolKnowledgeRecords()`.
- Produces: `GET /tools -> { schemaVersion, tools, knowledge }`.

- [ ] **Step 1: Write route-scope and endpoint tests**

Test control-token authorization, unauthorized rejection, deterministic tool listing, all existing/new tool IDs, and absence of `executable`, `resolver`, `cwd`, environment values, or local absolute paths.

- [ ] **Step 2: Implement route classification if needed**

Map `GET /tools` to the existing authenticated control/read scope. Do not create a weaker public scope.

- [ ] **Step 3: Implement the endpoint**

Return only public manifests and normalized knowledge records. Freeze source data; serialize copies.

- [ ] **Step 4: Run server tests**

Run: `node --experimental-strip-types --test src/server/security.test.ts src/server/tools.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts src/server/security.ts src/server/security.test.ts src/server/tools.integration.test.ts package.json
git commit -m "feat: expose authenticated tool catalog metadata"
```

### Task 6: Documentation and full validation

**Files:**
- Modify: `README.md`
- Modify: `.titan/todo/issues/tool-library-expansion.md`
- Modify: `.titan/todo/issues/planned-tools.md`

**Interfaces:**
- Consumes: completed implementation and CI results.
- Produces: user/developer documentation and final status.

- [ ] **Step 1: Document tool contract and usage examples**

Document `RUN_TOOL` examples for the four new Git tools, risk/approval behavior, `GET /tools`, public/private metadata separation, and the external package-loader trust boundary.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm run typecheck
pnpm run test:node
pnpm run test:integration
pnpm run build
```

Expected: PASS.

- [ ] **Step 3: Run full repository verification**

Run: `pnpm run verify`
Expected: PASS on the available environment; GitHub Actions must verify Linux and Windows.

- [ ] **Step 4: Update operating documents**

Record exact commands/results, remaining limitations, security findings, and change statuses to `validated` only when evidence exists.

- [ ] **Step 5: Commit**

```bash
git add README.md .titan/todo/issues/tool-library-expansion.md .titan/todo/issues/planned-tools.md
git commit -m "docs: complete tool library foundation guidance"
```

### Task 7: Review and pull request

**Files:**
- Review all changed files.

**Interfaces:**
- Produces: reviewed branch and draft pull request.

- [ ] **Step 1: Run Superpowers verification-before-completion review**

Check implementation against the approved design and plan; do not claim passing status without command or CI evidence.

- [ ] **Step 2: Run CodeRabbit review**

Review correctness, security, duplication, maintainability, cross-platform behavior, and test coverage. Apply actionable findings and rerun affected verification.

- [ ] **Step 3: Compare branch to `main`**

Confirm only intended files changed and no generated secrets/build artifacts are present.

- [ ] **Step 4: Push final branch state and open a draft PR**

Title: `Tool library expansion foundation`

The PR body must summarize architecture, tools added, compatibility, security, validation evidence, deferred work, and references to `.titan/todo/issues/`.
