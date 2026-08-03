# Skill Deprecation Policy

This document outlines how skills are deprecated and eventually removed from Titan Builder.

## Deprecation Status

Skills have three status levels defined in the skill manifest:

- **experimental**: Early-stage skills that may change significantly. Users should expect breaking changes.
- **stable**: Production-ready skills. Changes follow semantic versioning.
- **deprecated**: Skills that are no longer recommended and will be removed in a future version.

## Deprecation Process

When a skill needs to be deprecated:

1. **Update the manifest** with `status: "deprecated"` and include deprecation metadata:
   ```json
   {
     "status": "deprecated",
     "deprecation": {
       "message": "This skill has been superseded by <new-skill>. See <migration guide> for instructions.",
       "replacedBy": "titan.new-skill-name"
     }
   }
   ```

2. **Create a migration guide** documenting:
   - Why the skill is being deprecated
   - What users should use instead
   - Step-by-step migration instructions
   - Any breaking changes

3. **Announce the deprecation** in release notes with:
   - Removal timeline (e.g., "will be removed in v2.0")
   - Migration path
   - Link to migration guide

4. **Provide deprecation warnings** when deprecated skills are:
   - Loaded or initialized
   - Invoked or executed
   - Listed in UI/CLI

## Removal Timeline

Deprecated skills follow this timeline:

- **Deprecation announced**: Users notified with migration path
- **Support period**: Minimum 2 minor versions (e.g., 1.5 → 1.7) of continued support
- **Removal**: Skill is removed in the next major version (e.g., v2.0)

## Migration Guides

Migration guides should be placed in `docs/migrations/` with the pattern:
- `docs/migrations/skill-{skill-name}.md`

Each guide should include:
- Reason for deprecation
- Feature comparison with replacement
- Step-by-step migration instructions
- Example transformations
- Q&A for common issues

## Validation

The skill manifest schema enforces that:
- All deprecated skills have deprecation metadata
- The deprecation.message is non-empty
- The deprecation.replacedBy (if provided) references a valid skill ID

See `src/skills/manifest.ts` for validation rules.
