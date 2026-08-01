# OB-006 — Workspace Skills and Profiles in Every CLI Job

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: FIXED — dependency-backed verification pending
- Source commit: `21e208f164fe3f53dfe7ce62459c0d9e97993083`
- Artifact SHA-256: `cbc58e8e7c7a219d14280afae3d5c65eaf7734f27a521e4e0ddff9d0b53d5699`
- Offline applicator run: `30724047581`
- Offline applicator job: `91432415821`

## Confirmed defects

1. The extension merged active profile and skill instructions into `job.systemPrompt`, but established conversation threads returned `job.message` unchanged and therefore omitted those instructions.
2. Standard CLI messages already contained a system-instruction wrapper. The content script treated that wrapper as authoritative even though it predated extension workspace enrichment.
3. File delivery attached the bridge server's original stored prompt. Extension-side profile and skill enrichment never reached the attachment.
4. Delivery was selected before workspace enrichment, so active instructions could push a text prompt beyond the inline injection boundary without switching to attachment delivery.

## Red evidence

Failure-first tests required behavior that did not exist:

- A missing `job-payload.js` module initially failed with `ERR_MODULE_NOT_FOUND`.
- Existing source wiring conditionally composed system instructions only for empty threads.
- File attachment code fetched `/browser/prompt-file/:sessionId`, which contained the un-enriched server prompt.

## Implemented repair

- Added one pure `prepareOutboundJob` boundary in the background service worker.
- Server jobs now retain `promptBody`, the full original CLI prompt, even when the server's initial delivery suggestion is `file`.
- The background merges the current active profile and skills, strips stale workspace sections, and constructs exactly one system-instruction wrapper.
- Delivery is recalculated from the final enriched outbound payload.
- Text and attachment paths consume the same `outboundMessage` bytes.
- File content is carried in the dispatched job as `promptFileContent`; the content script no longer fetches a stale prompt file from the bridge.
- Established and new threads use the same authoritative outbound message.
- Current workspace sections replace stale profile/skill sections instead of accumulating duplicates.

## Test coverage

- Profile only.
- Skill only.
- Profile plus skill.
- Existing and empty threads.
- Text delivery.
- File delivery.
- Delivery recalculation after enrichment.
- Recovery of the full prompt body for server-suggested file jobs.
- Source-wiring guard preventing reintroduction of `/browser/prompt-file` in content delivery.
- Bridge integration asserts `promptBody`, prompt limit, and attachment note reach claimed jobs.

## Current verification

The guarded applicator passed:

- Artifact checksum and exact nine-path allowlist.
- 111/111 dependency-free Node tests.
- Extension integrity.
- Commit and push to the repair branch.

Do not mark this issue VERIFIED until the full GitHub pipeline passes typecheck, all Node tests, bridge/operation integrations, build, CLI smoke, and extension integrity on this source commit or a direct descendant.
