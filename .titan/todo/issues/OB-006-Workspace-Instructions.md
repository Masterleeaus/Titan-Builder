# OB-006 — Workspace Skills and Profiles in Every CLI Job

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: VERIFIED
- Source commit: `21e208f164fe3f53dfe7ce62459c0d9e97993083`
- Documentation verification commit: `0e7d34fc1a6d811e347f1efe3c393c0b48348046`
- Artifact SHA-256: `cbc58e8e7c7a219d14280afae3d5c65eaf7734f27a521e4e0ddff9d0b53d5699`
- Offline applicator run: `30724047581`
- Offline applicator job: `91432415821`
- Full verification run: `30724071899`
- Full verification job: `91432481816`

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
- Server jobs retain `promptBody`, the full original CLI prompt, even when the initial server suggestion is file delivery.
- The background merges the current active profile and skills, strips stale workspace sections, and constructs exactly one system-instruction wrapper.
- Delivery is recalculated from the final enriched outbound payload.
- Text and attachment paths consume the same `outboundMessage` bytes.
- File content is carried in the dispatched job as `promptFileContent`; the content script no longer fetches a stale prompt file from the bridge.
- Established and new threads use the same authoritative outbound message.
- Current workspace sections replace stale profile/skill sections rather than accumulating duplicates.

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

## Green evidence

The guarded applicator passed:

- Artifact checksum and exact nine-path allowlist.
- 111/111 dependency-free Node tests.
- Extension integrity.
- Commit and push to the repair branch.

GitHub Actions run `30724071899`, job `91432481816` passed:

- TypeScript typecheck.
- 111/111 Node tests.
- 4/4 dependency-backed integration tests.
- Production build.
- CLI smoke test.
- Manifest V3 extension integrity.

The acceptance criteria are satisfied. Workspace profile and skill instructions now reach every tested CLI-created browser job in text and attachment modes, regardless of whether the destination thread is empty or established.
