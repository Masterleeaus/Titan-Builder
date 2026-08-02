# Titan Builder Browser Extension and Root Runtime Deep Audit — Pass 6

Baseline: `main` at `bb06498efaa8a99f94a25e656e5055edd3948393`

This pass continues after `TB-DEEP-095` and focuses on workflow mutation concurrency, browser lease fencing, process and service identity, persisted-run integrity, configuration bootstrap races, companion credential routing, and bounded I/O.

## Findings

| ID | GitHub | Severity | Finding |
|---|---:|---|---|
| `TB-DEEP-096` | #138 | High | Serialize browser-run mutations with revisioned compare-and-swap |
| `TB-DEEP-097` | #139 | Critical | Fence provider work immediately when a browser claim lease is lost |
| `TB-DEEP-098` | #140 | High | Add bounded retry, dead-letter, and cleanup lifecycle for prompt sessions |
| `TB-DEEP-099` | #141 | Critical | Bind approved tools to resolved executable and runtime identity |
| `TB-DEEP-100` | #142 | Critical | Terminate complete process trees on timeout, cancellation, and failure |
| `TB-DEEP-101` | #143 | High | Make service supervision identity-bound and single-instance |
| `TB-DEEP-102` | #144 | High | Reuse the managed bridge service instead of starting a competing CLI server |
| `TB-DEEP-103` | #145 | High | Make bridge credential bootstrap concurrency-safe and non-clobbering |
| `TB-DEEP-104` | #146 | Critical | Integrity-bind recovered prepared artifacts to the visible run preview |
| `TB-DEEP-105` | #147 | High | Serialize project memory and history mutations without lost updates |
| `TB-DEEP-106` | #148 | Critical | Restrict companion bridge forwarding to an authenticated loopback endpoint |
| `TB-DEEP-107` | #149 | High | Bound companion indexing concurrency, file count, and total bytes |
| `TB-DEEP-108` | #150 | High | Enforce ChatGPT file export limits while streaming and after redirects |
| `TB-DEEP-109` | #151 | High | Replace cumulative browser response snapshots with bounded sequenced deltas |
| `TB-DEEP-110` | #152 | High | Route CLI context export through the canonical secure write boundary |
| `TB-DEEP-111` | #153 | Medium/High | Rotate and tail service logs without unbounded growth or full-file reads |

## Highest-priority repair order

1. `TB-DEEP-097` — browser lease fencing before provider-side effects.
2. `TB-DEEP-099` — executable and runtime identity binding.
3. `TB-DEEP-100` — complete process-tree supervision.
4. `TB-DEEP-104` — recovery integrity between prepared artifacts and visible previews.
5. `TB-DEEP-106` — privileged bridge-token destination containment.
6. `TB-DEEP-096` — per-run mutation serialization.
7. `TB-DEEP-101` — service process identity and single-instance lifecycle.
8. `TB-DEEP-103` — concurrency-safe credential bootstrap.

## Deduplication

Potential parser-envelope, cancellation, extension queue-retention, bridge handshake-timeout, public companion health, WebSocket query-token, Git helper, and cwd-dotenv findings were reconciled against existing issues rather than duplicated. New evidence should be added to those canonical issues where appropriate.

## Validation scope

This is a connector-backed static audit. Native browser, Linux race, Windows process/PID, filesystem permission, service lifecycle, large-stream, and process-tree stress tests were not executed.
