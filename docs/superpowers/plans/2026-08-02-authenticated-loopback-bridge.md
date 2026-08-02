# Authenticated Loopback Bridge Implementation Plan

> **Issue:** #148 — prevent the workspace companion from disclosing `BRIDGE_TOKEN` to an untrusted endpoint.

## Goal

Make privileged companion-to-bridge forwarding fail closed unless the destination is a canonical, explicitly allowed loopback origin and the process at that origin proves possession of the configured bridge secret before any bearer credential is attached.

## Security invariants

- Accept only canonical literal IPv4 or IPv6 loopback HTTP origins on approved ports.
- Reject DNS names, aliases, external addresses, credentials, paths, queries, fragments, redirects, and changed final origins.
- Send no `Authorization` header during the identity challenge.
- Bind each proof to a fresh nonce, protocol version, process UUID, and actual listening socket.
- Verify the nonce-bound HMAC with the normalized bridge token before forwarding a privileged request.
- Pin the first authenticated bridge instance UUID for the companion process.
- Refuse forwarding if a later proof identifies a different bridge process.
- Limit identity responses before parsing and treat malformed or oversized responses as authentication failures.

## Implementation tasks

- [x] Parse and validate trusted loopback endpoints.
- [x] Add a nonce-bound bridge identity proof endpoint.
- [x] Verify identity before every privileged companion request.
- [x] Disable redirects and validate final response origins.
- [x] Normalize the bridge token at the companion boundary.
- [x] Pin the authenticated bridge instance UUID.
- [x] Add unit, integration, real-socket, replacement, redirect, and oversized-response tests.
- [x] Normalize unknown Fastify errors without exposing primitive thrown values.
- [x] Confirm repository, companion, and security-policy workflows are green on the final head.
- [x] Mark PR #158 ready for review after final-head verification.
