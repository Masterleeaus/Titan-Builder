# TypeScript Strict Mode Configuration

## Configuration

The project has TypeScript strict mode fully enabled in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

## Enforcement

TypeScript strict mode is enforced at multiple levels:

### 1. Build Process
The `npm run build` script includes TypeScript compilation:
```json
"build": "tsc && node scripts/verify-binary.mjs"
```

If TypeScript compilation fails, the build fails immediately, preventing any output generation.

### 2. Type Checking
The `npm run typecheck` script runs `tsc --noEmit` to validate types without emitting files.

### 3. CI/CD
The repository's verification workflow runs:
- `pnpm run typecheck` - Full type checking
- `pnpm run build` - Actual compilation with strict mode

Any type errors will fail CI/CD and block merging.

## Strict Mode Rules

The enabled rules catch:

- **`noUnusedLocals`**: Unused variables, functions, or classes
- **`noUnusedParameters`**: Unused function parameters
- **`noFallthroughCasesInSwitch`**: Missing break statements in switch cases
- **`forceConsistentCasingInFileNames`**: Inconsistent import casing
- **All strict mode checks**: Null/undefined safety, implicit any, etc.

## Verification

To verify strict mode is working:

```bash
# Should pass (no type errors)
npm run typecheck

# Should build successfully
npm run build

# Both commands will fail if strict mode catches issues
```

## Developer Guidelines

When working in strict mode:

1. **Type everything**: Avoid `any` types; use `unknown` if needed and narrow with type guards
2. **Handle nullability**: Use optional chaining (`?.`) and nullish coalescing (`??`)
3. **Remove unused code**: Delete unused variables and parameters rather than prefixing with `_`
4. **Test build locally**: Always run `npm run build` before pushing to catch type errors early

## Historical Context

Previous issues with `preserveShebang` TypeScript option were removed in build configuration fixes (tsconfig now uses only supported options).
