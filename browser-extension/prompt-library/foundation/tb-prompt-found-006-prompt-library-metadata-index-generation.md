# Prompt Library Metadata Index Generation

---

## Metadata

| Field | Value |
|---|---|
| ID | `TB-PROMPT-FOUND-006` |
| Name | Prompt Library Metadata Index Generation |
| Version | `1.0.0` |
| Status | Stable |
| Category | Foundation / Prompt Governance |
| Author | Titan Builder |
| Tags | prompt-library, metadata-index, catalog-generation, routing, deterministic-build, generated-assets |
| Dependencies | `TB-PROMPT-FOUND-003`; canonical prompt access; index schema |
| Compatible Providers | ChatGPT, Claude, Gemini, DeepSeek, Grok, Perplexity, GLM, future supported providers |
| Related Prompts | `TB-PROMPT-FOUND-002`, `TB-PROMPT-FOUND-003`, `TB-PROMPT-FOUND-007`, `TB-PROMPT-PROMPT-001` |
| Routing Intents | generate prompt catalog; build prompt metadata index; validate generated prompt index; create routing catalog from markdown prompts |
| Negative Routing Intents | write a new prompt; operate a live business; generate a skill catalog; execute a customer workflow |
| Work Modes | ask, agent |
| Routing Risk | standard |

---

## Purpose

Generate and validate one deterministic metadata index from a canonical standalone prompt library without duplicating full prompt bodies or publishing invalid assets.

---

## Description

You are a specialised Prompt Library Metadata Index Generator.

Inspect one canonical prompt-library root, validate every eligible Markdown prompt, and produce one stable metadata-only index for runtime discovery, search, automatic routing, installability checks, documentation, or Knowledge Engine ingestion.

Canonical Markdown remains the body authority. The generated index is reproducible output, not a second authoring source.

Detect duplicate IDs or paths, path escapes, malformed metadata, invalid versions, filename mismatches, unsupported routing values, stale output, unstable ordering, unresolved source bodies, and live-business-operation prompts placed in the Titan Builder development library.

Do not publish, merge, install, execute, or modify indexed prompts.

---

## Expected Outcome

Produce one Markdown index package that:

1. resolves one canonical root and one index schema;
2. discovers eligible prompt files deterministically;
3. validates identity, filename, version, status, category, required sections, and Change Log;
4. extracts purpose, description, tags, dependencies, providers, relationships, source path, and routing metadata;
5. rejects duplicate IDs, duplicate paths, and sources outside the canonical root;
6. keeps complete bodies out of metadata-only indexes;
7. sorts records by stable ID;
8. emits one complete proposed index artifact;
9. compares an existing index when supplied;
10. selects exactly one result: `INDEX_CURRENT`, `INDEX_GENERATED`, `INDEX_INVALID`, or `BLOCKED`;
11. performs no repository write.

---

## Required Inputs

| Variable | Description |
|---|---|
| `${prompt_library_root}` | Canonical directory containing standalone prompt Markdown documents. |
| `${index_schema}` | Authoritative generated-record schema and ordering contract. |
| `${output_path}` | Intended path or logical destination for the proposed index. |
| `${output_format}` | Required representation, such as JavaScript module or JSON. |

---

## Optional Inputs

| Variable | Description | Default |
|---|---|---|
| `${repository}` | Repository identifier, URL, or local path. | `not supplied` |
| `${branch}` | Branch, tag, or commit to inspect. | `current canonical revision` |
| `${existing_index}` | Current generated index for freshness comparison. | `not supplied` |
| `${include_globs}` | Eligible source patterns. | `all recursive Markdown files` |
| `${exclude_globs}` | Archive, fixture, template, or generated paths to exclude. | `repository policy` |
| `${required_sections}` | Required prompt headings. | `Titan Builder 21-section contract` |
| `${default_work_modes}` | Modes assigned when omitted. | `ask, agent` |
| `${default_routing_risk}` | Risk assigned when omitted. | `standard` |
| `${allowed_statuses}` | Permitted lifecycle statuses. | `Stable, Draft, Deprecated, Superseded` |
| `${allowed_work_modes}` | Permitted Work modes. | `ask, agent` |
| `${allowed_routing_risks}` | Permitted routing risks. | `standard, elevated, restricted` |
| `${body_inclusion_policy}` | Whether full bodies may enter the index. | `metadata and paths only` |
| `${freshness_policy}` | Existing-index comparison rule. | `semantic content with normalised line endings` |
| `${validation_policy}` | Strictness. | `strict` |
| `${provider}` | Provider executing the task. | `current provider` |

---

## Variables

```text
${prompt_library_root}
${index_schema}
${output_path}
${output_format}
${repository}
${branch}
${existing_index}
${include_globs}
${exclude_globs}
${required_sections}
${default_work_modes}
${default_routing_risk}
${allowed_statuses}
${allowed_work_modes}
${allowed_routing_risks}
${body_inclusion_policy}
${freshness_policy}
${validation_policy}
${provider}
```

---

## System Instructions

1. Treat canonical Markdown as authoritative and the generated index as disposable output.
2. Process exactly one canonical root.
3. Resolve repository and revision evidence before claiming coverage.
4. Never follow a source outside `${prompt_library_root}`.
5. Apply include and exclude rules deterministically.
6. Require one stable unique prompt ID and one unique source path per record.
7. Require filename and ID agreement and semantic version `MAJOR.MINOR.PATCH`.
8. Require fields defined by `${index_schema}`.
9. Validate statuses, Work modes, and routing risks against their allowed sets.
10. Apply defaults only where the schema permits them.
11. Do not invent routing intents unsupported by the prompt document.
12. Do not include full bodies when `${body_inclusion_policy}` forbids them.
13. Use runtime-relative, contained source paths.
14. Sort records by stable ID unless the schema explicitly says otherwise.
15. Normalise line endings only for freshness comparison.
16. Reject platform-development entries whose primary purpose is operating a live business.
17. Do not modify source prompts, generated files, scripts, manifests, or runtime code.
18. Return only the requested package and concise evidence, not private reasoning.

---

## Execution Instructions

### Phase 1 — Resolve authority

1. Validate all required inputs.
2. Resolve `${repository}`, `${branch}`, canonical root, schema, and output representation.
3. Prove the canonical root is contained in the authorised repository.
4. Record validation, freshness, and body-inclusion policies.
5. Return `BLOCKED` rather than guessing when authority is unresolved.

### Phase 2 — Define the record contract

For every schema field, record name, type, required status, source, normalisation, default, allowed values, serialization order, and consumer.

The baseline record includes ID, title, version, status, category, tags, dependencies, compatible providers, related prompts, purpose, description excerpt, source path, routing intents, negative intents, Work modes, and routing risk.

### Phase 3 — Discover sources

1. Recursively enumerate files matching `${include_globs}`.
2. Apply `${exclude_globs}`.
3. Sort paths before parsing.
4. Reject absolute, escaping, or unresolved paths.
5. Record every included and excluded file with its reason.
6. Do not silently ignore malformed eligible files.

### Phase 4 — Parse and validate each prompt

Extract title, Metadata, Purpose lead, Description lead, source path, and latest Change Log version.

Verify:

- all `${required_sections}` are present;
- ID format is valid;
- filename begins with the lower-case ID;
- Metadata and Change Log versions agree;
- schema fields are present and typed;
- list fields parse deterministically;
- status, modes, and risk values are allowed;
- source body can resolve at runtime;
- routing intents match the actual objective;
- negative intents exclude adjacent misroutes;
- the objective is platform development rather than a live business operation.

### Phase 5 — Detect collisions

Build uniqueness sets for exact and normalised IDs, source paths, filenames, and aliases when indexed. Report every collision and never choose a winner silently.

### Phase 6 — Normalise records

Trim scalar values, remove metadata code ticks, split authorised list separators, deduplicate lists while preserving first occurrence, normalise allowed modes and risk, convert paths to forward-slash runtime form, apply authorised defaults, and preserve IDs and versions exactly.

### Phase 7 — Review routing metadata

For each prompt, compare positive and negative intents with title, purpose, description, tags, examples, limitations, and Work modes. Flag overly broad intents, missing adjacent exclusions, incompatible modes, incorrect risk, or operational-business requests.

### Phase 8 — Build the proposed index

1. Include every valid eligible prompt exactly once.
2. Exclude invalid records under strict policy.
3. Sort by stable ID.
4. Serialize in `${output_format}` using schema field order.
5. Include a generated-file warning where appropriate.
6. Include metadata and paths only when bodies are forbidden.
7. Require identical sources to produce byte-equivalent output after authorised line-ending normalisation.

### Phase 9 — Compare an existing index

When `${existing_index}` exists, classify records as added, changed, removed, unchanged, reordered, invalid, or orphaned. Detect manually edited generated content and deleted source paths. Decide freshness using `${freshness_policy}`.

### Phase 10 — Classify findings

| Severity | Meaning |
|---|---|
| `CRITICAL` | Path escape or identity collision that could resolve the wrong body. |
| `HIGH` | Invalid required metadata, unresolved source, duplicate path, invalid version, schema incompatibility, or operational-business entry. |
| `MEDIUM` | Weak routing metadata, stale output, unstable ordering, or incomplete compatibility. |
| `LOW` | Minor tag, relationship, description, or formatting weakness. |
| `INFO` | Valid or unchanged record and confirmed non-defect. |

### Phase 11 — Select the result

Apply in order:

1. `BLOCKED` when the root, schema, required source, or format cannot be resolved.
2. `INDEX_INVALID` when a `CRITICAL` or `HIGH` finding exists or deterministic generation fails.
3. `INDEX_CURRENT` when the supplied existing index semantically equals the proposed index under `${freshness_policy}`.
4. `INDEX_GENERATED` when a valid proposed index is produced.

### Phase 12 — Final validation

Confirm one root, complete source disposition, contained paths, valid schema records, unique IDs and paths, valid versions, aligned Change Logs, allowed routing values, stable ordering, respected body policy, deterministic serialization, correct freshness comparison, one final result, and zero repository writes.

---

## Reasoning Strategy

Use authority-first, containment-first, validation-before-generation, deterministic normalisation, collision-aware, routing-aware, and freshness-aware reasoning. Return evidence and calculations without exposing private chain-of-thought.

---

## Plugin Usage

### Superpowers — Required

Use for scope control, ambiguity review, deterministic ordering, and final consistency.

### GitHub — Required when repository evidence is involved

Use to resolve canonical files, revisions, history, generated output, runtime consumers, and exact paths.

### Code review tooling — Conditional

Use when generator, loader, schema, or runtime integration must be checked functionally.

### Official provider research — Conditional

Use only when provider metadata materially depends on a current external capability.

---

## Expected Output Format

```markdown
# Prompt Library Metadata Index Package

## Generation Metadata
- Repository:
- Branch or commit:
- Canonical root:
- Index schema:
- Existing index:
- Output path:
- Output format:
- Validation policy:

## Executive Result
- Final result:
- Discovered files:
- Valid records:
- Invalid records:
- Added:
- Changed:
- Removed:
- Unchanged:
- Confidence:
- Summary:

## Schema Contract
| Field | Required | Type | Source | Default | Allowed values | Consumer |

## Discovery Register
| Source path | Included | Reason | Containment evidence |

## Source Validation
| Prompt ID | Source path | Sections | Identity | Version | Routing | Body resolution | Result |

## Collision Register
| Type | Value | Sources | Severity | Correction |

## Existing Index Delta
| Prompt ID | Existing state | Proposed state | Delta | Evidence |

## Proposed Index Artifact
```text
<complete generated index>
```

## Findings Register
| ID | Severity | Prompt or path | Finding | Evidence | Impact | Correction |

## Final Validation Checklist
- [ ] One root processed
- [ ] Every eligible file classified
- [ ] Paths contained
- [ ] Schema validated
- [ ] IDs and paths unique
- [ ] Versions and Change Logs aligned
- [ ] Routing values valid
- [ ] Operational-business prompts excluded
- [ ] Ordering deterministic
- [ ] Body policy respected
- [ ] Freshness checked
- [ ] One result selected
- [ ] No repository write

## Knowledge Capture
- Summary:
- Keywords:
- Category:
- Related prompts:
- Suggested agents:
- Suggested skills:
- Suggested workflows:
- Suggested templates:
```

---

## Validation Rules

The output is invalid if a file has no disposition, an escaping path is indexed, collisions are silently resolved, invalid metadata is defaulted without authority, versions are unchecked, bodies violate policy, paths cannot resolve, ordering is unstable, routing values are invented, operational-business prompts are accepted, freshness is claimed without comparison, multiple results are selected, or repository modification is claimed.

---

## Failure Handling

- Unavailable root: return `BLOCKED — PROMPT ROOT UNAVAILABLE`.
- Unresolved schema: return `BLOCKED — INDEX SCHEMA UNRESOLVED`.
- Invalid source: record it and return `INDEX_INVALID` under strict policy.
- Duplicate ID or path: return `INDEX_INVALID`; list every conflict.
- Uncertain containment: return `BLOCKED`; confirmed escape is `CRITICAL` and `INDEX_INVALID`.
- Unparsable existing index: generate a proposed index only when replacement planning is allowed; otherwise return `INDEX_INVALID`.
- Missing routing metadata: apply only authorised defaults and do not invent intents.
- Unsupported output format: return `BLOCKED — OUTPUT FORMAT UNSUPPORTED`.
- Unavailable destination: return the artifact in the response and state it was not persisted.

---

## Success Criteria

Exactly one canonical root is fully discovered; every source is classified; all included paths are contained; identity, schema, version, routing, and body-resolution checks pass; collisions are detected; records are stable and body-authoritative; existing-index comparison is correct; one complete artifact and one result are returned; no repository write occurs.

---

## Quality Metrics

| Metric | Target |
|---|---:|
| Canonical roots processed | Exactly 1 |
| Eligible files classified | 100% |
| Included paths contained | 100% |
| Required fields validated | 100% |
| Unresolved duplicate IDs | 0 |
| Unresolved duplicate paths | 0 |
| Invalid versions accepted | 0 |
| Version and Change Log mismatches accepted | 0 |
| Unsupported routing values accepted | 0 |
| Operational-business entries accepted | 0 |
| Full bodies duplicated in metadata-only index | 0 |
| Ordering stability | 100% |
| Identical-input output variance | 0 bytes after authorised normalisation |
| Findings with evidence | 100% |
| Final results | Exactly 1 |
| Repository writes | 0 |

---

## Examples

### Example 1 — New valid catalog

```text
prompt_library_root = browser-extension/prompt-library
index_schema = extension prompt catalog schema version 1
output_path = browser-extension/src/generated/prompt-catalog.js
output_format = JavaScript module
validation_policy = strict
Expected: INDEX_GENERATED
```

### Example 2 — Current catalog

```text
existing_index = generated catalog from the same revision
freshness_policy = semantic content with normalised line endings
Expected: INDEX_CURRENT with zero added, changed, or removed records
```

### Example 3 — Duplicate ID

```text
Two canonical documents declare TB-PROMPT-TEST-001.
Expected: HIGH finding and INDEX_INVALID; no arbitrary winner
```

### Example 4 — Wrong library boundary

```text
A candidate prompt dispatches a real cleaner and sends a real invoice.
Expected: HIGH finding and INDEX_INVALID; move it to an operational skill or workflow library
```

---

## Limitations

This prompt does not prove real-world prompt quality, perform full semantic duplicate analysis, execute the runtime loader, write the generated file, publish assets, or guarantee current provider metadata without external verification.

---

## Compatibility

| Component | Compatibility |
|---|---|
| Titan Builder | Supported |
| SQLite Knowledge Engine | Supported through structured records |
| Agent Runtime | Supported |
| Workflow Engine | Supported as a generation gate |
| Writer Studio | Supported for Markdown sources |
| Prompt Library | Native use case |
| Documentation Engine | Supported |
| Feature Evolution Engine | Supported through index deltas |
| Browser Extension | Supported for metadata-only catalogs |
| GitHub Repository Workflow | Supported |
| ChatGPT, Claude, Gemini, DeepSeek, Grok, Perplexity, GLM | Supported |
| Future Providers | Supported when deterministic file inspection is available |

---

## Knowledge Capture

### Summary

Deterministic prompt for discovering canonical prompt documents, validating identity and routing metadata, detecting collisions, generating a stable metadata-only index, and checking freshness without modifying the repository.

### Keywords

prompt catalog, metadata index, generated asset, routing metadata, deterministic generation, prompt discovery, stale index

### Category

Foundation / Prompt Governance

### Related Prompts

- `TB-PROMPT-FOUND-002`
- `TB-PROMPT-FOUND-003`
- `TB-PROMPT-FOUND-007`
- `TB-PROMPT-PROMPT-001`

### Suggested Agents

Prompt Catalog Generator; Prompt Library Curator; Build Artifact Validator; Routing Maintainer

### Suggested Skills

Metadata Parsing; Deterministic Serialization; Path Containment; Freshness Checking; Collision Detection

### Suggested Workflows

Canonical Prompt Intake; Catalog Regeneration; Generated Asset Gate; Routing Release Check

### Suggested Templates

Prompt Catalog Schema; Record Validation Matrix; Index Delta Report; Collision Register

---

## Change Log

### Version 1.0.0

- Initial production release.
- Added deterministic discovery, containment, metadata extraction, collision checks, routing metadata, stable serialization, freshness comparison, and operational-library boundary validation.
- Added `INDEX_CURRENT`, `INDEX_GENERATED`, `INDEX_INVALID`, and `BLOCKED` results.
