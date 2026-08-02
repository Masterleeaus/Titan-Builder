# Titan Builder Prompt Library Architecture

## Status

Approved for implementation by the user's instruction to begin the repository scan and prompt-library work.

## Goal

Establish a canonical, standalone Markdown prompt library inside the Titan Builder browser-extension boundary without confusing content assets with the root TypeScript runtime or duplicating the existing side-panel prompt system.

## Repository evidence

The repository currently has two distinct runtime boundaries:

1. The root `src/` directory is the Node.js and TypeScript CLI/server runtime. Root `package.json` builds from `src/index.ts`, runs bridge/server tests under `src/`, and contains system-prompt assembly in `src/prompts/system.ts`.
2. `browser-extension/` is the browser-extension product boundary. Its `manifest.json` points to `browser-extension/src/background.js`, content scripts, popup files, and the side panel.

The active browser workspace libraries are already extension-owned:

- `browser-extension/src/coding-prompts.js` defines built-in prompt cards.
- `browser-extension/src/prompt-library.js` parses `${variable:default}` placeholders, expands variables, filters prompts, and normalises custom prompt records.
- `browser-extension/src/workspace-library.js` defines built-in skills and agent profiles and composes them into prompts.
- `browser-extension/src/sidepanel.html` exposes Prompts, Custom, Skills, and Agents views.
- `browser-extension/src/sidepanel.js` consumes these libraries and persists user-created items in `chrome.storage.local`.

No standalone Markdown prompt-asset directory currently exists. The existing prompt cards are concise JavaScript objects, not installable Markdown prompt documents.

## Architectural decision

### Canonical content location

Create standalone prompt documents under:

```text
browser-extension/prompt-library/<category>/<prompt-id>-<slug>.md
```

This location is inside the existing browser-extension product boundary but outside `browser-extension/src/`, which remains executable JavaScript runtime code.

### Root `src/` boundary

Do not place prompt-library content or skill-library content in root `src/`.

Root `src/` owns:

- CLI commands;
- Fastify bridge and session runtime;
- operation execution and verification;
- project context and memory;
- system prompts required by ask and agent transport modes.

Root `src/` should change only when a future pass adds CLI access to the canonical prompt catalog or shared prompt compilation tooling.

### Extension `src/` boundary

`browser-extension/src/` continues to own:

- prompt rendering and filtering;
- variable collection and expansion;
- side-panel state;
- runtime prompt routing;
- built-in skill and agent activation;
- any future catalog loader or generated index.

### Skills and agents

The current runtime source of built-in skills and agent profiles is `browser-extension/src/workspace-library.js`. Future standalone skill and agent documents should therefore remain inside the browser-extension boundary, not root `src/`.

Proposed future canonical locations are:

```text
browser-extension/skill-library/<category>/<skill-id>-<slug>.md
browser-extension/agent-library/<category>/<agent-id>-<slug>.md
```

Introducing those stores is outside prompt-library pass 01.

## Prompt document contract

Every prompt document must be a complete standalone Markdown file containing:

- Metadata
- Purpose
- Description
- Expected Outcome
- Required Inputs
- Optional Inputs
- Variables
- System Instructions
- Execution Instructions
- Reasoning Strategy
- Plugin Usage
- Expected Output Format
- Validation Rules
- Failure Handling
- Success Criteria
- Quality Metrics
- Examples
- Limitations
- Compatibility
- Knowledge Capture
- Change Log

Each prompt must solve one objective and must be reusable, parameterised, versioned, deterministic, composable, provider-neutral where practical, independently installable, and suitable for indexing by the Titan Builder Knowledge Engine.

## Runtime integration strategy

Pass 01 creates the canonical content store and first prompt document without changing runtime code.

A later dedicated pass will implement catalog loading. That pass must:

1. define an index schema for prompt metadata and file paths;
2. load packaged Markdown documents from the extension origin;
3. preserve the current `BUILTIN_CODING_PROMPTS` API during migration;
4. avoid duplicating full prompt bodies in JavaScript and Markdown;
5. retain custom prompt import/export and `chrome.storage.local` behaviour;
6. add deterministic tests for catalog loading, invalid metadata, duplicate IDs, and missing files.

Until that migration is complete, the Markdown library is the canonical authoring and version-history source, while the existing JavaScript cards remain the current UI runtime source.

## Duplicate prevention

Before adding a prompt, search:

- `browser-extension/prompt-library/`;
- `browser-extension/src/coding-prompts.js`;
- `browser-extension/src/workspace-library.js`;
- `src/prompts/`;
- documentation and `.titan/todo/issues` records.

Compare purpose, variables, workflow, expected output, tags, validation rules, and provider assumptions. Similar prompts must be upgraded, superseded, or merged rather than duplicated.

## Pass workflow

Each prompt-development pass must:

1. start from the latest `main`;
2. create a dedicated branch;
3. update `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`;
4. create or upgrade exactly one standalone Markdown prompt unless a migration pass explicitly requires supporting code;
5. validate structure, variables, scope, duplicate risk, and compatibility;
6. commit the pass;
7. open and merge a pull request into `main` after verification;
8. keep failed or blocked work on the branch rather than merging incomplete assets.

## Naming and versioning

Prompt IDs are stable and use:

```text
TB-PROMPT-<CATEGORY>-NNN
```

Filenames use:

```text
<lowercase-id>-<kebab-case-name>.md
```

Semantic versions use `MAJOR.MINOR.PATCH`:

- MAJOR: incompatible variable, output-contract, or objective change;
- MINOR: backwards-compatible capability or validation expansion;
- PATCH: wording correction, example repair, or metadata fix.

## Validation

A prompt passes publication validation only when:

- all required sections are present;
- the objective is singular and testable;
- every configurable value is parameterised;
- required and optional variables are documented;
- execution ordering is explicit;
- outputs are structurally specified;
- validation and failure behaviour are deterministic;
- examples are realistic and use declared variables;
- no project name, path, provider, branch, or repository is hardcoded unless the prompt's objective explicitly requires it;
- no existing prompt is materially duplicated;
- compatibility metadata is complete;
- the change log matches the document version.

## Pass 01 deliverables

- this architecture design;
- an implementation plan;
- the cumulative prompt roadmap;
- `TB-PROMPT-FOUND-001`, Repository Architecture Discovery;
- branch review and merge into `main`.
