# OB-005 — Large ZIP Export Crash

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: VERIFIED
- Implementation commit: `97c01df9b4602108dc21665ed18b5e57b6895353`
- Regression-test commit: `f60206a8084d559e8d727a7c0c80b4d54210d31b`
- Verification run: `30723807441`
- Verification job: `91431798561`

## Confirmed defect

The store-only ZIP exporter assembled arrays with spread operations:

- `local.push(...data)`
- `Uint8Array.from([...local, ...central, ...end])`

Large entry data became function arguments and exceeded the JavaScript call-stack/argument limit. The audit reproduced crashes at 500 KB, 1 MB, and 15 MB despite the extension advertising a 15 MB file limit.

## Red evidence

The failure-first boundary suite reproduced `RangeError: Maximum call stack size exceeded` for:

- 500,000-byte single entry.
- 1,000,000-byte single entry.
- 5,000,000-byte single entry.
- 15,000,000-byte single entry.
- Three 5,000,000-byte entries in one archive.

## Implemented repair

- Precomputes local-header, central-directory, and end-record lengths.
- Allocates one final `Uint8Array` of the exact required size.
- Writes numeric fields directly through `DataView` in little-endian order.
- Copies names and file data with `Uint8Array.set()` rather than spread syntax.
- Uses a table-driven CRC32 implementation to keep 15 MB exports fast.
- Enforces classic ZIP limits for entry count, filename length, entry size, offsets, and central-directory size.
- Verifies the final cursor exactly matches the preallocated output length.

## Green evidence

GitHub Actions run `30723807441`, job `91431798561` passed:

- All five production-scale ZIP boundary tests.
- 106/106 Node tests.
- 4/4 integration tests.
- TypeScript typecheck.
- Production build.
- CLI smoke test.
- Extension integrity check.

Observed CI durations for the largest cases:

- 15 MB single entry: approximately 244 ms.
- Three-file 15 MB total: approximately 235 ms.

The advertised 15 MB export boundary is now covered by a release regression test and passes without call-stack overflow.
