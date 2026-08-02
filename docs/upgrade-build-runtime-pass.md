# OpenBrowser v0.4.1 Build and Runtime Reliability Pass

This pass focuses on installation, deterministic verification, and release reliability.

## Changes

- Removed the accidental `openbrowser: link:` self-override from `pnpm-workspace.yaml`.
- Allowed the pinned `esbuild` package to run its required install script under pnpm 11.
- Aligned the project requirement with pnpm 11 by requiring Node.js 22 or later.
- Pinned Corepack usage to pnpm 11.2.2.
- Added `scripts/install-windows.ps1` for a verified Windows installation.
- Added a GitHub Actions workflow that installs from the frozen lockfile and runs the complete verification pipeline.
- Added a Manifest V3 extension release checker.
- Added CLI smoke testing after TypeScript compilation.
- Removed hardcoded CLI and popup version strings; both now read authoritative metadata.
- Added offline verification for security, bridge, Git, workspace, exporter, and release-configuration tests.

## Commands

```powershell
# Automated Windows installation
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1

# Dependency-free verification
pnpm run verify:offline

# Complete verification after dependency installation
pnpm run verify
```

The complete verification pipeline runs type checking, Vitest, TypeScript compilation, CLI startup help, and extension static validation.
